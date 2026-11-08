// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
// UserAvatar keeps the bounded image payload out of ordinary user queries.

export interface UserAvatar {
  userId: string;
  data?: number[];
  updatedAt: string;
}
