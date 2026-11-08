// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
export const agentProfileScopeUser = "user";
export const agentProfileScopeProject = "project";
export const agentProfileScopeCanvas = "canvas";

// AgentProfile stores a durable preference document. It is never an authority:
// the Agent compiler injects it as untrusted user data after server contracts.

export interface AgentProfile {
  id: string;
  userId: string;
  scope: string;
  projectId?: string;
  canvasId?: string;
  content: string;
  revision: number;
  hash: string;
  createdAt: string;
  updatedAt: string;
}
