// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
export type ResourceOffloadStatus = string;

export const resourceOffloadStatusPending: ResourceOffloadStatus = "pending";
export const resourceOffloadStatusProcessing: ResourceOffloadStatus = "processing";
export const resourceOffloadStatusDone: ResourceOffloadStatus = "done";
export const resourceOffloadStatusCancelled: ResourceOffloadStatus = "cancelled";
export const resourceOffloadStatusFailed: ResourceOffloadStatus = "failed";

// ResourceOffloadJob 记录“对象存储写入失败、生成作品先保存到本地”的资源，
// 由后台 worker 补传到原定的对象存储位置。Target* 冻结首次上传时的存储位置
// 和对象键，重试始终写同一个对象，不产生孤儿对象。

export interface ResourceOffloadJob {
  id: string;
  userId: string;
  resourceId: string;
  taskId: string;
  size: number;
  localObjectKey: string;
  targetProvider: string;
  targetEndpoint: string;
  targetBucket: string;
  targetStorageSettingId?: string;
  targetObjectKey: string;
  status: ResourceOffloadStatus;
  attempts: number;
  lastErrorCode: string;
  lastError: string;
  nextAttemptAt: string;
  leaseOwner?: string;
  leaseExpiresAt?: string | null;
  /** 切换到对象存储时记下的本地播放副本，和原文件一起延迟清理。 */
  localPlaybackKey?: string;
  localDeleteAfter?: string | null;
  localDeletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
