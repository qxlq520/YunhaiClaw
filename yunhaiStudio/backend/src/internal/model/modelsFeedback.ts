// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
export type FeedbackType = string;

export const feedbackTypeBug: FeedbackType = "bug";
export const feedbackTypeFeature: FeedbackType = "feature";
export const feedbackTypeImprovement: FeedbackType = "improvement";
export const feedbackTypeOther: FeedbackType = "other";

export type FeedbackStatus = string;

export const feedbackStatusPending: FeedbackStatus = "pending"    // 待处理;
export const feedbackStatusProcessing: FeedbackStatus = "processing" // 处理中/评估中;
export const feedbackStatusResolved: FeedbackStatus = "resolved"   // 已解决/已采纳;
export const feedbackStatusClosed: FeedbackStatus = "closed"     // 已关闭;
export const feedbackStatusArchived: FeedbackStatus = "archived"   // 已归档;

export interface FeedbackAttachment {
  id: string;
  name: string;
  url: string;
  size: number;
  mimeType: string;
}

export interface UserFeedback {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  contact: string;
  type: FeedbackType;
  title: string;
  content: string;
  status: FeedbackStatus;
  adminReply: string;
  repliedAt?: string | null;
  archived: boolean;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
