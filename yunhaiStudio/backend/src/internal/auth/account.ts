// 对应 backend/internal/auth/account.go
// 账号设置：资料读取、修改密码、更换邮箱。

import { timingSafeEqual } from "node:crypto";
import { badAuthRequest, newAppError, newId, rateLimited, unauthorized } from "@/internal/kernel/errors";
import type { AuthSession, User } from "@/internal/model/modelsIdentity";
import type { AuthVerification } from "@/internal/model/modelsNotifications";
import { codeMail, deliverEmail, emailPurposeEmailChanged, emailPurposeProfileEmail, maskedEmail, randomNumericCode, readEmailSetting, resolveEmailSender } from "./email";
import type { EmailSettingValue } from "./email";
import { renderNotice } from "@/internal/emailtpl/code";
import {
  changeProfileEmail as persistProfileEmail,
  changeProfilePassword as persistProfilePassword,
  profileCredentialHash,
  profileReauthenticationTtlMs,
} from "@/internal/repository/account";
import {
  attemptAuthVerification,
  authVerification,
  createAuthVerification,
  setAuthVerificationReady,
} from "@/internal/repository/notifications";
import type { NotificationLimit } from "@/internal/repository/notifications";
import { errNotificationLimit, errVerificationInvalid } from "@/internal/repository/errors";
import { checkEmailAvailable } from "@/internal/repository/emailIdentity";
import { hashPassword, hashToken, invalidVerification, normalizeEmail, randomToken, validateEmail, validatePassword, verifyPassword, profileWriteError, type AuthUser, type Service } from "./authService";
import { verificationHash, type VerificationTicket } from "./verification";

const profileEmailPurpose = "profile_email";

export interface UserProfile {
  user: AuthUser;
  hasPassword: boolean;
  emailEnabled: boolean;
  linuxdoEnabled: boolean;
  reauthenticatedUntil?: string;
}

export interface ProfilePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ProfileEmailCodeRequest {
  email: string;
  currentPassword: string;
}

export interface ProfileEmailChangeRequest {
  ticket: string;
  emailCode: string;
  currentPassword: string;
}

export interface ProfileEmailChangeResult {
  changed: boolean;
  notificationStatus: string;
}

async function authorizeProfileChange(user: User, session: AuthSession, password: string): Promise<void> {
  if ((user.passwordHash ?? "") !== "") {
    if (!(await verifyPassword(password, user.passwordHash ?? ""))) throw unauthorized("当前密码不正确");
    return;
  }
  const now = Date.now();
  const reauthenticatedAt = session.reauthenticatedAt ? new Date(session.reauthenticatedAt).getTime() : 0;
  if (!reauthenticatedAt || reauthenticatedAt > now || reauthenticatedAt + profileReauthenticationTtlMs <= now) {
    throw unauthorized("请先通过 Linux.do 重新验证身份");
  }
}

export async function userProfile(service: Service, actor: User | null, cookie: string): Promise<UserProfile> {
  const { user, session } = await service.profileSession(actor, cookie);
  const publicUser = await service.publicAuthUser(user);
  const emailEnabled = await service.emailEnabled();
  const { linuxDOEnabled } = await import("./linuxdo");
  const linuxdoEnabled = await linuxDOEnabled(service);
  const result: UserProfile = {
    user: publicUser,
    hasPassword: (user.passwordHash ?? "") !== "",
    emailEnabled,
    linuxdoEnabled,
  };
  const now = Date.now();
  const reauthenticatedAt = session.reauthenticatedAt ? new Date(session.reauthenticatedAt).getTime() : 0;
  if (reauthenticatedAt && reauthenticatedAt <= now) {
    const until = reauthenticatedAt + profileReauthenticationTtlMs;
    if (until > now) result.reauthenticatedUntil = new Date(until).toISOString();
  }
  return result;
}

export async function changeProfilePassword(
  service: Service,
  actor: User | null,
  cookie: string,
  req: ProfilePasswordRequest,
): Promise<void> {
  validatePassword(req.newPassword);
  if (Buffer.byteLength(req.newPassword, "utf8") > 72) {
    throw badAuthRequest("密码的 UTF-8 长度不能超过 72 字节");
  }
  const { user, session } = await service.profileSession(actor, cookie);
  await authorizeProfileChange(user, session, req.currentPassword);
  const hash = await hashPassword(req.newPassword);
  try {
    await persistProfilePassword(service.repo, user, session, hash, new Date().toISOString());
  } catch (error) {
    throw profileWriteError(error);
  }
}

async function profileEmailSetting(service: Service): Promise<EmailSettingValue> {
  const read = await readEmailSetting(service);
  if (!read.value.enabled || read.value.host === "" || read.value.port < 1 || read.value.fromEmail === "") {
    throw newAppError(403, "邮件服务未启用，暂时无法更换邮箱");
  }
  return resolveEmailSender(read.value, service.host.brandName());
}

export async function sendProfileEmailCode(
  service: Service,
  actor: User | null,
  cookie: string,
  req: ProfileEmailCodeRequest,
): Promise<VerificationTicket> {
  const { user, session } = await service.profileSession(actor, cookie);
  await authorizeProfileChange(user, session, req.currentPassword);
  const setting = await profileEmailSetting(service);
  const email = normalizeEmail(req.email);
  validateEmail(email);
  // 未验证的邮箱（关闭注册验证时填写）允许原样提交一次验证，作为后续绑定邮箱的入口。
  if (email === normalizeEmail(user.email ?? "") && user.emailVerifiedAt) {
    throw badAuthRequest("请输入与当前邮箱不同的新邮箱");
  }
  await checkEmailAvailable(service.repo, email, user.id);
  const code = randomNumericCode(6);
  const secret = randomToken();
  const now = new Date();
  const verification: AuthVerification = {
    id: newId(),
    tokenHash: hashToken(secret),
    purpose: profileEmailPurpose,
    method: "email",
    userId: user.id,
    sessionId: session.id,
    credentialHash: profileCredentialHash(user.passwordHash ?? ""),
    email,
    phone: "",
    emailHash: "",
    phoneHash: "",
    policyHash: "",
    ready: false,
    attempts: 0,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    usedAt: null,
  };
  verification.emailHash = await verificationHash(service, `${verification.id}:email:${email}:${code}`);
  const deliveryHash = await verificationHash(service, `delivery:${email}`);
  const limit = notificationLimitKey(now);
  const limits: NotificationLimit[] = [
    { key: `auth-day:${deliveryHash}:${limit.day}`, limit: 20, cooldownMs: 60 * 1000, expiresAt: new Date(now.getTime() + 48 * 3600 * 1000).toISOString() },
    { key: `auth-hour:${deliveryHash}:${limit.hour}`, limit: 5, cooldownMs: 0, expiresAt: new Date(now.getTime() + 2 * 3600 * 1000).toISOString() },
  ];
  try {
    await createAuthVerification(service.repo, verification, limits);
  } catch (error) {
    if (error === errNotificationLimit) {
      throw rateLimited("发送过于频繁，请至少等待 60 秒后重试（每小时最多 5 次）");
    }
    throw error;
  }
  const mail = codeMail({
    brand: setting.fromName,
    heading: "更换邮箱",
    intro: `你正在把${setting.fromName}账号的邮箱更换为 ${email}。请在账号设置页输入下方验证码完成验证。`,
    code,
    ttlMinutes: 10,
    recipient: email,
  });
  try {
    await deliverEmail(service, setting, {
      purpose: emailPurposeProfileEmail,
      userId: user.id,
      recipient: email,
      mail,
    });
  } catch {
    throw newAppError(503, "邮件发送失败，请稍后重试");
  }
  await setAuthVerificationReady(service.repo, verification.id);
  return { ticket: `${verification.id}.${secret}`, expiresIn: 600, retryAfter: 60 };
}

/** 与 Go 的 UTC 日期/小时配额键保持一致。 */
function notificationLimitKey(now: Date): { day: string; hour: string } {
  const iso = now.toISOString();
  return { day: iso.slice(0, 10), hour: iso.slice(0, 13) };
}

export async function changeProfileEmail(
  service: Service,
  actor: User | null,
  cookie: string,
  req: ProfileEmailChangeRequest,
): Promise<ProfileEmailChangeResult> {
  const { user, session } = await service.profileSession(actor, cookie);
  await authorizeProfileChange(user, session, req.currentPassword);
  const setting = await profileEmailSetting(service);
  const index = req.ticket.indexOf(".");
  if (index < 0) throw invalidVerification();
  const id = req.ticket.slice(0, index);
  const secret = req.ticket.slice(index + 1);
  if (id === "" || id.length > 36 || secret.length !== 64) throw invalidVerification();
  const verification = await authVerification(service.repo, id);
  if (!verification) throw invalidVerification();
  if (
    verification.purpose !== profileEmailPurpose ||
    verification.method !== "email" ||
    verification.userId !== user.id ||
    (verification.sessionId ?? "") !== session.id ||
    (verification.credentialHash ?? "") !== profileCredentialHash(user.passwordHash ?? "") ||
    !secureEqual(verification.tokenHash, hashToken(secret))
  ) {
    throw invalidVerification();
  }
  try {
    await attemptAuthVerification(service.repo, verification.id, new Date().toISOString());
  } catch (error) {
    if (error === errVerificationInvalid) throw invalidVerification();
    throw profileWriteError(error);
  }
  const hash = await verificationHash(service, `${verification.id}:email:${verification.email}:${req.emailCode.trim()}`);
  if (!secureEqual(hash, verification.emailHash)) throw invalidVerification();
  try {
    await persistProfileEmail(service.repo, user, session, verification, new Date().toISOString());
  } catch (error) {
    throw profileWriteError(error);
  }
  const result: ProfileEmailChangeResult = { changed: true, notificationStatus: "not_needed" };
  if ((user.email ?? "") !== "" && normalizeEmail(user.email ?? "") !== verification.email) {
    result.notificationStatus = "sent";
    try {
      const mail = renderNotice({
        brand: setting.fromName,
        subject: `${setting.fromName}账号邮箱已变更`,
        heading: "账号邮箱已变更",
        lines: [
          `你的${setting.fromName}账号邮箱已更换为 ${maskedEmail(verification.email)}。`,
          "为保护账号安全，所有设备上的登录会话已退出，请使用新邮箱重新登录。",
        ],
        tip: "如果这不是你本人的操作，请立即联系管理员冻结账号。",
      });
      await deliverEmail(service, setting, {
        purpose: emailPurposeEmailChanged,
        userId: user.id,
        recipient: user.email ?? "",
        mail,
      });
    } catch {
      result.notificationStatus = "failed";
    }
  }
  return result;
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
