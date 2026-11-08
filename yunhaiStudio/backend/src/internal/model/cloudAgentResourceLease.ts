// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
// CloudAgentResourceLease pins immutable inputs while a prepared action waits
// for approval. Submitted tasks subsequently own their resource references.

export interface CloudAgentResourceLease {
  userId: string;
  runId: string;
  ownerId: string;
  resourceId: string;
  expiresAt: string;
}
