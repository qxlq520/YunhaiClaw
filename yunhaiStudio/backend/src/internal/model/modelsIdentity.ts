// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
import { UserRole, UserStatus } from "./models";
import { UserGroup } from "./modelsUserGroup";
export interface User {
  id: string;
  username: string;
  email?: string;
  phone?: string;
  emailVerifiedAt?: string | null;
  phoneVerifiedAt?: string | null;
  displayName: string;
  avatarMode: string;
  avatarPreset?: string;
  avatarVersion?: string;
  role: UserRole;
  status: UserStatus;
  isPromoter: boolean;
  /** UserGroup 是用户分组编码；空串归入 default 分组。 */
  userGroup: string;
  passwordHash?: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  reauthenticatedAt?: string | null;
  id: string;
  userId: string;
  tokenHash?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserIdentity {
  id: string;
  userId: string;
  provider: string;
  subject: string;
  providerUsername: string;
  avatarUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface OAuthState {
  reauthUserId?: string;
  reauthSessionId?: string;
  id: string;
  provider: string;
  stateHash?: string;
  codeVerifier?: string;
  nextPath: string;
  acceptedTerms: boolean;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface EmailVerificationCode {
  attempts?: number;
  id: string;
  email: string;
  codeHash?: string;
  purpose: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}
