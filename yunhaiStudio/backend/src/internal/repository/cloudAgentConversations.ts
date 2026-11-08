// 对应 backend/internal/repository/cloud_agent_conversations.go
// 云端 Agent 对话目录与接续校验。

import type { CloudAgentExecution } from "@/internal/model/cloudAgent";
import type { Task } from "@/internal/model/modelsTask";
import { mapCloudAgentExecution, type CloudAgentExecutionRow } from "./cloudAgent";
import { recordNotFound, Repository } from "./repository";
import type { TaskRow } from "./repositoryTasks";

export interface CloudAgentHistoryCursor {
  createdAt: string;
  id: string;
}

const cloudAgentConversationIdentity = `COALESCE(NULLIF("conversation_id", ''), "id")`;

// 目录轮询只需要控制列，绝不载入 journal。
const cloudAgentHistoryColumns = `"id", "user_id", "conversation_id", "parent_id", "title", "canvas_id", "status", "revision", "cleanup_pending", "created_at", "updated_at"`;

export async function cloudAgentConversations(
  repo: Repository,
  userId: string,
  canvasId: string,
  before: CloudAgentHistoryCursor | null,
  limit: number,
): Promise<CloudAgentExecution[]> {
  const params: (string | number)[] = [userId, canvasId];
  let query = `SELECT e."id", e."user_id", e."conversation_id", e."parent_id", e."title", e."canvas_id", e."status", e."revision", e."cleanup_pending", e."created_at", e."updated_at"
    FROM "cloud_agent_executions" e
    WHERE e."user_id" = ?
    AND EXISTS (SELECT 1 FROM "cloud_agent_executions" c WHERE c."user_id" = e."user_id" AND c."canvas_id" = ?
      AND COALESCE(NULLIF(c."conversation_id", ''), c."id") = COALESCE(NULLIF(e."conversation_id", ''), e."id"))
    AND NOT EXISTS (SELECT 1 FROM "cloud_agent_executions" n WHERE n."user_id" = e."user_id"
      AND COALESCE(NULLIF(n."conversation_id", ''), n."id") = COALESCE(NULLIF(e."conversation_id", ''), e."id")
      AND (n."created_at" > e."created_at" OR (n."created_at" = e."created_at" AND n."id" > e."id")))`;
  if (before !== null) {
    query += ' AND (e."created_at" < ? OR (e."created_at" = ? AND e."id" < ?))';
    params.push(before.createdAt, before.createdAt, before.id);
  }
  query += ' ORDER BY e."created_at" DESC, e."id" DESC LIMIT ?';
  params.push(limit);
  const rows = await repo.db.all<CloudAgentExecutionRow>(query, params);
  return rows.map(mapCloudAgentExecution);
}

export async function cloudAgentConversationRuns(
  repo: Repository,
  userId: string,
  conversationId: string,
  after: CloudAgentHistoryCursor | null,
  limit: number,
): Promise<CloudAgentExecution[]> {
  const params: (string | number)[] = [userId, conversationId];
  let query = `SELECT ${cloudAgentHistoryColumns} FROM "cloud_agent_executions" WHERE "user_id" = ? AND ${cloudAgentConversationIdentity} = ?`;
  if (after !== null) {
    query += ' AND ("created_at" > ? OR ("created_at" = ? AND "id" > ?))';
    params.push(after.createdAt, after.createdAt, after.id);
  }
  query += ' ORDER BY "created_at" ASC, "id" ASC LIMIT ?';
  params.push(limit);
  const rows = await repo.db.all<CloudAgentExecutionRow>(query, params);
  return rows.map(mapCloudAgentExecution);
}

// 只读控制列，供客户端按 revision 判断对话是否变化，不载入事件。
export async function cloudAgentConversationLatest(
  repo: Repository,
  userId: string,
  conversationId: string,
): Promise<CloudAgentExecution> {
  const rows = await repo.db.all<CloudAgentExecutionRow>(
    `SELECT ${cloudAgentHistoryColumns} FROM "cloud_agent_executions" WHERE "user_id" = ? AND ${cloudAgentConversationIdentity} = ? ORDER BY "created_at" DESC, "id" DESC LIMIT 1`,
    [userId, conversationId],
  );
  if (!rows.length) throw recordNotFound;
  return mapCloudAgentExecution(rows[0]);
}

export async function cloudAgentConversationExists(repo: Repository, userId: string, conversationId: string): Promise<boolean> {
  const rows = await repo.db.all<{ id: string }>(
    `SELECT "id" FROM "cloud_agent_executions" WHERE "user_id" = ? AND ${cloudAgentConversationIdentity} = ? LIMIT 1`,
    [userId, conversationId],
  );
  return rows.length > 0;
}

export const errCloudAgentStaleParent = new Error("对话已有更新，请同步最新一轮后再发送");

// 同一父轮的接续先取得数据库行锁，再检查最新轮次与未落检查点的预留任务。
// 该检查和任务、积分预留同事务提交，浏览器不能用旧上下文另开收费分支。
export async function requireCurrentCloudAgentParent(repo: Repository, task: Task): Promise<void> {
  if (task.operation !== "cloud_agent" || (task.inputJson ?? "") === "") return;
  const input = JSON.parse(task.inputJson) as unknown;
  const parentId = cloudAgentParentId(input);
  if (parentId === "") return;
  const locked = await repo.db.run(
    'UPDATE "cloud_agent_executions" SET "revision" = "revision" WHERE "id" = ? AND "user_id" = ?',
    [parentId, task.userId],
  );
  if (locked !== 1) throw recordNotFound;
  const parentRows = await repo.db.all<CloudAgentExecutionRow>(
    `SELECT ${cloudAgentHistoryColumns} FROM "cloud_agent_executions" WHERE "id" = ? AND "user_id" = ? LIMIT 1`,
    [parentId, task.userId],
  );
  if (!parentRows.length) throw recordNotFound;
  const parent = mapCloudAgentExecution(parentRows[0]);
  const conversationId = parent.conversationId !== "" ? parent.conversationId : parent.id;
  const latestRows = await repo.db.all<{ id: string }>(
    `SELECT "id" FROM "cloud_agent_executions" WHERE "user_id" = ? AND ${cloudAgentConversationIdentity} = ? ORDER BY "created_at" DESC, "id" DESC LIMIT 1`,
    [task.userId, conversationId],
  );
  if (!latestRows.length) throw recordNotFound;
  if (latestRows[0].id !== parentId || !cloudAgentParentTerminal(parent.status) || parent.cleanupPending) {
    throw errCloudAgentStaleParent;
  }
  // 刚准入的子任务可能还没有执行检查点。它不可变的任务输入已经记录了父轮，
  // 这个空档不会放进第二个子任务，即使对话迁移到另一个画布。
  const reservations = await repo.db.all<TaskRow>(
    `SELECT "id", "input_json" FROM "tasks" WHERE "user_id" = ? AND "operation" = 'cloud_agent' AND "agent_execution_ready" = false
      AND NOT EXISTS (SELECT 1 FROM "cloud_agent_executions" e WHERE e."id" = "tasks"."id" AND e."user_id" = "tasks"."user_id")`,
    [task.userId],
  );
  for (const reservation of reservations) {
    if ((reservation.id ?? "") === task.id) continue;
    let pendingParentId = "";
    try {
      pendingParentId = cloudAgentParentId(JSON.parse(reservation.input_json ?? ""));
    } catch {
      continue;
    }
    if (pendingParentId === parentId) throw errCloudAgentStaleParent;
  }
}

function cloudAgentParentId(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const agent = (input as { cloudAgent?: unknown }).cloudAgent;
  if (typeof agent !== "object" || agent === null) return "";
  const parentId = (agent as { parentId?: unknown }).parentId;
  return typeof parentId === "string" ? parentId : "";
}

function cloudAgentParentTerminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "rejected";
}
