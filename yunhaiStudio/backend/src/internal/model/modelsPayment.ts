// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
export type PaymentOrderStatus = string;

export type PaymentNotificationStatus = string;

export type PaymentReconciliationStatus = string;

export type PaymentReconciliationResult = string;

export type TopupSaleStrategy = string;

// TopupProductKind 决定支付成功后发放的权益：积分入账或账号文件容量扩容。

export type TopupProductKind = string;

export const topupProductKindCredits: TopupProductKind = "credits";
export const topupProductKindStorage: TopupProductKind = "storage";

export const topupSaleStrategyUnlimited: TopupSaleStrategy = "unlimited";
export const topupSaleStrategyPeriodic: TopupSaleStrategy = "periodic";
export const topupSaleStrategyInventory: TopupSaleStrategy = "inventory";
export const topupSaleStrategyTimed: TopupSaleStrategy = "timed";

export const paymentOrderCreated: PaymentOrderStatus = "created";
export const paymentOrderPending: PaymentOrderStatus = "pending";
export const paymentOrderClosing: PaymentOrderStatus = "closing";
export const paymentOrderClosed: PaymentOrderStatus = "closed";
export const paymentOrderCredited: PaymentOrderStatus = "credited";
export const paymentOrderCreateFailed: PaymentOrderStatus = "create_failed";
export const paymentNotificationPending: PaymentNotificationStatus = "pending";
export const paymentNotificationProcessed: PaymentNotificationStatus = "processed";
export const paymentNotificationFailed: PaymentNotificationStatus = "failed";
export const paymentReconciliationRunning: PaymentReconciliationStatus = "running";
export const paymentReconciliationCompleted: PaymentReconciliationStatus = "completed";
export const paymentReconciliationFailed: PaymentReconciliationStatus = "failed";
export const paymentReconciliationMatched: PaymentReconciliationResult = "matched";
export const paymentReconciliationRecovered: PaymentReconciliationResult = "recovered";
export const paymentReconciliationLocalOrderNotFound: PaymentReconciliationResult = "local_order_not_found";
export const paymentReconciliationProviderRecordMissing: PaymentReconciliationResult = "provider_record_missing";
export const paymentReconciliationAmountMismatch: PaymentReconciliationResult = "amount_mismatch";
export const paymentReconciliationTradeNoMismatch: PaymentReconciliationResult = "trade_no_mismatch";
export const paymentReconciliationCreditFailed: PaymentReconciliationResult = "credit_failed";

// TopupProduct is the server-owned price and credit snapshot source. Clients
// select a product ID and can never submit their own payable amount or credits.

export interface TopupProduct {
  id: string;
  name: string;
  description?: string;
  kind: TopupProductKind;
  amountFen: number;
  /** Currency 是售价货币；AmountFen 统一表示该货币的最小单位（分 / 美分）。 // 列默认值保持 CNY：Schema 75 用它把升级前的旧商品归为人民币。新建商品总是显式写入货币 // （为空时取后台默认充值货币，默认 USD），不依赖列默认值。 */
  currency: string;
  creditsMicrocredits: number;
  /** StorageBytes / StorageDurationDays 只对 storage 商品有效；天数为 0 表示永久扩容。 */
  storageBytes: number;
  storageDurationDays: number;
  enabled: boolean;
  sortOrder: number;
  saleStrategy: TopupSaleStrategy;
  periodDays?: number;
  periodPurchaseLimit?: number;
  stockTotal?: number;
  stockRemaining?: number;
  saleStartAt?: string | null;
  saleEndAt?: string | null;
  saleStatus?: string;
  canPurchase: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

// PaymentProviderConfig is immutable and versioned. Payment orders pin one
// version so key rotation cannot make an older callback unverifiable.

export interface PaymentProviderConfig {
  id: string;
  providerId: string;
  pluginId: string;
  pluginVersion: string;
  version: number;
  enabled: boolean;
  closeAfterMinutes: number;
  configCipher?: string;
  configDigest: string;
  createdBy: string;
  createdAt: string;
}

export interface PaymentOrder {
  id: string;
  userId: string;
  idempotencyKey: string;
  merchantOrderNo: string;
  productId: string;
  productName: string;
  productKind: TopupProductKind;
  storageBytes: number;
  storageDurationDays: number;
  stockReserved?: boolean;
  providerId: string;
  pluginId: string;
  pluginVersion: string;
  providerConfigId: string;
  providerConfigVersion: number;
  amountFen: number;
  currency: string;
  /** ChargeAmountFen / ChargeCurrency 是下单时向渠道实际收取的金额快照。渠道结算货币与商品货币不同时 // 按 ExchangeRateMicros（1 USD 兑换的 CNY × 1e6）换算；同币种时与 AmountFen / Currency 相同。 // 回调、查单和对账都按实收金额校验，汇率调整不影响已创建的订单。 */
  chargeAmountFen: number;
  chargeCurrency: string;
  exchangeRateMicros: number;
  paymentMethod: string;
  creditsMicrocredits: number;
  status: PaymentOrderStatus;
  providerTradeNo?: string | null;
  providerStatus?: string;
  checkoutMode?: string;
  checkoutValue?: string;
  checkoutExpiresAt?: string | null;
  expiresAt: string;
  providerPaidAt?: string | null;
  creditedAt?: string | null;
  closedAt?: string | null;
  lastQueriedAt?: string | null;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

// PaymentNotification is a durable, verified inbox. NormalizedJSON contains
// only the provider-neutral evidence required by the asynchronous credit job.

export interface PaymentNotification {
  id: string;
  providerId: string;
  providerEventId: string;
  providerConfigId: string;
  merchantOrderNo?: string;
  paymentOrderId?: string;
  payloadDigest: string;
  payloadCipher?: string;
  normalizedJson?: string;
  status: PaymentNotificationStatus;
  attempts: number;
  lastError?: string;
  nextAttemptAt: string;
  processedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentReconciliationRun {
  id: string;
  providerId: string;
  configId: string;
  billDate: string;
  status: PaymentReconciliationStatus;
  totalItems: number;
  matchItems: number;
  recoveredItems: number;
  errorItems: number;
  error?: string;
  startedBy?: string;
  startedAt: string;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentReconciliationItem {
  id: string;
  runId: string;
  providerId: string;
  paymentOrderId?: string;
  merchantOrderNo: string;
  providerTradeNo?: string;
  amountFen: number;
  currency: string;
  result: PaymentReconciliationResult;
  resolved: boolean;
  detail?: string;
  createdAt: string;
}
