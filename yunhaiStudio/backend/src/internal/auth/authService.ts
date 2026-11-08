// 对应 backend/internal/auth/auth.go 与 host.go
// 认证服务装配、注册登录、会话与账号公开信息。

import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  AppError,
  badAuthRequest,
  forbidden,
  newId,
  newAppError,
  unauthorized,
} from "@/internal/kernel/errors";
import { codeAccountNotRegistered } from "@/internal/kernel/errorCodes";
import { userRoleAdmin, userRoleUser, userStatusActive } from "@/internal/model/models";
import type { AuthSession, User } from "@/internal/model/modelsIdentity";
import * as repoAccount from "@/internal/repository/account";
import { Repository, recordNotFound } from "@/internal/repository/repository";
import { loginLogUser, maskLoginAccount, newLoginLog, recordLoginFailure, recordRejectedLogin, type LoginContext } from "./loginLogs";
import { revokeAuthSessionWithLog } from "@/internal/repository/loginLogs";
import type { LoginLog } from "@/internal/model/modelsLoginLog";
import type { AuthVerification } from "@/internal/model/modelsNotifications";
import type { EmailVerificationCode } from "@/internal/model/modelsIdentity";
import {
  type LoginMode,
  loginModeModal,
  type PublicRegistrationSetting,
  type RegistrationSettingRequest,
  adminRegistrationSetting,
  updateRegistrationSetting,
  registrationEnabled,
  agreementTitleForMessage,
  registrationAgreement,
  readRegistrationSetting,
  normalizeLoginMode,
  type RegistrationSettingValue,
  registrationValueEmailRequired,
  registrationValueVerificationRequired,
} from "./registration";
import {
  type VerificationConfirm,
  type VerificationRequest,
  type VerificationTicket,
  bindVerification,
  loginVerification,
  startVerification,
  verifyTicket,
} from "./verification";
import {
  adminVerificationPolicy,
  policyAllows,
  updateVerificationPolicy,
  type VerificationPolicy,
  verificationPolicy,
} from "./verificationPolicy";
import { resetPassword, sendPasswordResetEmailCode, type PasswordResetRequest } from "./passwordReset";
import {
  profileAvatarContent,
  selectDefaultProfileAvatar,
  updateProfileAvatar,
  useDefaultProfileAvatar,
} from "./avatar";
import {
  adminEmailSetting,
  emailBrandName,
  sendSystemEmail,
  updateEmailSetting,
  type EmailDelivery,
  type EmailSettingRequest,
  type PublicEmailSetting,
} from "./email";
import { adminEmailLogs, cleanupEmailLogs, sendTestEmail, type EmailLogPage, type EmailLogQuery } from "./emailAdmin";
import { checkEmailAvailable, createRegisteredUser } from "@/internal/repository/emailIdentity";
import { createUserWithEmailVerification } from "@/internal/repository/account";
import {
  createUserWithVerification,
  errVerificationInvalid,
} from "@/internal/repository/notifications";
import { userIdentityForUser } from "@/internal/repository/oauth";

export const defaultBrandName = "影降";
export const sessionCookieName = "open_ai_canvas_session";

const sessionMaxAgeMs = 30 * 24 * 60 * 60 * 1000;
const usernamePattern = /^[a-zA-Z0-9_-]{3,32}$/;
const usernameInvalidChars = /[^a-zA-Z0-9_-]+/g;

export type AuthError = AppError;

export interface Host {
  requireAdmin(user: User | null): Promise<void> | void;
  encryptSecret(value: string): Promise<string> | string;
  decryptSecret(value: string): Promise<string> | string;
  settingsEncryptionKey(): Promise<Uint8Array | null> | Uint8Array | null;
  brandName(): string;
  ensureSignupBonus(userId: string): Promise<void> | void;
  bindReferral(inviteeId: string, code: string): void;
  recordActivity(userId: string, event: string, count: number): void;
  allowRequest(key: string, limit: number, windowMs: number): Promise<boolean> | boolean;
  requestRetryAfter(key: string, windowMs: number): number;
}

export const nopHost: Host = {
  requireAdmin: () => undefined,
  encryptSecret: (value) => value,
  decryptSecret: (value) => value,
  settingsEncryptionKey: () => null,
  brandName: () => defaultBrandName,
  ensureSignupBonus: () => undefined,
  bindReferral: () => undefined,
  recordActivity: () => undefined,
  allowRequest: () => true,
  requestRetryAfter: () => 0,
};

export function brandHost(name: string): Host {
  return {
    ...nopHost,
    brandName: () => (name.trim() === "" ? defaultBrandName : name),
  };
}

export type MailSender = (setting: unknown, recipient: string, subject: string, text: string) => Promise<void> | void;

export interface SMSDelivery {
  available(scene: string): Promise<boolean> | boolean;
  sendCode(scene: string, phone: string, code: string): Promise<void>;
}

export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export interface RegisterRequest {
  loginContext?: LoginContext;
  username: string;
  email: string;
  emailCode: string;
  phone: string;
  smsCode: string;
  ticket: string;
  displayName: string;
  password: string;
  acceptedTerms: boolean;
  referralCode: string;
}

export interface LoginRequest {
  loginContext?: LoginContext;
  username: string;
  password: string;
  autoRegister: boolean;
}

export interface PublicAuthSettings extends VerificationPolicy {
  smsBindingAvailable: boolean;
  emailBindingAvailable: boolean;
  firstUser: boolean;
  registrationEnabled: boolean;
  linuxdoEnabled: boolean;
  emailEnabled: boolean;
  emailCodeRequired: boolean;
  emailRequired: boolean;
  emailVerificationRequired: boolean;
  agreementTitle?: string;
  agreementContent?: string;
  loginMode: LoginMode;
}

export interface AuthUser extends Omit<User, "passwordHash" | "avatarVersion"> {
  avatarUrl?: string;
  identityProvider?: string;
  identityId?: string;
  identityUsername?: string;
}

export interface AuthSessionResult {
  user: AuthUser;
  session: string;
  maxAgeSecs: number;
}

export class Service {
  mailSender: MailSender | null;
  sms: SMSDelivery | null = null;
  readonly emailCodeMutex = new Mutex();
  readonly registrationMutex = new Mutex();

  constructor(
    readonly repo: Repository,
    readonly host: Host = nopHost,
    mailSender: MailSender | null = null,
  ) {
    this.mailSender = mailSender;
  }

  setMailSender(sender: MailSender | null): void {
    this.mailSender = sender;
  }

  setSMSDelivery(delivery: SMSDelivery | null): void {
    this.sms = delivery;
  }

  // 以下方法由各迁移文件提供实现，保持与 Go 的方法集合一致。
  adminRegistrationSetting(actor: User | null): Promise<PublicRegistrationSetting> {
    return adminRegistrationSetting(this, actor);
  }

  updateRegistrationSetting(actor: User | null, req: RegistrationSettingRequest): Promise<PublicRegistrationSetting> {
    return updateRegistrationSetting(this, actor, req);
  }

  async registrationEnabled(): Promise<boolean> {
    return registrationEnabled(this);
  }

  agreementTitleForMessage(): Promise<string> {
    return agreementTitleForMessage(this);
  }

  registrationAgreement(): Promise<{ title: string; content: string }> {
    return registrationAgreement(this);
  }

  async publicAuthSettings(): Promise<PublicAuthSettings> {
    const count = await repoAccount.userCount(this.repo);
    if (count === 0) {
      // 首个管理员同样要看到服务协议，不能因为跳过注册校验就丢失协议字段。
      const agreement = await this.registrationAgreement();
      let loginMode: LoginMode = loginModeModal;
      const registration = await readRegistrationSetting(this);
      if (registration.error === null) loginMode = normalizeLoginMode(registration.value.loginMode);
      return {
        smsLogin: false,
        emailLogin: false,
        smsRegistration: false,
        emailRegistration: false,
        smsAndEmailRegistration: false,
        smsBindingAvailable: false,
        emailBindingAvailable: false,
        firstUser: true,
        registrationEnabled: true,
        linuxdoEnabled: false,
        emailEnabled: false,
        emailCodeRequired: false,
        emailRequired: false,
        emailVerificationRequired: false,
        agreementTitle: agreement.title,
        agreementContent: agreement.content,
        loginMode,
      };
    }
    const registration = await readRegistrationSetting(this);
    if (registration.error) throw registration.error;
    const emailEnabled = await this.emailEnabled();
    const policy = await verificationPolicy(this);
    const smsLogin = await this.smsAvailable("login");
    const smsRegister = await this.smsAvailable("register");
    const smsBind = await this.smsAvailable("bind");
    policy.smsLogin = policy.smsLogin && smsLogin;
    policy.emailLogin = policy.emailLogin && emailEnabled;
    policy.smsRegistration = policy.smsRegistration && smsRegister;
    policy.emailRegistration = policy.emailRegistration && emailEnabled;
    policy.smsAndEmailRegistration = policy.smsAndEmailRegistration && smsRegister && emailEnabled;
    const agreement = await this.registrationAgreement();
    return {
      ...policy,
      smsBindingAvailable: smsBind,
      emailBindingAvailable: emailEnabled,
      firstUser: false,
      registrationEnabled: registration.value.enabled,
      linuxdoEnabled: await this.linuxDOEnabled(),
      emailEnabled,
      emailCodeRequired:
        registrationValueVerificationRequired(registration.value) &&
        (policy.emailRegistration || policy.smsAndEmailRegistration),
      emailRequired: registrationValueEmailRequired(registration.value),
      emailVerificationRequired: registrationValueVerificationRequired(registration.value),
      agreementTitle: agreement.title,
      agreementContent: agreement.content,
      loginMode: normalizeLoginMode(registration.value.loginMode),
    };
  }

  async register(req: RegisterRequest): Promise<AuthSessionResult> {
    if (!req.acceptedTerms) {
      throw badAuthRequest(`请先同意${await this.agreementTitleForMessage()}`);
    }
    const usernameInput = req.username ?? "";
    const emailInput = req.email ?? "";
    const ticket = (req.ticket ?? "").trim();
    const emailCode = (req.emailCode ?? "").trim();
    const smsCode = (req.smsCode ?? "").trim();
    const phoneInput = (req.phone ?? "").trim();
    const referralCode = (req.referralCode ?? "").trim();
    const username = normalizeUsername(usernameInput);
    const email = normalizeEmail(emailInput);
    // 一体表单用邮箱作账号时不提交用户名，加锁后再按邮箱前缀生成。
    const generateUsername = username === "" && email !== "";
    if (!generateUsername) validateUsername(username);
    validatePassword(req.password);
    if (email !== "") validateEmail(email);
    return this.registrationMutex.run(async () => {
      const count = await repoAccount.userCount(this.repo);
      let verifiedCode: EmailVerificationCode | null = null;
      let verification: AuthVerification | null = null;
      let phone = "";
      if (count > 0) {
        const registration = await readRegistrationSetting(this);
        if (registration.error) throw registration.error;
        if (!registration.value.enabled) throw forbidden("管理员未开放新用户注册");
        if (registrationValueEmailRequired(registration.value) && email === "") throw badAuthRequest("请输入邮箱");
        if (email !== "") await this.validateRegistrationEmailDomain(email);
        if (ticket !== "") {
          verification = await verifyTicket(this, "register", {
            ticket,
            emailCode,
            smsCode,
          });
          // 短信验证时邮箱可以另填，按未验证保存；邮箱验证时提交的邮箱必须与验证码一致。
          if (
            (verification.email !== "" && verification.email !== email) ||
            (verification.email === "" && verification.method !== "sms") ||
            (verification.phone !== "" &&
              phoneInput !== verification.phone &&
              `+86${phoneInput}` !== verification.phone) ||
            (verification.phone === "" && phoneInput !== "")
          ) {
            throw invalidVerification();
          }
          phone = verification.phone;
          await this.contactAvailable(email, phone, "");
        } else if (registrationValueVerificationRequired(registration.value)) {
          const policy = await verificationPolicy(this);
          if (!policyAllows(policy, "register", "email") || phoneInput !== "") {
            throw badAuthRequest("请先获取本次注册验证码");
          }
          if (email === "") throw badAuthRequest("请输入邮箱");
          verifiedCode = await this.verifyRegistrationEmailCode(email, emailCode);
        }
      }
      const finalUsername = generateUsername ? await this.usernameFromEmail(email) : username;
      const displayName = normalizeDisplayName(req.displayName ?? "", finalUsername);
      if (await repoAccount.userByUsername(this.repo, finalUsername)) {
        throw badAuthRequest("用户名已存在");
      }
      if (email !== "") await checkEmailAvailable(this.repo, email, "");
      const passwordHash = await hashPassword(req.password);
      const now = new Date().toISOString();
      const user: User = {
        id: newId(),
        username: finalUsername,
        email,
        phone,
        displayName,
        avatarMode: "",
        role: userRoleUser,
        status: userStatusActive,
        isPromoter: false,
        userGroup: "",
        passwordHash,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      };
      if (count === 0) user.role = userRoleAdmin;
      if (verification) {
        if (verification.email !== "") user.emailVerifiedAt = now;
        if (phone !== "") user.phoneVerifiedAt = now;
        try {
          await createUserWithVerification(this.repo, user, verification.id);
        } catch (error) {
          if (error === errVerificationInvalid) throw invalidVerification();
          throw error;
        }
      } else if (verifiedCode) {
        user.emailVerifiedAt = now;
        await createUserWithEmailVerification(this.repo, user, verifiedCode.id, new Date().toISOString());
      } else {
        await createRegisteredUser(this.repo, user);
      }
      await this.host.ensureSignupBonus(user.id);
      if (count > 0) this.host.bindReferral(user.id, referralCode);
      const event = newLoginLog("password", "registration", req.loginContext ?? { ip: "", userAgent: "" });
      try {
        return await this.createAuthSession(user, event);
      } catch (error) {
        throw await this.recordLoginFailure(event, error);
      }
    });
  }

  async loginRateLimitSubject(accountInput: string): Promise<string> {
    const account = accountInput.trim();
    const user = await repoAccount.userByAccount(this.repo, account);
    if (!user) return `input:${account.toLowerCase()}`;
    return `user:${user.id}`;
  }

  async login(req: LoginRequest): Promise<AuthSessionResult> {
    const event = newLoginLog("password", "login", req.loginContext ?? { ip: "", userAgent: "" });
    event.account = maskLoginAccount(req.username ?? "");
    try {
      const account = (req.username ?? "").trim();
      const user = await repoAccount.userByAccount(this.repo, account);
      if (!user) {
        if (req.autoRegister) await this.accountNotRegistered(account);
        throw unauthorized("用户名、邮箱或密码不正确");
      }
      loginLogUser(event, user);
      if (user.status !== userStatusActive) throw forbidden("该账号已被禁用");
      if (!(await verifyPassword(req.password ?? "", user.passwordHash ?? ""))) {
        throw unauthorized("用户名、邮箱或密码不正确");
      }
      const now = new Date().toISOString();
      user.lastLoginAt = now;
      user.updatedAt = now;
      await repoAccount.updateUserLoginTime(this.repo, user.id, now);
      return await this.createAuthSession(user, event);
    } catch (error) {
      throw await this.recordLoginFailure(event, error);
    }
  }

  /**
   * 只在允许创建账号且输入可以作为用户名或邮箱注册时返回 account_not_registered；
   * 注册关闭时保持原来的“用户名、邮箱或密码不正确”，不额外暴露账号是否存在。
   */
  async accountNotRegistered(account: string): Promise<void> {
    const count = await repoAccount.userCount(this.repo);
    if (count > 0) {
      const enabled = await this.registrationEnabled();
      if (!enabled) return;
    }
    let kind = "username";
    if (account.includes("@")) {
      if (!isValidEmail(normalizeEmail(account))) return;
      kind = "email";
    } else if (!usernamePattern.test(account)) {
      return;
    }
    throw new AppError({
      status: 404,
      code: codeAccountNotRegistered,
      reason: "account_not_registered",
      message: "该账号尚未注册，确认密码后即可创建账号",
      details: { accountKind: kind },
    });
  }

  /** 用邮箱前缀生成可用用户名；邮箱一体注册时用户不再单独填写用户名。 */
  async usernameFromEmail(email: string): Promise<string> {
    const local = email.split("@")[0] ?? "";
    let base = local.replace(usernameInvalidChars, "-").replace(/^-+|-+$/g, "").replace(/^_+|_+$/g, "");
    if (base.length > 24) base = base.slice(0, 24);
    while (base.length < 3) base += "0";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${randomToken().slice(0, 6)}`;
      if (!(await repoAccount.userByUsername(this.repo, candidate))) return candidate;
    }
    throw newAppError(409, "无法生成可用的用户名，请改用用户名注册");
  }

  async logout(cookieValue: string, context?: LoginContext): Promise<void> {
    const [sessionId, token] = parseSessionCookie(cookieValue);
    if (sessionId === "" || token === "") return;
    const event = newLoginLog("unknown", "logout", context ?? { ip: "", userAgent: "" });
    event.event = "logout";
    event.sessionRef = hashToken(sessionId);
    try {
      await revokeAuthSessionWithLog(this.repo, sessionId, hashToken(token), event);
    } catch (error) {
      throw await this.recordLoginFailure(event, error);
    }
  }

  async currentUser(cookieValue: string): Promise<User> {
    const [sessionId, token] = parseSessionCookie(cookieValue);
    if (sessionId === "" || token === "") throw unauthorized("请先登录");
    const session = await repoAccount.authSession(this.repo, sessionId);
    if (!session) throw unauthorized("登录状态已失效");
    if (new Date(session.expiresAt).getTime() <= Date.now() || session.tokenHash !== hashToken(token)) {
      await repoAccount.deleteAuthSession(this.repo, sessionId);
      throw unauthorized("登录状态已失效");
    }
    const user = await repoAccount.userById(this.repo, session.userId);
    if (!user) throw recordNotFound;
    if (user.status !== userStatusActive) throw forbidden("该账号已被禁用");
    return user;
  }

  /** 认证响应只补充当前用户自己的第三方公开身份，不把身份表或密钥字段暴露给其他列表接口。 */
  async publicAuthUser(user: User): Promise<AuthUser> {
    const result: AuthUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      emailVerifiedAt: user.emailVerifiedAt,
      phoneVerifiedAt: user.phoneVerifiedAt,
      displayName: user.displayName,
      avatarMode: user.avatarMode,
      avatarPreset: user.avatarPreset,
      role: user.role,
      status: user.status,
      isPromoter: user.isPromoter,
      userGroup: user.userGroup,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
    if (user.avatarMode === "custom") result.avatarUrl = profileAvatarUrl(user);
    let identity;
    try {
      identity = await userIdentityForUser(this.repo, user.id, "linuxdo");
    } catch (error) {
      if (error === recordNotFound) return result;
      throw error;
    }
    if (!identity) return result;
    if (user.avatarMode === "") result.avatarUrl = identity.avatarUrl;
    result.identityProvider = identity.provider;
    result.identityId = identity.subject;
    result.identityUsername = identity.providerUsername;
    return result;
  }

  async createAuthSession(user: User, event: LoginLog): Promise<AuthSessionResult> {
    loginLogUser(event, user);
    const publicUser = await this.publicAuthUser(user);
    const token = randomToken();
    const now = new Date();
    const session: AuthSession = {
      id: newId(),
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + sessionMaxAgeMs).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    event.sessionRef = hashToken(session.id);
    event.createdAt = now.toISOString();
    try {
      await repoAccount.createAuthSessionForUser(this.repo, user, session, [event]);
    } catch (error) {
      throw profileWriteError(error);
    }
    this.host.recordActivity(user.id, "login", 1);
    return {
      user: publicUser,
      session: `${session.id}.${token}`,
      maxAgeSecs: Math.trunc(sessionMaxAgeMs / 1000),
    };
  }

  /** 账号设置类操作要求 cookie 与 actor 指向同一会话，避免复用其他会话的凭据。 */
  async profileSession(actor: User | null, cookie: string): Promise<{ user: User; session: AuthSession }> {
    if (!actor || actor.id === "") throw unauthorized("请先登录");
    const [id, token] = parseSessionCookie(cookie);
    if (id === "" || token === "") throw unauthorized("登录状态已失效");
    const session = await repoAccount.authSession(this.repo, id);
    if (!session) throw unauthorized("登录状态已失效");
    if (session.userId !== actor.id || new Date(session.expiresAt).getTime() <= Date.now() || session.tokenHash !== hashToken(token)) {
      throw unauthorized("登录状态已失效");
    }
    const user = await repoAccount.userById(this.repo, actor.id);
    if (!user) throw recordNotFound;
    if (user.status !== userStatusActive) throw forbidden("该账号已被禁用");
    return { user, session };
  }

  // 账号设置方法由 account.ts 提供实现。
  userProfile(actor: User | null, cookie: string): Promise<import("./account").UserProfile> {
    return import("./account").then((module) => module.userProfile(this, actor, cookie));
  }

  changeProfilePassword(actor: User | null, cookie: string, req: import("./account").ProfilePasswordRequest): Promise<void> {
    return import("./account").then((module) => module.changeProfilePassword(this, actor, cookie, req));
  }

  sendProfileEmailCode(
    actor: User | null,
    cookie: string,
    req: import("./account").ProfileEmailCodeRequest,
  ): Promise<import("./verification").VerificationTicket> {
    return import("./account").then((module) => module.sendProfileEmailCode(this, actor, cookie, req));
  }

  changeProfileEmail(
    actor: User | null,
    cookie: string,
    req: import("./account").ProfileEmailChangeRequest,
  ): Promise<import("./account").ProfileEmailChangeResult> {
    return import("./account").then((module) => module.changeProfileEmail(this, actor, cookie, req));
  }

  // Linux.do OAuth 方法由 linuxdo.ts 提供实现。
  adminLinuxDOSetting(actor: User | null): Promise<import("./linuxdo").PublicLinuxDOSetting> {
    return import("./linuxdo").then((module) => module.adminLinuxDOSetting(this, actor));
  }

  updateLinuxDOSetting(
    actor: User | null,
    req: import("./linuxdo").LinuxDOSettingRequest,
  ): Promise<import("./linuxdo").PublicLinuxDOSetting> {
    return import("./linuxdo").then((module) => module.updateLinuxDOSetting(this, actor, req));
  }

  beginLinuxDOLogin(nextPath: string, acceptedTerms: boolean): Promise<string> {
    return import("./linuxdo").then((module) => module.beginLinuxDOLogin(this, nextPath, acceptedTerms));
  }

  beginLinuxDOReauthentication(actor: User | null, cookie: string): Promise<string> {
    return import("./linuxdo").then((module) => module.beginLinuxDOReauthentication(this, actor, cookie));
  }

  linuxDOReauthenticationState(stateValue: string): Promise<boolean> {
    return import("./linuxdo").then((module) => module.linuxDOReauthenticationState(this, stateValue));
  }

  completeLinuxDOLogin(
    stateValue: string,
    code: string,
    cookieValue: string,
    context?: LoginContext,
  ): Promise<import("./linuxdo").LinuxDOCallbackResult> {
    return import("./linuxdo").then((module) => module.completeLinuxDOLogin(this, stateValue, code, cookieValue, context));
  }

  // LibTV / TapNow 导入方法由对应文件提供实现。
  adminLibTVSetting(actor: User | null): Promise<import("./libtv").PublicLibTVSetting> {
    return import("./libtv").then((module) => module.adminLibTVSetting(this, actor));
  }

  updateLibTVSetting(
    actor: User | null,
    req: import("./libtv").LibTVSettingRequest,
  ): Promise<import("./libtv").PublicLibTVSetting> {
    return import("./libtv").then((module) => module.updateLibTVSetting(this, actor, req));
  }

  testLibTV(actor: User | null, projectUuid: string): Promise<void> {
    return import("./libtv").then((module) => module.testLibTV(this, actor, projectUuid));
  }

  importLibTV(userId: string, canvasProjectId: string, projectUuid: string): Promise<import("./libtv").LibTVImportResult> {
    return import("./libtv").then((module) => module.importLibTV(this, userId, canvasProjectId, projectUuid));
  }

  importTapNow(userId: string, canvasProjectId: string, shareId: string): Promise<import("./tapnow").TapNowImportResult> {
    return import("./tapnow").then((module) => module.importTapNow(this, userId, canvasProjectId, shareId));
  }

  // 邮箱相关方法与验证方法由对应文件提供实现。
  emailEnabled(): Promise<boolean> {
    return import("./email").then((module) => module.emailEnabled(this));
  }

  smsAvailable(scene: string): Promise<boolean> {
    return import("./verificationPolicy").then((module) => module.smsAvailable(this, scene));
  }

  verifyRegistrationEmailCode(email: string, code: string): Promise<EmailVerificationCode> {
    return import("./email").then((module) => module.verifyRegistrationEmailCode(this, email, code));
  }

  sendRegistrationEmailCode(email: string): Promise<void> {
    return import("./email").then((module) => module.sendRegistrationEmailCode(this, email));
  }

  linuxDOEnabled(): Promise<boolean> {
    return import("./linuxdo").then((module) => module.linuxDOEnabled(this));
  }

  contactAvailable(email: string, phone: string, ownId: string): Promise<void> {
    return import("./verification").then((module) => module.contactAvailable(this, email, phone, ownId));
  }

  validateRegistrationEmailDomain(email: string): Promise<void> {
    return import("./email").then((module) => module.validateRegistrationEmailDomain(this, email));
  }

  recordLoginFailure(event: LoginLog, original: unknown): Promise<unknown> {
    return recordLoginFailure(this, event, original);
  }

  recordRejectedLogin(method: string, context: LoginContext, status: number): Promise<void> {
    return recordRejectedLogin(this, method, context, status);
  }

  startVerification(actor: User | null, req: VerificationRequest): Promise<VerificationTicket> {
    return startVerification(this, actor, req);
  }

  loginVerification(req: VerificationConfirm): Promise<AuthSessionResult> {
    return loginVerification(this, req);
  }

  bindVerification(actor: User | null, req: VerificationConfirm): Promise<AuthUser> {
    return bindVerification(this, actor, req);
  }

  sendPasswordResetEmailCode(email: string): Promise<void> {
    return sendPasswordResetEmailCode(this, email);
  }

  resetPassword(req: PasswordResetRequest): Promise<void> {
    return resetPassword(this, req);
  }

  updateProfileAvatar(actor: User | null, data: Uint8Array | null): Promise<AuthUser> {
    return updateProfileAvatar(this, actor, data);
  }

  useDefaultProfileAvatar(actor: User | null): Promise<AuthUser> {
    return useDefaultProfileAvatar(this, actor);
  }

  selectDefaultProfileAvatar(actor: User | null, preset: string): Promise<AuthUser> {
    return selectDefaultProfileAvatar(this, actor, preset);
  }

  profileAvatarContent(actor: User | null, targetUserId: string): Promise<Uint8Array> {
    return profileAvatarContent(this, actor, targetUserId);
  }

  adminEmailSetting(actor: User | null): Promise<PublicEmailSetting> {
    return adminEmailSetting(this, actor);
  }

  updateEmailSetting(actor: User | null, req: EmailSettingRequest): Promise<PublicEmailSetting> {
    return updateEmailSetting(this, actor, req);
  }

  adminEmailLogs(actor: User | null, query: EmailLogQuery, page: number, pageSize: number): Promise<EmailLogPage> {
    return adminEmailLogs(this, actor, query, page, pageSize);
  }

  sendTestEmail(actor: User | null, recipient: string): Promise<void> {
    return sendTestEmail(this, actor, recipient);
  }

  cleanupEmailLogs(): Promise<number> {
    return cleanupEmailLogs(this);
  }

  adminVerificationPolicy(actor: User | null): Promise<VerificationPolicy> {
    return adminVerificationPolicy(this, actor);
  }

  updateVerificationPolicy(actor: User | null, policy: VerificationPolicy): Promise<VerificationPolicy> {
    return updateVerificationPolicy(this, actor, policy);
  }

  sendSystemEmail(delivery: EmailDelivery): Promise<void> {
    return sendSystemEmail(this, delivery);
  }

  emailBrandName(): Promise<string> {
    return emailBrandName(this);
  }
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function randomToken(): string {
  return randomBytes(32).toString("hex");
}

export function parseSessionCookie(value: string): [string, string] {
  const index = value.indexOf(".");
  if (index < 0) return ["", ""];
  return [value.slice(0, index).trim(), value.slice(index + 1).trim()];
}

export function normalizeUsername(value: string): string {
  return value.trim();
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeDisplayName(value: string, fallback: string): string {
  let name = value.trim();
  if (name === "") name = fallback;
  const chars = Array.from(name);
  if (chars.length > 40) name = chars.slice(0, 40).join("");
  return name;
}

export function validateUsername(value: string): void {
  if (!usernamePattern.test(value)) throw badAuthRequest("用户名需为 3-32 位字母、数字、下划线或连字符");
}

export function validatePassword(value: string): void {
  if (Array.from(value).length < 8) throw badAuthRequest("密码至少 8 位");
}

export function isValidEmail(value: string): boolean {
  // ACT: 近似 net/mail.ParseAddress；只拦截明显非法输入，不追求 RFC 5322 全量解析。
  return value !== "" && !/\s/.test(value) && /^[^@]+@[^@]+$/.test(value);
}

export function validateEmail(value: string): void {
  if (!isValidEmail(value)) throw badAuthRequest("邮箱格式不正确");
}

export function invalidVerification(): AppError {
  return badAuthRequest("验证码错误、已失效或验证次数已用完，请重新获取");
}

export function profileWriteError(error: unknown): unknown {
  if (error instanceof Error && error.message === "账号或身份验证状态已变化，请重新登录或验证") {
    return unauthorized(error.message);
  }
  if (error === errVerificationInvalid) return invalidVerification();
  return error;
}

export function profileAvatarUrl(user: User): string {
  return `/api/auth/profile/avatar/${encodeURIComponent(user.id)}?v=${encodeURIComponent(user.avatarVersion ?? "")}`;
}

export { maskLoginAccount };
