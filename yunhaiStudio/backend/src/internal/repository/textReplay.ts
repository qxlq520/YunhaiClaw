// 对应 backend/internal/repository/text_replay.go
// text_replay 任务的增量文本回放：限流、草稿归并、过期清理与原子收尾。

import {
  taskStatusCancelled,
  taskStatusFailed,
  taskStatusSucceeded,
  taskStatusTextReplay,
} from "@/internal/model/models";
import type { TaskTextDelta } from "@/internal/model/modelsTask";
import { recordNotFound, Repository, toNullableIso } from "./repository";
import { newRepositoryId } from "./finance";

export const errTextReplayClosed = new Error("该文本任务已结束");
export const errTextReplayQuotaExceeded = new Error("文本回放额度已用完");

export interface TextReplayLimits {
  maxTaskBytes: number;
  maxUserBytes: number;
  maxTaskEvents: number;
}

export interface TextReplayStats {
  eventCount: number;
  taskCount: number;
  byteCount: number;
  oldestAt: string | null;
}

interface TaskTextDeltaRow {
  id: string;
  user_id: string;
  task_id: string;
  sequence: number;
  content: string;
  byte_count: number;
  created_at: string | null;
  expires_at: string | null;
}

function mapTaskTextDelta(row: TaskTextDeltaRow): TaskTextDelta {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    sequence: Number(row.sequence ?? 0),
    content: row.content ?? "",
    byteCount: Number(row.byte_count ?? 0),
    createdAt: row.created_at ?? "",
    expiresAt: row.expires_at ?? "",
  };
}

// 追加增量时同时锁定任务行，把额度判断和写入放在一个事务里；
// 否则并发分片会一起通过额度检查，导致用户配额被突破。
export async function appendTaskTextDelta(
  repo: Repository,
  userId: string,
  taskId: string,
  content: string,
  expiresAt: string,
  limits: TextReplayLimits,
): Promise<TaskTextDelta> {
  return repo.transaction(async (tx) => {
    const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    const tasks = await tx.db.all<{ id: string; user_id: string; status: string }>(
      `SELECT "id", "user_id", "status" FROM "tasks" WHERE "id" = ? AND "user_id" = ? LIMIT 1${locking}`,
      [taskId, userId],
    );
    if (!tasks.length) throw recordNotFound;
    const status = tasks[0].status;
    if (status === taskStatusSucceeded || status === taskStatusFailed || status === taskStatusCancelled) {
      throw errTextReplayClosed;
    }
    const usageRows = await tx.db.all<{ count: number; bytes: number; max: number }>(
      'SELECT COUNT(*) AS "count", COALESCE(SUM("byte_count"), 0) AS "bytes", COALESCE(MAX("sequence"), 0) AS "max" FROM "task_text_deltas" WHERE "task_id" = ?',
      [taskId],
    );
    const taskUsage = {
      count: Number(usageRows[0]?.count ?? 0),
      bytes: Number(usageRows[0]?.bytes ?? 0),
      max: Number(usageRows[0]?.max ?? 0),
    };
    const userRows = await tx.db.all<{ bytes: number }>(
      'SELECT COALESCE(SUM("byte_count"), 0) AS "bytes" FROM "task_text_deltas" WHERE "user_id" = ?',
      [userId],
    );
    const userBytes = Number(userRows[0]?.bytes ?? 0);
    const incoming = Buffer.byteLength(content, "utf8");
    if (
      taskUsage.count + 1 > limits.maxTaskEvents ||
      taskUsage.bytes + incoming > limits.maxTaskBytes ||
      userBytes + incoming > limits.maxUserBytes
    ) {
      throw errTextReplayQuotaExceeded;
    }
    const created: TaskTextDelta = {
      id: newRepositoryId(),
      userId,
      taskId,
      sequence: taskUsage.max + 1,
      content,
      byteCount: incoming,
      createdAt: new Date().toISOString(),
      expiresAt,
    };
    await tx.db.run(
      'INSERT INTO "task_text_deltas" ("id", "user_id", "task_id", "sequence", "content", "byte_count", "created_at", "expires_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [created.id, created.userId, created.taskId, created.sequence, created.content, created.byteCount, created.createdAt, created.expiresAt],
    );
    return created;
  });
}

export async function taskTextDeltas(
  repo: Repository,
  userId: string,
  taskId: string,
  after: number,
  limit: number,
): Promise<TaskTextDelta[]> {
  const effectiveLimit = limit <= 0 || limit > 1000 ? 1000 : limit;
  const rows = await repo.db.all<TaskTextDeltaRow>(
    'SELECT * FROM "task_text_deltas" WHERE "user_id" = ? AND "task_id" = ? AND "sequence" > ? ORDER BY "sequence" ASC LIMIT ?',
    [userId, taskId, after, effectiveLimit],
  );
  return rows.map(mapTaskTextDelta);
}

export async function compactTaskTextDeltas(
  repo: Repository,
  taskId: string,
  expiresAt: string,
  keepDraft: boolean,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    const tasks = await tx.db.all<{ id: string; text_draft: string | null }>(
      `SELECT "id", "text_draft" FROM "tasks" WHERE "id" = ? LIMIT 1${locking}`,
      [taskId],
    );
    if (!tasks.length) throw recordNotFound;
    if (keepDraft) {
      const items = await tx.db.all<{ content: string | null }>(
        'SELECT "content" FROM "task_text_deltas" WHERE "task_id" = ? ORDER BY "sequence" ASC',
        [taskId],
      );
      if ((tasks[0].text_draft ?? "") === "") {
        const draft = items.map((item) => item.content ?? "").join("");
        await tx.db.run('UPDATE "tasks" SET "text_draft" = ? WHERE "id" = ?', [draft, taskId]);
      }
    }
    await tx.db.run('UPDATE "task_text_deltas" SET "expires_at" = ? WHERE "task_id" = ?', [expiresAt, taskId]);
  });
}

// 清理过期增量前先把失败/取消任务的未归并内容写入 text_draft，
// 保证回放窗口关闭后用户仍能看到已生成的部分文本。
export async function cleanupTaskTextDeltas(repo: Repository, now: string): Promise<number> {
  return repo.transaction(async (tx) => {
    const taskRows = await tx.db.all<{ task_id: string }>(
      'SELECT DISTINCT "task_id" FROM "task_text_deltas" WHERE "expires_at" <= ?',
      [now],
    );
    for (const row of taskRows) {
      const taskId = row.task_id;
      const tasks = await tx.db.all<{ id: string; status: string; text_draft: string | null }>(
        'SELECT "id", "status", "text_draft" FROM "tasks" WHERE "id" = ? LIMIT 1',
        [taskId],
      );
      if (!tasks.length) continue;
      const task = tasks[0];
      if ((task.text_draft ?? "") !== "" || (task.status !== taskStatusFailed && task.status !== taskStatusCancelled)) {
        continue;
      }
      const items = await tx.db.all<{ content: string | null }>(
        'SELECT "content" FROM "task_text_deltas" WHERE "task_id" = ? ORDER BY "sequence" ASC',
        [taskId],
      );
      const draft = items.map((item) => item.content ?? "").join("");
      await tx.db.run('UPDATE "tasks" SET "text_draft" = ? WHERE "id" = ?', [draft, taskId]);
    }
    return tx.db.run(
      'DELETE FROM "task_text_deltas" WHERE "expires_at" <= ? OR NOT EXISTS (SELECT 1 FROM "tasks" WHERE "tasks"."id" = "task_text_delta"."task_id")',
      [now],
    );
  });
}

export async function completeTextReplayTask(
  repo: Repository,
  userId: string,
  taskId: string,
  resultJson: string,
  now: string,
): Promise<boolean> {
  const changes = await repo.db.run(
    'UPDATE "tasks" SET "status" = ?, "stage" = ?, "progress" = ?, "result_json" = ?, "text_draft" = ?, "error" = ?, "completed_at" = ?, "lease_owner" = ?, "lease_expires_at" = NULL, "updated_at" = ? WHERE "id" = ? AND "user_id" = ? AND "status" = ?',
    [taskStatusSucceeded, "已完成", 100, resultJson, "", "", now, "", now, taskId, userId, taskStatusTextReplay],
  );
  return changes === 1;
}

export async function deleteUserTaskTextDeltas(repo: Repository, userId: string): Promise<void> {
  await repo.db.run('DELETE FROM "task_text_deltas" WHERE "user_id" = ?', [userId]);
}

export async function textReplayStats(repo: Repository): Promise<TextReplayStats> {
  const rows = await repo.db.all<{
    event_count: number;
    task_count: number;
    byte_count: number;
    oldest_at: string | null;
  }>(
    'SELECT COUNT(*) AS "event_count", COUNT(DISTINCT "task_id") AS "task_count", COALESCE(SUM("byte_count"), 0) AS "byte_count", MIN("created_at") AS "oldest_at" FROM "task_text_deltas"',
  );
  const row = rows[0];
  return {
    eventCount: Number(row?.event_count ?? 0),
    taskCount: Number(row?.task_count ?? 0),
    byteCount: Number(row?.byte_count ?? 0),
    oldestAt: toNullableIso(row?.oldest_at ?? null),
  };
}
