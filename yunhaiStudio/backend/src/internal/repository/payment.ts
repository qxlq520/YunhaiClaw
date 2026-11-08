// 对应 backend/internal/repository/payment.go
// 充值商品、支付渠道配置、支付订单、支付通知与对账的持久化。

import { creditLedgerPaymentTopup } from "@/internal/model/models";
import {
  paymentNotificationFailed,
  paymentNotificationPending,
  paymentNotificationProcessed,
  paymentOrderClosed,
  paymentOrderClosing,
  paymentOrderCreateFailed,
  paymentOrderCreated,
  paymentOrderCredited,
  paymentOrderPending,
  paymentReconciliationCompleted,
  paymentReconciliationFailed,
  paymentReconciliationRunning,
  topupProductKindStorage,
  topupSaleStrategyInventory,
  topupSaleStrategyPeriodic,
  topupSaleStrategyTimed,
  topupSaleStrategyUnlimited,
} from "@/internal/model/modelsPayment";
import type {
  PaymentNotification,
  PaymentOrder,
  PaymentOrderStatus,
  PaymentProviderConfig,
  PaymentReconciliationItem,
  PaymentReconciliationRun,
  TopupProduct,
} from "@/internal/model/modelsPayment";
import { userStorageGrantSourcePayment } from "@/internal/model/modelsStorage";
import { newRepositoryId } from "./finance";
import { recordNotFound, Repository, toBool, toIso, toNullableIso } from "./repository";

export interface PaymentOrderFilter {
  status: string;
  keyword: string;
  providerId: string;
  timeField: string;
  from: string;
  until: string;
}

export interface PaymentReconciliationFilter {
  providerId: string;
  status: string;
  from: string;
  to: string;
}

export const errPaymentOrderStateConflict = new Error("订单状态已变化，请刷新后重试");
export const errPaymentEvidenceMismatch = new Error("支付凭证与订单不一致");
export const errPaymentTradeNoConflict = new Error("该支付流水号已被使用");
export const errPaymentCreditOverflow = new Error("积分余额超出上限，无法入账");
export const errTopupUnavailable = new Error("充值商品当前不可购买");

// 积分余额以 JSON 数字返回给前端，支付入账保持在 Number.MAX_SAFE_INTEGER 内。
const maxPaymentCreditBalance = 9_007_199_254_740_991;

export interface PaymentEvidence {
  providerTradeNo: string;
  providerStatus: string;
  amountFen: number;
  currency: string;
  paidAt: string;
}

interface TopupProductRow {
  id: string;
  name: string;
  description: string | null;
  kind: TopupProduct["kind"];
  amount_fen: number;
  currency: string;
  credits_microcredits: number;
  storage_bytes: number;
  storage_duration_days: number;
  enabled: unknown;
  sort_order: number;
  sale_strategy: TopupProduct["saleStrategy"];
  period_days: number | null;
  period_purchase_limit: number | null;
  stock_total: number | null;
  stock_remaining: number | null;
  sale_start_at: string | null;
  sale_end_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

const topupProductColumns = `"id", "name", "description", "kind", "amount_fen", "currency", "credits_microcredits", "storage_bytes", "storage_duration_days", "enabled", "sort_order", "sale_strategy", "period_days", "period_purchase_limit", "stock_total", "stock_remaining", "sale_start_at", "sale_end_at", "created_by", "updated_by", "created_at", "updated_at"`;

function mapTopupProduct(row: TopupProductRow): TopupProduct {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    kind: row.kind,
    amountFen: Number(row.amount_fen ?? 0),
    currency: row.currency,
    creditsMicrocredits: Number(row.credits_microcredits ?? 0),
    storageBytes: Number(row.storage_bytes ?? 0),
    storageDurationDays: Number(row.storage_duration_days ?? 0),
    enabled: toBool(row.enabled),
    sortOrder: Number(row.sort_order ?? 0),
    saleStrategy: row.sale_strategy,
    periodDays: Number(row.period_days ?? 0),
    periodPurchaseLimit: Number(row.period_purchase_limit ?? 0),
    stockTotal: Number(row.stock_total ?? 0),
    stockRemaining: Number(row.stock_remaining ?? 0),
    saleStartAt: toNullableIso(row.sale_start_at),
    saleEndAt: toNullableIso(row.sale_end_at),
    saleStatus: "",
    canPurchase: false,
    createdBy: row.created_by ?? "",
    updatedBy: row.updated_by ?? "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function topupProducts(repo: Repository, includeDisabled: boolean): Promise<TopupProduct[]> {
  const conditions = includeDisabled ? "" : ' WHERE "enabled" = ?';
  const rows = await repo.db.all<TopupProductRow>(
    `SELECT ${topupProductColumns} FROM "topup_products"${conditions} ORDER BY "sort_order" ASC, "amount_fen" ASC, "created_at" ASC`,
    includeDisabled ? [] : [true],
  );
  return rows.map(mapTopupProduct);
}

export async function topupProduct(repo: Repository, id: string): Promise<TopupProduct | null> {
  const rows = await repo.db.all<TopupProductRow>(`SELECT ${topupProductColumns} FROM "topup_products" WHERE "id" = ? LIMIT 1`, [
    id.trim(),
  ]);
  return rows.length ? mapTopupProduct(rows[0]) : null;
}

export async function createTopupProduct(repo: Repository, product: TopupProduct): Promise<void> {
  const now = new Date().toISOString();
  await repo.db.run(
    `INSERT INTO "topup_products" (${topupProductColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      product.id,
      product.name,
      product.description ?? "",
      product.kind,
      product.amountFen,
      product.currency,
      product.creditsMicrocredits,
      product.storageBytes,
      product.storageDurationDays,
      product.enabled,
      product.sortOrder,
      product.saleStrategy,
      product.periodDays ?? 0,
      product.periodPurchaseLimit ?? 0,
      product.stockTotal ?? 0,
      product.stockRemaining ?? 0,
      product.saleStartAt ?? null,
      product.saleEndAt ?? null,
      product.createdBy ?? "",
      product.updatedBy ?? "",
      product.createdAt || now,
      product.updatedAt || now,
    ],
  );
}

/** 锁住商品行后基于锁定状态计算新值，避免覆盖并发的库存预占或释放。 */
export async function updateTopupProduct(
  repo: Repository,
  id: string,
  build: (existing: TopupProduct) => Promise<TopupProduct> | TopupProduct,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    const rows = await tx.db.all<TopupProductRow>(
      `SELECT ${topupProductColumns} FROM "topup_products" WHERE "id" = ? LIMIT 1${locking}`,
      [id.trim()],
    );
    if (!rows.length) throw recordNotFound;
    const existing = mapTopupProduct(rows[0]);
    const product = await build(existing);
    await tx.db.run(
      'UPDATE "topup_products" SET "name" = ?, "description" = ?, "amount_fen" = ?, "currency" = ?, "kind" = ?, "storage_bytes" = ?, "storage_duration_days" = ?, "credits_microcredits" = ?, "enabled" = ?, "sort_order" = ?, "sale_strategy" = ?, "period_days" = ?, "period_purchase_limit" = ?, "stock_total" = ?, "stock_remaining" = ?, "sale_start_at" = ?, "sale_end_at" = ?, "updated_by" = ?, "updated_at" = ? WHERE "id" = ?',
      [
        product.name,
        product.description ?? "",
        product.amountFen,
        product.currency,
        product.kind,
        product.storageBytes,
        product.storageDurationDays,
        product.creditsMicrocredits,
        product.enabled,
        product.sortOrder,
        product.saleStrategy,
        product.periodDays ?? 0,
        product.periodPurchaseLimit ?? 0,
        product.stockTotal ?? 0,
        product.stockRemaining ?? 0,
        product.saleStartAt ?? null,
        product.saleEndAt ?? null,
        product.updatedBy ?? "",
        new Date().toISOString(),
        existing.id,
      ],
    );
  });
}

interface PaymentProviderConfigRow {
  id: string;
  provider_id: string;
  plugin_id: string;
  plugin_version: string;
  version: number;
  enabled: unknown;
  close_after_minutes: number;
  config_cipher: string | null;
  config_digest: string;
  created_by: string | null;
  created_at: string;
}

const paymentProviderConfigColumns = `"id", "provider_id", "plugin_id", "plugin_version", "version", "enabled", "close_after_minutes", "config_cipher", "config_digest", "created_by", "created_at"`;

function mapPaymentProviderConfig(row: PaymentProviderConfigRow): PaymentProviderConfig {
  return {
    id: row.id,
    providerId: row.provider_id,
    pluginId: row.plugin_id,
    pluginVersion: row.plugin_version,
    version: Number(row.version ?? 0),
    enabled: toBool(row.enabled),
    closeAfterMinutes: Number(row.close_after_minutes ?? 0),
    configCipher: row.config_cipher ?? "",
    configDigest: row.config_digest,
    createdBy: row.created_by ?? "",
    createdAt: toIso(row.created_at),
  };
}

export async function createPaymentProviderConfig(repo: Repository, config: PaymentProviderConfig): Promise<void> {
  await repo.transaction(async (tx) => {
    const rows = await tx.db.all<{ version: number | null }>(
      'SELECT COALESCE(MAX("version"), 0) AS "version" FROM "payment_provider_configs" WHERE "provider_id" = ?',
      [config.providerId],
    );
    config.version = Number(rows[0]?.version ?? 0) + 1;
    await tx.db.run(
      `INSERT INTO "payment_provider_configs" (${paymentProviderConfigColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        config.id,
        config.providerId,
        config.pluginId,
        config.pluginVersion,
        config.version,
        config.enabled,
        config.closeAfterMinutes,
        config.configCipher ?? "",
        config.configDigest,
        config.createdBy,
        config.createdAt || new Date().toISOString(),
      ],
    );
  });
}

export async function latestPaymentProviderConfig(repo: Repository, providerId: string): Promise<PaymentProviderConfig | null> {
  const rows = await repo.db.all<PaymentProviderConfigRow>(
    `SELECT ${paymentProviderConfigColumns} FROM "payment_provider_configs" WHERE "provider_id" = ? ORDER BY "version" DESC LIMIT 1`,
    [providerId.trim()],
  );
  return rows.length ? mapPaymentProviderConfig(rows[0]) : null;
}

export async function paymentProviderConfig(repo: Repository, id: string): Promise<PaymentProviderConfig | null> {
  const rows = await repo.db.all<PaymentProviderConfigRow>(
    `SELECT ${paymentProviderConfigColumns} FROM "payment_provider_configs" WHERE "id" = ? LIMIT 1`,
    [id.trim()],
  );
  return rows.length ? mapPaymentProviderConfig(rows[0]) : null;
}

export interface PaymentOrderRow {
  id: string;
  user_id: string;
  idempotency_key: string;
  merchant_order_no: string;
  product_id: string;
  product_name: string;
  product_kind: PaymentOrder["productKind"];
  storage_bytes: number;
  storage_duration_days: number;
  stock_reserved: unknown;
  provider_id: string;
  plugin_id: string;
  plugin_version: string;
  provider_config_id: string;
  provider_config_version: number;
  amount_fen: number;
  currency: string;
  charge_amount_fen: number;
  charge_currency: string;
  exchange_rate_micros: number;
  payment_method: string;
  credits_microcredits: number;
  status: PaymentOrderStatus;
  provider_trade_no: string | null;
  provider_status: string | null;
  checkout_mode: string | null;
  checkout_value: string | null;
  checkout_expires_at: string | null;
  expires_at: string;
  provider_paid_at: string | null;
  credited_at: string | null;
  closed_at: string | null;
  last_queried_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export const paymentOrderColumns = `"id", "user_id", "idempotency_key", "merchant_order_no", "product_id", "product_name", "product_kind", "storage_bytes", "storage_duration_days", "stock_reserved", "provider_id", "plugin_id", "plugin_version", "provider_config_id", "provider_config_version", "amount_fen", "currency", "charge_amount_fen", "charge_currency", "exchange_rate_micros", "payment_method", "credits_microcredits", "status", "provider_trade_no", "provider_status", "checkout_mode", "checkout_value", "checkout_expires_at", "expires_at", "provider_paid_at", "credited_at", "closed_at", "last_queried_at", "last_error", "created_at", "updated_at"`;

export function mapPaymentOrder(row: PaymentOrderRow): PaymentOrder {
  return {
    id: row.id,
    userId: row.user_id,
    idempotencyKey: row.idempotency_key,
    merchantOrderNo: row.merchant_order_no,
    productId: row.product_id,
    productName: row.product_name,
    productKind: row.product_kind,
    storageBytes: Number(row.storage_bytes ?? 0),
    storageDurationDays: Number(row.storage_duration_days ?? 0),
    stockReserved: toBool(row.stock_reserved),
    providerId: row.provider_id,
    pluginId: row.plugin_id,
    pluginVersion: row.plugin_version,
    providerConfigId: row.provider_config_id,
    providerConfigVersion: Number(row.provider_config_version ?? 0),
    amountFen: Number(row.amount_fen ?? 0),
    currency: row.currency,
    chargeAmountFen: Number(row.charge_amount_fen ?? 0),
    chargeCurrency: row.charge_currency,
    exchangeRateMicros: Number(row.exchange_rate_micros ?? 0),
    paymentMethod: row.payment_method,
    creditsMicrocredits: Number(row.credits_microcredits ?? 0),
    status: row.status,
    providerTradeNo: row.provider_trade_no ?? null,
    providerStatus: row.provider_status ?? "",
    checkoutMode: row.checkout_mode ?? "",
    checkoutValue: row.checkout_value ?? "",
    checkoutExpiresAt: toNullableIso(row.checkout_expires_at),
    expiresAt: toIso(row.expires_at),
    providerPaidAt: toNullableIso(row.provider_paid_at),
    creditedAt: toNullableIso(row.credited_at),
    closedAt: toNullableIso(row.closed_at),
    lastQueriedAt: toNullableIso(row.last_queried_at),
    lastError: row.last_error ?? "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

/** 声明用户的幂等键；库存类商品在同一事务内预占一件库存。 */
export async function createPaymentOrderWithProductReservation(
  repo: Repository,
  order: PaymentOrder,
): Promise<{ order: PaymentOrder; created: boolean }> {
  return repo.transaction(async (tx) => {
    const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    const productRows = await tx.db.all<TopupProductRow>(
      `SELECT ${topupProductColumns} FROM "topup_products" WHERE "id" = ? LIMIT 1${locking}`,
      [order.productId],
    );
    if (!productRows.length) throw recordNotFound;
    const product = mapTopupProduct(productRows[0]);
    const strategy = product.saleStrategy || topupSaleStrategyUnlimited;
    // 同一幂等键的重试直接返回原订单，不能被限购/库存检查拦下。
    const existingRows = await tx.db.all<PaymentOrderRow>(
      `SELECT ${paymentOrderColumns} FROM "payment_orders" WHERE "user_id" = ? AND "idempotency_key" = ? LIMIT 1`,
      [order.userId, order.idempotencyKey],
    );
    if (existingRows.length) return { order: mapPaymentOrder(existingRows[0]), created: false };

    const nowDate = new Date();
    const now = nowDate.toISOString();
    if (!product.enabled) throw errTopupUnavailable;
    if (
      strategy === topupSaleStrategyTimed &&
      ((product.saleStartAt != null && nowDate.getTime() < new Date(product.saleStartAt).getTime()) ||
        (product.saleEndAt != null && !(nowDate.getTime() < new Date(product.saleEndAt).getTime())))
    ) {
      throw errTopupUnavailable;
    }
    if (
      strategy === topupSaleStrategyPeriodic &&
      (product.periodDays ?? 0) > 0 &&
      (product.periodPurchaseLimit ?? 0) > 0
    ) {
      // 未关闭的订单都占用周期名额；订单关闭（含超时关单）后名额释放。
      const since = new Date(nowDate.getTime() - (product.periodDays ?? 0) * 24 * 60 * 60 * 1000).toISOString();
      const counted = await tx.db.all<{ total: number }>(
        'SELECT COUNT(*) AS "total" FROM "payment_orders" WHERE "user_id" = ? AND "product_id" = ? AND "status" IN (?, ?, ?, ?, ?) AND "created_at" >= ?',
        [
          order.userId,
          order.productId,
          paymentOrderCreated,
          paymentOrderPending,
          paymentOrderClosing,
          paymentOrderCreateFailed,
          paymentOrderCredited,
          since,
        ],
      );
      if (Number(counted[0]?.total ?? 0) >= (product.periodPurchaseLimit ?? 0)) throw errTopupUnavailable;
    }
    if (strategy === topupSaleStrategyInventory) {
      const reserved = await tx.db.run(
        'UPDATE "topup_products" SET "stock_remaining" = "stock_remaining" - 1, "updated_at" = ? WHERE "id" = ? AND "stock_remaining" > 0',
        [now, product.id],
      );
      if (reserved !== 1) throw errTopupUnavailable;
      order.stockReserved = true;
    }

    order.createdAt = order.createdAt || now;
    order.updatedAt = order.updatedAt || now;
    const inserted = await tx.db.run(
      `INSERT INTO "payment_orders" (${paymentOrderColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT ("user_id", "idempotency_key") DO NOTHING`,
      [
        order.id,
        order.userId,
        order.idempotencyKey,
        order.merchantOrderNo,
        order.productId,
        order.productName,
        order.productKind,
        order.storageBytes,
        order.storageDurationDays,
        order.stockReserved ?? false,
        order.providerId,
        order.pluginId,
        order.pluginVersion,
        order.providerConfigId,
        order.providerConfigVersion,
        order.amountFen,
        order.currency,
        order.chargeAmountFen,
        order.chargeCurrency,
        order.exchangeRateMicros,
        order.paymentMethod,
        order.creditsMicrocredits,
        order.status,
        order.providerTradeNo ?? null,
        order.providerStatus ?? "",
        order.checkoutMode ?? "",
        order.checkoutValue ?? "",
        order.checkoutExpiresAt ?? null,
        order.expiresAt,
        order.providerPaidAt ?? null,
        order.creditedAt ?? null,
        order.closedAt ?? null,
        order.lastQueriedAt ?? null,
        order.lastError ?? "",
        order.createdAt,
        order.updatedAt,
      ],
    );
    if (inserted === 1) return { order, created: true };

    const reloaded = await tx.db.all<PaymentOrderRow>(
      `SELECT ${paymentOrderColumns} FROM "payment_orders" WHERE "user_id" = ? AND "idempotency_key" = ? LIMIT 1`,
      [order.userId, order.idempotencyKey],
    );
    if (!reloaded.length) throw recordNotFound;
    if (order.stockReserved) {
      await tx.db.run(
        'UPDATE "topup_products" SET "stock_remaining" = "stock_remaining" + 1, "updated_at" = ? WHERE "id" = ?',
        [now, order.productId],
      );
    }
    return { order: mapPaymentOrder(reloaded[0]), created: false };
  });
}

export async function setPaymentOrderCheckout(
  repo: Repository,
  id: string,
  checkoutMode: string,
  checkoutValue: string,
  checkoutExpiresAt: string,
): Promise<void> {
  const affected = await repo.db.run(
    'UPDATE "payment_orders" SET "status" = ?, "checkout_mode" = ?, "checkout_value" = ?, "checkout_expires_at" = ?, "last_error" = \'\', "updated_at" = ? WHERE "id" = ? AND "status" IN (?, ?, ?)',
    [
      paymentOrderPending,
      checkoutMode,
      checkoutValue,
      checkoutExpiresAt,
      new Date().toISOString(),
      id,
      paymentOrderCreated,
      paymentOrderCreateFailed,
      paymentOrderPending,
    ],
  );
  if (affected !== 1) throw errPaymentOrderStateConflict;
}

export async function setPaymentOrderCreateFailure(repo: Repository, id: string, message: string): Promise<void> {
  await repo.db.run(
    'UPDATE "payment_orders" SET "status" = ?, "last_error" = ?, "updated_at" = ? WHERE "id" = ? AND "status" IN (?, ?)',
    [paymentOrderCreateFailed, message, new Date().toISOString(), id, paymentOrderCreated, paymentOrderCreateFailed],
  );
}

export async function paymentOrderForUser(repo: Repository, userId: string, id: string): Promise<PaymentOrder | null> {
  const rows = await repo.db.all<PaymentOrderRow>(
    `SELECT ${paymentOrderColumns} FROM "payment_orders" WHERE "id" = ? AND "user_id" = ? LIMIT 1`,
    [id.trim(), userId.trim()],
  );
  return rows.length ? mapPaymentOrder(rows[0]) : null;
}

export async function paymentOrderByIdempotency(
  repo: Repository,
  userId: string,
  idempotencyKey: string,
): Promise<PaymentOrder | null> {
  const rows = await repo.db.all<PaymentOrderRow>(
    `SELECT ${paymentOrderColumns} FROM "payment_orders" WHERE "user_id" = ? AND "idempotency_key" = ? LIMIT 1`,
    [userId.trim(), idempotencyKey.trim()],
  );
  return rows.length ? mapPaymentOrder(rows[0]) : null;
}

export async function paymentOrder(repo: Repository, id: string): Promise<PaymentOrder | null> {
  const rows = await repo.db.all<PaymentOrderRow>(`SELECT ${paymentOrderColumns} FROM "payment_orders" WHERE "id" = ? LIMIT 1`, [
    id.trim(),
  ]);
  return rows.length ? mapPaymentOrder(rows[0]) : null;
}

export async function paymentOrderByMerchant(
  repo: Repository,
  providerId: string,
  merchantOrderNo: string,
): Promise<PaymentOrder | null> {
  const rows = await repo.db.all<PaymentOrderRow>(
    `SELECT ${paymentOrderColumns} FROM "payment_orders" WHERE "provider_id" = ? AND "merchant_order_no" = ? LIMIT 1`,
    [providerId, merchantOrderNo],
  );
  return rows.length ? mapPaymentOrder(rows[0]) : null;
}

export async function activePaymentOrderCount(repo: Repository, userId: string): Promise<number> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "payment_orders" WHERE "user_id" = ? AND "status" IN (?, ?, ?, ?)',
    [userId, paymentOrderCreated, paymentOrderPending, paymentOrderClosing, paymentOrderCreateFailed],
  );
  return Number(rows[0]?.total ?? 0);
}

export async function paymentOrderCountForProvider(repo: Repository, providerId: string): Promise<number> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "payment_orders" WHERE "provider_id" = ?',
    [providerId.trim()],
  );
  return Number(rows[0]?.total ?? 0);
}

/** 仍在创建重试、回调、查单或关单阶段，需要插件运行时支撑的订单数。 */
export async function activePaymentOrderCountForPlugin(
  repo: Repository,
  pluginId: string,
  pluginVersion: string,
): Promise<number> {
  let query = 'SELECT COUNT(*) AS "total" FROM "payment_orders" WHERE "plugin_id" = ? AND "status" IN (?, ?, ?, ?)';
  const values = [pluginId.trim(), paymentOrderCreated, paymentOrderPending, paymentOrderClosing, paymentOrderCreateFailed];
  if (pluginVersion.trim() !== "") {
    // 未固定插件版本的旧订单仍依赖该插件的历史运行时，升级期间继续受保护。
    query += ' AND ("plugin_version" = ? OR "plugin_version" = \'\' OR "plugin_version" IS NULL)';
    values.push(pluginVersion.trim());
  }
  const rows = await repo.db.all<{ total: number }>(query, values);
  return Number(rows[0]?.total ?? 0);
}

interface PaymentNotificationRow {
  id: string;
  provider_id: string;
  provider_event_id: string;
  provider_config_id: string;
  merchant_order_no: string | null;
  payment_order_id: string | null;
  payload_digest: string;
  payload_cipher: string | null;
  normalized_json: string | null;
  status: PaymentNotification["status"];
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

const paymentNotificationColumns = `"id", "provider_id", "provider_event_id", "provider_config_id", "merchant_order_no", "payment_order_id", "payload_digest", "payload_cipher", "normalized_json", "status", "attempts", "last_error", "next_attempt_at", "processed_at", "created_at", "updated_at"`;

function mapPaymentNotification(row: PaymentNotificationRow): PaymentNotification {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerEventId: row.provider_event_id,
    providerConfigId: row.provider_config_id,
    merchantOrderNo: row.merchant_order_no ?? "",
    paymentOrderId: row.payment_order_id ?? "",
    payloadDigest: row.payload_digest,
    payloadCipher: row.payload_cipher ?? "",
    normalizedJson: row.normalized_json ?? "",
    status: row.status,
    attempts: Number(row.attempts ?? 0),
    lastError: row.last_error ?? "",
    nextAttemptAt: toIso(row.next_attempt_at),
    processedAt: toNullableIso(row.processed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function saveVerifiedPaymentNotification(repo: Repository, notification: PaymentNotification): Promise<boolean> {
  const now = new Date().toISOString();
  const created = await repo.db.run(
    `INSERT INTO "payment_notifications" (${paymentNotificationColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT ("provider_id", "provider_event_id") DO NOTHING`,
    [
      notification.id,
      notification.providerId,
      notification.providerEventId,
      notification.providerConfigId,
      notification.merchantOrderNo ?? "",
      notification.paymentOrderId ?? "",
      notification.payloadDigest,
      notification.payloadCipher ?? "",
      notification.normalizedJson ?? "",
      notification.status,
      notification.attempts,
      notification.lastError ?? "",
      notification.nextAttemptAt,
      notification.processedAt ?? null,
      notification.createdAt || now,
      notification.updatedAt || now,
    ],
  );
  return created === 1;
}

export async function pendingPaymentNotifications(repo: Repository, limit: number): Promise<PaymentNotification[]> {
  let effectiveLimit = limit;
  if (effectiveLimit <= 0 || effectiveLimit > 100) effectiveLimit = 32;
  const rows = await repo.db.all<PaymentNotificationRow>(
    `SELECT ${paymentNotificationColumns} FROM "payment_notifications" WHERE "status" IN (?, ?) AND "next_attempt_at" <= ? AND "attempts" < ? ORDER BY "created_at" ASC LIMIT ?`,
    [paymentNotificationPending, paymentNotificationFailed, new Date().toISOString(), 20, effectiveLimit],
  );
  return rows.map(mapPaymentNotification);
}

export async function completePaymentNotification(repo: Repository, id: string): Promise<void> {
  const now = new Date().toISOString();
  await repo.db.run(
    'UPDATE "payment_notifications" SET "status" = ?, "processed_at" = ?, "last_error" = \'\', "updated_at" = ? WHERE "id" = ?',
    [paymentNotificationProcessed, now, now, id],
  );
}

export async function retryPaymentNotification(
  repo: Repository,
  id: string,
  message: string,
  next: string,
): Promise<void> {
  await repo.db.run(
    'UPDATE "payment_notifications" SET "status" = ?, "attempts" = "attempts" + 1, "last_error" = ?, "next_attempt_at" = ?, "updated_at" = ? WHERE "id" = ?',
    [paymentNotificationFailed, message, next, new Date().toISOString(), id],
  );
}

/** 原子记录渠道支付成功并发放权益；唯一流水引用是回调与查单并发时的最终防线。 */
export async function completePaymentOrder(
  repo: Repository,
  providerId: string,
  merchantOrderNo: string,
  evidence: PaymentEvidence,
): Promise<{ order: PaymentOrder; granted: boolean }> {
  let outcome = await repo.transaction(async (tx) => {
    const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    const rows = await tx.db.all<PaymentOrderRow>(
      `SELECT ${paymentOrderColumns} FROM "payment_orders" WHERE "provider_id" = ? AND "merchant_order_no" = ? LIMIT 1${locking}`,
      [providerId, merchantOrderNo],
    );
    if (!rows.length) throw recordNotFound;
    const order = mapPaymentOrder(rows[0]);
    // 渠道凭据只证明实收金额；商品金额可能经过汇率换算，不能拿来比对。
    if (
      order.chargeAmountFen !== evidence.amountFen ||
      order.chargeCurrency !== evidence.currency ||
      evidence.providerTradeNo.trim() === ""
    ) {
      throw errPaymentEvidenceMismatch;
    }
    const storageOrder = order.productKind === topupProductKindStorage;
    if (
      order.amountFen <= 0 ||
      (storageOrder && order.storageBytes <= 0) ||
      (!storageOrder && order.creditsMicrocredits <= 0)
    ) {
      throw errPaymentOrderStateConflict;
    }
    if (order.status === paymentOrderCredited) {
      if (order.providerTradeNo == null || order.providerTradeNo.trim() !== evidence.providerTradeNo.trim()) {
        throw errPaymentEvidenceMismatch;
      }
      return { order, granted: false };
    }
    const duplicates = await tx.db.all<{ total: number }>(
      'SELECT COUNT(*) AS "total" FROM "payment_orders" WHERE "provider_id" = ? AND "provider_trade_no" = ? AND "id" <> ?',
      [providerId, evidence.providerTradeNo, order.id],
    );
    if (Number(duplicates[0]?.total ?? 0) > 0) throw errPaymentTradeNoConflict;

    const referenceKey = `payment:${providerId}:${merchantOrderNo}`;
    const now = new Date().toISOString();
    if (storageOrder) {
      await grantPaymentStorage(tx, order, referenceKey, now);
    } else {
      await creditPaymentTopup(tx, order, referenceKey, now);
    }

    const paidAt = evidence.paidAt || now;
    const updated = await tx.db.run(
      'UPDATE "payment_orders" SET "status" = ?, "stock_reserved" = ?, "provider_trade_no" = ?, "provider_status" = ?, "provider_paid_at" = ?, "credited_at" = ?, "last_error" = \'\', "updated_at" = ? WHERE "id" = ? AND "status" <> ?',
      [
        paymentOrderCredited,
        false,
        evidence.providerTradeNo,
        evidence.providerStatus,
        paidAt,
        now,
        now,
        order.id,
        paymentOrderCredited,
      ],
    );
    if (updated !== 1) throw errPaymentOrderStateConflict;
    const reloaded = await paymentOrder(tx, order.id);
    if (!reloaded) throw recordNotFound;
    return { order: reloaded, granted: true };
  });

  if (!outcome.granted && outcome.order.id !== "") {
    const reloaded = await paymentOrder(repo, outcome.order.id);
    if (!reloaded) throw recordNotFound;
    outcome = { order: reloaded, granted: false };
  }
  return outcome;
}

/** 按订单快照写一笔扩容记录；有效期从发放时刻起算。 */
async function grantPaymentStorage(
  tx: Repository,
  order: PaymentOrder,
  referenceKey: string,
  now: string,
): Promise<void> {
  let expiresAt: string | null = null;
  if (order.storageDurationDays > 0) {
    expiresAt = new Date(new Date(now).getTime() + order.storageDurationDays * 24 * 60 * 60 * 1000).toISOString();
  }
  const created = await tx.db.run(
    'INSERT INTO "user_storage_grants" ("id", "user_id", "source", "payment_order_id", "product_id", "product_name", "bytes", "duration_days", "starts_at", "expires_at", "revoked_at", "revoked_by", "revoke_reason", "reference_key", "note", "created_by", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT ("reference_key") DO NOTHING',
    [
      newRepositoryId(),
      order.userId,
      userStorageGrantSourcePayment,
      order.id,
      order.productId,
      order.productName,
      order.storageBytes,
      order.storageDurationDays,
      now,
      expiresAt,
      null,
      "",
      "",
      referenceKey,
      `${order.productName} · 在线购买存储空间`,
      "",
      now,
    ],
  );
  if (created === 0) {
    // 订单未到终态却已有发放记录，说明状态不一致，不能当作成功。
    throw errPaymentOrderStateConflict;
  }
}

/** 写积分流水并入账；唯一 reference_key 是回调与查单并发时的最终防线。 */
async function creditPaymentTopup(
  tx: Repository,
  order: PaymentOrder,
  referenceKey: string,
  now: string,
): Promise<void> {
  const entryId = newRepositoryId();
  const created = await tx.db.run(
    'INSERT INTO "credit_ledger_entries" ("id", "user_id", "type", "amount_microcredits", "available_delta_microcredits", "reserved_delta_microcredits", "available_after_microcredits", "reserved_after_microcredits", "billing_order_id", "payment_order_id", "redeem_code_id", "actor_user_id", "model", "channel_id", "scene", "note", "reference_key", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT ("reference_key") DO NOTHING',
    [
      entryId,
      order.userId,
      creditLedgerPaymentTopup,
      order.creditsMicrocredits,
      0,
      0,
      0,
      0,
      "",
      order.id,
      "",
      "",
      "",
      "",
      "",
      `${order.productName} · 在线支付充值`,
      referenceKey,
      now,
    ],
  );
  if (created === 0) {
    // 已入账订单在事务前段处理；此处说明订单仍未终态却存在流水，隐藏该不一致会掩盖账务异常。
    throw errPaymentOrderStateConflict;
  }
  await tx.db.run(
    'INSERT INTO "credit_accounts" ("user_id", "available_microcredits", "reserved_microcredits", "version", "created_at", "updated_at") VALUES (?, 0, 0, 0, ?, ?) ON CONFLICT DO NOTHING',
    [order.userId, now, now],
  );
  const accountUpdate = await tx.db.run(
    'UPDATE "credit_accounts" SET "available_microcredits" = "available_microcredits" + ?, "version" = "version" + 1, "updated_at" = ? WHERE "user_id" = ? AND "available_microcredits" <= ?',
    [order.creditsMicrocredits, now, order.userId, maxPaymentCreditBalance - order.creditsMicrocredits],
  );
  if (accountUpdate !== 1) throw errPaymentCreditOverflow;
  const accountRows = await tx.db.all<{ available_microcredits: number; reserved_microcredits: number }>(
    'SELECT "available_microcredits", "reserved_microcredits" FROM "credit_accounts" WHERE "user_id" = ? LIMIT 1',
    [order.userId],
  );
  if (!accountRows.length) throw recordNotFound;
  await tx.db.run(
    'UPDATE "credit_ledger_entries" SET "available_delta_microcredits" = ?, "available_after_microcredits" = ?, "reserved_after_microcredits" = ? WHERE "id" = ?',
    [
      order.creditsMicrocredits,
      Number(accountRows[0].available_microcredits ?? 0),
      Number(accountRows[0].reserved_microcredits ?? 0),
      entryId,
    ],
  );
}

export async function recordPaymentQuery(repo: Repository, id: string, providerStatus: string): Promise<void> {
  const now = new Date().toISOString();
  await repo.db.run(
    'UPDATE "payment_orders" SET "provider_status" = ?, "last_queried_at" = ?, "updated_at" = ? WHERE "id" = ?',
    [providerStatus, now, now, id],
  );
}

export async function markPaymentOrderClosed(
  repo: Repository,
  id: string,
  providerStatus: string,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    const rows = await tx.db.all<PaymentOrderRow>(
      `SELECT ${paymentOrderColumns} FROM "payment_orders" WHERE "id" = ? LIMIT 1${locking}`,
      [id],
    );
    if (!rows.length) throw recordNotFound;
    const order = mapPaymentOrder(rows[0]);
    if (order.status === paymentOrderCredited || order.status === paymentOrderClosed) return;
    if (
      order.status !== paymentOrderCreated &&
      order.status !== paymentOrderPending &&
      order.status !== paymentOrderClosing &&
      order.status !== paymentOrderCreateFailed
    ) {
      throw errPaymentOrderStateConflict;
    }
    const now = new Date().toISOString();
    if (order.stockReserved) {
      await tx.db.run(
        'UPDATE "topup_products" SET "stock_remaining" = "stock_remaining" + 1, "updated_at" = ? WHERE "id" = ?',
        [now, order.productId],
      );
    }
    await tx.db.run(
      'UPDATE "payment_orders" SET "status" = ?, "stock_reserved" = ?, "provider_status" = ?, "closed_at" = ?, "last_error" = \'\', "updated_at" = ? WHERE "id" = ?',
      [paymentOrderClosed, false, providerStatus, now, now, id],
    );
  });
}

export async function restoreClosingPaymentOrder(repo: Repository, id: string, message: string): Promise<void> {
  await repo.db.run(
    'UPDATE "payment_orders" SET "status" = ?, "last_error" = ?, "updated_at" = ? WHERE "id" = ? AND "status" = ?',
    [paymentOrderPending, message, new Date().toISOString(), id, paymentOrderClosing],
  );
}

export async function claimExpiredPaymentOrders(repo: Repository, limit: number): Promise<PaymentOrder[]> {
  let effectiveLimit = limit;
  if (effectiveLimit <= 0 || effectiveLimit > 100) effectiveLimit = 32;
  const now = new Date();
  const nowIso = now.toISOString();
  const closingCutoff = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
  const rows = await repo.db.all<PaymentOrderRow>(
    `SELECT ${paymentOrderColumns} FROM "payment_orders" WHERE ("status" IN (?, ?, ?) AND "expires_at" <= ?) OR ("status" = ? AND "updated_at" <= ?) ORDER BY "expires_at" ASC LIMIT ?`,
    [
      paymentOrderCreated,
      paymentOrderPending,
      paymentOrderCreateFailed,
      nowIso,
      paymentOrderClosing,
      closingCutoff,
      effectiveLimit,
    ],
  );
  const claimed: PaymentOrder[] = [];
  for (const row of rows) {
    const candidate = mapPaymentOrder(row);
    let query = 'UPDATE "payment_orders" SET "status" = ?, "updated_at" = ? WHERE "id" = ? AND "status" = ?';
    const values: (string | number | boolean | null)[] = [paymentOrderClosing, nowIso, candidate.id, candidate.status];
    if (candidate.status === paymentOrderClosing) {
      query += ' AND "updated_at" = ?';
      values.push(row.updated_at);
    }
    const updated = await repo.db.run(query, values);
    if (updated === 1) {
      candidate.status = paymentOrderClosing;
      claimed.push(candidate);
    }
  }
  return claimed;
}

export async function paymentOrdersNeedingQuery(
  repo: Repository,
  cutoff: string,
  limit: number,
): Promise<PaymentOrder[]> {
  let effectiveLimit = limit;
  if (effectiveLimit <= 0 || effectiveLimit > 100) effectiveLimit = 32;
  const rows = await repo.db.all<PaymentOrderRow>(
    `SELECT ${paymentOrderColumns} FROM "payment_orders" WHERE "status" IN (?, ?, ?) AND ("last_queried_at" IS NULL OR "last_queried_at" < ?) ORDER BY "created_at" ASC LIMIT ?`,
    [paymentOrderCreated, paymentOrderPending, paymentOrderCreateFailed, cutoff, effectiveLimit],
  );
  return rows.map(mapPaymentOrder);
}

export async function adminPaymentOrders(
  repo: Repository,
  filter: PaymentOrderFilter,
  limit: number,
  offset: number,
): Promise<{ orders: PaymentOrder[]; total: number }> {
  const { where, values } = paymentOrderQuery(repo, filter);
  const whereClause = where ? ` ${where}` : "";
  const totals = await repo.db.all<{ total: number }>(
    `SELECT COUNT(*) AS "total" FROM "payment_orders"${whereClause}`,
    values,
  );
  const rows = await repo.db.all<PaymentOrderRow>(
    `SELECT ${paymentOrderColumns} FROM "payment_orders"${whereClause} ORDER BY "created_at" DESC, "id" DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset],
  );
  return { orders: rows.map(mapPaymentOrder), total: Number(totals[0]?.total ?? 0) };
}

export function paymentOrderQuery(
  repo: Repository,
  filter: PaymentOrderFilter,
): { where: string; values: (string | number)[] } {
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  const status = filter.status.trim();
  if (status !== "" && status !== "all") {
    conditions.push('"status" = ?');
    values.push(status);
  }
  const keyword = filter.keyword.trim();
  if (keyword !== "") {
    const like = `%${keyword}%`;
    const lowered = like.toLowerCase();
    conditions.push(
      '("merchant_order_no" LIKE ? OR "provider_trade_no" LIKE ? OR "user_id" = ? OR "user_id" IN (SELECT "id" FROM "users" WHERE lower("username") LIKE ? OR lower("display_name") LIKE ? OR lower("email") LIKE ?))',
    );
    values.push(like, like, keyword, lowered, lowered, lowered);
  }
  if (filter.providerId !== "" && filter.providerId !== "all") {
    conditions.push('"provider_id" = ?');
    values.push(filter.providerId);
  }
  let column = '"created_at"';
  switch (filter.timeField) {
    case "paid":
      column = '"provider_paid_at"';
      break;
    case "credited":
      column = '"credited_at"';
      break;
  }
  if (filter.from !== "") {
    conditions.push(`${column} >= ?`);
    values.push(filter.from);
  }
  if (filter.until !== "") {
    conditions.push(`${column} < ?`);
    values.push(filter.until);
  }
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
}

export interface PaymentReconciliationRunRow {
  id: string;
  provider_id: string;
  config_id: string;
  bill_date: string;
  status: PaymentReconciliationRun["status"];
  total_items: number;
  match_items: number;
  recovered_items: number;
  error_items: number;
  error: string | null;
  started_by: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const paymentReconciliationRunColumns = `"id", "provider_id", "config_id", "bill_date", "status", "total_items", "match_items", "recovered_items", "error_items", "error", "started_by", "started_at", "completed_at", "created_at", "updated_at"`;

export function mapPaymentReconciliationRun(row: PaymentReconciliationRunRow): PaymentReconciliationRun {
  return {
    id: row.id,
    providerId: row.provider_id,
    configId: row.config_id,
    billDate: row.bill_date,
    status: row.status,
    totalItems: Number(row.total_items ?? 0),
    matchItems: Number(row.match_items ?? 0),
    recoveredItems: Number(row.recovered_items ?? 0),
    errorItems: Number(row.error_items ?? 0),
    error: row.error ?? "",
    startedBy: row.started_by ?? "",
    startedAt: toIso(row.started_at),
    completedAt: toNullableIso(row.completed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export interface PaymentReconciliationItemRow {
  id: string;
  run_id: string;
  provider_id: string;
  payment_order_id: string | null;
  merchant_order_no: string;
  provider_trade_no: string | null;
  amount_fen: number;
  currency: string;
  result: PaymentReconciliationItem["result"];
  resolved: unknown;
  detail: string | null;
  created_at: string;
}

export const paymentReconciliationItemColumns = `"id", "run_id", "provider_id", "payment_order_id", "merchant_order_no", "provider_trade_no", "amount_fen", "currency", "result", "resolved", "detail", "created_at"`;

export function mapPaymentReconciliationItem(row: PaymentReconciliationItemRow): PaymentReconciliationItem {
  return {
    id: row.id,
    runId: row.run_id,
    providerId: row.provider_id,
    paymentOrderId: row.payment_order_id ?? "",
    merchantOrderNo: row.merchant_order_no,
    providerTradeNo: row.provider_trade_no ?? "",
    amountFen: Number(row.amount_fen ?? 0),
    currency: row.currency,
    result: row.result,
    resolved: toBool(row.resolved),
    detail: row.detail ?? "",
    createdAt: toIso(row.created_at),
  };
}

/** 为同一渠道创建或安全复用当天的唯一一次对账任务。 */
export async function beginPaymentReconciliation(
  repo: Repository,
  run: PaymentReconciliationRun,
): Promise<{ run: PaymentReconciliationRun; started: boolean }> {
  return repo.transaction(async (tx) => {
    const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    const load = async (): Promise<PaymentReconciliationRun | null> => {
      const rows = await tx.db.all<PaymentReconciliationRunRow>(
        `SELECT ${paymentReconciliationRunColumns} FROM "payment_reconciliation_runs" WHERE "provider_id" = ? AND "bill_date" = ? LIMIT 1${locking}`,
        [run.providerId, run.billDate],
      );
      return rows.length ? mapPaymentReconciliationRun(rows[0]) : null;
    };

    let current = await load();
    if (!current) {
      const now = new Date().toISOString();
      const createdAt = run.createdAt || now;
      const updatedAt = run.updatedAt || now;
      const inserted = await tx.db.run(
        `INSERT INTO "payment_reconciliation_runs" (${paymentReconciliationRunColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT ("provider_id", "bill_date") DO NOTHING`,
        [
          run.id,
          run.providerId,
          run.configId,
          run.billDate,
          run.status,
          run.totalItems,
          run.matchItems,
          run.recoveredItems,
          run.errorItems,
          run.error ?? "",
          run.startedBy ?? "",
          run.startedAt,
          run.completedAt ?? null,
          createdAt,
          updatedAt,
        ],
      );
      if (inserted === 1) return { run: { ...run, createdAt, updatedAt }, started: true };
      // 唯一键竞争失败：重新加锁读取并走同一套运行中/冷却规则。
      current = await load();
      if (!current) throw recordNotFound;
    }
    if (
      current.status === paymentReconciliationRunning &&
      new Date(current.updatedAt).getTime() > Date.now() - 30 * 60 * 1000
    ) {
      return { run: current, started: false };
    }
    await tx.db.run('DELETE FROM "payment_reconciliation_items" WHERE "run_id" = ?', [current.id]);
    const now = new Date().toISOString();
    await tx.db.run(
      'UPDATE "payment_reconciliation_runs" SET "config_id" = ?, "status" = ?, "total_items" = 0, "match_items" = 0, "recovered_items" = 0, "error_items" = 0, "error" = \'\', "started_by" = ?, "started_at" = ?, "completed_at" = NULL, "updated_at" = ? WHERE "id" = ?',
      [run.configId, paymentReconciliationRunning, run.startedBy ?? "", now, now, current.id],
    );
    const reloaded = await paymentReconciliationRun(tx, current.id);
    if (!reloaded) throw recordNotFound;
    return { run: reloaded, started: true };
  });
}

export async function completePaymentReconciliation(
  repo: Repository,
  id: string,
  items: PaymentReconciliationItem[],
  matched: number,
  recovered: number,
  failed: number,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const now = new Date().toISOString();
    for (const item of items) {
      await tx.db.run(
        `INSERT INTO "payment_reconciliation_items" (${paymentReconciliationItemColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id,
          item.runId,
          item.providerId,
          item.paymentOrderId ?? "",
          item.merchantOrderNo,
          item.providerTradeNo ?? "",
          item.amountFen,
          item.currency,
          item.result,
          item.resolved,
          item.detail ?? "",
          item.createdAt || now,
        ],
      );
    }
    const updated = await tx.db.run(
      'UPDATE "payment_reconciliation_runs" SET "status" = ?, "total_items" = ?, "match_items" = ?, "recovered_items" = ?, "error_items" = ?, "error" = \'\', "completed_at" = ?, "updated_at" = ? WHERE "id" = ? AND "status" = ?',
      [
        paymentReconciliationCompleted,
        items.length,
        matched,
        recovered,
        failed,
        now,
        now,
        id.trim(),
        paymentReconciliationRunning,
      ],
    );
    if (updated !== 1) throw new Error("payment reconciliation run is no longer running");
  });
}

export async function failPaymentReconciliation(repo: Repository, id: string, message: string): Promise<void> {
  const now = new Date().toISOString();
  await repo.db.run(
    'UPDATE "payment_reconciliation_runs" SET "status" = ?, "error" = ?, "completed_at" = ?, "updated_at" = ? WHERE "id" = ?',
    [paymentReconciliationFailed, message, now, now, id.trim()],
  );
}

export async function paymentReconciliationRun(
  repo: Repository,
  id: string,
): Promise<PaymentReconciliationRun | null> {
  const rows = await repo.db.all<PaymentReconciliationRunRow>(
    `SELECT ${paymentReconciliationRunColumns} FROM "payment_reconciliation_runs" WHERE "id" = ? LIMIT 1`,
    [id.trim()],
  );
  return rows.length ? mapPaymentReconciliationRun(rows[0]) : null;
}

export async function paymentReconciliationRunByDate(
  repo: Repository,
  providerId: string,
  billDate: string,
): Promise<PaymentReconciliationRun | null> {
  const rows = await repo.db.all<PaymentReconciliationRunRow>(
    `SELECT ${paymentReconciliationRunColumns} FROM "payment_reconciliation_runs" WHERE "provider_id" = ? AND "bill_date" = ? LIMIT 1`,
    [providerId.trim(), billDate.trim()],
  );
  return rows.length ? mapPaymentReconciliationRun(rows[0]) : null;
}

export async function adminPaymentReconciliationRuns(
  repo: Repository,
  filter: PaymentReconciliationFilter,
  limit: number,
  offset: number,
): Promise<{ runs: PaymentReconciliationRun[]; total: number }> {
  const { where, values } = paymentReconciliationQuery(repo, filter);
  const whereClause = where ? ` ${where}` : "";
  const totals = await repo.db.all<{ total: number }>(
    `SELECT COUNT(*) AS "total" FROM "payment_reconciliation_runs"${whereClause}`,
    values,
  );
  const rows = await repo.db.all<PaymentReconciliationRunRow>(
    `SELECT ${paymentReconciliationRunColumns} FROM "payment_reconciliation_runs"${whereClause} ORDER BY "bill_date" DESC, "started_at" DESC, "id" DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset],
  );
  return { runs: rows.map(mapPaymentReconciliationRun), total: Number(totals[0]?.total ?? 0) };
}

export function paymentReconciliationQuery(repo: Repository, filter: PaymentReconciliationFilter): {
  where: string;
  values: string[];
} {
  const conditions: string[] = [];
  const values: string[] = [];
  const providerId = filter.providerId.trim();
  if (providerId !== "" && providerId !== "all") {
    conditions.push('"provider_id" = ?');
    values.push(providerId);
  }
  const status = filter.status.trim();
  if (status !== "" && status !== "all") {
    conditions.push('"status" = ?');
    values.push(status);
  }
  if (filter.from !== "") {
    conditions.push('"bill_date" >= ?');
    values.push(filter.from);
  }
  if (filter.to !== "") {
    conditions.push('"bill_date" <= ?');
    values.push(filter.to);
  }
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
}

export async function paymentReconciliationItems(
  repo: Repository,
  runId: string,
  result: string,
  limit: number,
  offset: number,
): Promise<{ items: PaymentReconciliationItem[]; total: number }> {
  const { where, values } = paymentReconciliationItemsQuery(repo, runId, result);
  const whereClause = where ? ` ${where}` : "";
  const totals = await repo.db.all<{ total: number }>(
    `SELECT COUNT(*) AS "total" FROM "payment_reconciliation_items"${whereClause}`,
    values,
  );
  const rows = await repo.db.all<PaymentReconciliationItemRow>(
    `SELECT ${paymentReconciliationItemColumns} FROM "payment_reconciliation_items"${whereClause} ORDER BY "resolved" ASC, "created_at" ASC, "id" ASC LIMIT ? OFFSET ?`,
    [...values, limit, offset],
  );
  return { items: rows.map(mapPaymentReconciliationItem), total: Number(totals[0]?.total ?? 0) };
}

export async function creditedPaymentOrdersBetween(
  repo: Repository,
  providerId: string,
  start: string,
  end: string,
): Promise<PaymentOrder[]> {
  const rows = await repo.db.all<PaymentOrderRow>(
    `SELECT ${paymentOrderColumns} FROM "payment_orders" WHERE "provider_id" = ? AND "status" = ? AND "provider_paid_at" >= ? AND "provider_paid_at" < ? ORDER BY "provider_paid_at" ASC`,
    [providerId.trim(), paymentOrderCredited, start, end],
  );
  return rows.map(mapPaymentOrder);
}

/** 统计支付结果仍不明确、且与账单日有重叠的订单。 */
export async function unresolvedPaymentOrderCandidateCountOverlapping(
  repo: Repository,
  providerId: string,
  start: string,
  end: string,
): Promise<number> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "payment_orders" WHERE "provider_id" = ? AND "status" IN (?, ?, ?, ?) AND "created_at" < ? AND "expires_at" >= ?',
    [providerId.trim(), paymentOrderCreated, paymentOrderPending, paymentOrderClosing, paymentOrderCreateFailed, end, start],
  );
  return Number(rows[0]?.total ?? 0);
}

/** 按对账结果筛选明细；abnormal 覆盖除 matched / recovered 外的所有结果。 */
export function paymentReconciliationItemsQuery(
  repo: Repository,
  runId: string,
  result: string,
): { where: string; values: string[] } {
  const conditions = ['"run_id" = ?'];
  const values: string[] = [runId.trim()];
  const normalized = result.trim();
  if (normalized === "abnormal") {
    conditions.push('"result" NOT IN (?, ?)');
    values.push("matched", "recovered");
  } else if (normalized !== "" && normalized !== "all") {
    conditions.push('"result" = ?');
    values.push(normalized);
  }
  return { where: `WHERE ${conditions.join(" AND ")}`, values };
}
