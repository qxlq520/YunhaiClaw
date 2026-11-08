// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
import { BillingStatus, CreditLedgerType, RedeemCodeStatus } from "./models";
import { UserGroup } from "./modelsUserGroup";
import { BillingTokenPriceRule, TokenPriceRule } from "./tokenPriceRules";
export interface CreditAccount {
  userId: string;
  availableMicrocredits: number;
  reservedMicrocredits: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreditLedgerEntry {
  id: string;
  userId: string;
  type: CreditLedgerType;
  amountMicrocredits: number;
  availableDeltaMicrocredits: number;
  reservedDeltaMicrocredits: number;
  availableAfterMicrocredits: number;
  reservedAfterMicrocredits: number;
  billingOrderId?: string;
  paymentOrderId?: string;
  redeemCodeId?: string;
  actorUserId?: string;
  model?: string;
  channelId?: string;
  scene?: string;
  note?: string;
  referenceKey?: string | null;
  createdAt: string;
}

export interface BillingOrder {
  id: string;
  userId: string;
  /** 仅管理端列表填充，不入库。 */
  userDisplayName?: string;
  userAccount?: string;
  idempotencyKey: string;
  taskId?: string;
  channelId: string;
  channelModelId: string;
  /** PriceTierID/Version 记录任务实际命中的规格档；金额字段仍是不可变结算快照。 */
  priceTierId?: string;
  priceTierVersion: number;
  priceSelectorJson?: string;
  model: string;
  capability: string;
  scene: string;
  billingMode: string;
  priceVersion: number;
  unitPriceMicrocredits: number;
  multiplierBasisPoints: number;
  /** UserGroup/PriceCurrency/CurrencyRateMicrocredits 固化下单时的分组和货币换算； // 单价字段已是换算后的微积分，结算只读取快照。 */
  userGroup?: string;
  priceCurrency?: string;
  currencyRateMicrocredits?: number;
  quantity: number;
  amountMicrocredits: number;
  reservedAmountMicrocredits: number;
  /** ChargeLimitSet distinguishes an authorized zero price from an uncapped order. // All Agent prices remain capped across route changes and settlement. */
  chargeLimitSet?: boolean;
  chargeLimitMicrocredits?: number;
  actualAmountMicrocredits: number;
  refundedAmountMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
  cacheWriteTokenPriceMicrocredits: number;
  /** TokenPriceRulesJSON 固化下单时所在时段（东八区）启用的分时与上下文规则（[]BillingTokenPriceRule）， // 单价已换算为微积分；结算按真实输入 Token 取首条命中的规则，未命中时用上面的基础 Token 单价。 */
  tokenPriceRulesJson?: string;
  /** TokenPriceRule 是结算命中的规则序号（从 1 起），0 表示按基础 Token 单价结算。 */
  tokenPriceRule: number;
  /** InputTokens 含缓存命中与缓存写入；结算时普通输入 = InputTokens - CachedTokens - CacheWriteTokens。 */
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  /** VideoFormulaTokens 固化提交时的视频公式用量，不含预授权余量；旧订单保持 0，不反推历史用量。 */
  videoFormulaTokens: number;
  /** ReferenceVideo* 固化提交时挂载的参考视频：数量、计入或记录的总毫秒数，以及是否按带参考视频价格计费。 */
  referenceVideoCount: number;
  referenceVideoMillis: number;
  referenceVideoBilled: boolean;
  usageSource?: string;
  usageAvailable: boolean;
  status: BillingStatus;
  providerRequestId?: string;
  error?: string;
  resolvedBy?: string;
  resolutionNote?: string;
  startedAt: string | null;
  settledAt: string | null;
  refundedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RedeemBatch {
  id: string;
  amountMicrocredits: number;
  count: number;
  note: string;
  createdBy: string;
  codesCipher?: string;
  expiresAt: string | null;
  createdAt: string;
  availableCount: number;
  redeemedCount: number;
  disabledCount: number;
  expiredCount: number;
}

export interface RedeemCode {
  id: string;
  batchId: string;
  codeHash?: string;
  codeSuffix: string;
  amountMicrocredits: number;
  status: RedeemCodeStatus;
  redeemedBy?: string;
  redeemedAt: string | null;
  redeemedIp?: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ModelPricing {
  id: string;
  channelId: string;
  model: string;
  capability: string;
  currency: string;
  inputPerMillionMicros: number;
  outputPerMillionMicros: number;
  cachedPerMillionMicros: number;
  perRequestMicros: number;
  perMediaMicros: number;
  perVideoSecondMicros: number;
  createdAt: string;
  updatedAt: string;
}
