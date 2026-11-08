// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
// LoginLog 保存事件时的用户快照，不随账号改名或会话清理改写历史。

export interface LoginLog {
  id: string;
  userId: string | null;
  username: string;
  displayName: string;
  account: string;
  event: string;
  method: string;
  source: string;
  result: string;
  ip: string;
  userAgent: string;
  sessionRef: string;
  reason: string;
  message: string;
  createdAt: string;
}
