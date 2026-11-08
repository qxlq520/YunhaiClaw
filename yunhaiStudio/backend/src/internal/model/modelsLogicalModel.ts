// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
// IDSequence 为需要可读、稳定 ID 的业务对象提供数据库级自增序列。
// 对象关联始终使用独立外键，不允许从带前缀 ID 中解析父子关系。

export interface IDSequence {
  name: string;
  value: number;
  updatedAt: string;
}

export interface LogicalModel {
  id: string;
  code: string;
  name: string;
  icon: string;
  description: string;
  capability: string;
  enabled: boolean;
  sortOrder: number;
  /** RevisionSequence 记录已经分配的 revision 版本号，由数据库原子递增。 */
  revisionSequence?: number;
  activeRevisionId: string;
  /** SourceChannelModelID 标识这个前台目录项由哪个系统渠道模型投影而来。 // 管理员不再重复维护能力和价格，渠道模型保存时会创建新的前台 revision。 */
  sourceChannelModelId?: string;
  pricePolicy: string;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputPriceMicrocredits: number;
  outputPriceMicrocredits: number;
  cachedPriceMicrocredits: number;
  cacheWritePriceMicrocredits: number;
  /** LegacyModelIDsJSON 用于创作端把已保存的旧 SKU 选择无缝映射到新的模型家族。 // 这只是目录兼容信息，任务、路由尝试和账单仍固定引用其创建时的 ID 快照。 */
  legacyModelIDsJson?: string;
  /** ArchivedAt 仅从可选目录隐藏模型；历史任务、计费和审计仍需读取主体及不可变 revision。 */
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// LogicalModelRevision 固化一次可发布的前台能力合同。默认值属于前台模型，不能由供应商隐式决定。

export interface LogicalModelRevision {
  id: string;
  logicalModelId: string;
  version: number;
  capabilitySpecJson?: string;
  defaultOptionsJson?: string;
  createdBy: string;
  createdAt: string;
}

export interface LogicalModelRoute {
  id: string;
  logicalModelRevisionId: string;
  channelModelId: string;
  enabled: boolean;
  priority: number;
  weight: number;
  createdAt: string;
  updatedAt: string;
}

export interface RouteAttempt {
  id: string;
  taskId: string;
  routeRun: number;
  attemptNumber: number;
  logicalModelId: string;
  logicalModelRevisionId: string;
  routeId: string;
  channelModelId: string;
  channelId: string;
  status: string;
  dispatchState: string;
  providerRequestId: string;
  failureCode: string;
  failureMessage: string;
  startedAt: string;
  completedAt: string | null;
}

// LogicalModelPriceSKU 表示前台模型在统一定价模式下的独立售价 SKU。
// 当 pricePolicy = unified 时，用户价格由此 SKU 决定，而非渠道价格。
// SelectorJSON 统一使用结构化意图选择器，支持复杂的能力组合定价。

export interface LogicalModelPriceSKU {
  id: string;
  logicalModelRevisionId: string;
  code: string;
  name: string;
  selectorKey: string;
  selectorJson?: string;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
  priority: number;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}
