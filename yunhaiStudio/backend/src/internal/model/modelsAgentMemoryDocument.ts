// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
export const agentMemoryDocumentModeAuto = "auto";
export const agentMemoryDocumentModeReview = "review";
export const agentMemoryDocumentModeOff = "off";
export const agentMemorySectionUser = "user";
export const agentMemorySectionNotes = "notes";
export const agentMemoryRevisionApplied = "applied";
export const agentMemoryRevisionPending = "pending";
export const agentMemoryRevisionRejected = "rejected";
export const agentMemoryActorAgent = "agent";
export const agentMemoryActorUser = "user";
export const agentMemoryActorRestore = "restore";
export const agentMemoryActorSeed = "seed";
export const agentMemoryActorAdmin = "admin";

// AgentMemoryEntry 是记忆文件里的一条记录。ID 只在本文件内唯一，供 Agent 精确修改或删除。

export interface AgentMemoryEntry {
  id: string;
  section: string;
  text: string;
  source?: string;
  originRunId?: string;
  createdAt: string;
  updatedAt: string;
}

// AgentMemoryDocument 是每个用户一份、有容量上限的长期记忆。它只是参考数据，
// 每轮开始时冻结快照注入上下文，不构成权限、审批或收费授权。

export interface AgentMemoryDocument {
  userId: string;
  entriesJson?: string;
  /** NextEntrySeq 单调递增，删除后的条目 ID 不会被新条目复用，旧快照里的 ID 不会指向别的内容。 */
  nextEntrySeq?: number;
  revision: number;
  hash: string;
  charCount: number;
  mode: string;
  capacity: number;
  createdAt: string;
  updatedAt: string;
}

// AgentMemoryDocumentRevision 记录一次修改的前后快照。applied 可撤销；pending 等待用户采纳。

export interface AgentMemoryDocumentRevision {
  id: string;
  userId: string;
  baseRevision: number;
  revision: number;
  actor: string;
  runId?: string;
  /** CallID 是 Agent 工具调用 ID：同一调用重放时返回已有结果，不重复写入。 */
  callId?: string;
  status: string;
  summary: string;
  opsJson?: string;
  beforeJson?: string;
  afterJson?: string;
  createdAt: string;
  decidedAt?: string | null;
  restoredAt?: string | null;
}
