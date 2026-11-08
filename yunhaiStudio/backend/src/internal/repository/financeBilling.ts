// 对应 backend/internal/repository/finance_billing.go
// 计费订单的预占、执行、结算、退款与用量回填。

import {
  apiCallStatusFailed,
  apiCallStatusSucceeded,
  billingStatusRefunded,
  billingStatusReserved,
  billingStatusRunning,
  billingStatusSettled,
  billingStatusUncertain,
  creditLedgerConsume,
  creditLedgerRefund,
  creditLedgerReserve,
  taskStatusCancelled,
  taskStatusFailed,
  type BillingStatus,
} from "@/internal/model/models";
import type { BillingOrder } from "@/internal/model/modelsFinance";
import { billingOrderBillingTokenPriceRules, billingOrderTokenPrices } from "@/internal/model/tokenPriceRules";
import type { SqlValue } from "@/internal/database/database";
import { recordNotFound, Repository, toBool, toIso, toNullableIso } from "./repository";
import {
  errBillingStateConflict,
  errBillingUsageUnavailable,
  errInsufficientCredits,
  insertCreditAccount,
  insertCreditLedgerEntry,
  newRepositoryId,
} from "./finance";
import { billingChargeLimitApplies, validateBillingChargeLimit } from "./billingAuthorization";

export interface BillingOrderRow {
  id: string | null;
  user_id: string | null;
  idempotency_key: string | null;
  task_id: string | null;
  channel_id: string | null;
  channel_model_id: string | null;
  price_tier_id: string | null;
  price_tier_version: number | null;
  price_selector_json: string | null;
  model: string | null;
  capability: string | null;
  scene: string | null;
  billing_mode: string | null;
  price_version: number | null;
  unit_price_microcredits: number | null;
  multiplier_basis_points: number | null;
  user_group: string | null;
  price_currency: string | null;
  currency_rate_microcredits: number | null;
  quantity: number | null;
  amount_microcredits: number | null;
  reserved_amount_microcredits: number | null;
  charge_limit_set: number | boolean | null;
  charge_limit_microcredits: number | null;
  actual_amount_microcredits: number | null;
  refunded_amount_microcredits: number | null;
  input_token_price_microcredits: number | null;
  output_token_price_microcredits: number | null;
  cached_token_price_microcredits: number | null;
  cache_write_token_price_microcredits: number | null;
  token_price_rules_json: string | null;
  token_price_rule: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  cache_write_tokens: number | null;
  video_formula_tokens: number | null;
  reference_video_count: number | null;
  reference_video_millis: number | null;
  reference_video_billed: number | boolean | null;
  usage_source: string | null;
  usage_available: number | boolean | null;
  status: string | null;
  provider_request_id: string | null;
  error: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  started_at: string | null;
  settled_at: string | null;
  refunded_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export const billingOrderColumns = `"id", "user_id", "idempotency_key", "task_id", "channel_id", "channel_model_id", "price_tier_id", "price_tier_version", "price_selector_json", "model", "capability", "scene", "billing_mode", "price_version", "unit_price_microcredits", "multiplier_basis_points", "user_group", "price_currency", "currency_rate_microcredits", "quantity", "amount_microcredits", "reserved_amount_microcredits", "charge_limit_set", "charge_limit_microcredits", "actual_amount_microcredits", "refunded_amount_microcredits", "input_token_price_microcredits", "output_token_price_microcredits", "cached_token_price_microcredits", "cache_write_token_price_microcredits", "token_price_rules_json", "token_price_rule", "input_tokens", "output_tokens", "cached_tokens", "cache_write_tokens", "video_formula_tokens", "reference_video_count", "reference_video_millis", "reference_video_billed", "usage_source", "usage_available", "status", "provider_request_id", "error", "resolved_by", "resolution_note", "started_at", "settled_at", "refunded_at", "created_at", "updated_at"`;

export function mapBillingOrder(row: BillingOrderRow): BillingOrder {
  return {
    id: row.id ?? "",
    userId: row.user_id ?? "",
    idempotencyKey: row.idempotency_key ?? "",
    taskId: row.task_id ?? "",
    channelId: row.channel_id ?? "",
    channelModelId: row.channel_model_id ?? "",
    priceTierId: row.price_tier_id ?? "",
    priceTierVersion: Number(row.price_tier_version ?? 0),
    priceSelectorJson: row.price_selector_json ?? "",
    model: row.model ?? "",
    capability: row.capability ?? "",
    scene: row.scene ?? "",
    billingMode: row.billing_mode ?? "",
    priceVersion: Number(row.price_version ?? 0),
    unitPriceMicrocredits: Number(row.unit_price_microcredits ?? 0),
    multiplierBasisPoints: Number(row.multiplier_basis_points ?? 0),
    userGroup: row.user_group ?? "",
    priceCurrency: row.price_currency ?? "",
    currencyRateMicrocredits: Number(row.currency_rate_microcredits ?? 0),
    quantity: Number(row.quantity ?? 0),
    amountMicrocredits: Number(row.amount_microcredits ?? 0),
    reservedAmountMicrocredits: Number(row.reserved_amount_microcredits ?? 0),
    chargeLimitSet: toBool(row.charge_limit_set),
    chargeLimitMicrocredits: Number(row.charge_limit_microcredits ?? 0),
    actualAmountMicrocredits: Number(row.actual_amount_microcredits ?? 0),
    refundedAmountMicrocredits: Number(row.refunded_amount_microcredits ?? 0),
    inputTokenPriceMicrocredits: Number(row.input_token_price_microcredits ?? 0),
    outputTokenPriceMicrocredits: Number(row.output_token_price_microcredits ?? 0),
    cachedTokenPriceMicrocredits: Number(row.cached_token_price_microcredits ?? 0),
    cacheWriteTokenPriceMicrocredits: Number(row.cache_write_token_price_microcredits ?? 0),
    tokenPriceRulesJson: row.token_price_rules_json ?? "",
    tokenPriceRule: Number(row.token_price_rule ?? 0),
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    cachedTokens: Number(row.cached_tokens ?? 0),
    cacheWriteTokens: Number(row.cache_write_tokens ?? 0),
    videoFormulaTokens: Number(row.video_formula_tokens ?? 0),
    referenceVideoCount: Number(row.reference_video_count ?? 0),
    referenceVideoMillis: Number(row.reference_video_millis ?? 0),
    referenceVideoBilled: toBool(row.reference_video_billed),
    usageSource: row.usage_source ?? "",
    usageAvailable: toBool(row.usage_available),
    status: (row.status ?? "") as BillingStatus,
    providerRequestId: row.provider_request_id ?? "",
    error: row.error ?? "",
    resolvedBy: row.resolved_by ?? "",
    resolutionNote: row.resolution_note ?? "",
    startedAt: toNullableIso(row.started_at),
    settledAt: toNullableIso(row.settled_at),
    refundedAt: toNullableIso(row.refunded_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export interface BillingUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
}

export interface BillingAutoRefundCursor {
  createdAt: string;
  id: string;
}

const billingUsageSourceProvider = "provider";
const billingUsageSourceVideoFormula = "video_formula";
const videoFormulaNote = "按提交时的视频 Token 公式快照结算";

type BillingUpdate = [column: string, value: SqlValue];

function nowIso(): string {
  return new Date().toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function updateBillingOrderState(repo: Repository, order: BillingOrder, updates: BillingUpdate[]): Promise<void> {
  const sets = updates.map(([column]) => `"${column}" = ?`);
  const affected = await repo.db.run(
    `UPDATE "billing_orders" SET ${sets.join(", ")} WHERE "id" = ? AND "status" = ?`,
    [...updates.map(([, value]) => value), order.id, order.status],
  );
  if (affected !== 1) throw errBillingStateConflict;
}

async function insertBillingOrder(repo: Repository, order: BillingOrder): Promise<void> {
  const now = nowIso();
  await repo.db.run(
    `INSERT INTO "billing_orders" (${billingOrderColumns}) VALUES (${billingOrderColumns.split(", ").map(() => "?").join(", ")})`,
    [
      order.id,
      order.userId,
      order.idempotencyKey,
      order.taskId ?? "",
      order.channelId,
      order.channelModelId,
      order.priceTierId ?? "",
      order.priceTierVersion,
      order.priceSelectorJson ?? "",
      order.model,
      order.capability,
      order.scene,
      order.billingMode,
      order.priceVersion,
      order.unitPriceMicrocredits,
      order.multiplierBasisPoints,
      order.userGroup ?? "",
      order.priceCurrency ?? "",
      order.currencyRateMicrocredits ?? 0,
      order.quantity,
      order.amountMicrocredits,
      order.reservedAmountMicrocredits,
      toBool(order.chargeLimitSet),
      order.chargeLimitMicrocredits ?? 0,
      order.actualAmountMicrocredits,
      order.refundedAmountMicrocredits,
      order.inputTokenPriceMicrocredits,
      order.outputTokenPriceMicrocredits,
      order.cachedTokenPriceMicrocredits,
      order.cacheWriteTokenPriceMicrocredits,
      order.tokenPriceRulesJson ?? "",
      order.tokenPriceRule,
      order.inputTokens,
      order.outputTokens,
      order.cachedTokens,
      order.cacheWriteTokens,
      order.videoFormulaTokens,
      order.referenceVideoCount,
      order.referenceVideoMillis,
      toBool(order.referenceVideoBilled),
      order.usageSource ?? "",
      toBool(order.usageAvailable),
      order.status,
      order.providerRequestId ?? "",
      order.error ?? "",
      order.resolvedBy ?? "",
      order.resolutionNote ?? "",
      order.startedAt,
      order.settledAt,
      order.refundedAt,
      order.createdAt || now,
      order.updatedAt || now,
    ],
  );
}

async function creditAccountBalance(repo: Repository, userId: string): Promise<{ available: number; reserved: number }> {
  const rows = await repo.db.all<{ available_microcredits: number; reserved_microcredits: number }>(
    'SELECT "available_microcredits", "reserved_microcredits" FROM "credit_accounts" WHERE "user_id" = ? LIMIT 1',
    [userId],
  );
  if (!rows.length) throw recordNotFound;
  return {
    available: Number(rows[0].available_microcredits ?? 0),
    reserved: Number(rows[0].reserved_microcredits ?? 0),
  };
}

// 预占与结算都按“任务/订单在前、账户在后”的顺序加锁，避免与自动退款互相等待。
export async function reserveBillingOrder(repo: Repository, order: BillingOrder): Promise<void> {
  validateBillingChargeLimit(order, order.amountMicrocredits);
  if (order.reservedAmountMicrocredits <= 0) order.reservedAmountMicrocredits = order.amountMicrocredits;
  const now = nowIso();
  await insertCreditAccount(repo, order.userId, now);
  const affected = await repo.db.run(
    'UPDATE "credit_accounts" SET "available_microcredits" = "available_microcredits" - ?, "reserved_microcredits" = "reserved_microcredits" + ?, "version" = "version" + 1, "updated_at" = ? WHERE "user_id" = ? AND "available_microcredits" >= ?',
    [order.amountMicrocredits, order.amountMicrocredits, now, order.userId, order.amountMicrocredits],
  );
  if (affected !== 1) throw errInsufficientCredits;
  const account = await creditAccountBalance(repo, order.userId);
  await insertBillingOrder(repo, order);
  await insertCreditLedgerEntry(
    repo,
    {
      id: newRepositoryId(),
      userId: order.userId,
      type: creditLedgerReserve,
      availableDeltaMicrocredits: -order.amountMicrocredits,
      reservedDeltaMicrocredits: order.amountMicrocredits,
      availableAfterMicrocredits: account.available,
      reservedAfterMicrocredits: account.reserved,
      billingOrderId: order.id,
      model: order.model,
      channelId: order.channelId,
      scene: order.scene,
      note: referenceVideoLedgerNote(order),
    },
    now,
  );
}

export async function ReserveBillingOrder(repo: Repository, order: BillingOrder): Promise<void> {
  await repo.transaction((tx) => reserveBillingOrder(tx, order));
}

function referenceVideoLedgerNote(order: BillingOrder): string {
  if (order.referenceVideoCount <= 0) return "";
  let status = "未计费";
  if (order.referenceVideoBilled) status = "已计费";
  if (order.referenceVideoMillis <= 0) return `参考视频 ${order.referenceVideoCount} 个${status}`;
  let seconds = (order.referenceVideoMillis / 1000).toFixed(1);
  if (order.referenceVideoMillis % 1000 === 0) seconds = String(order.referenceVideoMillis / 1000);
  return `参考视频 ${seconds} 秒${status}`;
}

function joinLedgerNotes(...notes: string[]): string {
  const result: string[] = [];
  for (const note of notes) {
    const trimmed = (note ?? "").trim();
    if (trimmed !== "") result.push(trimmed);
  }
  return result.join("；");
}

export async function BillingOrder(repo: Repository, id: string): Promise<BillingOrder | null> {
  const rows = await repo.db.all<BillingOrderRow>(`SELECT ${billingOrderColumns} FROM "billing_orders" WHERE "id" = ? LIMIT 1`, [id]);
  return rows.length ? mapBillingOrder(rows[0]) : null;
}

export async function BillingOrdersByIDs(repo: Repository, ids: string[]): Promise<Map<string, BillingOrder>> {
  const result = new Map<string, BillingOrder>();
  if (ids.length === 0) return result;
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await repo.db.all<BillingOrderRow>(
    `SELECT ${billingOrderColumns} FROM "billing_orders" WHERE "id" IN (${placeholders})`,
    ids,
  );
  for (const row of rows) {
    const order = mapBillingOrder(row);
    result.set(order.id, order);
  }
  return result;
}

export async function BillingOrdersByTaskIDs(
  repo: Repository,
  userId: string,
  taskIds: string[],
): Promise<Map<string, BillingOrder>> {
  const result = new Map<string, BillingOrder>();
  if (taskIds.length === 0) return result;
  const placeholders = taskIds.map(() => "?").join(", ");
  const rows = await repo.db.all<BillingOrderRow>(
    `SELECT ${billingOrderColumns} FROM "billing_orders" WHERE "user_id" = ? AND "task_id" IN (${placeholders})`,
    [userId, ...taskIds],
  );
  for (const row of rows) {
    const order = mapBillingOrder(row);
    if ((order.taskId ?? "") !== "") result.set(order.taskId ?? "", order);
  }
  return result;
}

function autoRefundableConditions(): { where: string; values: SqlValue[] } {
  const cutoff = new Date(Date.now() - 40 * 60 * 1000).toISOString();
  return {
    where:
      '("billing_orders"."status" IN (?, ?) OR ("billing_orders"."status" = ? AND "billing_orders"."updated_at" < ?))' +
      ' AND "tasks"."status" IN (?, ?)' +
      ` AND COALESCE("tasks"."media_recovery_json", '') = ''` +
      ` AND COALESCE("tasks"."execution_diagnostic_json", '') NOT LIKE ?`,
    values: [billingStatusUncertain, billingStatusReserved, billingStatusRunning, cutoff, taskStatusFailed, taskStatusCancelled, '%"code":"result_persistence_failed"%'],
  };
}

export async function AutoRefundableBillingOrders(
  repo: Repository,
  limit: number,
  before: BillingAutoRefundCursor | null,
): Promise<BillingAutoRefundCursor[]> {
  const base = autoRefundableConditions();
  let where = base.where;
  const values = [...base.values];
  if (before) {
    where += ' AND ("billing_orders"."created_at" < ? OR ("billing_orders"."created_at" = ? AND "billing_orders"."id" < ?))';
    values.push(before.createdAt, before.createdAt, before.id);
  }
  const rows = await repo.db.all<{ id: string; created_at: string }>(
    `SELECT "billing_orders"."id", "billing_orders"."created_at" FROM "billing_orders" JOIN "tasks" ON "tasks"."id" = "billing_orders"."task_id" WHERE ${where} ORDER BY "billing_orders"."created_at" DESC, "billing_orders"."id" DESC LIMIT ?`,
    [...values, limit],
  );
  return rows.map((row) => ({ createdAt: toIso(row.created_at), id: row.id }));
}

export async function AdminBillingOrders(
  repo: Repository,
  status: string,
  keyword: string,
  limit: number,
  offset: number,
): Promise<{ items: BillingOrder[]; total: number }> {
  const joins: string[] = [];
  const conditions: string[] = [];
  const values: SqlValue[] = [];
  const cutoff = new Date(Date.now() - 40 * 60 * 1000).toISOString();
  if (status === "review") {
    joins.push('LEFT JOIN "tasks" ON "tasks"."id" = "billing_orders"."task_id"');
    conditions.push(
      '("billing_orders"."status" = ? OR ("billing_orders"."status" = ? AND "billing_orders"."updated_at" < ?) OR ("billing_orders"."status" = ? AND "tasks"."status" IN (?, ?)))',
    );
    values.push(billingStatusUncertain, billingStatusRunning, cutoff, billingStatusReserved, taskStatusFailed, taskStatusCancelled);
  } else if (status !== "" && status !== "all") {
    conditions.push('"billing_orders"."status" = ?');
    values.push(status);
  }
  const trimmedKeyword = (keyword ?? "").trim();
  if (trimmedKeyword !== "") {
    const pattern = `%${trimmedKeyword.toLowerCase()}%`;
    joins.push('LEFT JOIN "users" ON "users"."id" = "billing_orders"."user_id"');
    conditions.push(
      '(lower("billing_orders"."model") LIKE ? OR lower("billing_orders"."scene") LIKE ? OR lower("billing_orders"."provider_request_id") LIKE ? OR lower("users"."username") LIKE ? OR lower("users"."display_name") LIKE ?)',
    );
    values.push(pattern, pattern, pattern, pattern, pattern);
  }
  const joinSql = joins.length ? ` ${joins.join(" ")}` : "";
  const whereSql = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const totals = await repo.db.all<{ total: number }>(
    `SELECT COUNT(*) AS "total" FROM "billing_orders"${joinSql}${whereSql}`,
    values,
  );
  const total = Number(totals[0]?.total ?? 0);
  const rows = await repo.db.all<BillingOrderRow>(
    `SELECT "billing_orders".* FROM "billing_orders"${joinSql}${whereSql} ORDER BY "billing_orders"."created_at" DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset],
  );
  return { items: rows.map(mapBillingOrder), total };
}

export async function BillingOrderHasTerminalFailure(repo: Repository, orderId: string): Promise<boolean> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "api_call_logs" WHERE "billing_order_id" = ? AND "billable" = ? AND "request_kind" = ? AND "status" = ? AND "error_code" IN (?, ?)',
    [orderId, true, "create", apiCallStatusFailed, "task_failed", "task_cancelled"],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

export async function BillingOrderHasSuccessfulBillableCall(repo: Repository, orderId: string): Promise<boolean> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "api_call_logs" WHERE "billing_order_id" = ? AND "billable" = ? AND "status" = ?',
    [orderId, true, apiCallStatusSucceeded],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

export async function TaskHasSuccessfulBillableCall(repo: Repository, taskId: string): Promise<boolean> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "api_call_logs" WHERE "task_id" = ? AND "billable" = ? AND "status" = ?',
    [taskId, true, apiCallStatusSucceeded],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function queryBillingUsage(repo: Repository, orderId: string): Promise<BillingUsage> {
  const rows = await repo.db.all<{
    input_tokens: number | null;
    output_tokens: number | null;
    cached_tokens: number | null;
    cache_write_tokens: number | null;
  }>(
    'SELECT "input_tokens", "output_tokens", "cached_tokens", "cache_write_tokens" FROM "api_call_logs" WHERE "billing_order_id" = ? AND "status" = ? AND "usage_available" = ? ORDER BY "created_at" DESC LIMIT 1',
    [orderId, apiCallStatusSucceeded, true],
  );
  if (!rows.length) throw errBillingUsageUnavailable;
  return {
    inputTokens: Number(rows[0].input_tokens ?? 0),
    outputTokens: Number(rows[0].output_tokens ?? 0),
    cachedTokens: Number(rows[0].cached_tokens ?? 0),
    cacheWriteTokens: Number(rows[0].cache_write_tokens ?? 0),
  };
}

export async function BillingUsage(repo: Repository, orderId: string): Promise<BillingUsage> {
  return queryBillingUsage(repo, orderId);
}

async function tokenSettlementUsage(
  repo: Repository,
  order: BillingOrder,
): Promise<{ usage: BillingUsage | null; source: string }> {
  if (
    order.capability === "video" &&
    order.referenceVideoCount > 0 &&
    !order.referenceVideoBilled &&
    order.videoFormulaTokens > 0
  ) {
    return {
      usage: { inputTokens: 0, outputTokens: order.videoFormulaTokens, cachedTokens: 0, cacheWriteTokens: 0 },
      source: billingUsageSourceVideoFormula,
    };
  }
  let usage: BillingUsage | null = null;
  let unavailable = false;
  try {
    usage = await queryBillingUsage(repo, order.id);
  } catch (error) {
    if (error !== errBillingUsageUnavailable) throw error;
    unavailable = true;
  }
  if (order.capability !== "video") {
    if (unavailable) throw errBillingUsageUnavailable;
    return { usage, source: billingUsageSourceProvider };
  }
  if (!unavailable && usage && usage.outputTokens > 0 && usage.inputTokens >= 0 && usage.cachedTokens >= 0) {
    return {
      // 视频只按输出时长 Token 结算，上游返回的输入/缓存字段不参与计费。
      usage: { inputTokens: 0, outputTokens: usage.outputTokens, cachedTokens: 0, cacheWriteTokens: 0 },
      source: billingUsageSourceProvider,
    };
  }
  if (order.videoFormulaTokens > 0) {
    return {
      usage: { inputTokens: 0, outputTokens: order.videoFormulaTokens, cachedTokens: 0, cacheWriteTokens: 0 },
      source: billingUsageSourceVideoFormula,
    };
  }
  if (unavailable) throw errBillingUsageUnavailable;
  return { usage, source: billingUsageSourceProvider };
}

function tokenBillingAmount(
  multiplierBasisPoints: number,
  terms: { tokens: number; priceMicrocredits: number }[],
): number {
  if (multiplierBasisPoints <= 0) throw new Error("invalid token billing");
  let total = 0n;
  for (const term of terms) {
    if (term.tokens < 0 || term.priceMicrocredits < 0) throw new Error("invalid token billing");
    total += BigInt(term.tokens) * BigInt(term.priceMicrocredits);
  }
  total *= BigInt(multiplierBasisPoints);
  const divisor = 10_000_000_000n;
  let amount = total / divisor;
  if (total % divisor !== 0n) amount += 1n;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("token billing overflow");
  return Number(amount);
}

function tokenUsageAmount(order: BillingOrder, usage: BillingUsage | null): { amount: number; priceRule: number } {
  if (!usage) throw errBillingUsageUnavailable;
  if (usage.inputTokens < 0 || usage.outputTokens < 0 || usage.cachedTokens < 0 || usage.cacheWriteTokens < 0) {
    throw new Error("invalid token usage amount");
  }
  if (order.capability === "video" && usage.outputTokens <= 0) throw errBillingUsageUnavailable;
  const prices = billingOrderTokenPrices(order, usage.inputTokens);
  const terms = [{ tokens: usage.outputTokens, priceMicrocredits: prices.prices.output }];
  if (order.capability !== "video") {
    const inputTokens = Math.max(usage.inputTokens - usage.cachedTokens - usage.cacheWriteTokens, 0);
    terms.push(
      { tokens: inputTokens, priceMicrocredits: prices.prices.input },
      { tokens: usage.cachedTokens, priceMicrocredits: prices.prices.cached },
      { tokens: usage.cacheWriteTokens, priceMicrocredits: prices.prices.cacheWrite },
    );
  }
  try {
    return { amount: tokenBillingAmount(order.multiplierBasisPoints, terms), priceRule: prices.rule };
  } catch {
    throw new Error("invalid token usage amount");
  }
}

function audioBillingAmount(unitPriceMicrocredits: number, quantity: number, multiplierBasisPoints: number): number {
  if (unitPriceMicrocredits < 0 || quantity <= 0 || multiplierBasisPoints <= 0) {
    throw new Error("积分计费参数无效");
  }
  const maxInt64 = (1n << 63n) - 1n;
  const unit = BigInt(unitPriceMicrocredits);
  const count = BigInt(quantity);
  const multiplier = BigInt(multiplierBasisPoints);
  if (unit > maxInt64 / count || unit * count > (maxInt64 - 9999n) / multiplier) {
    throw new Error("积分计费金额溢出");
  }
  const amount = (unit * count * multiplier + 9999n) / 10000n;
  if (amount < 0n) throw new Error(`积分计费金额无效：${amount}`);
  return Number(amount);
}

export async function RecordBillingResolution(
  repo: Repository,
  id: string,
  actorUserId: string,
  note: string,
): Promise<void> {
  await repo.db.run(
    'UPDATE "billing_orders" SET "resolved_by" = ?, "resolution_note" = ?, "updated_at" = ? WHERE "id" = ?',
    [actorUserId, note, nowIso(), id],
  );
}

export async function UpdateBillingProviderRequestID(
  repo: Repository,
  id: string,
  providerRequestId: string,
): Promise<void> {
  if (id === "" || providerRequestId === "") return;
  await repo.db.run('UPDATE "billing_orders" SET "provider_request_id" = ?, "updated_at" = ? WHERE "id" = ?', [
    providerRequestId,
    nowIso(),
    id,
  ]);
}

export async function MarkBillingRunning(repo: Repository, id: string): Promise<void> {
  if (id === "") return;
  const rows = await repo.db.all<{ id: string; status: BillingStatus }>(
    'SELECT "id", "status" FROM "billing_orders" WHERE "id" = ? LIMIT 1',
    [id],
  );
  if (!rows.length) throw recordNotFound;
  if (rows[0].status === billingStatusRunning) return;
  const now = nowIso();
  const affected = await repo.db.run(
    'UPDATE "billing_orders" SET "status" = ?, "started_at" = ?, "updated_at" = ? WHERE "id" = ? AND "status" = ?',
    [billingStatusRunning, now, now, id, billingStatusReserved],
  );
  if (affected !== 1) throw errBillingStateConflict;
}

export async function MarkBillingUncertain(repo: Repository, id: string, reason: string): Promise<void> {
  if (id === "") return;
  const now = nowIso();
  await repo.db.run(
    'UPDATE "billing_orders" SET "status" = ?, "error" = ?, "updated_at" = ? WHERE "id" = ? AND "status" IN (?, ?)',
    [billingStatusUncertain, reason, now, id, billingStatusReserved, billingStatusRunning],
  );
}

function zeroPricedTokenOrder(order: BillingOrder): boolean {
  if (
    order.billingMode !== "token" ||
    order.inputTokenPriceMicrocredits !== 0 ||
    order.outputTokenPriceMicrocredits !== 0 ||
    order.cachedTokenPriceMicrocredits !== 0 ||
    order.cacheWriteTokenPriceMicrocredits !== 0
  ) {
    return false;
  }
  let rules;
  try {
    rules = billingOrderBillingTokenPriceRules(order);
  } catch {
    return false;
  }
  for (const rule of rules) {
    if (rule.input !== 0 || rule.output !== 0 || rule.cached !== 0 || rule.cacheWrite !== 0) return false;
  }
  return true;
}

async function settleBillingOrder(
  repo: Repository,
  id: string,
  providerRequestId: string,
  audioDurationMs: number | null,
): Promise<void> {
  const observed: { usage: BillingUsage | null; usageSource: string; actual: number; actualAvailable: boolean } = {
    usage: null,
    usageSource: "",
    actual: 0,
    actualAvailable: false,
  };
  try {
    await repo.transaction(async (tx) => {
      const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
      const rows = await tx.db.all<BillingOrderRow>(
        `SELECT ${billingOrderColumns} FROM "billing_orders" WHERE "id" = ? LIMIT 1${locking}`,
        [id],
      );
      if (!rows.length) throw recordNotFound;
      const order = mapBillingOrder(rows[0]);
      if (order.status === billingStatusSettled) return;
      if (order.status === billingStatusRefunded) throw new Error("billing order already refunded");
      if (order.billingMode !== "token") {
        validateBillingChargeLimit(order, order.amountMicrocredits);
      }
      if (order.billingMode === "token" && !zeroPricedTokenOrder(order)) {
        const settlement = await tokenSettlementUsage(tx, order);
        const usage = settlement.usage;
        observed.usage = usage;
        observed.usageSource = settlement.source;
        const reserved = order.reservedAmountMicrocredits > 0 ? order.reservedAmountMicrocredits : order.amountMicrocredits;
        const priced = tokenUsageAmount(order, usage);
        let actual = priced.amount;
        const priceRule = priced.priceRule;
        const chargeCapped = billingChargeLimitApplies(order) && actual > (order.chargeLimitMicrocredits ?? 0);
        if (chargeCapped) actual = order.chargeLimitMicrocredits ?? 0;
        observed.actual = actual;
        observed.actualAvailable = true;
        const refund = Math.max(reserved - actual, 0);
        const supplement = Math.max(actual - reserved, 0);
        const now = nowIso();
        const affected = await tx.db.run(
          'UPDATE "credit_accounts" SET "available_microcredits" = "available_microcredits" + ?, "reserved_microcredits" = "reserved_microcredits" - ?, "version" = "version" + 1, "updated_at" = ? WHERE "user_id" = ? AND "reserved_microcredits" >= ?',
          [refund - supplement, reserved, now, order.userId, reserved],
        );
        if (affected !== 1) throw new Error("reserved credit balance is inconsistent");
        const account = await creditAccountBalance(tx, order.userId);
        const updates: BillingUpdate[] = [
          ["status", billingStatusSettled],
          ["settled_at", now],
          ["updated_at", now],
          ["actual_amount_microcredits", actual],
          ["refunded_amount_microcredits", refund],
          ["input_tokens", usage!.inputTokens],
          ["output_tokens", usage!.outputTokens],
          ["cached_tokens", usage!.cachedTokens],
          ["cache_write_tokens", usage!.cacheWriteTokens],
          ["usage_available", settlement.source === billingUsageSourceProvider],
          ["usage_source", settlement.source],
          ["token_price_rule", priceRule],
        ];
        if (providerRequestId !== "") updates.push(["provider_request_id", providerRequestId]);
        await updateBillingOrderState(tx, order, updates);
        let consumeNote = "";
        if (chargeCapped) {
          consumeNote = "Token 实际用量超过 Agent 报价，已按本轮硬上限结算";
        } else if (supplement > 0) {
          consumeNote = "Token 实际用量超过预授权，已补扣差额";
        }
        if (priceRule > 0) {
          let ruleNote = `按分时与上下文价格第 ${priceRule} 条结算`;
          if (consumeNote !== "") ruleNote += `；${consumeNote}`;
          consumeNote = ruleNote;
        }
        if (settlement.source === billingUsageSourceVideoFormula) {
          consumeNote = `${videoFormulaNote}；${consumeNote}`.trim();
        }
        await insertCreditLedgerEntry(
          tx,
          {
            id: newRepositoryId(),
            userId: order.userId,
            type: creditLedgerConsume,
            amountMicrocredits: -actual,
            availableDeltaMicrocredits: -supplement,
            reservedDeltaMicrocredits: -reserved,
            availableAfterMicrocredits: account.available,
            reservedAfterMicrocredits: account.reserved,
            billingOrderId: order.id,
            model: order.model,
            channelId: order.channelId,
            scene: order.scene,
            note: joinLedgerNotes(consumeNote, referenceVideoLedgerNote(order)),
          },
          now,
        );
        if (refund > 0) {
          await insertCreditLedgerEntry(
            tx,
            {
              id: newRepositoryId(),
              userId: order.userId,
              type: creditLedgerRefund,
              amountMicrocredits: refund,
              availableDeltaMicrocredits: refund,
              availableAfterMicrocredits: account.available,
              reservedAfterMicrocredits: account.reserved,
              billingOrderId: order.id,
              model: order.model,
              channelId: order.channelId,
              scene: order.scene,
              note: "Token 预授权差额退回",
            },
            now,
          );
        }
        return;
      }
      let actual = order.amountMicrocredits;
      let quantity = order.quantity;
      let refund = 0;
      let supplement = 0;
      if (
        order.billingMode === "per_second" &&
        (order.capability === "audio" || (order.capability === "video" && audioDurationMs !== null))
      ) {
        const mediaLabel = order.capability === "video" ? "视频" : "音频";
        if (audioDurationMs === null || audioDurationMs <= 0) {
          throw new Error(`${mediaLabel}实际时长不可用，无法按秒结算`);
        }
        quantity = Math.floor((audioDurationMs + 999) / 1000);
        if (order.capability === "video" && order.referenceVideoBilled) {
          quantity += Math.floor((order.referenceVideoMillis + 999) / 1000);
        }
        actual = audioBillingAmount(order.unitPriceMicrocredits, quantity, order.multiplierBasisPoints);
        if (billingChargeLimitApplies(order) && actual > (order.chargeLimitMicrocredits ?? 0)) {
          throw new Error(`${mediaLabel}实际费用超过本次授权上限，需人工核对`);
        }
        const reserved = order.reservedAmountMicrocredits > 0 ? order.reservedAmountMicrocredits : order.amountMicrocredits;
        refund = Math.max(reserved - actual, 0);
        supplement = Math.max(actual - reserved, 0);
        const now = nowIso();
        const affected = await tx.db.run(
          'UPDATE "credit_accounts" SET "available_microcredits" = "available_microcredits" + ?, "reserved_microcredits" = "reserved_microcredits" - ?, "version" = "version" + 1, "updated_at" = ? WHERE "user_id" = ? AND "reserved_microcredits" >= ? AND "available_microcredits" >= ?',
          [refund - supplement, reserved, now, order.userId, reserved, supplement],
        );
        if (affected !== 1) throw new Error(`预留积分不足以完成${mediaLabel}实际结算`);
        const account = await creditAccountBalance(tx, order.userId);
        // ACT: schema.ts 未定义 billing_orders 的 cost_* 快照列，成本快照不落库；金额与数量仍按 Go 语义结算。
        const updates: BillingUpdate[] = [
          ["status", billingStatusSettled],
          ["quantity", quantity],
          ["actual_amount_microcredits", actual],
          ["refunded_amount_microcredits", refund],
          ["settled_at", now],
          ["updated_at", now],
        ];
        if (providerRequestId !== "") updates.push(["provider_request_id", providerRequestId]);
        await updateBillingOrderState(tx, order, updates);
        let note = `${mediaLabel}按实际输出时长结算`;
        if (supplement > 0) note += "，已补扣差额";
        await insertCreditLedgerEntry(
          tx,
          {
            id: newRepositoryId(),
            userId: order.userId,
            type: creditLedgerConsume,
            amountMicrocredits: -actual,
            availableDeltaMicrocredits: -supplement,
            reservedDeltaMicrocredits: -reserved,
            availableAfterMicrocredits: account.available,
            reservedAfterMicrocredits: account.reserved,
            billingOrderId: order.id,
            model: order.model,
            channelId: order.channelId,
            scene: order.scene,
            note: joinLedgerNotes(note, referenceVideoLedgerNote(order)),
          },
          now,
        );
        if (refund > 0) {
          await insertCreditLedgerEntry(
            tx,
            {
              id: newRepositoryId(),
              userId: order.userId,
              type: creditLedgerRefund,
              amountMicrocredits: refund,
              availableDeltaMicrocredits: refund,
              availableAfterMicrocredits: account.available,
              reservedAfterMicrocredits: account.reserved,
              billingOrderId: order.id,
              model: order.model,
              channelId: order.channelId,
              scene: order.scene,
              note: `${mediaLabel}实际时长短于预授权，差额退回`,
            },
            now,
          );
        }
        return;
      }
      const now = nowIso();
      const affected = await tx.db.run(
        'UPDATE "credit_accounts" SET "reserved_microcredits" = "reserved_microcredits" - ?, "version" = "version" + 1, "updated_at" = ? WHERE "user_id" = ? AND "reserved_microcredits" >= ?',
        [order.amountMicrocredits, now, order.userId, order.amountMicrocredits],
      );
      if (affected !== 1) throw new Error("reserved credit balance is inconsistent");
      const account = await creditAccountBalance(tx, order.userId);
      const updates: BillingUpdate[] = [
        ["status", billingStatusSettled],
        ["actual_amount_microcredits", actual],
        ["settled_at", now],
        ["updated_at", now],
      ];
      if (providerRequestId !== "") updates.push(["provider_request_id", providerRequestId]);
      await updateBillingOrderState(tx, order, updates);
      await insertCreditLedgerEntry(
        tx,
        {
          id: newRepositoryId(),
          userId: order.userId,
          type: creditLedgerConsume,
          amountMicrocredits: -actual,
          reservedDeltaMicrocredits: -order.amountMicrocredits,
          availableAfterMicrocredits: account.available,
          reservedAfterMicrocredits: account.reserved,
          billingOrderId: order.id,
          model: order.model,
          channelId: order.channelId,
          scene: order.scene,
          note: referenceVideoLedgerNote(order),
        },
        now,
      );
    });
  } catch (error) {
    if (observed.usage) {
      const updates: BillingUpdate[] = [
        ["input_tokens", observed.usage.inputTokens],
        ["output_tokens", observed.usage.outputTokens],
        ["cached_tokens", observed.usage.cachedTokens],
        ["cache_write_tokens", observed.usage.cacheWriteTokens],
        ["usage_available", observed.usageSource === billingUsageSourceProvider],
        ["usage_source", observed.usageSource],
        ["updated_at", nowIso()],
      ];
      if (observed.actualAvailable) updates.push(["actual_amount_microcredits", observed.actual]);
      if (providerRequestId !== "") updates.push(["provider_request_id", providerRequestId]);
      const sets = updates.map(([column]) => `"${column}" = ?`);
      try {
        await repo.db.run(
          `UPDATE "billing_orders" SET ${sets.join(", ")} WHERE "id" = ? AND "status" NOT IN (?, ?)`,
          [...updates.map(([, value]) => value), id, billingStatusSettled, billingStatusRefunded],
        );
      } catch (usageError) {
        throw new Error(`${errorMessage(error)}; ${errorMessage(usageError)}`);
      }
    }
    throw error;
  }
}

export async function SettleBillingOrder(repo: Repository, id: string, providerRequestId: string): Promise<void> {
  await settleBillingOrder(repo, id, providerRequestId, null);
}

export async function SettleBillingOrderWithAudioDuration(
  repo: Repository,
  id: string,
  providerRequestId: string,
  durationMs: number,
): Promise<void> {
  await settleBillingOrder(repo, id, providerRequestId, durationMs);
}

export async function RestoreRefundedBillingOrder(repo: Repository, id: string, providerRequestId: string): Promise<void> {
  await repo.transaction(async (tx) => {
    const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    const rows = await tx.db.all<BillingOrderRow>(
      `SELECT ${billingOrderColumns} FROM "billing_orders" WHERE "id" = ? LIMIT 1${locking}`,
      [id],
    );
    if (!rows.length) throw recordNotFound;
    const order = mapBillingOrder(rows[0]);
    if (order.status === billingStatusSettled) return;
    if (order.status !== billingStatusRefunded) throw errBillingStateConflict;
    if (order.billingMode !== "token") {
      validateBillingChargeLimit(order, order.amountMicrocredits);
    }
    let actual = order.amountMicrocredits;
    let usage: BillingUsage | null = null;
    let usageSource = "";
    let priceRule = 0;
    if (order.billingMode === "token") {
      if (zeroPricedTokenOrder(order)) {
        actual = 0;
      } else {
        const settlement = await tokenSettlementUsage(tx, order);
        usage = settlement.usage;
        usageSource = settlement.source;
        const priced = tokenUsageAmount(order, usage);
        actual = priced.amount;
        priceRule = priced.priceRule;
      }
    }
    const chargeCapped = billingChargeLimitApplies(order) && actual > (order.chargeLimitMicrocredits ?? 0);
    if (chargeCapped) actual = order.chargeLimitMicrocredits ?? 0;
    if (actual < 0) throw new Error("invalid restored billing amount");
    const now = nowIso();
    const affected = await tx.db.run(
      'UPDATE "credit_accounts" SET "available_microcredits" = "available_microcredits" - ?, "version" = "version" + 1, "updated_at" = ? WHERE "user_id" = ?',
      [actual, now, order.userId],
    );
    if (affected !== 1) throw new Error("credit account does not exist");
    const account = await creditAccountBalance(tx, order.userId);
    const updates: BillingUpdate[] = [
      ["status", billingStatusSettled],
      ["actual_amount_microcredits", actual],
      ["refunded_amount_microcredits", Math.max(order.amountMicrocredits - actual, 0)],
      ["refunded_at", null],
      ["settled_at", now],
      ["error", ""],
      ["updated_at", now],
    ];
    if (usage) {
      updates.push(
        ["input_tokens", usage.inputTokens],
        ["output_tokens", usage.outputTokens],
        ["cached_tokens", usage.cachedTokens],
        ["cache_write_tokens", usage.cacheWriteTokens],
        ["usage_available", usageSource === billingUsageSourceProvider],
        ["usage_source", usageSource],
        ["token_price_rule", priceRule],
      );
    }
    if (providerRequestId !== "") updates.push(["provider_request_id", providerRequestId]);
    const sets = updates.map(([column]) => `"${column}" = ?`);
    const changed = await tx.db.run(
      `UPDATE "billing_orders" SET ${sets.join(", ")} WHERE "id" = ? AND "status" = ?`,
      [...updates.map(([, value]) => value), order.id, billingStatusRefunded],
    );
    if (changed !== 1) throw errBillingStateConflict;
    let consumeNote = "人工查询确认上游成功，退款订单重新扣费";
    if (usageSource === billingUsageSourceVideoFormula) consumeNote += `；${videoFormulaNote}`;
    if (chargeCapped) consumeNote += "；已按本轮 Agent 硬上限结算";
    await insertCreditLedgerEntry(
      tx,
      {
        id: newRepositoryId(),
        userId: order.userId,
        type: creditLedgerConsume,
        amountMicrocredits: -actual,
        availableDeltaMicrocredits: -actual,
        availableAfterMicrocredits: account.available,
        reservedAfterMicrocredits: account.reserved,
        billingOrderId: order.id,
        model: order.model,
        channelId: order.channelId,
        scene: order.scene,
        note: consumeNote,
      },
      now,
    );
  });
}

export async function RefundBillingOrder(repo: Repository, id: string, errorText: string): Promise<void> {
  await repo.transaction(async (tx) => {
    const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    const rows = await tx.db.all<BillingOrderRow>(
      `SELECT ${billingOrderColumns} FROM "billing_orders" WHERE "id" = ? LIMIT 1${locking}`,
      [id],
    );
    if (!rows.length) throw recordNotFound;
    await refundBillingOrder(tx, mapBillingOrder(rows[0]), errorText);
  });
}

export async function refundBillingOrder(repo: Repository, order: BillingOrder, errorText: string): Promise<void> {
  if (order.status === billingStatusRefunded) return;
  if (order.status === billingStatusSettled) throw new Error("settled billing order requires a manual refund");
  const now = nowIso();
  const affected = await repo.db.run(
    'UPDATE "credit_accounts" SET "available_microcredits" = "available_microcredits" + ?, "reserved_microcredits" = "reserved_microcredits" - ?, "version" = "version" + 1, "updated_at" = ? WHERE "user_id" = ? AND "reserved_microcredits" >= ?',
    [order.amountMicrocredits, order.amountMicrocredits, now, order.userId, order.amountMicrocredits],
  );
  if (affected !== 1) throw new Error("reserved credit balance is inconsistent");
  const account = await creditAccountBalance(repo, order.userId);
  const updates: BillingUpdate[] = [
    ["status", billingStatusRefunded],
    ["error", errorText],
    ["refunded_amount_microcredits", order.amountMicrocredits],
    ["refunded_at", now],
    ["updated_at", now],
  ];
  await updateBillingOrderState(repo, order, updates);
  await insertCreditLedgerEntry(
    repo,
    {
      id: newRepositoryId(),
      userId: order.userId,
      type: creditLedgerRefund,
      amountMicrocredits: order.amountMicrocredits,
      availableDeltaMicrocredits: order.amountMicrocredits,
      reservedDeltaMicrocredits: -order.amountMicrocredits,
      availableAfterMicrocredits: account.available,
      reservedAfterMicrocredits: account.reserved,
      billingOrderId: order.id,
      model: order.model,
      channelId: order.channelId,
      scene: order.scene,
      note: errorText,
    },
    now,
  );
}

export async function AutoRefundBillingOrder(repo: Repository, id: string, note: string): Promise<boolean> {
  return repo.transaction(async (tx) => {
    const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    const candidates = await tx.db.all<{ id: string; task_id: string | null }>(
      'SELECT "id", "task_id" FROM "billing_orders" WHERE "id" = ? LIMIT 1',
      [id],
    );
    if (!candidates.length) throw recordNotFound;
    const taskId = candidates[0].task_id ?? "";
    if (taskId !== "") {
      // 任务缺失时仍允许退款；自动退款只依赖订单与任务的终态标记。
      await tx.db.all<{ id: string }>(`SELECT "id" FROM "tasks" WHERE "id" = ? LIMIT 1${locking}`, [taskId]);
    }
    const rows = await tx.db.all<BillingOrderRow>(
      `SELECT ${billingOrderColumns} FROM "billing_orders" WHERE "id" = ? LIMIT 1${locking}`,
      [id],
    );
    if (!rows.length) throw recordNotFound;
    const order = mapBillingOrder(rows[0]);
    const conditions = autoRefundableConditions();
    const counts = await tx.db.all<{ total: number }>(
      `SELECT COUNT(*) AS "total" FROM "billing_orders" JOIN "tasks" ON "tasks"."id" = "billing_orders"."task_id" WHERE ${conditions.where} AND "billing_orders"."id" = ?`,
      [...conditions.values, id],
    );
    if (Number(counts[0]?.total ?? 0) === 0) return false;
    await refundBillingOrder(tx, order, note);
    await RecordBillingResolution(tx, id, "", note);
    return true;
  });
}
