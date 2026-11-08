// 对应 backend/internal/auth/verification.go
// 登录/注册/绑定的邮箱与短信验证票据。

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError, badAuthRequest, forbidden, newId, rateLimited, unauthorized } from "@/internal/kernel/errors";
import { userStatusActive } from "@/internal/model/models";
import type { AuthVerification } from "@/internal/model/modelsNotifications";
import type { User } from "@/internal/model/modelsIdentity";
import {
  completeAuthVerification,
  createAuthVerification,
  errNotificationLimit,
  errVerificationInvalid,
  attemptAuthVerification,
  authVerification,
  setAuthVerificationReady,
  userByPhone,
} from "@/internal/repository/notifications";
import { checkEmailAvailable } from "@/internal/repository/emailIdentity";
import { normalizePhone } from "@/internal/sms/sms";
import { renderCode } from "@/internal/emailtpl/code";
import { emailEnabled, readEmailSetting, resolveEmailSender, deliverEmail, validateRegistrationEmailDomain } from "./email";
import type { EmailDelivery } from "./email";
import { hashToken, normalizeEmail, validateEmail, verifyPassword, invalidVerification } from "./authService";
import type { AuthSessionResult, AuthUser, Service } from "./authService";
import { loginLogUser, maskLoginAccount, newLoginLog, type LoginContext } from "./loginLogs";
import { policyAllows, policyHash, verificationPolicy } from "./verificationPolicy";
import type { VerificationPolicy } from "./verificationPolicy";
import { firstNonEmpty } from "@/internal/kernel/errors";
import { registrationEnabled } from "./registration";

export interface VerificationRequest {
  purpose: string;
  method: string;
  email: string;
  phone: string;
  password: string;
}

export interface VerificationTicket {
  ticket: string;
  expiresIn: number;
  retryAfter: number;
}

export interface VerificationConfirm {
  loginContext?: LoginContext;
  ticket: string;
  emailCode: string;
  smsCode: string;
}

const verificationPurposeEmail = "verification";

export async function verificationHash(service: Service, value: string): Promise<string> {
  const key = await service.host.settingsEncryptionKey();
  if (!key || key.length < 16) throw new AppError({ status: 503, message: "验证码加密密钥不可用" });
  return createHmac("sha256", Buffer.from(key)).update(value).digest("hex");
}

export async function checkVerificationPolicy(
  service: Service,
  policy: VerificationPolicy,
  purpose: string,
  method: string,
): Promise<void> {
  if (!policyAllows(policy, purpose, method)) throw forbidden("此验证方式未开启，请刷新页面");
  if (purpose === "register" && !(await registrationEnabled(service))) {
    throw forbidden("管理员未开放新用户注册");
  }
}

export async function startVerification(
  service: Service,
  actor: User | null,
  req: VerificationRequest,
): Promise<VerificationTicket> {
  const policy = await verificationPolicy(service);
  await checkVerificationPolicy(service, policy, req.purpose, req.method);
  let email = "";
  let phone = "";
  if (req.method === "email" || req.method === "sms_email") {
    email = normalizeEmail(req.email);
    validateEmail(email);
    if (!(await emailEnabled(service))) throw new AppError({ status: 503, message: "邮件服务未启用" });
    if (req.purpose === "register") await validateRegistrationEmailDomain(service, email);
  }
  if (req.method === "sms" || req.method === "sms_email") {
    phone = normalizePhone(req.phone);
    if (!(await smsAvailableFor(service, req.purpose))) throw new AppError({ status: 503, message: "此场景短信服务未启用" });
  }
  let userId = "";
  if (req.purpose === "bind") {
    if (!actor || actor.status !== userStatusActive) throw unauthorized("请先登录");
    if (!(await verifyPassword(req.password, actor.passwordHash ?? ""))) throw unauthorized("当前密码不正确");
    userId = actor.id;
  }
  // 只对已存在、启用且已验证的联系方式签发可用票据；
  // 未知账号得到形状相同但不可用的票据，响应不会泄露账号是否存在。
  if (req.purpose === "login") {
    const user = email !== "" ? await userByEmail(service, email) : await userByPhone(service.repo, phone);
    if (user && user.status === userStatusActive && ((email !== "" && user.emailVerifiedAt) || (phone !== "" && user.phoneVerifiedAt))) {
      userId = user.id;
    }
  }
  if (req.purpose !== "login") await contactAvailable(service, email, phone, userId);
  const secret = randomBytes(32);
  const now = new Date();
  const verification: AuthVerification = {
    id: newId(),
    tokenHash: hashToken(secret.toString("hex")),
    purpose: req.purpose,
    method: req.method,
    userId,
    email,
    phone,
    emailHash: "",
    phoneHash: "",
    policyHash: policyHash(policy),
    sessionId: "",
    credentialHash: "",
    ready: false,
    attempts: 0,
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    usedAt: null,
    createdAt: now.toISOString(),
  };
  let emailCode = "";
  let smsCode = "";
  if (email !== "") {
    emailCode = randomNumericCode(6);
    verification.emailHash = await verificationHash(service, `${verification.id}:email:${email}:${emailCode}`);
  }
  if (phone !== "") {
    smsCode = randomNumericCode(6);
    verification.phoneHash = await verificationHash(service, `${verification.id}:sms:${phone}:${smsCode}`);
  }
  const limits = [];
  for (const target of [email, phone]) {
    if (target === "") continue;
    const hash = await verificationHash(service, `delivery:${target}`);
    // 日共享键同时提供跨场景的 60 秒滑动冷却。
    const day = now.toISOString().slice(0, 10);
    const hour = now.toISOString().slice(0, 13);
    limits.push(
      { key: `auth-day:${hash}:${day}`, limit: 20, cooldownMs: 60 * 1000, expiresAt: new Date(now.getTime() + 48 * 3600 * 1000).toISOString() },
      { key: `auth-hour:${hash}:${hour}`, limit: 5, cooldownMs: 0, expiresAt: new Date(now.getTime() + 2 * 3600 * 1000).toISOString() },
    );
  }
  try {
    await createAuthVerification(service.repo, verification, limits);
  } catch (error) {
    if (error === errNotificationLimit) throw rateLimited("发送过于频繁，请至少等待 60 秒后重试（每小时最多 5 次）");
    throw error;
  }
  const ticket: VerificationTicket = { ticket: `${verification.id}.${secret.toString("hex")}`, expiresIn: 600, retryAfter: 60 };
  if (req.purpose === "login" && userId === "") return ticket;
  if (phone !== "" && service.sms) {
    await service.sms.sendCode(req.purpose, phone, smsCode);
  }
  if (email !== "") {
    const setting = await readEmailSetting(service);
    const sender = resolveEmailSender(setting.value, service.host.brandName());
    const heading = verificationHeading(req.purpose);
    const rendered = renderCode({
      brand: sender.fromName,
      heading,
      intro: `你正在${sender.fromName}进行${heading}。请在页面中输入下方验证码完成身份验证。`,
      code: emailCode,
      ttlMinutes: 10,
      recipient: email,
    });
    try {
      await deliverEmail(service, sender, {
        purpose: "verification",
        userId,
        recipient: email,
        mail: rendered,
      } satisfies EmailDelivery);
    } catch {
      throw new AppError({ status: 503, message: "邮件发送失败，请稍后重试" });
    }
  }
  await setAuthVerificationReady(service.repo, verification.id);
  return ticket;
}

async function smsAvailableFor(service: Service, scene: string): Promise<boolean> {
  if (!service.sms) return false;
  return service.sms.available(scene);
}

async function userByEmail(service: Service, email: string): Promise<User | null> {
  const { userByEmail: lookup } = await import("@/internal/repository/account");
  return lookup(service.repo, email);
}

export async function contactAvailable(
  service: Service,
  email: string,
  phone: string,
  ownId: string,
): Promise<void> {
  if (email !== "") await checkEmailAvailable(service.repo, email, ownId);
  if (phone !== "") {
    const user = await userByPhone(service.repo, phone);
    if (user && user.id !== ownId) throw badAuthRequest("该邮箱或手机号已被使用");
  }
}

export async function verifyTicket(
  service: Service,
  purpose: string,
  req: VerificationConfirm,
): Promise<AuthVerification> {
  const index = req.ticket.indexOf(".");
  const id = index < 0 ? req.ticket : req.ticket.slice(0, index);
  const secret = index < 0 ? "" : req.ticket.slice(index + 1);
  if (index < 0 || secret.length !== 64 || id.length > 36) throw invalidVerification();
  const verification = await authVerification(service.repo, id);
  if (!verification) throw invalidVerification();
  if (!secureEqual(verification.tokenHash, hashToken(secret)) || verification.purpose !== purpose) {
    throw invalidVerification();
  }
  const policy = await verificationPolicy(service);
  await checkVerificationPolicy(service, policy, verification.purpose, verification.method);
  if (policyHash(policy) !== verification.policyHash) {
    throw badAuthRequest("验证策略已更新，请重新获取验证码");
  }
  try {
    await attemptAuthVerification(service.repo, verification.id, new Date().toISOString());
  } catch (error) {
    if (error === errVerificationInvalid) throw invalidVerification();
    throw error;
  }
  if (verification.email !== "") {
    const hash = await verificationHash(service, `${verification.id}:email:${verification.email}:${req.emailCode.trim()}`);
    if (!secureEqual(hash, verification.emailHash)) throw invalidVerification();
  }
  if (verification.phone !== "") {
    const hash = await verificationHash(service, `${verification.id}:sms:${verification.phone}:${req.smsCode.trim()}`);
    if (!secureEqual(hash, verification.phoneHash)) throw invalidVerification();
  }
  return verification;
}

export async function loginVerification(service: Service, req: VerificationConfirm): Promise<AuthSessionResult> {
  const event = newLoginLog("verification", "login", req.loginContext ?? { ip: "", userAgent: "" });
  try {
    const index = req.ticket.indexOf(".");
    if (index >= 0) {
      const id = req.ticket.slice(0, index);
      const secret = req.ticket.slice(index + 1);
      if (id.length <= 36 && secret.length === 64) {
        const candidate = await authVerification(service.repo, id);
        if (candidate && candidate.purpose === "login" && secureEqual(candidate.tokenHash, hashToken(secret))) {
          event.method = candidate.method;
          event.account = maskLoginAccount(firstNonEmpty(candidate.email, candidate.phone));
          if (candidate.userId !== "") {
            const { userById } = await import("@/internal/repository/account");
            const user = await userById(service.repo, candidate.userId);
            if (user) loginLogUser(event, user);
          }
        }
      }
    }
    const verification = await verifyTicket(service, "login", req);
    let user: User;
    try {
      user = await completeAuthVerification(service.repo, verification, false);
    } catch (error) {
      if (error === errVerificationInvalid) throw invalidVerification();
      throw error;
    }
    event.method = verification.method;
    return await service.createAuthSession(user, event);
  } catch (error) {
    throw await service.recordLoginFailure(event, error);
  }
}

export async function bindVerification(service: Service, actor: User | null, req: VerificationConfirm): Promise<AuthUser> {
  if (!actor) throw unauthorized("请先登录");
  const verification = await verifyTicket(service, "bind", req);
  if (verification.userId !== actor.id) throw invalidVerification();
  await contactAvailable(service, verification.email, verification.phone, actor.id);
  let user: User;
  try {
    user = await completeAuthVerification(service.repo, verification, true);
  } catch {
    throw invalidVerification();
  }
  return service.publicAuthUser(user);
}

export function verificationHeading(purpose: string): string {
  switch (purpose) {
    case "login":
      return "登录";
    case "register":
      return "注册";
    case "bind":
      return "绑定邮箱";
    default:
      return "身份验证";
  }
}

function randomNumericCode(length: number): string {
  let value = "";
  const bytes = randomBytes(length);
  for (let index = 0; index < length; index += 1) value += String(bytes[index] % 10);
  return value;
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
