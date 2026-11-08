// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
// CreationRun keeps execution authority separate from untrusted conversation state.

export interface CreationRun {
  id: string;
  userId: string;
  clientKey?: string;
  createHash?: string;
  canvasId?: string;
  revision: number;
  executionEpoch: number;
  executionOwner: string;
  leaseExpiresAt?: string | null;
  status: string;
  stateJson?: string;
  approvedProposalVersion?: number;
  approvedProposalHash?: string;
  approvedOperationsJson?: string;
  approvedCanvasJson?: string;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreationSubmission {
  id: string;
  userId?: string;
  runId: string;
  itemKey: string;
  proposalVersion?: number;
  proposalHash?: string;
  requestJson?: string;
  requestHash: string;
  quoteJson?: string;
  priceSignature?: string;
  expiresAt?: string;
  approvedAt?: string | null;
  revokedAt?: string | null;
  taskId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
