// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
// CreditCostPricing 仅供管理员配置和内部核算。持有者必须使用 json:"-"，
// 管理端通过专用响应投影公开，禁止随用户目录、报价或账单序列化。

export interface CreditCostPricing {
  configured: boolean;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
  cacheWriteTokenPriceMicrocredits: number;
  /** 带参考视频的成本价，仅视频模型开启参考视频计费且请求挂参考视频时使用：按秒档替代 Unit，Token 档替代 Output。 */
  referenceVideoUnitPriceMicrocredits: number;
  referenceVideoOutputTokenPriceMicrocredits: number;
}

// BillingCostSnapshot 独立于销售价格，切换供应线路时始终更新为实际执行线路的成本。

export interface BillingCostSnapshot {
  costPricing?: CreditCostPricing;
  costBillingMode?: string;
  costQuantity?: number;
  costVideoFormulaTokens?: number;
}
