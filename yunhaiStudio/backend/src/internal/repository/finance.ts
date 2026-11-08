// 对应 backend/internal/repository/finance.go
// 积分账户、积分流水、注册/签到奖励与带扣费的任务创建。

import { randomBytes } from "node:crypto";
import {
  creditLedgerAdminAdjust,
  creditLedgerAdminGrant,
  creditLedgerCheckinBonus,
  creditLedgerConsume,
  creditLedgerRedeem,
  creditLedgerRefund,
  creditLedgerReserve,
  creditLedgerSignupBonus,
  billingStatusRefunded,
  billingStatusReserved,
  billingStatusRunning,
  billingStatusSettled,
  taskStatusCancelled,
  taskStatusFailed,
  taskStatusQueued,
  type CreditLedgerType,
} from "@/internal/model/models";
import type { BillingOrder, CreditAccount, CreditLedgerEntry } from "@/internal/model/modelsFinance";
import type { Task } from "@/internal/model/modelsTask";
import { recordNotFound, Repository, toBool, toIso } from "./repository";
import { activeTaskCountForUser, mapTask, type TaskRow } from "./repositoryTasks";
import { requireCurrentCloudAgentParent } from "./cloudAgentConversations";
import { requireExclusiveCanvasAgent } from "./cloudAgentCanvas";
import { requireActiveLogicalModelForTask } from "./logicalModels";
import {
  billingOrderColumns,
  mapBillingOrder,
  refundBillingOrder,
  reserveBillingOrder,
  type BillingOrderRow,
} from "./financeBilling";

export const errInsufficientCredits = new Error("积分不足，请先充值");
export const errRedeemCodeInvalid = new Error("兑换码无效或已使用");
export const errActiveTaskLimit = new Error("同时进行的任务数已达上限，请等待已有任务完成");
export const errTaskNotRetryable = new Error("该任务当前状态不支持重试");
export const errTaskBillingReview = new Error("上一次调用费用仍需核对");
export const errBillingStateConflict = new Error("计费状态已变化，请刷新后重试");
export const errBillingUsageUnavailable = new Error("暂时无法获取用量，计费未完成");
export const errBillingChargeLimit = new Error("本次费用超过授权上限，已拒绝扣费");
export const errChannelModelInUse = new Error("该渠道模型正在被使用，无法删除或停用");

interface CreditAccountRow {
  user_id: string;
  available_microcredits: number;
  reserved_microcredits: number;
  version: number;
  created_at: string;
  updated_at: string;
}

const creditAccountColumns = `"user_id", "available_microcredits", "reserved_microcredits", "version", "created_at", "updated_at"`;

function mapCreditAccount(row: CreditAccountRow): CreditAccount {
  return {
    userId: row.user_id,
    availableMicrocredits: Number(row.available_microcredits ?? 0),
    reservedMicrocredits: Number(row.reserved_microcredits ?? 0),
    version: Number(row.version ?? 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

interface CreditLedgerEntryRow {
  id: string;
  user_id: string;
  type: CreditLedgerType;
  amount_microcredits: number;
  available_delta_microcredits: number;
  reserved_delta_microcredits: number;
  available_after_microcredits: number;
  reserved_after_microcredits: number;
  billing_order_id: string | null;
  payment_order_id: string | null;
  redeem_code_id: string | null;
  actor_user_id: string | null;
  model: string | null;
  channel_id: string | null;
  scene: string | null;
  note: string | null;
  reference_key: string | null;
  created_at: string;
}

const creditLedgerEntryColumns = `"id", "user_id", "type", "amount_microcredits", "available_delta_microcredits", "reserved_delta_microcredits", "available_after_microcredits", "reserved_after_microcredits", "billing_order_id", "payment_order_id", "redeem_code_id", "actor_user_id", "model", "channel_id", "scene", "note", "reference_key", "created_at"`;

function mapCreditLedgerEntry(row: CreditLedgerEntryRow): CreditLedgerEntry {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    amountMicrocredits: Number(row.amount_microcredits ?? 0),
    availableDeltaMicrocredits: Number(row.available_delta_microcredits ?? 0),
    reservedDeltaMicrocredits: Number(row.reserved_delta_microcredits ?? 0),
    availableAfterMicrocredits: Number(row.available_after_microcredits ?? 0),
    reservedAfterMicrocredits: Number(row.reserved_after_microcredits ?? 0),
    billingOrderId: row.billing_order_id ?? "",
    paymentOrderId: row.payment_order_id ?? "",
    redeemCodeId: row.redeem_code_id ?? "",
    actorUserId: row.actor_user_id ?? "",
    model: row.model ?? "",
    channelId: row.channel_id ?? "",
    scene: row.scene ?? "",
    note: row.note ?? "",
    referenceKey: row.reference_key ?? null,
    createdAt: toIso(row.created_at),
  };
}

async function loadCreditAccount(repo: Repository, userId: string): Promise<CreditAccount | null> {
  const rows = await repo.db.all<CreditAccountRow>(`SELECT ${creditAccountColumns} FROM "credit_accounts" WHERE "user_id" = ? LIMIT 1`, [userId]);
  return rows.length ? mapCreditAccount(rows[0]) : null;
}

export async function insertCreditAccount(repo: Repository, userId: string, now: string): Promise<void> {
  await repo.db.run(
    'INSERT INTO "credit_accounts" ("user_id", "available_microcredits", "reserved_microcredits", "version", "created_at", "updated_at") VALUES (?, 0, 0, 0, ?, ?) ON CONFLICT DO NOTHING',
    [userId, now, now],
  );
}

export async function insertCreditLedgerEntry(
  repo: Repository,
  entry: {
    id: string;
    userId: string;
    type: CreditLedgerType;
    amountMicrocredits?: number;
    availableDeltaMicrocredits?: number;
    reservedDeltaMicrocredits?: number;
    availableAfterMicrocredits?: number;
    reservedAfterMicrocredits?: number;
    billingOrderId?: string;
    model?: string;
    channelId?: string;
    scene?: string;
    note?: string;
    referenceKey?: string | null;
  },
  now: string,
  onConflictIgnore?: "reference_key",
): Promise<number> {
  const conflict = onConflictIgnore ? ` ON CONFLICT ("${onConflictIgnore}") DO NOTHING` : "";
  return repo.db.run(
    `INSERT INTO "credit_ledger_entries" (${creditLedgerEntryColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)${conflict}`,
    [
      entry.id,
      entry.userId,
      entry.type,
      entry.amountMicrocredits ?? 0,
      entry.availableDeltaMicrocredits ?? 0,
      entry.reservedDeltaMicrocredits ?? 0,
      entry.availableAfterMicrocredits ?? 0,
      entry.reservedAfterMicrocredits ?? 0,
      entry.billingOrderId ?? "",
      "",
      "",
      "",
      entry.model ?? "",
      entry.channelId ?? "",
      entry.scene ?? "",
      entry.note ?? "",
      entry.referenceKey ?? null,
      now,
    ],
  );
}

// 先抢占唯一业务键再更新账户，确保注册和签到奖励在多实例并发下只入账一次。
export async function grantCreditsOnce(
  repo: Repository,
  userId: string,
  entryType: CreditLedgerType,
  amount: number,
  referenceKey: string,
  note: string,
): Promise<{ account: CreditAccount; granted: boolean }> {
  let account: CreditAccount = { userId, availableMicrocredits: 0, reservedMicrocredits: 0, version: 0, createdAt: "", updatedAt: "" };
  let granted = false;
  await repo.transaction(async (tx) => {
    const now = new Date().toISOString();
    await insertCreditAccount(tx, userId, now);
    const entryId = newRepositoryId();
    const created = await insertCreditLedgerEntry(
      tx,
      { id: entryId, userId, type: entryType, amountMicrocredits: amount, note, referenceKey },
      now,
      "reference_key",
    );
    if (created === 0) {
      const existing = await loadCreditAccount(tx, userId);
      if (!existing) throw recordNotFound;
      account = existing;
      return;
    }
    granted = true;
    await tx.db.run(
      'UPDATE "credit_accounts" SET "available_microcredits" = "available_microcredits" + ?, "version" = "version" + 1, "updated_at" = ? WHERE "user_id" = ?',
      [amount, now, userId],
    );
    const updated = await loadCreditAccount(tx, userId);
    if (!updated) throw recordNotFound;
    account = updated;
    await tx.db.run(
      'UPDATE "credit_ledger_entries" SET "available_delta_microcredits" = ?, "available_after_microcredits" = ?, "reserved_after_microcredits" = ? WHERE "id" = ?',
      [amount, updated.availableMicrocredits, updated.reservedMicrocredits, entryId],
    );
  });
  return { account, granted };
}

export async function creditAccount(repo: Repository, userId: string): Promise<CreditAccount> {
  const found = await loadCreditAccount(repo, userId);
  if (found) return found;
  const now = new Date().toISOString();
  await insertCreditAccount(repo, userId, now);
  return { userId, availableMicrocredits: 0, reservedMicrocredits: 0, version: 0, createdAt: now, updatedAt: now };
}

export async function creditAccounts(repo: Repository, userIds: string[]): Promise<CreditAccount[]> {
  if (userIds.length === 0) return [];
  const placeholders = userIds.map(() => "?").join(", ");
  const rows = await repo.db.all<CreditAccountRow>(
    `SELECT ${creditAccountColumns} FROM "credit_accounts" WHERE "user_id" IN (${placeholders})`,
    userIds,
  );
  return rows.map(mapCreditAccount);
}

export async function creditLedger(
  repo: Repository,
  userId: string,
  entryType: string,
  limit: number,
  offset: number,
): Promise<{ items: CreditLedgerEntry[]; total: number }> {
  let where = '"user_id" = ? AND "type" <> ?';
  const values: string[] = [userId, creditLedgerReserve];
  switch (entryType) {
    case "income":
      where += ' AND "type" IN (?, ?, ?, ?, ?)';
      values.push(
        creditLedgerRedeem,
        creditLedgerAdminGrant,
        creditLedgerAdminAdjust,
        creditLedgerSignupBonus,
        creditLedgerCheckinBonus,
      );
      break;
    case "consume":
      where += ' AND "type" = ?';
      values.push(creditLedgerConsume);
      break;
    case "refund":
      where += ' AND "type" = ?';
      values.push(creditLedgerRefund);
      break;
  }
  const totals = await repo.db.all<{ total: number }>(
    `SELECT COUNT(*) AS "total" FROM "credit_ledger_entries" WHERE ${where}`,
    values,
  );
  const total = Number(totals[0]?.total ?? 0);
  let pageLimit = limit;
  if (pageLimit <= 0 || pageLimit > 100) pageLimit = 30;
  let pageOffset = offset;
  if (pageOffset < 0) pageOffset = 0;
  const rows = await repo.db.all<CreditLedgerEntryRow>(
    `SELECT ${creditLedgerEntryColumns} FROM "credit_ledger_entries" WHERE ${where} ORDER BY "created_at" DESC LIMIT ? OFFSET ?`,
    [...values, pageLimit, pageOffset],
  );
  return { items: rows.map(mapCreditLedgerEntry), total };
}

export async function creditLedgerReferenceExists(repo: Repository, referenceKey: string): Promise<boolean> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "credit_ledger_entries" WHERE "reference_key" = ?',
    [referenceKey],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

export async function createTaskWithCreditReservation(
  repo: Repository,
  task: Task,
  order: BillingOrder | null,
  activeTaskLimit: number,
): Promise<void> {
  await repo.transaction(async (tx) => {
    await requireCurrentCloudAgentParent(tx, task);
    await requireExclusiveCanvasAgent(tx, task);
    await requireActiveLogicalModelForTask(tx, tx, task);
    await enforceActiveTaskLimit(tx, task.userId, activeTaskLimit);
    if (order) await reserveBillingOrder(tx, order);
    await insertTask(tx, task);
    if (task.operation === "cloud_agent" && task.projectId !== "") {
      tx.canvasChanged(task.userId, task.projectId);
    }
  });
}

export async function createTaskWithActiveLimit(repo: Repository, task: Task, activeTaskLimit: number): Promise<void> {
  await repo.transaction(async (tx) => {
    await requireCurrentCloudAgentParent(tx, task);
    await requireExclusiveCanvasAgent(tx, task);
    await requireActiveLogicalModelForTask(tx, tx, task);
    await enforceActiveTaskLimit(tx, task.userId, activeTaskLimit);
    await insertTask(tx, task);
    if (task.operation === "cloud_agent" && task.projectId !== "") {
      tx.canvasChanged(task.userId, task.projectId);
    }
  });
}

export async function retryTaskWithBilling(
  repo: Repository,
  userId: string,
  prepared: Task,
  order: BillingOrder | null,
  activeTaskLimit: number,
  authorizeRelease?: (repo: Repository, task: Task, order: BillingOrder) => Promise<void> | void,
): Promise<Task> {
  const taskId = prepared.id;
  return repo.transaction(async (tx) => {
    const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    // 与自动退款保持任务先于账户的锁顺序；重试资格也必须在预扣前确认。
    const rows = await tx.db.all<TaskRow>(
      `SELECT * FROM "tasks" WHERE "id" = ? AND "user_id" = ? LIMIT 1${locking}`,
      [taskId, userId],
    );
    if (!rows.length) throw recordNotFound;
    let current = mapTask(rows[0]);
    if (current.status !== taskStatusFailed && current.status !== taskStatusCancelled) throw errTaskNotRetryable;
    if ((current.billingOrderId ?? "") !== "") {
      const previousRows = await tx.db.all<BillingOrderRow>(
        `SELECT ${billingOrderColumns} FROM "billing_orders" WHERE "id" = ? AND "user_id" = ? AND "task_id" = ? LIMIT 1${locking}`,
        [current.billingOrderId ?? "", userId, current.id],
      );
      if (!previousRows.length) throw recordNotFound;
      const previous = mapBillingOrder(previousRows[0]);
      if (previous.status === billingStatusSettled || previous.status === billingStatusRefunded) {
        // 已结算或已退款都不需要释放冻结积分。
      } else if (previous.status === billingStatusReserved || previous.status === billingStatusRunning) {
        if (!authorizeRelease) throw errTaskBillingReview;
        await authorizeRelease(tx, current, previous);
        // 旧执行证据将在重试时清空，必须先在同一事务中完成释放。
        await refundBillingOrder(tx, previous, "重试前退回：已确认上次请求未提交或上游明确失败");
      } else {
        throw errTaskBillingReview;
      }
    }
    await enforceActiveTaskLimit(tx, userId, activeTaskLimit);
    if (order) await reserveBillingOrder(tx, order);
    const now = new Date().toISOString();
    const sets = [
      '"status" = ?',
      '"stage" = ?',
      '"progress" = ?',
      '"error" = ?',
      '"result_json" = ?',
      '"execution_diagnostic_json" = ?',
      '"cancellation_source" = ?',
      '"cancellation_actor_id" = ?',
      '"cancellation_requested_at" = ?',
      '"text_draft" = ?',
      '"started_at" = ?',
      '"completed_at" = ?',
      '"provider_request_id" = ?',
      '"poll_stage" = ?',
      '"next_poll_at" = ?',
      '"provider_cancel_status" = ?',
      '"provider_cancel_error" = ?',
      '"provider_cancel_attempts" = ?',
      '"provider_cancel_requested_at" = ?',
      '"provider_cancelled_at" = ?',
      '"provider_cancel_next_check_at" = ?',
      '"route_run" = "route_run" + 1',
      '"logical_model_revision_id" = ?',
      '"route_id" = ?',
      '"channel_model_id" = ?',
      '"input_json" = ?',
      '"model" = ?',
      '"provider" = ?',
      '"lease_owner" = ?',
      '"lease_expires_at" = ?',
      '"updated_at" = ?',
      '"billing_order_id" = ?',
    ];
    const values: (string | number | null)[] = [
      taskStatusQueued,
      "等待队列调度",
      5,
      "",
      "",
      "",
      "",
      "",
      null,
      "",
      null,
      null,
      "",
      "",
      null,
      "",
      "",
      0,
      null,
      null,
      null,
      prepared.logicalModelRevisionId ?? "",
      prepared.routeId ?? "",
      prepared.channelModelId ?? "",
      prepared.inputJson,
      prepared.model,
      prepared.provider,
      "",
      null,
      now,
      order ? order.id : "",
    ];
    const affected = await tx.db.run(
      `UPDATE "tasks" SET ${sets.join(", ")} WHERE "id" = ? AND "user_id" = ? AND "status" IN (?, ?)`,
      [...values, taskId, userId, taskStatusFailed, taskStatusCancelled],
    );
    if (affected !== 1) throw errTaskNotRetryable;
    await tx.db.run('DELETE FROM "task_text_deltas" WHERE "user_id" = ? AND "task_id" = ?', [userId, taskId]);
    const reloaded = await tx.db.all<TaskRow>(`SELECT * FROM "tasks" WHERE "id" = ? AND "user_id" = ? LIMIT 1`, [taskId, userId]);
    if (!reloaded.length) throw recordNotFound;
    current = mapTask(reloaded[0]);
    return current;
  });
}

async function enforceActiveTaskLimit(repo: Repository, userId: string, activeTaskLimit: number): Promise<void> {
  const count = await activeTaskCountForUser(repo, userId);
  if (count >= activeTaskLimit) throw errActiveTaskLimit;
}

async function insertTask(repo: Repository, task: Task): Promise<void> {
  const now = new Date().toISOString();
  const createdAt = task.createdAt || now;
  const createdAtEpoch = task.createdAtEpoch ?? Math.floor(new Date(createdAt).getTime() / 1000);
  await repo.db.run(
    `INSERT INTO "tasks" ("agent_execution_ready", "agent_run_id", "generation_id", "approval_id", "authorized_charge_microcredits", "execution_diagnostic_json", "cancellation_source", "cancellation_actor_id", "cancellation_requested_at", "creation_submission_id", "workbench_kind", "id", "user_id", "trace_id", "request_id", "project_id", "type", "status", "stage", "progress", "prompt", "operation", "provider", "model", "logical_model_id", "logical_model_revision_id", "route_id", "channel_model_id", "route_run", "billing_order_id", "provider_request_id", "provider_cancel_status", "provider_cancel_error", "provider_cancel_attempts", "provider_cancel_requested_at", "provider_cancelled_at", "provider_cancel_next_check_at", "poll_stage", "next_poll_at", "lease_owner", "lease_expires_at", "input_json", "result_json", "media_recovery_json", "media_stage", "text_draft", "error", "attempts", "started_at", "completed_at", "created_at", "created_at_epoch", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      toBool(task.agentExecutionReady),
      task.agentRunId ?? "",
      task.generationId ?? "",
      task.approvalId ?? "",
      task.authorizedChargeMicrocredits ?? 0,
      task.executionDiagnosticJson ?? "",
      task.cancellationSource ?? "",
      task.cancellationActorId ?? "",
      task.cancellationRequestedAt ?? null,
      task.creationSubmissionId ?? null,
      task.workbenchKind ?? "",
      task.id,
      task.userId,
      task.traceId ?? "",
      task.requestId ?? "",
      task.projectId,
      task.type,
      task.status,
      task.stage,
      task.progress,
      task.prompt,
      task.operation,
      task.provider,
      task.model,
      task.logicalModelId ?? "",
      task.logicalModelRevisionId ?? "",
      task.routeId ?? "",
      task.channelModelId ?? "",
      task.routeRun ?? 0,
      task.billingOrderId ?? "",
      task.providerRequestId ?? "",
      task.providerCancelStatus ?? "",
      task.providerCancelError ?? "",
      task.providerCancelAttempts ?? 0,
      task.providerCancelRequestedAt ?? null,
      task.providerCancelledAt ?? null,
      task.providerCancelNextCheckAt ?? null,
      task.pollStage ?? "",
      task.nextPollAt ?? null,
      task.leaseOwner ?? "",
      task.leaseExpiresAt ?? null,
      task.inputJson,
      task.resultJson,
      task.mediaRecoveryJson ?? "",
      task.mediaStage ?? "",
      task.textDraft ?? "",
      task.error,
      task.attempts,
      task.startedAt ?? null,
      task.completedAt ?? null,
      createdAt,
      createdAtEpoch,
      task.updatedAt || now,
    ],
  );
}

export function newRepositoryId(): string {
  return randomRepositorySuffix();
}

function randomRepositorySuffix(): string {
  try {
    return randomBytes(16).toString("hex");
  } catch {
    return "fallback";
  }
}
