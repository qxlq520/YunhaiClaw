// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
export type UserStorageGrantSource = string;

export const userStorageGrantSourcePayment: UserStorageGrantSource = "payment";
export const userStorageGrantSourceAdmin: UserStorageGrantSource = "admin";

// UserStorageGrant 是一笔独立的账号文件容量扩容。有效容量 = 全局基础容量 + 未撤销且未过期记录之和；
// 到期不需要后台任务，查询时按 expires_at 过滤。

export interface UserStorageGrant {
  id: string;
  userId: string;
  source: UserStorageGrantSource;
  paymentOrderId?: string;
  productId?: string;
  productName?: string;
  bytes: number;
  durationDays: number;
  startsAt: string;
  /** ExpiresAt 为空表示永久有效。 */
  expiresAt?: string | null;
  revokedAt?: string | null;
  revokedBy?: string;
  revokeReason?: string;
  /** ReferenceKey 唯一，防止支付回调与主动查单并发时重复发放。 */
  referenceKey?: string | null;
  note?: string;
  createdBy?: string;
  createdAt: string;
}

// UserStorageState 记录账号首次被观察到超出文件容量的时间，用于计算 7 天宽限期。
// 用量回落到容量以内时清空。

export interface UserStorageState {
  userId: string;
  overLimitSince?: string | null;
  updatedAt: string;
}
