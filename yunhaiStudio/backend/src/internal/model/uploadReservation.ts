// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
// UploadReservation survives process restarts; expiry, not process ownership,
// bounds its lifetime. Day records the UTC quota bucket charged at admission.

export interface UploadReservation {
  id: string;
  userId: string;
  size: number;
  day: string;
  expiresAt: string;
}
