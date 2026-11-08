// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
export interface SMSChannel {
  id: string;
  name: string;
  provider: string;
  enabled: boolean;
  priority: number;
  dailyLimit: number;
  signName: string;
  appId: string;
  credentials?: string;
  templatesJson?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

// SMSRecord contains no code, template parameters, raw response or full phone.

export interface SMSRecord {
  id: string;
  channelId: string;
  channelName: string;
  provider: string;
  purpose: string;
  maskedPhone: string;
  targetHash?: string;
  state: string;
  requestId: string;
  messageId: string;
  errorCode: string;
  durationMs: number;
  createdAt: string;
  updatedAt: string;
}

// Verification tickets are immutable, short-lived and purpose/target bound.
// Only code HMACs and the hash of the high-entropy client ticket are persisted.

export interface AuthVerification {
  sessionId?: string;
  credentialHash?: string;
  id: string;
  tokenHash: string;
  purpose: string;
  method: string;
  userId: string;
  email: string;
  phone: string;
  emailHash: string;
  phoneHash: string;
  policyHash: string;
  ready: boolean;
  attempts: number;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

// Fixed window quotas and per-recipient cooldowns are shared by all instances.

export interface NotificationQuota {
  key: string;
  count: number;
  nextAt: string;
  expiresAt: string;
}
