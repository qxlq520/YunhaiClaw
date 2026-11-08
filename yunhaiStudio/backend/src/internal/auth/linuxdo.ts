// 对应 backend/internal/auth/linuxdo.go
// Linux.do OAuth 配置、授权跳转、回调登录与重新验证。

import { createHash } from "node:crypto";
import {
  badAuthRequest,
  firstNonEmpty,
  forbidden,
  newId,
  truncateRunes,
  unauthorized,
  uniqueNonEmpty,
} from "@/internal/kernel/errors";
import type { AuthSession, OAuthState, User, UserIdentity } from "@/internal/model/modelsIdentity";
import type { SystemSetting } from "@/internal/model/modelsPlatform";
import { outboundFetch, validateOutboundUrl } from "@/internal/outbound/outbound";
import {
  createOAuthState,
  createOAuthUser,
  consumeOAuthState,
  userIdentity,
  userIdentityForUser,
} from "@/internal/repository/oauth";
import {
  linuxDOReauthenticationState as readReauthenticationState,
  reauthenticateLinuxDOSession,
  updateUserLoginTime,
  userById,
  userByEmail,
  userCount,
  userByUsername,
} from "@/internal/repository/account";
import { saveSetting, setting as readSetting } from "@/internal/repository/setting";
import { recordNotFound } from "@/internal/repository/repository";
import { loginLogUser, newLoginLog, recordLoginFailure, type LoginContext } from "./loginLogs";
import {
  hashToken,
  isValidEmail,
  normalizeDisplayName,
  normalizeEmail,
  profileWriteError,
  randomToken,
  type AuthSessionResult,
  type Service,
} from "./authService";
import { agreementTitleForMessage, registrationEnabled } from "./registration";
import { verificationPolicy } from "./verificationPolicy";
import { userRoleUser, userStatusActive } from "@/internal/model/models";

export const linuxDOSettingKey = "linuxdo_oauth";

const oauthUsernameSanitizer = /[^a-zA-Z0-9_-]+/g;

export interface LinuxDOSettingRequest {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  redirectUrl: string;
  scopes: string[] | null;
  clientAuthMethod: string;
  subjectField: string;
  usernameField: string;
  displayNameField: string;
  emailField: string;
  avatarField: string;
}

export interface PublicLinuxDOSetting {
  enabled: boolean;
  clientId: string;
  hasClientSecret: boolean;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  redirectUrl: string;
  scopes: string[];
  clientAuthMethod: string;
  subjectField: string;
  usernameField: string;
  displayNameField: string;
  emailField: string;
  avatarField: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface LinuxDOSettingValue {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  redirectUrl: string;
  scopes: string[];
  clientAuthMethod: string;
  subjectField: string;
  usernameField: string;
  displayNameField: string;
  emailField: string;
  avatarField: string;
}

export interface LinuxDOCallbackResult {
  session?: AuthSessionResult;
  next: string;
  reauthenticated: boolean;
}

export async function adminLinuxDOSetting(service: Service, actor: User | null): Promise<PublicLinuxDOSetting> {
  await service.host.requireAdmin(actor);
  const read = await readLinuxDOSetting(service);
  return publicLinuxDOSetting(read.setting, read.value);
}

export async function updateLinuxDOSetting(
  service: Service,
  actor: User | null,
  req: LinuxDOSettingRequest,
): Promise<PublicLinuxDOSetting> {
  await service.host.requireAdmin(actor);
  const current = await readLinuxDOSetting(service);
  const next = normalizeLinuxDOSetting({
    enabled: req.enabled,
    clientId: req.clientId,
    clientSecret: req.clientSecret,
    authorizationUrl: req.authorizationUrl,
    tokenUrl: req.tokenUrl,
    userInfoUrl: req.userInfoUrl,
    redirectUrl: req.redirectUrl,
    scopes: req.scopes ?? [],
    clientAuthMethod: req.clientAuthMethod,
    subjectField: req.subjectField,
    usernameField: req.usernameField,
    displayNameField: req.displayNameField,
    emailField: req.emailField,
    avatarField: req.avatarField,
  });
  if (next.clientSecret === "") next.clientSecret = current.value.clientSecret;
  validateLinuxDOSetting(next);
  const stored: LinuxDOSettingValue = {
    ...next,
    clientSecret: await service.host.encryptSecret(next.clientSecret),
  };
  await saveSetting(service.repo, linuxDOSettingKey, JSON.stringify(stored), actor ? actor.id : "");
  const saved = await readSetting(service.repo, linuxDOSettingKey);
  return publicLinuxDOSetting(saved, next);
}

export async function linuxDOEnabled(service: Service): Promise<boolean> {
  const read = await readLinuxDOSetting(service);
  return read.value.enabled;
}

export async function beginLinuxDOLogin(service: Service, nextPath: string, acceptedTerms: boolean): Promise<string> {
  const count = await userCount(service.repo);
  if (count === 0) throw forbidden("请先创建本地管理员账号，再开放 Linux.do 登录");
  const read = await readLinuxDOSetting(service);
  if (!read.value.enabled) throw forbidden("Linux.do 登录尚未启用");
  return beginLinuxDOAuthorization(service, read.value, {
    id: "",
    provider: "",
    stateHash: "",
    codeVerifier: "",
    nextPath: safeOAuthNext(nextPath),
    acceptedTerms,
    expiresAt: "",
    usedAt: null,
    createdAt: "",
  });
}

export async function beginLinuxDOReauthentication(
  service: Service,
  actor: User | null,
  cookie: string,
): Promise<string> {
  const { user, session } = await service.profileSession(actor, cookie);
  if (!(await userIdentityForUser(service.repo, user.id, "linuxdo"))) {
    throw forbidden("该账号没有关联 Linux.do 身份");
  }
  const read = await readLinuxDOSetting(service);
  if (!read.value.enabled) throw forbidden("Linux.do 登录尚未启用");
  return beginLinuxDOAuthorization(service, read.value, {
    id: "",
    provider: "",
    stateHash: "",
    codeVerifier: "",
    nextPath: "/settings?section=profile&reauth=success",
    acceptedTerms: false,
    expiresAt: "",
    usedAt: null,
    createdAt: "",
    reauthUserId: user.id,
    reauthSessionId: session.id,
  });
}

export async function linuxDOReauthenticationState(service: Service, stateValue: string): Promise<boolean> {
  if (stateValue.trim() === "") return false;
  return readReauthenticationState(service.repo, hashToken(stateValue));
}

async function beginLinuxDOAuthorization(
  service: Service,
  settingValue: LinuxDOSettingValue,
  record: OAuthState,
): Promise<string> {
  const state = randomToken();
  const verifier = randomToken();
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const now = new Date();
  record.id = newId();
  record.provider = "linuxdo";
  record.stateHash = hashToken(state);
  record.codeVerifier = verifier;
  record.expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  record.createdAt = now.toISOString();
  await createOAuthState(service.repo, record);
  const authorizeUrl = new URL(settingValue.authorizationUrl);
  authorizeUrl.searchParams.set("client_id", settingValue.clientId);
  authorizeUrl.searchParams.set("redirect_uri", settingValue.redirectUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  if (settingValue.scopes.length > 0) authorizeUrl.searchParams.set("scope", settingValue.scopes.join(" "));
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  return authorizeUrl.toString();
}

export async function completeLinuxDOLogin(
  service: Service,
  stateValue: string,
  code: string,
  cookieValue: string,
  context: LoginContext = { ip: "", userAgent: "" },
): Promise<LinuxDOCallbackResult> {
  const event = newLoginLog("linuxdo", "login", context);
  let logFailure = true;
  try {
    if (stateValue.trim() !== "") {
      const reauth = await linuxDOReauthenticationState(service, stateValue);
      logFailure = !reauth;
    }
    if (stateValue.trim() === "" || code.trim() === "") {
      throw badAuthRequest("Linux.do 登录回调缺少必要参数");
    }
    let state: OAuthState | null = null;
    try {
      state = await consumeOAuthState(service.repo, "linuxdo", hashToken(stateValue));
    } catch (error) {
      if (error === recordNotFound || (error as Error).message === recordNotFound.message) {
        throw badAuthRequest("Linux.do 登录状态无效或已过期");
      }
      throw error;
    }
    if (!state) throw badAuthRequest("Linux.do 登录状态无效或已过期");
    logFailure = (state.reauthUserId ?? "") === "" && (state.reauthSessionId ?? "") === "";
    const read = await readLinuxDOSetting(service);
    if (!read.value.enabled) throw forbidden("Linux.do 登录尚未启用");
    let reauthUser: User | null = null;
    let reauthSession: AuthSession | null = null;
    if ((state.reauthUserId ?? "") !== "" || (state.reauthSessionId ?? "") !== "") {
      if (cookieValue === "") throw unauthorized("重新验证需要当前登录会话");
      const result = await service.profileSession({ id: state.reauthUserId ?? "" } as User, cookieValue);
      reauthUser = result.user;
      reauthSession = result.session;
      if (reauthSession.id !== state.reauthSessionId) {
        throw unauthorized("重新验证与当前登录会话不匹配");
      }
    }
    const accessToken = await exchangeLinuxDOCode(read.value, code, state.codeVerifier ?? "");
    const profile = await fetchLinuxDOProfile(read.value, accessToken);
    const subject = profileString(profile, read.value.subjectField);
    if (subject === "") throw new Error("Linux.do 用户信息缺少稳定用户 ID");
    if (reauthUser && reauthSession) {
      try {
        await reauthenticateLinuxDOSession(service.repo, reauthUser, reauthSession, subject, new Date().toISOString());
      } catch (error) {
        throw profileWriteError(error);
      }
      return { next: "/settings?section=profile&reauth=success", reauthenticated: true };
    }
    const providerUsername = profileString(profile, read.value.usernameField);
    const displayName = firstNonEmpty(profileString(profile, read.value.displayNameField), providerUsername, "Linux.do 用户");
    const avatarUrl = profileString(profile, read.value.avatarField);
    const identityRecord = await userIdentity(service.repo, "linuxdo", subject);
    let user: User | null;
    if (identityRecord) {
      user = await userById(service.repo, identityRecord.userId);
      if (!user) throw new Error("record not found");
      identityRecord.providerUsername = providerUsername;
      identityRecord.avatarUrl = avatarUrl;
      identityRecord.updatedAt = new Date().toISOString();
      await saveIdentity(service, identityRecord);
    } else {
      event.source = "registration";
      const policy = await verificationPolicy(service);
      if (policy.smsAndEmailRegistration) {
        throw forbidden("平台要求短信和邮箱验证，请先通过注册页面创建账号；第三方登录不能绕过双重验证");
      }
      if (!(await registrationEnabled(service))) throw forbidden("管理员未开放新用户注册");
      if (!state.acceptedTerms) {
        throw badAuthRequest(`请先同意${await agreementTitleForMessage(service)}`);
      }
      const created = await createLinuxDOUser(
        service,
        subject,
        providerUsername,
        displayName,
        profileString(profile, read.value.emailField),
        avatarUrl,
      );
      user = created.user;
      await createOAuthUser(service.repo, created.user, created.identity);
      await service.host.ensureSignupBonus(created.user.id);
    }
    loginLogUser(event, user);
    if (user.status !== userStatusActive) throw forbidden("该账号已被禁用");
    const now = new Date().toISOString();
    user.lastLoginAt = now;
    user.updatedAt = now;
    await updateUserLoginTime(service.repo, user.id, now);
    const session = await service.createAuthSession(user, event);
    return { session, next: safeOAuthNext(state.nextPath), reauthenticated: false };
  } catch (error) {
    if (logFailure) throw await recordLoginFailure(service, event, error);
    throw error;
  }
}

/** ACT: 仅更新第三方公开资料字段；完整身份记录写入仍复用 repository 的 upsert 事务。 */
async function saveIdentity(service: Service, identity: UserIdentity): Promise<void> {
  await service.repo.db.run(
    'UPDATE "user_identities" SET "provider_username" = ?, "avatar_url" = ?, "updated_at" = ? WHERE "id" = ?',
    [identity.providerUsername, identity.avatarUrl, identity.updatedAt, identity.id],
  );
}

async function createLinuxDOUser(
  service: Service,
  subject: string,
  providerUsername: string,
  displayName: string,
  rawEmail: string,
  avatarUrl: string,
): Promise<{ user: User; identity: UserIdentity }> {
  let base = providerUsername.trim().replace(oauthUsernameSanitizer, "_");
  base = base.replace(/^[_-]+|[_-]+$/g, "");
  if (Array.from(base).length < 3) base = `linuxdo_${shortSubject(subject)}`;
  if (Array.from(base).length > 24) base = Array.from(base).slice(0, 24).join("");
  let username = base;
  if ((await userByUsername(service.repo, username)) !== null) {
    username = `${truncateRunes(base, 23)}_${shortSubject(subject)}`;
  }
  let email = normalizeEmail(rawEmail);
  if (email !== "") {
    if (!isValidEmail(email)) email = "";
    else if ((await userByEmail(service.repo, email)) !== null) email = "";
  }
  const now = new Date().toISOString();
  const user: User = {
    id: newId(),
    username,
    email,
    displayName: normalizeDisplayName(displayName, username),
    avatarMode: "",
    role: userRoleUser,
    status: userStatusActive,
    isPromoter: false,
    userGroup: "",
    passwordHash: "",
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const identity: UserIdentity = {
    id: newId(),
    userId: user.id,
    provider: "linuxdo",
    subject,
    providerUsername,
    avatarUrl,
    createdAt: now,
    updatedAt: now,
  };
  return { user, identity };
}

async function readLinuxDOSetting(
  service: Service,
): Promise<{ setting: SystemSetting | null; value: LinuxDOSettingValue }> {
  const saved = await readSetting(service.repo, linuxDOSettingKey);
  if (!saved) return { setting: null, value: defaultLinuxDOSetting() };
  const value = defaultLinuxDOSetting();
  if (saved.valueJson.trim() !== "") {
    let parsed: Partial<LinuxDOSettingValue>;
    try {
      parsed = JSON.parse(saved.valueJson) as Partial<LinuxDOSettingValue>;
    } catch {
      throw new Error("Linux.do OAuth 配置格式无效");
    }
    Object.assign(value, parsed);
  }
  value.clientSecret = await service.host.decryptSecret(value.clientSecret);
  return { setting: saved, value: normalizeLinuxDOSetting(value) };
}

export function validateLinuxDOSetting(value: LinuxDOSettingValue): void {
  if (!value.enabled) return;
  if (
    value.clientId === "" ||
    value.clientSecret === "" ||
    value.authorizationUrl === "" ||
    value.tokenUrl === "" ||
    value.userInfoUrl === "" ||
    value.redirectUrl === ""
  ) {
    throw badAuthRequest("启用 Linux.do 登录前请完整填写 Client、端点和回调配置");
  }
  for (const rawUrl of [value.authorizationUrl, value.tokenUrl, value.userInfoUrl]) {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw badAuthRequest("Linux.do 授权、Token 和用户信息地址必须是有效的 HTTPS URL");
    }
    if (parsed.protocol !== "https:" || parsed.host === "") {
      throw badAuthRequest("Linux.do 授权、Token 和用户信息地址必须是有效的 HTTPS URL");
    }
  }
  let redirectUrl: URL;
  try {
    redirectUrl = new URL(value.redirectUrl);
  } catch {
    throw badAuthRequest("Linux.do 回调地址必须使用 HTTPS，本地回环地址可使用 HTTP");
  }
  const loopbackHttp = redirectUrl.protocol === "http:" && isLoopbackOAuthHost(redirectUrl.hostname);
  if (redirectUrl.host === "" || (redirectUrl.protocol !== "https:" && !loopbackHttp)) {
    throw badAuthRequest("Linux.do 回调地址必须使用 HTTPS，本地回环地址可使用 HTTP");
  }
  if (value.clientAuthMethod !== "client_secret_post" && value.clientAuthMethod !== "client_secret_basic") {
    throw badAuthRequest("请选择有效的 OAuth 客户端鉴权方式");
  }
}

export function isLoopbackOAuthHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

export function normalizeLinuxDOSetting(value: LinuxDOSettingValue): LinuxDOSettingValue {
  const normalized: LinuxDOSettingValue = {
    enabled: value.enabled,
    clientId: value.clientId.trim(),
    clientSecret: value.clientSecret.trim(),
    authorizationUrl: value.authorizationUrl.trim(),
    tokenUrl: value.tokenUrl.trim(),
    userInfoUrl: value.userInfoUrl.trim(),
    redirectUrl: value.redirectUrl.trim(),
    scopes: uniqueNonEmpty(value.scopes),
    clientAuthMethod: value.clientAuthMethod.trim(),
    subjectField: value.subjectField.trim(),
    usernameField: value.usernameField.trim(),
    displayNameField: value.displayNameField.trim(),
    emailField: value.emailField.trim(),
    avatarField: value.avatarField.trim(),
  };
  if (normalized.clientAuthMethod === "") normalized.clientAuthMethod = "client_secret_post";
  if (normalized.subjectField === "") normalized.subjectField = "id";
  if (normalized.usernameField === "") normalized.usernameField = "username";
  if (normalized.displayNameField === "") normalized.displayNameField = "name";
  if (normalized.emailField === "") normalized.emailField = "email";
  if (normalized.avatarField === "") normalized.avatarField = "avatar_url";
  return normalized;
}

export function defaultLinuxDOSetting(): LinuxDOSettingValue {
  return normalizeLinuxDOSetting({
    enabled: false,
    clientId: "",
    clientSecret: "",
    authorizationUrl: "",
    tokenUrl: "",
    userInfoUrl: "",
    redirectUrl: "",
    scopes: [],
    clientAuthMethod: "",
    subjectField: "",
    usernameField: "",
    displayNameField: "",
    emailField: "",
    avatarField: "",
  });
}

export function publicLinuxDOSetting(
  setting: SystemSetting | null,
  value: LinuxDOSettingValue,
): PublicLinuxDOSetting {
  return {
    enabled: value.enabled,
    clientId: value.clientId,
    hasClientSecret: value.clientSecret !== "",
    authorizationUrl: value.authorizationUrl,
    tokenUrl: value.tokenUrl,
    userInfoUrl: value.userInfoUrl,
    redirectUrl: value.redirectUrl,
    scopes: value.scopes,
    clientAuthMethod: value.clientAuthMethod,
    subjectField: value.subjectField,
    usernameField: value.usernameField,
    displayNameField: value.displayNameField,
    emailField: value.emailField,
    avatarField: value.avatarField,
    updatedBy: setting?.updatedBy ?? "",
    createdAt: setting?.createdAt ?? "",
    updatedAt: setting?.updatedAt ?? "",
  };
}

async function exchangeLinuxDOCode(setting: LinuxDOSettingValue, code: string, verifier: string): Promise<string> {
  validateOutboundUrl(setting.tokenUrl);
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: setting.clientId,
    redirect_uri: setting.redirectUrl,
    code_verifier: verifier,
  });
  if (setting.clientAuthMethod === "client_secret_post") form.set("client_secret", setting.clientSecret);
  const headers = new Headers({
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  });
  if (setting.clientAuthMethod === "client_secret_basic") {
    headers.set(
      "authorization",
      `Basic ${Buffer.from(`${setting.clientId}:${setting.clientSecret}`).toString("base64")}`,
    );
  }
  let response: Response;
  try {
    response = await outboundFetch(setting.tokenUrl, { method: "POST", body: form, headers, timeoutMs: 20_000 });
  } catch (error) {
    throw new Error(`Linux.do Token 请求失败：${(error as Error).message}`);
  }
  const body = await readLimitedText(response, 1 << 20);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Linux.do Token 请求失败：HTTP ${response.status}`);
  }
  let payload: { access_token?: string };
  try {
    payload = JSON.parse(body) as { access_token?: string };
  } catch {
    throw new Error("Linux.do Token 响应无效");
  }
  if (!payload.access_token) throw new Error("Linux.do Token 响应无效");
  return payload.access_token;
}

async function fetchLinuxDOProfile(
  setting: LinuxDOSettingValue,
  accessToken: string,
): Promise<Record<string, unknown>> {
  validateOutboundUrl(setting.userInfoUrl);
  let response: Response;
  try {
    response = await outboundFetch(setting.userInfoUrl, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      timeoutMs: 20_000,
    });
  } catch (error) {
    throw new Error(`Linux.do 用户信息请求失败：${(error as Error).message}`);
  }
  const body = await readLimitedText(response, 2 << 20);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Linux.do 用户信息请求失败：HTTP ${response.status}`);
  }
  // ACT: JSON.parse 无法保留超大整数的精度，Linux.do 的稳定用户 ID 为普通整数。
  let profile: Record<string, unknown>;
  try {
    profile = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error("Linux.do 用户信息响应无效");
  }
  return profile;
}

async function readLimitedText(response: Response, limit: number): Promise<string> {
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > limit) throw new Error("Linux.do 响应内容过大");
  return buffer.toString("utf8");
}

export function profileString(profile: Record<string, unknown>, field: string): string {
  let value: unknown = profile;
  for (const segment of field.split(".")) {
    if (value === null || typeof value !== "object") return "";
    value = (value as Record<string, unknown>)[segment];
    if (value === undefined || value === null) return "";
  }
  return String(value).trim();
}

export function safeOAuthNext(value: string): string {
  const raw = value.trim();
  if (raw === "" || raw.startsWith("//") || !raw.startsWith("/") || raw.includes("\\")) return "/create";
  let parsed: URL;
  try {
    parsed = new URL(raw, "http://localhost");
  } catch {
    return "/create";
  }
  if (parsed.host !== "localhost") return "/create";
  return `${parsed.pathname}${parsed.search}`;
}

export function shortSubject(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}
