// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
export const poseLibraryStatusPending = "pending";
export const poseLibraryStatusReady = "ready";
export const poseLibraryStatusFailed = "failed";

// PoseLibrarySource 是一个姿势数据来源（一次导入包）及其署名。
// BaseURL 只在把图片同步到本站时使用，用户浏览和选用都不再访问来源站点。

export interface PoseLibrarySource {
  key: string;
  name: string;
  attribution: string;
  homepage: string;
  baseUrl: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// PoseLibraryItem 是姿势库里的一张参考图（某个姿势的一个视角）。
// 同一 GroupKey 的多张图是同一姿势的不同视角；图片文件保存在数据目录 pose-library/<ID>/ 下。

export interface PoseLibraryItem {
  id: string;
  sourceKey: string;
  externalKey: string;
  groupKey: string;
  code: string;
  system: string;
  category: string;
  name: string;
  angle: string;
  searchText?: string;
  sortOrder: number;
  enabled: boolean;
  status: string;
  error?: string;
  remoteThumb?: string;
  remoteImage?: string;
  thumbFile?: string;
  thumbMime?: string;
  imageFile?: string;
  imageMime?: string;
  imageSha256?: string;
  imageBytes: number;
  width: number;
  height: number;
  createdBy: string;
  syncedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
