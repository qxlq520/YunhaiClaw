// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
import { ProviderCancelStatus, TaskStatus } from "./models";
import { TaskExecutionDiagnostic } from "./taskExecution";
export interface Task {
  /** Only EnsureCloudAgent sets this after creating the execution in the same // transaction. Ordinary task saves must not reset it from a stale snapshot. */
  agentExecutionReady?: boolean;
  agentRunId?: string;
  generationId?: string;
  approvalId?: string;
  authorizedChargeMicrocredits?: number;
  executionDiagnosticJson?: string;
  diagnostic?: TaskExecutionDiagnostic | null;
  cancellationSource?: string;
  cancellationActorId?: string;
  cancellationRequestedAt?: string | null;
  creationSubmissionId?: string | null;
  workbenchKind?: string;
  id: string;
  userId: string;
  traceId?: string;
  requestId?: string;
  projectId: string;
  type: string;
  status: TaskStatus;
  stage: string;
  progress: number;
  prompt: string;
  operation: string;
  provider: string;
  model: string;
  logicalModelId?: string;
  logicalModelRevisionId?: string;
  routeId?: string;
  channelModelId?: string;
  /** RouteRun 只在用户主动重试时递增；worker 租约恢复不应创建新的路由选择世代。 */
  routeRun?: number;
  billingOrderId?: string;
  providerRequestId?: string;
  providerCancelStatus?: ProviderCancelStatus;
  providerCancelError?: string;
  providerCancelAttempts?: number;
  providerCancelRequestedAt?: string | null;
  providerCancelledAt?: string | null;
  providerCancelNextCheckAt?: string | null;
  pollStage?: string;
  nextPollAt?: string | null;
  leaseOwner?: string;
  leaseExpiresAt?: string | null;
  inputJson: string;
  resultJson: string;
  /** MediaRecoveryJSON is an encrypted server-only checkpoint, never a public result. */
  mediaRecoveryJson?: string;
  mediaStage?: string;
  canRecoverMedia?: boolean;
  textDraft?: string;
  error: string;
  attempts: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  createdAtEpoch?: number;
  updatedAt: string;
}

// TaskTextDelta 只保存可回放窗口内的文本增量；最终正文和失败草稿分别归并到 Task.ResultJSON 与 Task.TextDraft。

export interface TaskTextDelta {
  id: string;
  userId: string;
  taskId: string;
  sequence: number;
  content: string;
  byteCount: number;
  createdAt: string;
  expiresAt: string;
}

export interface TaskLog {
  id: string;
  userId: string;
  taskId: string;
  traceId?: string;
  requestId?: string;
  level: string;
  message: string;
  payload: string;
  createdAt: string;
}

export interface Result {
  id: string;
  userId: string;
  taskId: string;
  kind: string;
  url: string;
  payload: string;
  createdAt: string;
}

export function taskBeforeCreate(task: Task): void {
  if (task.createdAtEpoch) return;
  const parsed = task.createdAt ? new Date(task.createdAt) : new Date();
  task.createdAtEpoch = Math.floor((Number.isNaN(parsed.getTime()) ? Date.now() : parsed.getTime()) / 1000);
}
