// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
export interface EcommerceAgentAnalysis {
  id: string;
  userId?: string;
  signature?: string;
  payloadJson?: string;
  createdAt: string;
}

// EcommerceAgentRun is a durable, owner-scoped generation receipt. A run owns
// its page records and one existing billing order; the idempotency key is
// unique per user, including when the caller did not supply one.

export interface EcommerceAgentRun {
  id: string;
  userId?: string;
  idempotencyKey?: string;
  projectId: string;
  billingOrderId?: string;
  status: string;
  mode: string;
  platform: string;
  language: string;
  generateType: number;
  pageCount: number;
  successPages: number;
  cancelRequested: boolean;
  unitMicrocredits: number;
  briefJson?: string;
  copyJson?: string;
  canvasJson?: string;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string | null;
}

export interface EcommerceAgentPage {
  id?: string;
  runId?: string;
  index: number;
  role: string;
  title: string;
  headline: string;
  prompt: string;
  url: string;
  status: string;
  error?: string;
  aspectRatio: string;
  needText: boolean;
  latencyMs: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface EcommerceAgentCanvasVersion {
  id: string;
  userId?: string;
  projectId: string;
  version: number;
  canvasJson?: string;
  createdAt: string;
}
