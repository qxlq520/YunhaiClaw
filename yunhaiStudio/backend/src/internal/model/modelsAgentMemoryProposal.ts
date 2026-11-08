// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
import { createHash } from "node:crypto";
import { AgentLesson } from "./modelsAgentLesson";
export const agentMemoryProposalGenerating = "generating";
export const agentMemoryProposalPending = "pending";
export const agentMemoryProposalApproved = "approved";
export const agentMemoryProposalRejected = "rejected";
export const agentMemoryProposalNoChanges = "no_changes";
export const agentMemoryProposalFailed = "failed";

// AgentMemoryProposal retains the exact model input and proposed edits. A model
// completion never writes AgentLesson rows; only the owner's decision applies it.

export interface AgentMemoryProposal {
  id: string;
  userId: string;
  taskId: string;
  status: string;
  version: number;
  inputJson: string;
  changesJson: string;
  summaryJson: string;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
}

// AgentMemoryRevision is an immutable before/after snapshot of one approved
// batch. Version and RestoredAt guard a single atomic restore of that batch.

export interface AgentMemoryRevision {
  id: string;
  userId: string;
  proposalId: string;
  version: number;
  beforeJson: string;
  afterJson: string;
  createdAt: string;
  restoredAt: string | null;
}

// AgentMemorySnapshot preserves editor-visible data and provenance. Counters are
// retained for deleted rows, but do not form a version: telemetry is not an edit.

export interface AgentMemorySnapshot {
  id: string;
  topic: string;
  category: string;
  situation: string;
  lesson: string;
  source: string;
  originRunId: string;
  evidenceJson: string;
  stepsJson: string;
  status: string;
  hits: number;
  injected: number;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMemoryChange {
  kind: string;
  before: AgentMemorySnapshot[];
  after: AgentMemorySnapshot;
}

function toUtcIso(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

export function snapshotAgentMemory(lesson: AgentLesson): AgentMemorySnapshot {
  return {
    id: lesson.id,
    topic: lesson.topic,
    category: lesson.category,
    situation: lesson.situation,
    lesson: lesson.lesson,
    source: lesson.source,
    originRunId: lesson.originRunId ?? "",
    evidenceJson: lesson.evidenceJson ?? "",
    stepsJson: lesson.stepsJson ?? "",
    status: lesson.status,
    hits: lesson.hits,
    injected: lesson.injected,
    lastVerifiedAt: lesson.lastVerifiedAt ? toUtcIso(lesson.lastVerifiedAt) : null,
    createdAt: toUtcIso(lesson.createdAt),
    updatedAt: toUtcIso(lesson.updatedAt),
  };
}

export function agentMemorySnapshotLessonForUser(snapshot: AgentMemorySnapshot, userId: string): AgentLesson {
  return {
    ...(snapshot as unknown as AgentLesson),
    id: snapshot.id,
    authorUserId: userId,
    topic: snapshot.topic,
    category: snapshot.category,
    situation: snapshot.situation,
    lesson: snapshot.lesson,
    source: snapshot.source,
    originRunId: snapshot.originRunId,
    evidenceJson: snapshot.evidenceJson,
    stepsJson: snapshot.stepsJson,
    status: snapshot.status,
    hits: snapshot.hits,
    injected: snapshot.injected,
    lastVerifiedAt: snapshot.lastVerifiedAt,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}

export function agentMemorySnapshotContentVersion(snapshot: AgentMemorySnapshot): string {
  const normalized: AgentMemorySnapshot = {
    ...snapshot,
    hits: 0,
    injected: 0,
    createdAt: toUtcIso(snapshot.createdAt),
    updatedAt: toUtcIso(snapshot.updatedAt),
    lastVerifiedAt: snapshot.lastVerifiedAt ? toUtcIso(snapshot.lastVerifiedAt) : null,
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
