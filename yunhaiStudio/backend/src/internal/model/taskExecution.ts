// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
export const taskCancellationUserRequest = "user_request";
export const taskCancellationParentCancelled = "parent_cancelled";
export const taskCancellationParentFailed = "parent_failed";
export const taskCancellationWorkerContext = "worker_context";

// TaskExecutionDiagnostic records execution facts independently of the node's
// presentation state. SafeMessage is suitable for users and model context.

export interface TaskExecutionDiagnostic {
  code: string;
  phase: string;
  fieldPath?: string;
  taskSubmitted: boolean;
  submissionOutcome: string;
  retryClass: string;
  safeMessage: string;
  diagnosticId: string;
  writebackOutcome?: string;
  writebackReason?: string;
  writebackNodeId?: string;
  writebackMessage?: string;
}

export interface TaskCancellationIntent {
  source: string;
  actorId: string;
  requestedAt: string;
  diagnostic: TaskExecutionDiagnostic;
}
