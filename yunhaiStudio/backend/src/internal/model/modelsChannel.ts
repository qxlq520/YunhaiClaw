// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
import { CreditCostPricing } from "./creditCost";
import { ApiCallStatus, BillingStatus, ChannelInterfaceType, ChannelScope, TaskStatus } from "./models";
import { TokenPriceRule } from "./tokenPriceRules";
export interface ModelChannel {
  id: string;
  userId: string;
  scope: ChannelScope;
  enabled: boolean;
  name: string;
  /** PublicAlias 仅保留历史列供旧迁移读取，运行时不再使用渠道级前台名称。 */
  publicAlias?: string;
  sortOrder: number;
  baseUrl: string;
  apiKey?: string;
  secretKey?: string;
  apiFormat: string;
  concurrencyLimit: number;
  /** ProxyURL 是渠道级出站代理地址，支持 socks5://、socks5h://、http://、https://。 // 留空时使用全局环境变量代理。 */
  proxyUrl: string;
  modelsJson: string;
  /** RetiredModelsJSON 记录已被一个模型家族吸收的上游 SKU，防止目录拉取时重新创建重复记录。 */
  retiredModelsJson?: string;
  headersJson?: string;
  /** CatalogProviderID 记录渠道由哪个目录服务商一键接入；空表示自定义渠道。只用于来源展示。 */
  catalogProviderId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface ChannelModelTag {
  text: string;
  color: string;
}

export interface ChannelModel {
  id: string;
  channelId: string;
  modelKey: string;
  providerModelKey: string;
  displayName: string;
  channelLabel: string;
  tags: ChannelModelTag[];
  description: string;
  sortOrder: number;
  icon: string;
  capability: string;
  protocol: ChannelInterfaceType;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
  /** CacheWriteTokenPriceMicrocredits 是写入提示词缓存（Anthropic cache_creation 等）的每百万 Token 价格，0 表示不单独收费。 */
  cacheWriteTokenPriceMicrocredits: number;
  priceConfigured: boolean;
  enabled: boolean;
  priceVersion: number;
  /** PriceCurrency 决定价格档售价的单位：credits 直接是微积分；USD/CNY 是百万分之一货币单位， // 下单时按用户分组兑换比例换算为积分。 */
  priceCurrency: string;
  capabilityConfigJson?: string;
  capabilityVersion: number;
  capabilityConfig?: Record<string, unknown>;
  /** CatalogModelKey 记录来自服务商目录的推荐模型 key，便于排查来源。 */
  catalogModelKey: string;
  /** ReferenceVideoBilling 仅对视频模型生效：开启后挂参考视频的请求按价格档的“带参考视频”价格计费， // 按秒模式把后端实测的参考视频秒数计入数量，Token 模式把参考视频计入公式用量；关闭时参考视频不计费。 */
  referenceVideoBilling: boolean;
  /** PriceTiers 是系统渠道模型的价格真相。标量价格仅为旧调用与历史数据兼容， // 新的创作端报价必须按所选规格命中一个价格档。 */
  priceTiers: ChannelModelPriceTier[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

// ChannelModelPriceTier 表示渠道模型在一个规格组合下的可执行上游 SKU 和用户价格。
// SelectorJSON 是规格选择器真相，例如 {"operation":"image_to_video","vquality":"720p",
// "videoSeconds":"10"} 或 {"operation":"text_to_image","quality":"2k"}。
// SelectorKey 是规范化 JSON，用于 PostgreSQL 的活动规格唯一约束。旧的 Resolution / VideoSeconds
// 仅保留给历史 API 与升级回填，不能再作为 SKU 唯一性依据。

export interface ChannelModelPriceTier {
  costPricing?: CreditCostPricing;
  id: string;
  channelModelId: string;
  selectorKey: string;
  selectorJson?: string;
  selector?: Record<string, string>;
  resolution: string;
  videoSeconds: number;
  providerModelKey: string;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
  cacheWriteTokenPriceMicrocredits: number;
  /** TokenPriceRulesEnabled 打开后，文本 Token 档按 TokenPriceRules 的分时与上下文单价计费； // 关闭时规则保留但不参与报价和结算。 */
  tokenPriceRulesEnabled: boolean;
  tokenPriceRules: TokenPriceRule[];
  /** 带参考视频的价格：模型开启 ReferenceVideoBilling 且请求挂了参考视频时替代 UnitPrice（按秒） // 或 OutputTokenPrice（Token）；未开启时不使用。 */
  referenceVideoUnitPriceMicrocredits: number;
  referenceVideoOutputTokenPriceMicrocredits: number;
  priceConfigured: boolean;
  enabled: boolean;
  priceVersion: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface ApiCallLog {
  id: string;
  userId: string;
  traceId?: string;
  requestId?: string;
  userDisplayName?: string;
  userAccount?: string;
  channelId: string;
  channelName: string;
  taskId?: string;
  taskStatus?: TaskStatus;
  mediaStage?: string;
  billingOrderId?: string;
  billingStatus?: BillingStatus;
  billingReservedMicrocredits: number;
  billingSettledMicrocredits?: number | null;
  billingAvailable: boolean;
  creditCostConfigured: boolean;
  creditCostMicrocredits?: number | null;
  source: string;
  capability: string;
  operation: string;
  requestKind: string;
  billable: boolean;
  apiFormat: string;
  method: string;
  path: string;
  model: string;
  status: ApiCallStatus;
  statusCode: number;
  durationMs: number;
  pollCount: number;
  providerStatus?: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  /** CacheWriteTokens 是本次写入提示词缓存的输入 Token，已计入 InputTokens。 */
  cacheWriteTokens: number;
  usageAvailable: boolean;
  mediaCount: number;
  mediaPreviewUrl?: string;
  mediaPreviewKind?: string;
  videoSeconds: number;
  providerRequestId: string;
  estimatedCostMicros: number;
  costAvailable: boolean;
  currency: string;
  errorCode?: string;
  error: string;
  concurrencyLimit: number;
  upstreamUrl: string;
  requestContentType?: string;
  requestBody?: string;
  responseBody?: string;
  startedAt: string;
  createdAt: string;
  createdAtEpoch?: number;
}

export function apiCallLogBeforeCreate(log: ApiCallLog): void {
  if (log.createdAtEpoch) return;
  const parsed = log.createdAt ? new Date(log.createdAt) : new Date();
  log.createdAtEpoch = Math.floor((Number.isNaN(parsed.getTime()) ? Date.now() : parsed.getTime()) / 1000);
}
