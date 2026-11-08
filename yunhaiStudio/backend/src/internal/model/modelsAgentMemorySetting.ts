// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
export const agentMemoryCompactIntervalOff = "off";
export const agentMemoryCompactIntervalDaily = "daily";
export const agentMemoryCompactIntervalWeekly = "weekly";
export const agentMemoryCompactIntervalMonthly = "monthly";
export const agentMemoryCompactStatusIdle = "idle";
export const agentMemoryCompactStatusQueued = "queued";
export const agentMemoryCompactStatusRunning = "running";
export const agentMemoryCompactStatusSucceeded = "succeeded";
export const agentMemoryCompactStatusFailed = "failed";
export const agentMemoryCompactStatusReview = "awaiting_review";
export const agentMemoryCompactStatusApplied = "applied";
export const agentMemoryCompactStatusRejected = "rejected";
export const agentMemoryCompactStatusRestored = "restored";

// AgentMemorySetting 是用户私有的记忆压缩偏好与最近一次压缩状态。

export interface AgentMemorySetting {
  userId: string;
  compactInterval: string;
  logicalModelId: string;
  channelId: string;
  channelModelKey: string;
  model: string;
  lastCompactAt?: string | null;
  compactStartedAt?: string | null;
  compactTaskId?: string;
  compactProposalId?: string;
  compactCursor?: string;
  lastStatus: string;
  lastSummaryJson?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}
