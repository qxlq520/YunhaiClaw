// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
export const agentLessonStatusPending = "pending";
export const agentLessonStatusApproved = "approved";
export const agentLessonStatusRejected = "rejected";
export const agentLessonStatusExpired = "expired";

// AgentLessonStep 是一条记忆路线里的一步。

export interface AgentLessonStep {
  tool: string;
  action: string;
  note?: string;
}

// AgentLesson 是用户私有的 Agent 记忆。只有该用户批准后才会注入自己的会话。

export interface AgentLesson {
  id: string;
  topic: string;
  category: string;
  situation: string;
  lesson: string;
  source: string;
  stepsJson?: string;
  originRunId?: string;
  evidenceJson?: string;
  status: string;
  authorUserId?: string;
  hits: number;
  injected: number;
  lastVerifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
