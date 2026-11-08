// 对应 backend/internal/repository/repository_tasks.go
// 生成任务的持久化：领取、租约续期、Provider 进度与终态写回。
//
// 所有「执行中」写入都带租约校验：进程被新执行者接管后，旧执行者的迟到写入会因
// 租约不匹配被丢弃，避免覆盖新结果或重复扣费。

import {
  providerCancelStatusRequested,
  taskStatusCancelled,
  taskStatusFailed,
  taskStatusQueued,
  taskStatusRunning,
  taskStatusSucceeded,
} from "@/internal/model/models";
import type { ProviderCancelStatus, TaskStatus } from "@/internal/model/models";
import type { Result, Task, TaskLog } from "@/internal/model/modelsTask";
import type { TaskCancellationIntent } from "@/internal/model/taskExecution";
import { recordNotFound, Repository, toBool, toIso, toNullableIso } from "./repository";

export const errTaskStateConflict = new Error("任务状态已变化，请刷新后重试");
export const errTaskProviderRecoveryConflict = new Error("任务正在恢复中，请稍后查看");
export const errTaskProviderCancellationConflict = new Error("任务正在取消中，请稍后查看");

export interface TaskRow {
  agent_execution_ready?: unknown;
  agent_run_id?: string | null;
  generation_id?: string | null;
  approval_id?: string | null;
  authorized_charge_microcredits?: number | null;
  execution_diagnostic_json?: string | null;
  cancellation_source?: string | null;
  cancellation_actor_id?: string | null;
  cancellation_requested_at?: string | null;
  creation_submission_id?: string | null;
  workbench_kind?: string | null;
  id?: string;
  user_id?: string | null;
  trace_id?: string | null;
  request_id?: string | null;
  project_id?: string | null;
  type?: string | null;
  status?: string | null;
  stage?: string | null;
  progress?: number | null;
  prompt?: string | null;
  operation?: string | null;
  provider?: string | null;
  model?: string | null;
  logical_model_id?: string | null;
  logical_model_revision_id?: string | null;
  route_id?: string | null;
  channel_model_id?: string | null;
  route_run?: number | null;
  billing_order_id?: string | null;
  provider_request_id?: string | null;
  provider_cancel_status?: string | null;
  provider_cancel_error?: string | null;
  provider_cancel_attempts?: number | null;
  provider_cancel_requested_at?: string | null;
  provider_cancelled_at?: string | null;
  provider_cancel_next_check_at?: string | null;
  poll_stage?: string | null;
  next_poll_at?: string | null;
  lease_owner?: string | null;
  lease_expires_at?: string | null;
  input_json?: string | null;
  result_json?: string | null;
  media_recovery_json?: string | null;
  media_stage?: string | null;
  text_draft?: string | null;
  error?: string | null;
  attempts?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  created_at_epoch?: number | null;
  updated_at?: string | null;
}

export function mapTask(row: TaskRow): Task {
  return {
    agentExecutionReady: toBool(row.agent_execution_ready),
    agentRunId: row.agent_run_id ?? "",
    generationId: row.generation_id ?? "",
    approvalId: row.approval_id ?? "",
    authorizedChargeMicrocredits: Number(row.authorized_charge_microcredits ?? 0),
    executionDiagnosticJson: row.execution_diagnostic_json ?? "",
    cancellationSource: row.cancellation_source ?? "",
    cancellationActorId: row.cancellation_actor_id ?? "",
    cancellationRequestedAt: toNullableIso(row.cancellation_requested_at),
    creationSubmissionId: row.creation_submission_id ?? null,
    workbenchKind: row.workbench_kind ?? "",
    id: row.id ?? "",
    userId: row.user_id ?? "",
    traceId: row.trace_id ?? "",
    requestId: row.request_id ?? "",
    projectId: row.project_id ?? "",
    type: row.type ?? "",
    status: (row.status ?? "") as TaskStatus,
    stage: row.stage ?? "",
    progress: Number(row.progress ?? 0),
    prompt: row.prompt ?? "",
    operation: row.operation ?? "",
    provider: row.provider ?? "",
    model: row.model ?? "",
    logicalModelId: row.logical_model_id ?? "",
    logicalModelRevisionId: row.logical_model_revision_id ?? "",
    routeId: row.route_id ?? "",
    channelModelId: row.channel_model_id ?? "",
    routeRun: Number(row.route_run ?? 0),
    billingOrderId: row.billing_order_id ?? "",
    providerRequestId: row.provider_request_id ?? "",
    providerCancelStatus: (row.provider_cancel_status ?? "") as ProviderCancelStatus,
    providerCancelError: row.provider_cancel_error ?? "",
    providerCancelAttempts: Number(row.provider_cancel_attempts ?? 0),
    providerCancelRequestedAt: toNullableIso(row.provider_cancel_requested_at),
    providerCancelledAt: toNullableIso(row.provider_cancelled_at),
    providerCancelNextCheckAt: toNullableIso(row.provider_cancel_next_check_at),
    pollStage: row.poll_stage ?? "",
    nextPollAt: toNullableIso(row.next_poll_at),
    leaseOwner: row.lease_owner ?? "",
    leaseExpiresAt: toNullableIso(row.lease_expires_at),
    inputJson: row.input_json ?? "",
    resultJson: row.result_json ?? "",
    mediaRecoveryJson: row.media_recovery_json ?? "",
    mediaStage: row.media_stage ?? "",
    textDraft: row.text_draft ?? "",
    error: row.error ?? "",
    attempts: Number(row.attempts ?? 0),
    startedAt: toNullableIso(row.started_at),
    completedAt: toNullableIso(row.completed_at),
    createdAt: toIso(row.created_at),
    createdAtEpoch: Number(row.created_at_epoch ?? 0),
    updatedAt: toIso(row.updated_at),
  };
}

function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}

export interface LeaseCondition {
  condition: string;
  values: (string | number)[];
}

// 无租约任务仅能写无租约记录；有租约的执行者必须仍持有本次领取的有效 owner。
export function taskLeaseWriter(owner: string, now: string): LeaseCondition {
  if (owner === "") {
    return { condition: '("lease_owner" = \'\' OR "lease_owner" IS NULL)', values: [] };
  }
  return { condition: '"lease_owner" = ? AND "lease_expires_at" > ?', values: [owner, now] };
}

export async function task(repo: Repository, id: string): Promise<Task | null> {
  const rows = await repo.db.all<TaskRow>('SELECT * FROM "tasks" WHERE "id" = ? LIMIT 1', [id]);
  return rows.length ? mapTask(rows[0]) : null;
}

// taskStatus 避免等待循环反复读取大输入、文本草稿和结果正文。
export async function taskStatus(repo: Repository, id: string): Promise<TaskStatus> {
  const rows = await repo.db.all<{ status: string | null }>('SELECT "status" FROM "tasks" WHERE "id" = ? LIMIT 1', [id]);
  if (!rows.length) throw recordNotFound;
  return (rows[0].status ?? "") as TaskStatus;
}

export async function taskForUser(repo: Repository, userId: string, id: string): Promise<Task | null> {
  const rows = await repo.db.all<TaskRow>('SELECT * FROM "tasks" WHERE "id" = ? AND "user_id" = ? LIMIT 1', [id, userId]);
  return rows.length ? mapTask(rows[0]) : null;
}

export async function activeTaskCountForUser(repo: Repository, userId: string): Promise<number> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "tasks" WHERE "user_id" = ? AND "status" IN (?, ?)',
    [userId, taskStatusQueued, taskStatusRunning],
  );
  return Number(rows[0]?.total ?? 0);
}

export async function activeTaskCountForProjectIds(repo: Repository, userId: string, projectIds: string[]): Promise<number> {
  if (projectIds.length === 0) return 0;
  const rows = await repo.db.all<{ total: number }>(
    `SELECT COUNT(*) AS "total" FROM "tasks" WHERE "user_id" = ? AND "project_id" IN (${placeholders(projectIds.length)}) AND "status" IN (?, ?)`,
    [userId, ...projectIds, taskStatusQueued, taskStatusRunning],
  );
  return Number(rows[0]?.total ?? 0);
}

// 任务领取以数据库租约为真相；PostgreSQL 锁行跳过竞争任务，SQLite 继续依赖条件更新保证单实例原子性。
export async function claimNextTask(repo: Repository, owner: string, leaseDurationMs: number): Promise<Task | null> {
  const now = new Date();
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs).toISOString();
  return repo.transaction(async (tx) => {
    const locking = tx.dialect() === "postgres" ? " FOR UPDATE SKIP LOCKED" : "";
    const rows = await tx.db.all<TaskRow>(
      `SELECT * FROM "tasks" WHERE ("status" = ? OR ("status" = ? AND ("lease_expires_at" IS NULL OR "lease_expires_at" <= ?))) AND ("next_poll_at" IS NULL OR "next_poll_at" <= ?) ORDER BY "created_at" ASC LIMIT 1${locking}`,
      [taskStatusQueued, taskStatusRunning, nowIso, nowIso],
    );
    if (!rows.length) return null;
    const candidate = rows[0];
    const conditions = ['"id" = ?'];
    const values: (string | number)[] = [candidate.id ?? ""];
    if (tx.dialect() !== "postgres") {
      conditions.push(
        '("status" = ? OR ("status" = ? AND ("lease_expires_at" IS NULL OR "lease_expires_at" <= ?))) AND ("next_poll_at" IS NULL OR "next_poll_at" <= ?)',
      );
      values.push(taskStatusQueued, taskStatusRunning, nowIso, nowIso);
    }
    const changes = await tx.db.run(
      `UPDATE "tasks" SET "status" = ?, "stage" = CASE WHEN "provider_request_id" <> '' THEN "stage" ELSE ? END, "progress" = CASE WHEN "provider_request_id" <> '' THEN "progress" ELSE ? END, "attempts" = "attempts" + ?, "started_at" = COALESCE("started_at", ?), "lease_owner" = ?, "lease_expires_at" = ?, "next_poll_at" = NULL, "updated_at" = ? WHERE ${conditions.join(" AND ")}`,
      [taskStatusRunning, "后端接管任务", 15, 1, nowIso, owner, leaseExpiresAt, nowIso, ...values],
    );
    if (changes === 0) return null;
    const updated = await tx.db.all<TaskRow>('SELECT * FROM "tasks" WHERE "id" = ? LIMIT 1', [candidate.id ?? ""]);
    return updated.length ? mapTask(updated[0]) : null;
  });
}

export async function renewTaskLease(repo: Repository, id: string, owner: string, leaseDurationMs: number): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const changes = await repo.db.run(
    'UPDATE "tasks" SET "lease_expires_at" = ?, "updated_at" = ? WHERE "id" = ? AND "status" = ? AND "lease_owner" = ? AND "lease_expires_at" > ?',
    [new Date(now.getTime() + leaseDurationMs).toISOString(), nowIso, id, taskStatusRunning, owner, nowIso],
  );
  if (changes !== 1) throw new Error("任务租约已失效");
}

export async function updateTaskProviderState(
  repo: Repository,
  id: string,
  providerRequestId: string,
  pollStage: string,
  nextPollAt: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  const assignments = ['"poll_stage" = ?', '"next_poll_at" = ?', '"updated_at" = ?'];
  const values: (string | number | null)[] = [pollStage, nextPollAt, now];
  const trimmed = providerRequestId.trim();
  if (trimmed !== "") {
    assignments.push('"provider_request_id" = ?');
    values.push(trimmed);
  }
  await repo.db.run(`UPDATE "tasks" SET ${assignments.join(", ")} WHERE "id" = ?`, [...values, id]);
}

export async function deferRunningTaskForProviderPoll(
  repo: Repository,
  id: string,
  owner: string,
  stage: string,
  delayMs: number,
): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const lease = taskLeaseWriter(owner, nowIso);
  const changes = await repo.db.run(
    `UPDATE "tasks" SET "stage" = ?, "error" = ?, "completed_at" = NULL, "next_poll_at" = ?, "lease_owner" = ?, "lease_expires_at" = NULL, "updated_at" = ? WHERE "id" = ? AND "status" = ? AND ${lease.condition}`,
    [stage, "", new Date(now.getTime() + delayMs).toISOString(), "", nowIso, id, taskStatusRunning, ...lease.values],
  );
  if (changes !== 1) throw errTaskStateConflict;
}

// 人工恢复仅锁定失败任务；旧 worker 的租约可覆盖，但未过期的人工恢复租约不能并发抢占。
export async function claimFailedTaskProviderRecovery(
  repo: Repository,
  id: string,
  userId: string,
  owner: string,
  leaseDurationMs: number,
): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const conditions = [
    '"id" = ?',
    '"status" = ?',
    '("lease_owner" = \'\' OR "lease_owner" NOT LIKE ? OR "lease_expires_at" IS NULL OR "lease_expires_at" <= ?)',
  ];
  const values: (string | number)[] = [id, taskStatusFailed, "manual-recovery:%", nowIso];
  if (userId.trim() !== "") {
    conditions.push('"user_id" = ?');
    values.push(userId);
  }
  const changes = await repo.db.run(
    `UPDATE "tasks" SET "lease_owner" = ?, "lease_expires_at" = ?, "updated_at" = ? WHERE ${conditions.join(" AND ")}`,
    [owner, new Date(now.getTime() + leaseDurationMs).toISOString(), nowIso, ...values],
  );
  if (changes !== 1) throw errTaskProviderRecoveryConflict;
}

export async function releaseTaskProviderRecovery(repo: Repository, id: string, owner: string): Promise<void> {
  await repo.db.run(
    'UPDATE "tasks" SET "lease_owner" = ?, "lease_expires_at" = NULL, "updated_at" = ? WHERE "id" = ? AND "lease_owner" = ?',
    ["", new Date().toISOString(), id, owner],
  );
}

export async function updateTaskProgress(repo: Repository, id: string, stage: string, progress: number): Promise<void> {
  await repo.db.run('UPDATE "tasks" SET "stage" = ?, "progress" = ?, "updated_at" = ? WHERE "id" = ? AND "status" = ?', [
    stage,
    progress,
    new Date().toISOString(),
    id,
    taskStatusRunning,
  ]);
}

export async function updateTaskProgressForLease(
  repo: Repository,
  id: string,
  owner: string,
  stage: string,
  progress: number,
): Promise<void> {
  const now = new Date().toISOString();
  const lease = taskLeaseWriter(owner, now);
  const changes = await repo.db.run(
    `UPDATE "tasks" SET "stage" = ?, "progress" = ?, "updated_at" = ? WHERE "id" = ? AND "status" = ? AND ${lease.condition}`,
    [stage, progress, now, id, taskStatusRunning, ...lease.values],
  );
  if (changes !== 1) throw errTaskStateConflict;
}

// 上游上报的进度不允许迟到或乱序的轮询响应把公开百分比往回改。
export async function updateTaskProviderProgress(repo: Repository, id: string, progress: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, progress));
  await repo.db.run(
    'UPDATE "tasks" SET "stage" = ?, "progress" = CASE WHEN "progress" < ? THEN ? ELSE "progress" END, "updated_at" = ? WHERE "id" = ? AND "status" = ?',
    ["上游生成中", clamped, clamped, new Date().toISOString(), id, taskStatusRunning],
  );
}

export async function saveTaskCompletion(
  repo: Repository,
  taskItem: Task,
  expected: TaskStatus,
  results: Result[],
): Promise<void> {
  await saveTaskCompletionWithRegistration(repo, taskItem, expected, results, null);
}

// 注册与终态成功一起提交；素材写入失败时任务仍可恢复，且不会向画布暴露假成功。
export async function saveTaskCompletionWithRegistration(
  repo: Repository,
  taskItem: Task,
  expected: TaskStatus,
  results: Result[],
  register: ((tx: Repository) => Promise<void>) | null,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const storedResultJson = taskItem.resultJson ?? "";
    const lease = taskLeaseWriter(taskItem.leaseOwner ?? "", new Date().toISOString());
    const changes = await tx.db.run(
      `UPDATE "tasks" SET "agent_run_id" = ?, "generation_id" = ?, "approval_id" = ?, "authorized_charge_microcredits" = ?, "execution_diagnostic_json" = ?, "cancellation_source" = ?, "cancellation_actor_id" = ?, "cancellation_requested_at" = ?, "creation_submission_id" = ?, "workbench_kind" = ?, "user_id" = ?, "trace_id" = ?, "request_id" = ?, "project_id" = ?, "type" = ?, "status" = ?, "stage" = ?, "progress" = ?, "prompt" = ?, "operation" = ?, "provider" = ?, "model" = ?, "logical_model_id" = ?, "logical_model_revision_id" = ?, "route_id" = ?, "channel_model_id" = ?, "route_run" = ?, "billing_order_id" = ?, "provider_request_id" = ?, "provider_cancel_status" = ?, "provider_cancel_error" = ?, "provider_cancel_attempts" = ?, "provider_cancel_requested_at" = ?, "provider_cancelled_at" = ?, "provider_cancel_next_check_at" = ?, "poll_stage" = ?, "next_poll_at" = ?, "lease_owner" = ?, "lease_expires_at" = ?, "input_json" = ?, "result_json" = ?, "media_recovery_json" = ?, "media_stage" = ?, "text_draft" = ?, "error" = ?, "attempts" = ?, "started_at" = ?, "completed_at" = ?, "created_at_epoch" = ?, "updated_at" = ? WHERE "id" = ? AND "status" = ? AND ${lease.condition}`,
      [
        taskItem.agentRunId ?? "",
        taskItem.generationId ?? "",
        taskItem.approvalId ?? "",
        taskItem.authorizedChargeMicrocredits ?? 0,
        taskItem.executionDiagnosticJson ?? "",
        taskItem.cancellationSource ?? "",
        taskItem.cancellationActorId ?? "",
        taskItem.cancellationRequestedAt ?? null,
        taskItem.creationSubmissionId ?? null,
        taskItem.workbenchKind ?? "",
        taskItem.userId,
        taskItem.traceId ?? "",
        taskItem.requestId ?? "",
        taskItem.projectId,
        taskItem.type,
        taskItem.status,
        taskItem.stage,
        taskItem.progress,
        taskItem.prompt,
        taskItem.operation,
        taskItem.provider,
        taskItem.model,
        taskItem.logicalModelId ?? "",
        taskItem.logicalModelRevisionId ?? "",
        taskItem.routeId ?? "",
        taskItem.channelModelId ?? "",
        taskItem.routeRun ?? 0,
        taskItem.billingOrderId ?? "",
        taskItem.providerRequestId ?? "",
        taskItem.providerCancelStatus ?? "",
        taskItem.providerCancelError ?? "",
        taskItem.providerCancelAttempts ?? 0,
        taskItem.providerCancelRequestedAt ?? null,
        taskItem.providerCancelledAt ?? null,
        taskItem.providerCancelNextCheckAt ?? null,
        taskItem.pollStage ?? "",
        taskItem.nextPollAt ?? null,
        taskItem.leaseOwner ?? "",
        taskItem.leaseExpiresAt ?? null,
        taskItem.inputJson,
        taskItem.resultJson,
        taskItem.mediaRecoveryJson ?? "",
        taskItem.mediaStage ?? "",
        taskItem.textDraft ?? "",
        taskItem.error,
        taskItem.attempts,
        taskItem.startedAt,
        taskItem.completedAt,
        taskItem.createdAtEpoch ?? 0,
        taskItem.updatedAt,
        taskItem.id,
        expected,
        ...lease.values,
      ],
    );
    if (changes !== 1) throw errTaskStateConflict;
    for (const result of results) {
      await tx.db.run(
        'INSERT INTO "results" ("id", "user_id", "task_id", "kind", "url", "payload", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?)',
        [result.id, result.userId, result.taskId, result.kind, result.url, result.payload, result.createdAt],
      );
    }
    if (register) {
      await register(tx);
      // 版本化资产绑定可能补充结果状态；与任务终态在同一事务保存。
      if ((taskItem.resultJson ?? "") !== storedResultJson) {
        await tx.db.run('UPDATE "tasks" SET "result_json" = ? WHERE "id" = ?', [taskItem.resultJson, taskItem.id]);
      }
    }
  });
}

export async function updateTaskTerminalState(
  repo: Repository,
  id: string,
  owner: string,
  expected: TaskStatus,
  status: TaskStatus,
  stage: string,
  errorText: string,
  completedAt: string,
): Promise<boolean> {
  const lease = taskLeaseWriter(owner, new Date().toISOString());
  const changes = await repo.db.run(
    `UPDATE "tasks" SET "status" = ?, "stage" = ?, "error" = ?, "completed_at" = ?, "lease_owner" = ?, "lease_expires_at" = NULL, "updated_at" = ? WHERE "id" = ? AND "status" = ? AND ${lease.condition}`,
    [status, stage, errorText, completedAt, "", completedAt, id, expected, ...lease.values],
  );
  return changes === 1;
}

export async function updateTaskTerminalDiagnostic(
  repo: Repository,
  taskItem: Task,
  completedAt: string,
): Promise<boolean> {
  const lease = taskLeaseWriter(taskItem.leaseOwner ?? "", new Date().toISOString());
  const changes = await repo.db.run(
    `UPDATE "tasks" SET "status" = ?, "stage" = ?, "error" = ?, "completed_at" = ?, "execution_diagnostic_json" = ?, "cancellation_source" = ?, "cancellation_actor_id" = ?, "cancellation_requested_at" = ?, "lease_owner" = ?, "lease_expires_at" = NULL, "updated_at" = ? WHERE "id" = ? AND "status" = ? AND ${lease.condition}`,
    [
      taskItem.status,
      taskItem.stage,
      taskItem.error,
      completedAt,
      taskItem.executionDiagnosticJson ?? "",
      taskItem.cancellationSource ?? "",
      taskItem.cancellationActorId ?? "",
      taskItem.cancellationRequestedAt ?? null,
      "",
      completedAt,
      taskItem.id,
      taskStatusRunning,
      ...lease.values,
    ],
  );
  return changes === 1;
}

export async function updateTaskExecutionDiagnostic(
  repo: Repository,
  userId: string,
  taskId: string,
  diagnosticJson: string,
): Promise<void> {
  const changes = await repo.db.run('UPDATE "tasks" SET "execution_diagnostic_json" = ? WHERE "id" = ? AND "user_id" = ?', [
    diagnosticJson,
    taskId,
    userId,
  ]);
  if (changes !== 1) throw recordNotFound;
}

export async function cancelTaskIfStatus(
  repo: Repository,
  userId: string,
  id: string,
  expected: TaskStatus,
  now: string,
  ...intents: TaskCancellationIntent[]
): Promise<boolean> {
  const assignments = [
    '"status" = ?',
    '"stage" = ?',
    '"error" = ?',
    '"completed_at" = ?',
    '"lease_owner" = ?',
    '"lease_expires_at" = NULL',
    '"updated_at" = ?',
  ];
  const values: (string | number | null)[] = [taskStatusCancelled, "任务已取消", "任务已取消", now, "", now];
  if (intents.length > 0) {
    const intent = intents[0];
    const diagnostic = JSON.stringify(intent.diagnostic);
    assignments.push('"cancellation_source" = ?', '"cancellation_actor_id" = ?', '"cancellation_requested_at" = ?', '"execution_diagnostic_json" = ?');
    values.push(intent.source, intent.actorId, intent.requestedAt, diagnostic);
  }
  const changes = await repo.db.run(
    `UPDATE "tasks" SET ${assignments.join(", ")} WHERE "id" = ? AND "user_id" = ? AND "status" = ?`,
    [...values, id, userId, expected],
  );
  return changes === 1;
}

// 上游取消先落库再发请求；条件更新保证并发和重复取消只有一个调用方取得发送权。
export async function claimTaskProviderCancellation(repo: Repository, userId: string, id: string, now: string): Promise<void> {
  const changes = await repo.db.run(
    'UPDATE "tasks" SET "provider_cancel_status" = ?, "provider_cancel_attempts" = ?, "provider_cancel_requested_at" = ?, "provider_cancel_next_check_at" = ?, "provider_cancel_error" = ?, "updated_at" = ? WHERE "id" = ? AND "user_id" = ? AND "status" = ? AND "provider_cancel_status" = ?',
    [
      providerCancelStatusRequested,
      1,
      now,
      new Date(new Date(now).getTime() + 15_000).toISOString(),
      "",
      now,
      id,
      userId,
      taskStatusCancelled,
      "",
    ],
  );
  if (changes !== 1) throw errTaskProviderCancellationConflict;
}

export async function updateTaskProviderCancellation(
  repo: Repository,
  id: string,
  expected: ProviderCancelStatus,
  status: ProviderCancelStatus,
  errorText: string,
  nextCheckAt: string | null,
  cancelledAt: string | null,
): Promise<void> {
  const assignments = [
    '"provider_cancel_status" = ?',
    '"provider_cancel_error" = ?',
    '"provider_cancel_next_check_at" = ?',
    '"lease_owner" = ?',
    '"lease_expires_at" = NULL',
    '"updated_at" = ?',
  ];
  const values: (string | number | null)[] = [status, errorText, nextCheckAt, "", new Date().toISOString()];
  if (cancelledAt !== null) {
    assignments.push('"provider_cancelled_at" = ?');
    values.push(cancelledAt);
  }
  const changes = await repo.db.run(
    `UPDATE "tasks" SET ${assignments.join(", ")} WHERE "id" = ? AND "status" = ? AND "provider_cancel_status" = ?`,
    [...values, id, taskStatusCancelled, expected],
  );
  if (changes !== 1) throw errTaskProviderCancellationConflict;
}

// 对账任务同样使用数据库租约，多实例和服务重启后只会有一个 worker 查询同一上游任务。
export async function claimNextTaskProviderCancellation(
  repo: Repository,
  owner: string,
  leaseDurationMs: number,
): Promise<Task | null> {
  const now = new Date();
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs).toISOString();
  return repo.transaction(async (tx) => {
    const locking = tx.dialect() === "postgres" ? " FOR UPDATE SKIP LOCKED" : "";
    const rows = await tx.db.all<TaskRow>(
      `SELECT * FROM "tasks" WHERE "status" = ? AND "provider_cancel_status" = ? AND ("provider_cancel_next_check_at" IS NULL OR "provider_cancel_next_check_at" <= ?) AND ("lease_expires_at" IS NULL OR "lease_expires_at" <= ?) ORDER BY "provider_cancel_requested_at" ASC LIMIT 1${locking}`,
      [taskStatusCancelled, providerCancelStatusRequested, nowIso, nowIso],
    );
    if (!rows.length) return null;
    const candidate = rows[0];
    const changes = await tx.db.run(
      'UPDATE "tasks" SET "lease_owner" = ?, "lease_expires_at" = ?, "provider_cancel_attempts" = "provider_cancel_attempts" + ?, "updated_at" = ? WHERE "id" = ? AND "status" = ? AND "provider_cancel_status" = ? AND ("lease_expires_at" IS NULL OR "lease_expires_at" <= ?)',
      [owner, leaseExpiresAt, 1, nowIso, candidate.id ?? "", taskStatusCancelled, providerCancelStatusRequested, nowIso],
    );
    if (changes === 0) return null;
    const updated = await tx.db.all<TaskRow>('SELECT * FROM "tasks" WHERE "id" = ? LIMIT 1', [candidate.id ?? ""]);
    return updated.length ? mapTask(updated[0]) : null;
  });
}

export async function tasks(repo: Repository, userId: string, limit: number, projectId: string, activeOnly: boolean): Promise<Task[]> {
  return tasksWithWorkbenchKind(repo, userId, limit, projectId, activeOnly, "");
}

const taskListColumns =
  '"id", "project_id", "type", "workbench_kind", "status", "stage", "media_stage", "media_recovery_json", "progress", "prompt", "operation", "provider", "model", "input_json", "result_json", "billing_order_id", "provider_request_id", "provider_cancel_status", "provider_cancel_error", "provider_cancel_attempts", "provider_cancel_requested_at", "provider_cancelled_at", "provider_cancel_next_check_at", "attempts", "started_at", "completed_at", "created_at", "updated_at", "agent_run_id", "generation_id", "approval_id", "authorized_charge_microcredits", "execution_diagnostic_json", "cancellation_source", "cancellation_actor_id", "cancellation_requested_at"';

export async function tasksWithWorkbenchKind(
  repo: Repository,
  userId: string,
  limit: number,
  projectId: string,
  activeOnly: boolean,
  workbenchKind: string,
): Promise<Task[]> {
  const effectiveLimit = limit <= 0 || limit > 100 ? 50 : limit;
  const conditions = ['"user_id" = ?'];
  const values: (string | number)[] = [userId];
  const trimmedProjectId = projectId.trim();
  if (trimmedProjectId !== "") {
    conditions.push('"project_id" = ?');
    values.push(trimmedProjectId);
  }
  if (activeOnly) {
    conditions.push('"status" IN (?, ?)');
    values.push(taskStatusQueued, taskStatusRunning);
  }
  if (workbenchKind !== "") {
    const taskType = `canvas_${workbenchKind}`;
    if (repo.dialect() === "postgres") {
      conditions.push(
        '("workbench_kind" = ? AND "type" = ?) OR ("type" = ? AND "input_json"::jsonb -> \'metadata\' ->> \'source\' = ? AND "input_json"::jsonb -> \'metadata\' ->> \'workbenchKind\' = ?)',
      );
    } else {
      conditions.push(
        '("workbench_kind" = ? AND "type" = ?) OR ("type" = ? AND json_extract("input_json", \'$.metadata.source\') = ? AND json_extract("input_json", \'$.metadata.workbenchKind\') = ?)',
      );
    }
    values.push(workbenchKind, taskType, taskType, "workbench", workbenchKind);
  }
  const rows = await repo.db.all<TaskRow>(
    `SELECT ${taskListColumns} FROM "tasks" WHERE ${conditions.join(" AND ")} ORDER BY "created_at" DESC LIMIT ?`,
    [...values, effectiveLimit],
  );
  return rows.map(mapTask);
}

// successfulWorkflowTasksForProject 返回需要补偿工作流产物的成功任务。
// 不设分页，供项目详情读取时修复浏览器中断造成的历史断点。
export async function successfulWorkflowTasksForProject(repo: Repository, userId: string, projectId: string): Promise<Task[]> {
  const rows = await repo.db.all<TaskRow>(
    'SELECT * FROM "tasks" WHERE "user_id" = ? AND "project_id" = ? AND "status" = ? ORDER BY "completed_at" ASC, "created_at" ASC',
    [userId, projectId, taskStatusSucceeded],
  );
  return rows.map(mapTask);
}

interface TaskLogRow {
  id: string;
  user_id: string;
  task_id: string;
  trace_id: string | null;
  request_id: string | null;
  level: string;
  message: string;
  payload: string;
  created_at: string | null;
}

export async function taskLogs(repo: Repository, userId: string, taskId: string): Promise<TaskLog[]> {
  const rows = await repo.db.all<TaskLogRow>(
    'SELECT * FROM "task_logs" WHERE "user_id" = ? AND "task_id" = ? ORDER BY "created_at" ASC',
    [userId, taskId],
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    traceId: row.trace_id ?? "",
    requestId: row.request_id ?? "",
    level: row.level,
    message: row.message,
    payload: row.payload,
    createdAt: toIso(row.created_at),
  }));
}
