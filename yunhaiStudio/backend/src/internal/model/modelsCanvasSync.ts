// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
export interface CanvasEditProof {
  nodeId: string;
  sessionId: string;
  token: string;
}

// One row per node is replaced only while holding the parent canvas row lock.

export interface CanvasEditLease {
  userId?: string;
  canvasId?: string;
  nodeId: string;
  sessionId: string;
  token?: string;
  expiresAt: string;
}

// CanvasMutationReceipt makes a client retry observable without making the
// canvas document carry an ever-growing list of request IDs. The receipt is a
// recovery hint; the mutation itself remains idempotent because applying the
// same desired values is a no-op.

export interface CanvasMutationReceipt {
  id: string;
  userId: string;
  canvasId: string;
  mutationId: string;
  payloadDigest: string;
  resultJson: string;
  revision: number;
  createdAt: string;
}
