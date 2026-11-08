// 对应 backend/internal/repository/cloud_agent.go
// Cloud Agent 执行检查点、事件窗口、画布变更与 Gemini 缓存。

import type {
  CloudAgentCanvasMutation,
  CloudAgentEventRecord,
  CloudAgentExecution,
  CloudAgentMessageRecord,
  CloudAgentPiSession,
} from "@/internal/model/cloudAgent";
import type { CloudAgentGeminiCache } from "@/internal/model/cloudAgentGeminiCache";
import type { Task } from "@/internal/model/modelsTask";
import { errCreationConflict } from "./creation";
import { recordNotFound, Repository, toBool, toIso, toNullableIso } from "./repository";
import { mapTask, type TaskRow } from "./repositoryTasks";

export interface CloudAgentExecutionRow {
  id?: string | null;
  user_id?: string | null;
  status?: string | null;
  revision?: number | null;
  checkpoint_version?: number | null;
  conversation_id?: string | null;
  parent_id?: string | null;
  title?: string | null;
  event_count?: number | null;
  message_count?: number | null;
  canvas_id?: string | null;
  active_task_id?: string | null;
  media_task_id?: string | null;
  cleanup_pending?: unknown;
  failure_message?: string | null;
  state_json?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export function mapCloudAgentExecution(row: CloudAgentExecutionRow): CloudAgentExecution {
  return {
    id: row.id ?? "",
    userId: row.user_id ?? "",
    status: row.status ?? "",
    revision: Number(row.revision ?? 0),
    checkpointVersion: Number(row.checkpoint_version ?? 0),
    conversationId: row.conversation_id ?? "",
    parentId: row.parent_id ?? "",
    title: row.title ?? "",
    eventCount: Number(row.event_count ?? 0),
    messageCount: Number(row.message_count ?? 0),
    canvasId: row.canvas_id ?? "",
    activeTaskId: row.active_task_id ?? "",
    mediaTaskId: row.media_task_id ?? "",
    cleanupPending: toBool(row.cleanup_pending),
    failureMessage: row.failure_message ?? "",
    stateJson: row.state_json ?? "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

interface CloudAgentEventRecordRow {
  run_id?: string | null;
  sequence?: number | null;
  user_id?: string | null;
  event_json?: string | null;
  created_at?: string | null;
}

function mapCloudAgentEventRecord(row: CloudAgentEventRecordRow): CloudAgentEventRecord {
  return {
    runId: row.run_id ?? "",
    sequence: Number(row.sequence ?? 0),
    userId: row.user_id ?? "",
    eventJson: row.event_json ?? "",
    createdAt: toIso(row.created_at),
  };
}

interface CloudAgentMessageRecordRow {
  run_id?: string | null;
  kind?: string | null;
  sequence?: number | null;
  user_id?: string | null;
  message_json?: string | null;
}

function mapCloudAgentMessageRecord(row: CloudAgentMessageRecordRow): CloudAgentMessageRecord {
  return {
    runId: row.run_id ?? "",
    kind: row.kind ?? "",
    sequence: Number(row.sequence ?? 0),
    userId: row.user_id ?? "",
    messageJson: row.message_json ?? "",
  };
}

interface CloudAgentPiSessionRow {
  run_id: string;
  user_id: string | null;
  session_jsonl: string | null;
  revision: number | null;
  updated_at: string | null;
}

function mapCloudAgentPiSession(row: CloudAgentPiSessionRow): CloudAgentPiSession {
  return {
    runId: row.run_id,
    userId: row.user_id ?? "",
    sessionJsonl: row.session_jsonl ?? "",
    revision: Number(row.revision ?? 0),
    updatedAt: toIso(row.updated_at),
  };
}

interface CloudAgentCanvasMutationRow {
  id: string;
  run_id: string | null;
  user_id: string | null;
  canvas_id: string | null;
  step_id: string | null;
  operation: string | null;
  before_snapshot_hash: string | null;
  after_snapshot_hash: string | null;
  before_json?: string | null;
  has_submitted_task: unknown;
  status: string | null;
  created_at: string | null;
  undone_at: string | null;
}

export function mapCloudAgentCanvasMutation(row: CloudAgentCanvasMutationRow): CloudAgentCanvasMutation {
  return {
    id: row.id,
    runId: row.run_id ?? "",
    userId: row.user_id ?? "",
    canvasId: row.canvas_id ?? "",
    stepId: row.step_id ?? "",
    operation: row.operation ?? "",
    beforeSnapshotHash: row.before_snapshot_hash ?? "",
    afterSnapshotHash: row.after_snapshot_hash ?? "",
    beforeJson: row.before_json ?? "",
    hasSubmittedTask: toBool(row.has_submitted_task),
    status: row.status ?? "",
    createdAt: toIso(row.created_at),
    undoneAt: toNullableIso(row.undone_at),
  };
}

interface CloudAgentGeminiCacheRow {
  id: string;
  user_id: string | null;
  cache_key: string | null;
  base_url: string | null;
  model: string | null;
  credential_hash: string | null;
  resource_name: string | null;
  expire_time: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function mapCloudAgentGeminiCache(row: CloudAgentGeminiCacheRow): CloudAgentGeminiCache {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    cacheKey: row.cache_key ?? "",
    baseUrl: row.base_url ?? "",
    model: row.model ?? "",
    credentialHash: row.credential_hash ?? "",
    resourceName: row.resource_name ?? "",
    expireTime: toIso(row.expire_time),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const cloudAgentExecutionColumns = `"id", "user_id", "status", "revision", "checkpoint_version", "conversation_id", "parent_id", "title", "event_count", "message_count", "canvas_id", "active_task_id", "media_task_id", "cleanup_pending", "failure_message", "state_json", "created_at", "updated_at"`;

const cloudAgentEventRecordColumns = `"run_id", "sequence", "user_id", "event_json", "created_at"`;

const cloudAgentMessageRecordColumns = `"run_id", "kind", "sequence", "user_id", "message_json"`;

const cloudAgentPiSessionColumns = `"run_id", "user_id", "session_jsonl", "revision", "updated_at"`;

const cloudAgentCanvasMutationColumns = `"id", "run_id", "user_id", "canvas_id", "step_id", "operation", "before_snapshot_hash", "after_snapshot_hash", "before_json", "has_submitted_task", "status", "created_at", "undone_at"`;

const cloudAgentGeminiCacheColumns = `"id", "user_id", "cache_key", "base_url", "model", "credential_hash", "resource_name", "expire_time", "created_at", "updated_at"`;

export async function cloudAgentPiSession(repo: Repository, userId: string, runId: string): Promise<CloudAgentPiSession | null> {
  const rows = await repo.db.all<CloudAgentPiSessionRow>(
    `SELECT ${cloudAgentPiSessionColumns} FROM "cloud_agent_pi_sessions" WHERE "run_id" = ? AND "user_id" = ? LIMIT 1`,
    [runId, userId],
  );
  return rows.length ? mapCloudAgentPiSession(rows[0]) : null;
}

// 带 revision 谓词保存，避免过期/恢复的 Pi 进程覆盖更新的原生会话快照。
export async function saveCloudAgentPiSession(repo: Repository, session: CloudAgentPiSession | null, expectedRevision: number): Promise<void> {
  if (session === null || session.runId === "" || session.userId === "") {
    throw new Error("invalid Agent session identity");
  }
  if (expectedRevision === 0) {
    session.revision = 1;
    if (!session.updatedAt) session.updatedAt = new Date().toISOString();
    await repo.db.run(
      `INSERT INTO "cloud_agent_pi_sessions" (${cloudAgentPiSessionColumns}) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      [session.runId, session.userId, session.sessionJsonl, session.revision, session.updatedAt],
    );
    return;
  }
  const changes = await repo.db.run(
    'UPDATE "cloud_agent_pi_sessions" SET "session_jsonl" = ?, "revision" = ?, "updated_at" = ? WHERE "run_id" = ? AND "user_id" = ? AND "revision" = ?',
    [session.sessionJsonl, expectedRevision + 1, new Date().toISOString(), session.runId, session.userId, expectedRevision],
  );
  if (changes !== 1) throw recordNotFound;
  session.revision = expectedRevision + 1;
}

export async function ensureCloudAgent(repo: Repository, run: CloudAgentExecution): Promise<void> {
  if (run.conversationId === "") {
    run.conversationId = run.id;
    if (run.parentId !== "") {
      const rows = await repo.db.all<{ id: string; conversation_id: string | null; title: string | null }>(
        'SELECT "id", "conversation_id", "title" FROM "cloud_agent_executions" WHERE "id" = ? AND "user_id" = ? LIMIT 1',
        [run.parentId, run.userId],
      );
      if (!rows.length) throw recordNotFound;
      const parent = rows[0];
      run.conversationId = (parent.conversation_id ?? "") !== "" ? (parent.conversation_id ?? "") : parent.id;
      run.title = parent.title ?? "";
    }
  }
  if (!run.createdAt) run.createdAt = new Date().toISOString();
  if (!run.updatedAt) run.updatedAt = new Date().toISOString();
  await repo.transaction(async (tx) => {
    await tx.db.run(
      `INSERT INTO "cloud_agent_executions" (${cloudAgentExecutionColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      [
        run.id,
        run.userId,
        run.status,
        run.revision,
        run.checkpointVersion,
        run.conversationId,
        run.parentId,
        run.title,
        run.eventCount,
        run.messageCount,
        run.canvasId,
        run.activeTaskId,
        run.mediaTaskId,
        run.cleanupPending,
        run.failureMessage,
        run.stateJson,
        run.createdAt,
        run.updatedAt,
      ],
    );
    // 该标记把已完成但仍为 text_replay 的 Pi 载体排除在预留扫描之外，
    // 它不是缓存的忙闲或权限标记。
    await tx.db.run(
      `UPDATE "tasks" SET "agent_execution_ready" = true
        WHERE "id" = ? AND "user_id" = ? AND "operation" = 'cloud_agent' AND "agent_execution_ready" = false
        AND EXISTS (SELECT 1 FROM "cloud_agent_executions" e WHERE e."id" = "tasks"."id" AND e."user_id" = "tasks"."user_id")`,
      [run.id, run.userId],
    );
  });
}

// 在同一个只读事务里读取执行行和它的事件/消息行，避免并发写入落在两次查询之间。
async function loadCloudAgent(repo: Repository, userId: string, id: string): Promise<CloudAgentExecution | null> {
  const rows = await repo.db.all<CloudAgentExecutionRow>(
    `SELECT * FROM "cloud_agent_executions" WHERE "id" = ? AND "user_id" = ? LIMIT 1`,
    [id, userId],
  );
  if (!rows.length) return null;
  const run = mapCloudAgentExecution(rows[0]);
  await hydrateCloudAgent(repo, run);
  return run;
}

export async function cloudAgent(repo: Repository, userId: string, id: string): Promise<CloudAgentExecution | null> {
  return repo.transaction((tx) => loadCloudAgent(tx, userId, id));
}

// 载入执行状态时读取的事件窗口条数。
//
// 事件全量在 cloud_agent_event_records（append-only，主键 run_id + sequence），
// 内存只保留最近这一窗；更早的记录按 seq 分页读表。
export const cloudAgentJournalWindow = 40;

async function hydrateCloudAgent(repo: Repository, run: CloudAgentExecution): Promise<void> {
  if (run.checkpointVersion < 2) return;
  // 只取最近一窗，再翻回升序，与 EventCount 的尾部对齐。
  const window = await repo.db.all<CloudAgentEventRecordRow>(
    `SELECT ${cloudAgentEventRecordColumns} FROM "cloud_agent_event_records" WHERE "run_id" = ? AND "user_id" = ? ORDER BY "sequence" DESC LIMIT ?`,
    [run.id, run.userId, cloudAgentJournalWindow],
  );
  run.journal = window.slice().reverse().map(mapCloudAgentEventRecord);
  const transcript = await repo.db.all<CloudAgentMessageRecordRow>(
    `SELECT ${cloudAgentMessageRecordColumns} FROM "cloud_agent_message_records" WHERE "run_id" = ? AND "user_id" = ? ORDER BY "kind", "sequence"`,
    [run.id, run.userId],
  );
  run.transcript = transcript.map(mapCloudAgentMessageRecord);
}

// 取 seq > afterSeq 的事件（升序），keyset 分页走 (run_id, sequence) 主键。
export async function cloudAgentEventRecords(
  repo: Repository,
  userId: string,
  runId: string,
  afterSeq: number,
  limit: number,
): Promise<CloudAgentEventRecord[]> {
  const size = limit <= 0 ? cloudAgentJournalWindow : limit;
  const rows = await repo.db.all<CloudAgentEventRecordRow>(
    `SELECT ${cloudAgentEventRecordColumns} FROM "cloud_agent_event_records" WHERE "run_id" = ? AND "user_id" = ? AND "sequence" > ? ORDER BY "sequence" ASC LIMIT ?`,
    [runId, userId, afterSeq, size],
  );
  return rows.map(mapCloudAgentEventRecord);
}

// 取 seq < beforeSeq 的最近 limit 条（升序返回）。
export async function cloudAgentEventRecordsBefore(
  repo: Repository,
  userId: string,
  runId: string,
  beforeSeq: number,
  limit: number,
): Promise<CloudAgentEventRecord[]> {
  const size = limit <= 0 ? cloudAgentJournalWindow : limit;
  const rows = await repo.db.all<CloudAgentEventRecordRow>(
    `SELECT ${cloudAgentEventRecordColumns} FROM "cloud_agent_event_records" WHERE "run_id" = ? AND "user_id" = ? AND "sequence" < ? ORDER BY "sequence" DESC LIMIT ?`,
    [runId, userId, beforeSeq, size],
  );
  return rows.reverse().map(mapCloudAgentEventRecord);
}

// 该运行已入库的事件条数；只做计数，不载入正文。
export async function cloudAgentEventRecordCount(repo: Repository, userId: string, runId: string): Promise<number> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "cloud_agent_event_records" WHERE "run_id" = ? AND "user_id" = ?',
    [runId, userId],
  );
  return Number(rows[0]?.total ?? 0);
}

export async function cloudAgentForActiveTask(repo: Repository, userId: string, taskId: string): Promise<CloudAgentExecution | null> {
  return repo.transaction(async (tx) => {
    const rows = await tx.db.all<CloudAgentExecutionRow>(
      'SELECT * FROM "cloud_agent_executions" WHERE "user_id" = ? AND "active_task_id" = ? AND "status" IN (?, ?) LIMIT 1',
      [userId, taskId, "running", "queued"],
    );
    if (!rows.length) return null;
    const run = mapCloudAgentExecution(rows[0]);
    await hydrateCloudAgent(tx, run);
    return run;
  });
}

// 列出调用者在某个画布上等待审批的运行；调用方修改前会重新载入。
export async function cloudAgentIdsWaitingApprovalForCanvas(repo: Repository, userId: string, canvasId: string): Promise<string[]> {
  const rows = await repo.db.all<{ id: string }>(
    'SELECT "id" FROM "cloud_agent_executions" WHERE "user_id" = ? AND "canvas_id" = ? AND "status" = ? ORDER BY "id" LIMIT 20',
    [userId, canvasId, "waiting_approval"],
  );
  return rows.map((row) => row.id);
}

export async function cloudAgentRoots(repo: Repository): Promise<Task[]> {
  const rows = await repo.db.all<TaskRow>(
    `SELECT * FROM "tasks" WHERE "operation" = ? AND "id" NOT IN (SELECT "id" FROM "cloud_agent_executions") ORDER BY "created_at" LIMIT 50`,
    ["cloud_agent"],
  );
  return rows.map(mapTask);
}

// 稳定的 keyset 让等待中的行把机会让给后续运行，同时不改业务时间戳。
export async function activeCloudAgentsAfter(repo: Repository, after: string, limit: number): Promise<CloudAgentExecution[]> {
  let size = limit;
  if (size < 1 || size > 50) size = 50;
  return repo.transaction(async (tx) => {
    const rows = await tx.db.all<CloudAgentExecutionRow>(
      `SELECT * FROM "cloud_agent_executions" WHERE ("status" IN (?, ?) OR "cleanup_pending" = ?) AND "id" > ? ORDER BY "id" LIMIT ?`,
      ["running", "queued", true, after, size],
    );
    const runs = rows.map(mapCloudAgentExecution);
    for (const run of runs) await hydrateCloudAgent(tx, run);
    return runs;
  });
}

export async function activeCloudAgents(repo: Repository): Promise<CloudAgentExecution[]> {
  return activeCloudAgentsAfter(repo, "", 50);
}

// 未变化的 SSE 订阅不载入 transcript、任务和账单。
export async function cloudAgentRevision(repo: Repository, userId: string, id: string): Promise<number> {
  const rows = await repo.db.all<{ id: string; revision: number | null }>(
    'SELECT "id", "revision" FROM "cloud_agent_executions" WHERE "id" = ? AND "user_id" = ? LIMIT 1',
    [id, userId],
  );
  if (!rows.length) throw recordNotFound;
  return Number(rows[0].revision ?? 0);
}

// 返回调用者最近若干次运行的事件行，按事件时间排序。先解析运行，
// 固定的事件上限不会把某次运行截成两半。
export async function recentCloudAgentEventsForUser(
  repo: Repository,
  userId: string,
  runLimit: number,
): Promise<CloudAgentEventRecord[]> {
  if (runLimit < 1) return [];
  const runRows = await repo.db.all<{ id: string }>(
    'SELECT "id" FROM "cloud_agent_executions" WHERE "user_id" = ? ORDER BY "created_at" DESC LIMIT ?',
    [userId, runLimit],
  );
  const runIds = runRows.map((row) => row.id);
  if (!runIds.length) return [];
  const placeholders = runIds.map(() => "?").join(", ");
  const rows = await repo.db.all<CloudAgentEventRecordRow>(
    `SELECT ${cloudAgentEventRecordColumns} FROM "cloud_agent_event_records" WHERE "user_id" = ? AND "run_id" IN (${placeholders}) ORDER BY "created_at", "sequence"`,
    [userId, ...runIds],
  );
  return rows.map(mapCloudAgentEventRecord);
}

// 先锁再读：检查点、画布写入与任务预留一起提交。
export async function mutateCloudAgent(
  repo: Repository,
  userId: string,
  id: string,
  revision: number,
  fn: (run: CloudAgentExecution, tx: Repository) => Promise<void> | void,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const changes = await tx.db.run(
      'UPDATE "cloud_agent_executions" SET "revision" = "revision" + 1 WHERE "id" = ? AND "user_id" = ? AND "revision" = ?',
      [id, userId, revision],
    );
    if (changes !== 1) throw errCreationConflict;
    const run = await loadCloudAgent(tx, userId, id);
    if (run === null) throw recordNotFound;
    const previousEvents = run.eventCount;
    const previousEventBodies = new Map<number, string>();
    for (const event of run.journal ?? []) previousEventBodies.set(event.sequence, event.eventJson);
    const previousMessages = new Map<string, string>();
    for (const message of run.transcript ?? []) {
      previousMessages.set(`${message.kind}:${message.sequence}`, message.messageJson);
    }
    await fn(run, tx);
    if (run.eventCount < previousEvents) throw new Error("cloud Agent journal cannot be truncated");
    // journal 是 append-only：本次转移之前已经载入的事件不许改写。
    // 内存里只有最近一窗，窗口右移后更早的行会落在新窗口之外——那些行不在
    // run.journal 里，也不会被下面的 Create 循环碰到（只追加 seq > 水位的新行），
    // 因此只要求它们确实比新窗口更早，而不是要求它们仍在窗口内。
    const journal = run.journal ?? [];
    const current = new Map<number, string>();
    for (const event of journal) current.set(event.sequence, event.eventJson);
    for (const [sequence, body] of previousEventBodies) {
      const updated = current.get(sequence);
      if (updated === undefined) {
        if (journal.length === 0 || sequence >= journal[0].sequence) {
          throw new Error("cloud Agent journal is append-only");
        }
        continue;
      }
      if (!sameJSONDocument(updated, body)) throw new Error("cloud Agent journal is append-only");
    }
    // 水位与窗口必须自洽：窗口最后一条就是要落库的最后一条。
    if (journal.length > 0 && journal[journal.length - 1].sequence !== run.eventCount) {
      throw new Error("cloud Agent journal watermark is inconsistent");
    }
    run.updatedAt = new Date().toISOString();
    await tx.db.run(
      `UPDATE "cloud_agent_executions" SET "user_id" = ?, "status" = ?, "revision" = ?, "checkpoint_version" = ?, "conversation_id" = ?, "parent_id" = ?, "title" = ?, "event_count" = ?, "message_count" = ?, "canvas_id" = ?, "active_task_id" = ?, "media_task_id" = ?, "cleanup_pending" = ?, "failure_message" = ?, "state_json" = ?, "created_at" = ?, "updated_at" = ? WHERE "id" = ?`,
      [
        run.userId,
        run.status,
        run.revision,
        run.checkpointVersion,
        run.conversationId,
        run.parentId,
        run.title,
        run.eventCount,
        run.messageCount,
        run.canvasId,
        run.activeTaskId,
        run.mediaTaskId,
        run.cleanupPending,
        run.failureMessage,
        run.stateJson,
        run.createdAt,
        run.updatedAt,
        run.id,
      ],
    );
    for (const event of journal) {
      if (event.sequence <= previousEvents) continue;
      if (!event.createdAt) event.createdAt = new Date().toISOString();
      await tx.db.run(
        `INSERT INTO "cloud_agent_event_records" (${cloudAgentEventRecordColumns}) VALUES (?, ?, ?, ?, ?)`,
        [event.runId, event.sequence, event.userId, event.eventJson, event.createdAt],
      );
    }
    for (const message of run.transcript ?? []) {
      const key = `${message.kind}:${message.sequence}`;
      if ((previousMessages.get(key) ?? "") === message.messageJson) continue;
      await tx.db.run(
        `INSERT INTO "cloud_agent_message_records" (${cloudAgentMessageRecordColumns}) VALUES (?, ?, ?, ?, ?) ON CONFLICT ("run_id", "kind", "sequence") DO UPDATE SET "message_json" = excluded."message_json"`,
        [message.runId, message.kind, message.sequence, message.userId, message.messageJson],
      );
    }
    for (const kind of ["canonical", "history"]) {
      const count = (run.transcript ?? []).filter((message) => message.kind === kind).length;
      await tx.db.run(
        'DELETE FROM "cloud_agent_message_records" WHERE "run_id" = ? AND "user_id" = ? AND "kind" = ? AND "sequence" > ?',
        [run.id, run.userId, kind, count],
      );
    }
  });
}

// 按 JSON 语义比较事件，而不是源字节。事件负载可能包含 RawMessage，
// 解码/再编码会合法地归一化空白、键序或 0.0 / 0 之类的数字写法。
function sameJSONDocument(left: string, right: string): boolean {
  const leftCanonical = canonicalJSONDocument(left);
  const rightCanonical = canonicalJSONDocument(right);
  if (leftCanonical === undefined || rightCanonical === undefined) return left === right;
  return leftCanonical === rightCanonical;
}

function canonicalJSONDocument(raw: string): string | undefined {
  let index = 0;
  const length = raw.length;

  function skipWhitespace(): void {
    while (index < length && (raw[index] === " " || raw[index] === "\t" || raw[index] === "\n" || raw[index] === "\r")) index += 1;
  }

  function parseString(): string | undefined {
    const start = index;
    index += 1;
    while (index < length) {
      const character = raw[index];
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === '"') {
        index += 1;
        try {
          return JSON.parse(raw.slice(start, index)) as string;
        } catch {
          return undefined;
        }
      }
      index += 1;
    }
    return undefined;
  }

  function parseValue(): string | undefined {
    skipWhitespace();
    if (index >= length) return undefined;
    const character = raw[index];
    if (character === "{") {
      index += 1;
      skipWhitespace();
      if (raw[index] === "}") {
        index += 1;
        return "{}";
      }
      const entries: [string, string][] = [];
      for (;;) {
        skipWhitespace();
        if (raw[index] !== '"') return undefined;
        const key = parseString();
        if (key === undefined) return undefined;
        skipWhitespace();
        if (raw[index] !== ":") return undefined;
        index += 1;
        const value = parseValue();
        if (value === undefined) return undefined;
        entries.push([key, value]);
        skipWhitespace();
        if (raw[index] === ",") {
          index += 1;
          continue;
        }
        if (raw[index] === "}") {
          index += 1;
          break;
        }
        return undefined;
      }
      entries.sort((left, right) => Buffer.compare(Buffer.from(left[0]), Buffer.from(right[0])));
      return `{${entries.map(([key, value]) => `${JSON.stringify(key)}:${value}`).join(",")}}`;
    }
    if (character === "[") {
      index += 1;
      skipWhitespace();
      if (raw[index] === "]") {
        index += 1;
        return "[]";
      }
      const items: string[] = [];
      for (;;) {
        const value = parseValue();
        if (value === undefined) return undefined;
        items.push(value);
        skipWhitespace();
        if (raw[index] === ",") {
          index += 1;
          continue;
        }
        if (raw[index] === "]") {
          index += 1;
          break;
        }
        return undefined;
      }
      return `[${items.join(",")}]`;
    }
    if (character === '"') {
      const value = parseString();
      return value === undefined ? undefined : JSON.stringify(value);
    }
    if (raw.startsWith("true", index)) {
      index += 4;
      return "true";
    }
    if (raw.startsWith("false", index)) {
      index += 5;
      return "false";
    }
    if (raw.startsWith("null", index)) {
      index += 4;
      return "null";
    }
    const matched = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(raw.slice(index));
    if (!matched) return undefined;
    index += matched[0].length;
    return canonicalJSONNumber(matched[0]);
  }

  const value = parseValue();
  if (value === undefined) return undefined;
  skipWhitespace();
  return index === length ? value : undefined;
}

// 对应 big.Rat.RatString()：把数字字面量转成既约分数，0.0 与 0 等价。
function canonicalJSONNumber(literal: string): string {
  let text = literal;
  let negative = false;
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  }
  let exponent = 0;
  const exponentIndex = text.search(/[eE]/);
  if (exponentIndex >= 0) {
    exponent = Number(text.slice(exponentIndex + 1));
    text = text.slice(0, exponentIndex);
  }
  const dotIndex = text.indexOf(".");
  let digits = text;
  if (dotIndex >= 0) {
    digits = text.slice(0, dotIndex) + text.slice(dotIndex + 1);
    exponent -= text.length - dotIndex - 1;
  }
  digits = digits.replace(/^0+(?=\d)/, "");
  let numerator = BigInt(digits || "0");
  let denominator = 1n;
  if (exponent > 0) {
    numerator *= 10n ** BigInt(exponent);
  } else if (exponent < 0) {
    denominator = 10n ** BigInt(-exponent);
  }
  let divisor = numerator < 0n ? -numerator : numerator;
  let remainder = denominator;
  while (remainder !== 0n) {
    const next = divisor % remainder;
    divisor = remainder;
    remainder = next;
  }
  if (divisor > 1n) {
    numerator /= divisor;
    denominator /= divisor;
  }
  if (negative) numerator = -numerator;
  return denominator === 1n ? `${numerator}` : `${numerator}/${denominator}`;
}

export async function createCloudAgentCanvasMutation(repo: Repository, mutation: CloudAgentCanvasMutation): Promise<void> {
  if (!mutation.createdAt) mutation.createdAt = new Date().toISOString();
  await repo.db.run(
    `INSERT INTO "cloud_agent_canvas_mutations" (${cloudAgentCanvasMutationColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      mutation.id,
      mutation.runId,
      mutation.userId,
      mutation.canvasId,
      mutation.stepId,
      mutation.operation,
      mutation.beforeSnapshotHash,
      mutation.afterSnapshotHash,
      mutation.beforeJson ?? "",
      mutation.hasSubmittedTask,
      mutation.status,
      mutation.createdAt,
      mutation.undoneAt ?? null,
    ],
  );
}

export async function latestCloudAgentCanvasMutation(
  repo: Repository,
  userId: string,
  runId: string,
): Promise<CloudAgentCanvasMutation | null> {
  const rows = await repo.db.all<CloudAgentCanvasMutationRow>(
    `SELECT ${cloudAgentCanvasMutationColumns} FROM "cloud_agent_canvas_mutations" WHERE "user_id" = ? AND "run_id" = ? ORDER BY "created_at" DESC, "id" DESC LIMIT 1`,
    [userId, runId],
  );
  return rows.length ? mapCloudAgentCanvasMutation(rows[0]) : null;
}

export async function markCloudAgentCanvasMutationUndone(
  repo: Repository,
  userId: string,
  runId: string,
  mutationId: string,
  undoneAt: string,
): Promise<void> {
  const changes = await repo.db.run(
    'UPDATE "cloud_agent_canvas_mutations" SET "status" = ?, "undone_at" = ? WHERE "id" = ? AND "user_id" = ? AND "run_id" = ? AND "status" = ?',
    ["undone", undoneAt, mutationId, userId, runId, "applied"],
  );
  if (changes !== 1) throw errCreationConflict;
}

// 终态 CAS，不读取也不重写 StateJSON；运行状态损坏无法解码时依然可用，
// 否则停在 running 会让调度器无限重试。
export async function markCloudAgentFailed(repo: Repository, userId: string, id: string, revision: number, message?: string): Promise<void> {
  const detail = message === undefined ? "Agent 运行状态损坏，本轮已停止" : message;
  const changes = await repo.db.run(
    'UPDATE "cloud_agent_executions" SET "status" = ?, "cleanup_pending" = ?, "failure_message" = ?, "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ? AND "user_id" = ? AND "revision" = ? AND "status" IN (?, ?)',
    ["failed", true, detail, new Date().toISOString(), id, userId, revision, "queued", "running"],
  );
  if (changes !== 1) throw errCreationConflict;
}

// 对损坏状态安全的取消转移；同样不触碰 StateJSON。
export async function markCloudAgentCancelled(repo: Repository, userId: string, id: string, revision: number): Promise<void> {
  const changes = await repo.db.run(
    'UPDATE "cloud_agent_executions" SET "status" = ?, "cleanup_pending" = ?, "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ? AND "user_id" = ? AND "revision" = ? AND "status" IN (?, ?, ?)',
    ["cancelled", true, new Date().toISOString(), id, userId, revision, "queued", "running", "waiting_approval"],
  );
  if (changes !== 1) throw errCreationConflict;
}

// 返回属于该用户的官方 Gemini CachedContent。
export async function geminiCacheByKey(repo: Repository, userId: string, cacheKey: string): Promise<CloudAgentGeminiCache | null> {
  const rows = await repo.db.all<CloudAgentGeminiCacheRow>(
    `SELECT ${cloudAgentGeminiCacheColumns} FROM "cloud_agent_gemini_caches" WHERE "user_id" = ? AND "cache_key" = ? LIMIT 1`,
    [userId, cacheKey],
  );
  return rows.length ? mapCloudAgentGeminiCache(rows[0]) : null;
}

// 持久化 Gemini 返回的资源名与过期时间。
export async function upsertGeminiCache(repo: Repository, cache: CloudAgentGeminiCache): Promise<void> {
  const now = new Date().toISOString();
  if (!cache.createdAt) cache.createdAt = now;
  if (!cache.updatedAt) cache.updatedAt = now;
  await repo.db.run(
    `INSERT INTO "cloud_agent_gemini_caches" (${cloudAgentGeminiCacheColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT ("user_id", "cache_key") DO UPDATE SET "user_id" = excluded."user_id", "base_url" = excluded."base_url", "model" = excluded."model", "credential_hash" = excluded."credential_hash", "resource_name" = excluded."resource_name", "expire_time" = excluded."expire_time", "updated_at" = excluded."updated_at"`,
    [
      cache.id,
      cache.userId,
      cache.cacheKey,
      cache.baseUrl,
      cache.model,
      cache.credentialHash,
      cache.resourceName,
      cache.expireTime,
      cache.createdAt,
      cache.updatedAt,
    ],
  );
}

export async function deleteGeminiCache(repo: Repository, userId: string, cacheKey: string): Promise<void> {
  await repo.db.run('DELETE FROM "cloud_agent_gemini_caches" WHERE "user_id" = ? AND "cache_key" = ?', [userId, cacheKey]);
}

// 防止使用旧 CachedContent 资源的迟到请求删掉同一身份下更新的缓存。
export async function deleteGeminiCacheIfResourceMatches(
  repo: Repository,
  userId: string,
  cacheKey: string,
  resourceName: string,
): Promise<boolean> {
  const changes = await repo.db.run(
    'DELETE FROM "cloud_agent_gemini_caches" WHERE "user_id" = ? AND "cache_key" = ? AND "resource_name" = ?',
    [userId, cacheKey, resourceName],
  );
  return changes === 1;
}
