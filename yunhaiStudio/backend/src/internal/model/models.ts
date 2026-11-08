// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
export type TaskStatus = string;

export type ProviderCancelStatus = string;

export type UserRole = string;

export type UserStatus = string;

export type ChannelScope = string;

export type ChannelInterfaceType = string;

export type ApiCallStatus = string;

export type ResourceStatus = string;

export type ResourceDeletionStatus = string;

export type BillingStatus = string;

export type CreditLedgerType = string;

export type RedeemCodeStatus = string;

export type AnnouncementStatus = string;

export type AnnouncementLevel = string;

export type ProjectStatus = string;

export type ProjectUnitKind = string;

export type ProjectUnitStatus = string;

export type AssetCategory = string;

export type AssetVersionStatus = string;

export type WorkflowStatus = string;

export type WorkflowStepStatus = string;

// AdminAuditEvent 只允许追加，用于还原管理员写操作，禁止作为可编辑业务状态使用。

export interface AdminAuditEvent {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  metadataJson: string;
  createdAt: string;
}

export const taskStatusQueued: TaskStatus = "queued";
export const taskStatusRunning: TaskStatus = "running";
export const taskStatusSucceeded: TaskStatus = "succeeded";
export const taskStatusFailed: TaskStatus = "failed";
export const taskStatusCancelled: TaskStatus = "cancelled";
export const taskStatusTextReplay: TaskStatus = "text_replay";
export const userRoleAdmin: UserRole = "admin";
export const userRoleUser: UserRole = "user";
export const userStatusActive: UserStatus = "active";
export const userStatusDisabled: UserStatus = "disabled";
export const channelScopeSystem: ChannelScope = "system";
export const channelScopeUser: ChannelScope = "user";
export const channelInterfaceChatCompletion: ChannelInterfaceType = "chat-completion";
export const channelInterfaceOpenAiResponse: ChannelInterfaceType = "openai-response";
export const channelInterfaceClaudeApi: ChannelInterfaceType = "claude-api";
export const channelInterfaceOpenAiImage: ChannelInterfaceType = "openai-image";
export const channelInterfaceGrokImage: ChannelInterfaceType = "grok-image";
export const channelInterfaceVolcengineArkImage: ChannelInterfaceType = "volcengine-ark-image";
export const channelInterfaceVolcengineArkAgentPlanImage: ChannelInterfaceType = "volcengine-ark-agent-plan-image";
export const channelInterfaceVolcengineJiMengImage: ChannelInterfaceType = "volcengine-jimeng-image";
export const channelInterfaceGeminiImage: ChannelInterfaceType = "gemini-image";
export const channelInterfaceOpenAiAudio: ChannelInterfaceType = "openai-audio";
export const channelInterfaceDoubaoStreamingTts: ChannelInterfaceType = "doubao-streaming-tts";
export const channelInterfaceAsyncAudio: ChannelInterfaceType = "async-audio";
export const channelInterfaceNewApiVideo: ChannelInterfaceType = "newapi";
export const channelInterfaceNewApiChannel1: ChannelInterfaceType = "newapi-channel-1";
export const channelInterfaceNewApiChannel2: ChannelInterfaceType = "newapi-channel-2";
export const channelInterfaceXaiVideo: ChannelInterfaceType = "xai-video";
export const channelInterfaceVolcengineArkVideo: ChannelInterfaceType = "volcengine-ark-video";
export const channelInterfaceVolcengineArkAgentPlanVideo: ChannelInterfaceType = "volcengine-ark-agent-plan-video";
export const channelInterfaceVolcengineJiMengVideo: ChannelInterfaceType = "volcengine-jimeng-video";
export const channelInterfaceGeminiVeo: ChannelInterfaceType = "gemini-veo";
export const channelInterfaceNovitaVideo: ChannelInterfaceType = "novita-video";
export const channelInterfaceMiniMaxVideo: ChannelInterfaceType = "minimax-video";
export const channelInterfaceAgnesVideo: ChannelInterfaceType = "agnes-video";
export const channelInterfaceRunningHubImage: ChannelInterfaceType = "runninghub-workflow-image";
export const channelInterfaceRunningHubVideo: ChannelInterfaceType = "runninghub-workflow-video";
export const channelInterfaceRunningHubAudio: ChannelInterfaceType = "runninghub-workflow-audio";
export const apiCallStatusSucceeded: ApiCallStatus = "succeeded";
export const apiCallStatusFailed: ApiCallStatus = "failed";
export const resourceStatusPending: ResourceStatus = "pending";
export const resourceStatusReady: ResourceStatus = "ready";
export const resourceStatusFailed: ResourceStatus = "failed";
export const resourceStatusDeleted: ResourceStatus = "deleted";
export const playbackStatusNone = "none";
export const playbackStatusProcessing = "processing";
export const playbackStatusReady = "ready";
export const playbackStatusFailed = "failed";
export const resourceDeletionStatusPending: ResourceDeletionStatus = "pending";
export const resourceDeletionStatusProcessing: ResourceDeletionStatus = "processing";
export const billingStatusReserved: BillingStatus = "reserved";
export const billingStatusRunning: BillingStatus = "running";
export const billingStatusSettled: BillingStatus = "settled";
export const billingStatusRefunded: BillingStatus = "refunded";
export const billingStatusUncertain: BillingStatus = "uncertain";
export const providerCancelStatusRequested: ProviderCancelStatus = "requested";
export const providerCancelStatusConfirmed: ProviderCancelStatus = "confirmed";
export const providerCancelStatusUncertain: ProviderCancelStatus = "uncertain";
export const creditLedgerRedeem: CreditLedgerType = "redeem";
export const creditLedgerAdminGrant: CreditLedgerType = "admin_grant";
export const creditLedgerReserve: CreditLedgerType = "reserve";
export const creditLedgerConsume: CreditLedgerType = "consume";
export const creditLedgerRefund: CreditLedgerType = "refund";
export const creditLedgerAdminAdjust: CreditLedgerType = "admin_adjustment";
export const creditLedgerSignupBonus: CreditLedgerType = "signup_bonus";
export const creditLedgerCheckinBonus: CreditLedgerType = "checkin_bonus";
export const creditLedgerPaymentTopup: CreditLedgerType = "payment_topup";
export const creditLedgerReferral: CreditLedgerType = "referral_commission";
export const redeemCodeUnused: RedeemCodeStatus = "unused";
export const redeemCodeRedeemed: RedeemCodeStatus = "redeemed";
export const redeemCodeDisabled: RedeemCodeStatus = "disabled";
export const announcementStatusActive: AnnouncementStatus = "active";
export const announcementStatusClosed: AnnouncementStatus = "closed";
export const announcementLevelInfo: AnnouncementLevel = "info";
export const announcementLevelSuccess: AnnouncementLevel = "success";
export const announcementLevelWarning: AnnouncementLevel = "warning";
export const announcementLevelCritical: AnnouncementLevel = "critical";
export const projectStatusActive: ProjectStatus = "active";
export const projectStatusArchived: ProjectStatus = "archived";
export const projectUnitKindChapter: ProjectUnitKind = "chapter";
export const projectUnitKindEpisode: ProjectUnitKind = "episode";
export const projectUnitStatusDraft: ProjectUnitStatus = "draft";
export const projectUnitStatusReady: ProjectUnitStatus = "ready";
export const projectUnitStatusCompleted: ProjectUnitStatus = "completed";
export const projectUnitStatusReserved: ProjectUnitStatus = "reserved";
export const assetCategoryCharacter: AssetCategory = "character";
export const assetCategoryEnvironment: AssetCategory = "environment";
export const assetCategoryProp: AssetCategory = "prop";
export const assetCategoryMaterial: AssetCategory = "material";
export const assetCategoryOther: AssetCategory = "other";
export const assetCategoryArk: AssetCategory = "ark";
export const assetVersionStatusDraft: AssetVersionStatus = "draft";
export const assetVersionStatusReview: AssetVersionStatus = "review";
export const assetVersionStatusConfirmed: AssetVersionStatus = "confirmed";
export const assetVersionStatusArchived: AssetVersionStatus = "archived";
export const workflowStatusActive: WorkflowStatus = "active";
export const workflowStatusCompleted: WorkflowStatus = "completed";
export const workflowStatusFailed: WorkflowStatus = "failed";
export const workflowStepStatusPending: WorkflowStepStatus = "pending";
export const workflowStepStatusReady: WorkflowStepStatus = "ready";
export const workflowStepStatusRunning: WorkflowStepStatus = "running";
export const workflowStepStatusReview: WorkflowStepStatus = "review";
export const workflowStepStatusCompleted: WorkflowStepStatus = "completed";
export const workflowStepStatusFailed: WorkflowStepStatus = "failed";
export const workflowStepStatusSkipped: WorkflowStepStatus = "skipped";
