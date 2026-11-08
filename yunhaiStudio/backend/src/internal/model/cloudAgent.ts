// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
// CloudAgentExecution checkpoints orchestration independently of billed tasks.

export interface CloudAgentExecution {
  id: string;
  userId: string;
  status: string;
  revision: number;
  checkpointVersion: number;
  conversationId: string;
  parentId: string;
  title: string;
  eventCount: number;
  messageCount: number;
  journal?: CloudAgentEventRecord[];
  transcript?: CloudAgentMessageRecord[];
  /** Control fields remain writable even when the transcript cannot be decoded or saved. */
  canvasId: string;
  activeTaskId: string;
  mediaTaskId: string;
  cleanupPending: boolean;
  failureMessage: string;
  stateJson: string;
  createdAt: string;
  updatedAt: string;
}

// CloudAgentPiSession stores Pi's native JSONL session independently from the
// bounded control checkpoint. Pi owns transcript and compaction semantics;
// Go only persists the opaque session snapshot and its revision.

export interface CloudAgentPiSession {
  runId: string;
  userId: string;
  sessionJsonl: string;
  revision: number;
  updatedAt: string;
}

// Journal rows are append-only and commit in the same transaction as the run.

export interface CloudAgentEventRecord {
  runId: string;
  sequence: number;
  userId: string;
  eventJson: string;
  createdAt: string;
}

// Transcript bodies do not share the bounded execution checkpoint. Canonical
// messages may be compacted; the append-only journal retains execution receipts.

export interface CloudAgentMessageRecord {
  runId: string;
  kind: string;
  sequence: number;
  userId: string;
  messageJson: string;
}

// CloudAgentCanvasMutation records one atomic canvas change made by an Agent.
// BeforeJSON is intentionally bounded by the application layer; mutations that
// cannot retain a safe snapshot are marked not_undoable instead of truncating it.

export interface CloudAgentCanvasMutation {
  id: string;
  runId: string;
  userId: string;
  canvasId: string;
  stepId: string;
  operation: string;
  beforeSnapshotHash: string;
  afterSnapshotHash: string;
  beforeJson?: string;
  hasSubmittedTask: boolean;
  status: string;
  createdAt: string;
  undoneAt?: string | null;
}
