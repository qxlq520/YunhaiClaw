// 对应 backend/internal/auth/email.go、email_cooldown.go
// SMTP 配置、注册邮箱验证码与系统邮件投递记录。

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { AppError, badAuthRequest, forbidden, newId, truncateRunes } from "@/internal/kernel/errors";
import type { EmailLog } from "@/internal/model/modelsEmail";
import type { EmailVerificationCode } from "@/internal/model/modelsIdentity";
import type { SystemSetting } from "@/internal/model/modelsPlatform";
import { deleteEmailVerificationCode, deleteExpiredEmailVerificationCodes, latestEmailVerificationCode } from "@/internal/repository/account";
import { attemptLegacyEmailVerification } from "@/internal/repository/notifications";
import { appendEmailLog } from "@/internal/repository/emailLogs";
import { saveSetting, setting as readSetting } from "@/internal/repository/setting";
import { renderCode, renderNotice } from "@/internal/emailtpl/code";
import type { CodeEmail, NoticeEmail } from "@/internal/emailtpl/code";
import { normalizeEmail, validateEmail, type Service } from "./authService";
import { policyAllows, verificationPolicy } from "./verificationPolicy";

export const emailSettingKey = "email";
export const registrationEmailPurpose = "registration";
const registrationCodeTtlMs = 10 * 60 * 1000;

export const emailPurposeRegistration = "registration";
export const emailPurposePasswordReset = "password_reset";
export const emailPurposeVerification = "verification";
export const emailPurposeProfileEmail = "profile_email";
export const emailPurposeEmailChanged = "email_changed";
export const emailPurposeTest = "test";
export const emailPurposeConsumptionReport = "consumption_report";
export const emailLogStatusSent = "sent";
export const emailLogStatusFailed = "failed";
export const emailLogStatusSkipped = "skipped";

export const defaultRegistrationEmailDomains = [
  "gmail.com",
  "163.com",
  "126.com",
  "qq.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "yahoo.com",
  "foxmail.com",
];

export interface EmailSettingRequest {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  encryption: string;
  fromEmail: string;
  fromName: string;
  registrationAllowedDomains: string[] | null;
}

export interface PublicEmailSetting {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  encryption: string;
  fromEmail: string;
  fromName: string;
  fromNameInherited: boolean;
  hasPassword: boolean;
  registrationAllowedDomains: string[];
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailSettingValue {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  encryption: string;
  fromEmail: string;
  fromName: string;
  registrationAllowedDomains: string[];
}

export interface OutgoingMail {
  subject: string;
  text: string;
  html: string;
}

export interface EmailDelivery {
  purpose: string;
  userId: string;
  recipient: string;
  mail: OutgoingMail;
}

export class EmailCodeCooldownError extends Error {
  constructor(readonly seconds: number) {
    super(`验证码已发送，请查看邮箱；${seconds} 秒后可以重新获取`);
    this.name = "EmailCodeCooldownError";
  }
}

export async function adminEmailSetting(service: Service, actor: { id: string } | null): Promise<PublicEmailSetting> {
  await service.host.requireAdmin(actor as never);
  const read = await readEmailSetting(service);
  return publicEmailSetting(service, read.setting, read.value);
}

export async function updateEmailSetting(
  service: Service,
  actor: { id: string } | null,
  req: EmailSettingRequest,
): Promise<PublicEmailSetting> {
  await service.host.requireAdmin(actor as never);
  const current = await readEmailSetting(service);
  const allowedDomains = req.registrationAllowedDomains ?? current.value.registrationAllowedDomains;
  const next = normalizeEmailSetting({
    enabled: req.enabled,
    host: req.host,
    port: req.port,
    username: req.username,
    password: req.password,
    encryption: req.encryption,
    fromEmail: req.fromEmail,
    fromName: req.fromName,
    registrationAllowedDomains: allowedDomains,
  });
  if (next.password === "") next.password = current.value.password;
  validateEmailSetting(next);
  const stored: EmailSettingValue = { ...next };
  stored.password = await service.host.encryptSecret(next.password);
  await saveSetting(service.repo, emailSettingKey, JSON.stringify(stored), actor ? actor.id : "");
  return publicEmailSetting(service, await readSetting(service.repo, emailSettingKey), next);
}

export async function emailEnabled(service: Service): Promise<boolean> {
  const read = await readEmailSetting(service);
  return read.value.enabled && read.value.host !== "" && read.value.port > 0 && read.value.fromEmail !== "";
}

export async function sendRegistrationEmailCode(service: Service, rawEmail: string): Promise<void> {
  const policy = await verificationPolicy(service);
  if (!policyAllows(policy, "register", "email")) throw forbidden("邮箱单独验证注册未开启");
  const email = normalizeEmail(rawEmail);
  validateEmail(email);
  const { userCount } = await import("@/internal/repository/account");
  if ((await userCount(service.repo)) === 0) throw badAuthRequest("首个管理员账号不需要邮箱验证码");
  const { registrationEnabled } = await import("./registration");
  if (!(await registrationEnabled(service))) throw forbidden("管理员未开放新用户注册");
  const { checkEmailAvailable } = await import("@/internal/repository/emailIdentity");
  await checkEmailAvailable(service.repo, email, "");
  const read = await readEmailSetting(service);
  validateRegistrationEmailDomainFor(email, read.value.registrationAllowedDomains);
  if (!read.value.enabled) throw forbidden("平台尚未启用注册邮件，请联系管理员");
  await service.emailCodeMutex.run(async () => {
    const latest = await latestEmailVerificationCode(service.repo, email, registrationEmailPurpose);
    if (latest && Date.now() - new Date(latest.createdAt).getTime() < 60 * 1000) {
      const remaining = new Date(latest.createdAt).getTime() + 60 * 1000 - Date.now();
      throw new EmailCodeCooldownError(Math.max(1, Math.ceil(remaining / 1000)));
    }
    const code = randomNumericCode(6);
    const codeHash = await emailVerificationCodeHash(service, registrationEmailPurpose, email, code);
    const now = new Date();
    const record: EmailVerificationCode = {
      id: newId(),
      email,
      codeHash,
      purpose: registrationEmailPurpose,
      expiresAt: new Date(now.getTime() + registrationCodeTtlMs).toISOString(),
      usedAt: null,
      attempts: 0,
      createdAt: now.toISOString(),
    };
    await service.repo.db.run(
      'INSERT INTO "email_verification_codes" ("attempts", "id", "email", "code_hash", "purpose", "expires_at", "used_at", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [record.attempts ?? 0, record.id, record.email, record.codeHash ?? "", record.purpose, record.expiresAt, record.usedAt, record.createdAt],
    );
    const sender = resolveEmailSender(read.value, service.host.brandName());
    const mail = registrationEmail(sender.fromName, email, code);
    try {
      await deliverEmail(service, sender, { purpose: emailPurposeRegistration, userId: "", recipient: email, mail });
    } catch (error) {
      await deleteEmailVerificationCode(service.repo, record.id);
      throw new Error(`发送注册邮件失败：${(error as Error).message}`);
    }
    try {
      await deleteExpiredEmailVerificationCodes(service.repo, new Date(now.getTime() - 24 * 3600 * 1000).toISOString());
    } catch {
      // 清理失败不影响本次发送。
    }
  });
}

export async function verifyRegistrationEmailCode(
  service: Service,
  emailInput: string,
  rawCode: string,
): Promise<EmailVerificationCode> {
  const policy = await verificationPolicy(service);
  if (!policyAllows(policy, "register", "email")) throw forbidden("邮箱单独验证注册未开启");
  if (!(await emailEnabled(service))) throw forbidden("平台尚未启用注册邮件，请联系管理员");
  const email = normalizeEmail(emailInput);
  const code = rawCode.trim();
  if (code.length !== 6) throw badAuthRequest("请输入 6 位邮箱验证码");
  const record = await latestEmailVerificationCode(service.repo, email, registrationEmailPurpose);
  if (!record) throw badAuthRequest("请先获取邮箱验证码");
  if (Date.now() > new Date(record.expiresAt).getTime()) throw badAuthRequest("邮箱验证码已过期，请重新获取");
  try {
    await attemptLegacyEmailVerification(service.repo, record.id);
  } catch {
    throw invalidVerificationCode();
  }
  const hash = await emailVerificationCodeHash(service, registrationEmailPurpose, email, code);
  if (!secureEqual(hash, record.codeHash ?? "")) throw badAuthRequest("邮箱验证码不正确");
  return record;
}

function invalidVerificationCode(): AppError {
  return badAuthRequest("验证码错误、已失效或验证次数已用尽，请重新获取");
}

export async function emailVerificationCodeHash(
  service: Service,
  purpose: string,
  email: string,
  code: string,
): Promise<string> {
  const key = await service.host.settingsEncryptionKey();
  if (!key) throw new AppError({ status: 503, message: "验证码加密密钥不可用" });
  return createHmac("sha256", Buffer.from(key))
    .update(`${purpose.trim()}:${normalizeEmail(email)}:${code.trim()}`)
    .digest("hex");
}

export async function readEmailSetting(service: Service): Promise<{ setting: SystemSetting | null; value: EmailSettingValue }> {
  const saved = await readSetting(service.repo, emailSettingKey);
  if (!saved) return { setting: null, value: normalizeEmailSetting(emptyEmailSetting()) };
  let parsed: EmailSettingValue;
  try {
    parsed = JSON.parse(saved.valueJson) as EmailSettingValue;
  } catch {
    throw new Error("邮件配置格式无效");
  }
  parsed.password = await service.host.decryptSecret(parsed.password ?? "");
  return { setting: saved, value: normalizeEmailSetting({ ...emptyEmailSetting(), ...parsed }) };
}

function emptyEmailSetting(): EmailSettingValue {
  return {
    enabled: false,
    host: "",
    port: 0,
    username: "",
    password: "",
    encryption: "",
    fromEmail: "",
    fromName: "",
    registrationAllowedDomains: [],
  };
}

export function validateEmailSetting(value: EmailSettingValue): void {
  validateRegistrationEmailDomains(value.registrationAllowedDomains);
  if (!value.enabled) return;
  if (value.host === "" || value.port < 1 || value.port > 65535 || value.fromEmail === "") {
    throw badAuthRequest("启用邮件前请完整填写 SMTP 主机、端口和发件邮箱");
  }
  if (!isValidMailAddress(value.fromEmail)) throw badAuthRequest("发件邮箱格式不正确");
  if (value.username !== "" && value.password === "") throw badAuthRequest("SMTP 用户名已填写，请同时填写密码");
  if (/[\r\n]/.test(value.fromName)) throw badAuthRequest("发件人名称不能包含换行");
}

export function normalizeEmailSetting(value: EmailSettingValue): EmailSettingValue {
  const next: EmailSettingValue = {
    ...value,
    host: value.host.trim(),
    username: value.username.trim(),
    password: value.password.trim(),
    fromEmail: normalizeEmail(value.fromEmail),
    fromName: value.fromName.trim(),
  };
  if (next.registrationAllowedDomains === null || next.registrationAllowedDomains === undefined) {
    next.registrationAllowedDomains = [...defaultRegistrationEmailDomains];
  }
  next.registrationAllowedDomains = normalizeEmailDomains(next.registrationAllowedDomains);
  if (next.port === 0) next.port = 587;
  if (next.encryption !== "tls" && next.encryption !== "none") next.encryption = "starttls";
  return next;
}

export function publicEmailSetting(
  service: Service,
  saved: SystemSetting | null,
  value: EmailSettingValue,
): PublicEmailSetting {
  const inherited = value.fromName === "" || value.fromName === "影降";
  const resolved = resolveEmailSender(value, service.host.brandName());
  return {
    enabled: resolved.enabled,
    host: resolved.host,
    port: resolved.port,
    username: resolved.username,
    encryption: resolved.encryption,
    fromEmail: resolved.fromEmail,
    fromName: resolved.fromName,
    fromNameInherited: inherited,
    hasPassword: resolved.password !== "",
    registrationAllowedDomains: resolved.registrationAllowedDomains,
    updatedBy: saved ? saved.updatedBy : "",
    createdAt: saved ? saved.createdAt : "",
    updatedAt: saved ? saved.updatedAt : "",
  };
}

export function normalizeEmailDomains(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw.trim().replace(/^@+/, "").trim().toLowerCase().replace(/\.$/, "");
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function validateRegistrationEmailDomains(allowed: string[]): void {
  if (allowed.length > 100) throw badAuthRequest("电子邮件域名白名单最多填写 100 项");
  for (const domain of allowed) {
    if (!validEmailDomain(domain)) throw badAuthRequest(`电子邮件域名格式不正确：${domain}`);
  }
}

export function validEmailDomain(value: string): boolean {
  if (value.length > 253 || !value.includes(".") || value.startsWith(".") || value.endsWith(".")) return false;
  for (const label of value.split(".")) {
    if (label === "" || label.length > 63 || label.startsWith("-") || label.endsWith("-")) return false;
    if (!/^[a-z0-9-]+$/.test(label)) return false;
  }
  return true;
}

export async function validateRegistrationEmailDomain(service: Service, email: string): Promise<void> {
  const read = await readEmailSetting(service);
  validateRegistrationEmailDomainFor(email, read.value.registrationAllowedDomains);
}

export function validateRegistrationEmailDomainFor(email: string, allowedDomains: string[]): void {
  const parts = email.split("@");
  if (parts.length !== 2) throw badAuthRequest("邮箱格式不正确");
  const domain = parts[1].toLowerCase();
  if (allowedDomains.length === 0) return;
  if (allowedDomains.includes(domain)) return;
  throw badAuthRequest("该邮箱域名不在管理员设置的白名单内");
}

export function resolveEmailSender(value: EmailSettingValue, brandName: string): EmailSettingValue {
  if (value.fromName === "" || value.fromName === "影降") {
    return { ...value, fromName: brandName };
  }
  return value;
}

/** 465 是隐式 TLS 端口，按 STARTTLS 连接只会超时；这里按端口纠正，其余端口尊重配置。 */
export function smtpEncryption(setting: EmailSettingValue): string {
  if (setting.port === 465 && setting.encryption !== "none") return "tls";
  return setting.encryption;
}

/**
 * ACT: Go 使用 net/smtp 手写会话；Node 无标准 SMTP 客户端，改用 nodemailer。
 * 阶段名按 nodemailer 错误码近似映射，保持后台展示的排障语义。
 */
export async function sendSMTPMail(setting: EmailSettingValue, recipient: string, mail: OutgoingMail): Promise<void> {
  const encryption = smtpEncryption(setting);
  const transport = nodemailer.createTransport({
    host: setting.host,
    port: setting.port,
    secure: encryption === "tls",
    requireTLS: encryption === "starttls",
    auth: setting.username !== "" ? { user: setting.username, pass: setting.password } : undefined,
    connectionTimeout: 12_000,
    greetingTimeout: 30_000,
    socketTimeout: 45_000,
    tls: { minVersion: "TLSv1.2", servername: setting.host },
  });
  try {
    await transport.sendMail({
      from: { name: setting.fromName, address: setting.fromEmail },
      to: recipient,
      subject: mail.subject,
      text: mail.text,
      html: mail.html || undefined,
    });
  } catch (error) {
    const code = String((error as { code?: string }).code ?? "");
    let stage = "data";
    if (code.startsWith("EAUTH")) stage = "auth";
    else if (code === "ESOCKET" || code === "ECONNECTION" || code === "ETIMEDOUT") stage = "connect";
    else if (code === "EMESSAGE") stage = "mail_from";
    throw new SMTPStageError(stage, error as Error);
  } finally {
    transport.close();
  }
}

export class SMTPStageError extends Error {
  constructor(
    readonly stage: string,
    readonly cause: Error,
  ) {
    super(`smtp ${stage}: ${cause.message}`);
    this.name = "SMTPStageError";
  }
}

/** 生成 multipart/alternative 邮件；Date 与 Message-ID 是 RFC 5322 必填头。 */
export function buildMIMEMessage(setting: EmailSettingValue, recipient: string, mail: OutgoingMail, now: Date): string {
  let domain = setting.host;
  const at = setting.fromEmail.indexOf("@");
  if (at >= 0 && at + 1 < setting.fromEmail.length) domain = setting.fromEmail.slice(at + 1);
  const lines: string[] = [];
  const header = (key: string, value: string) => lines.push(`${key}: ${value}`);
  header("From", `${encodeDisplayName(setting.fromName)} <${setting.fromEmail}>`);
  header("To", recipient);
  header("Subject", `=?UTF-8?B?${Buffer.from(mail.subject).toString("base64")}?=`);
  header("Date", now.toUTCString());
  header("Message-ID", `<${newId()}@${domain}>`);
  header("MIME-Version", "1.0");
  header("Auto-Submitted", "auto-generated");
  header("X-Auto-Response-Suppress", "All");
  if (mail.html.trim() === "") {
    header("Content-Type", "text/plain; charset=UTF-8");
    header("Content-Transfer-Encoding", "base64");
    return `${lines.join("\r\n")}\r\n\r\n${wrapBase64(mail.text)}`;
  }
  const boundary = `=_yc_${newId()}`;
  header("Content-Type", `multipart/alternative; boundary="${boundary}"`);
  const chunks = [lines.join("\r\n"), ""];
  for (const part of [
    { kind: "text/plain", body: mail.text },
    { kind: "text/html", body: mail.html },
  ]) {
    chunks.push(`--${boundary}`);
    chunks.push(`Content-Type: ${part.kind}; charset=UTF-8`);
    chunks.push("Content-Transfer-Encoding: base64");
    chunks.push("");
    chunks.push(wrapBase64(part.body));
  }
  chunks.push(`--${boundary}--`);
  return `${chunks.join("\r\n")}\r\n`;
}

function encodeDisplayName(name: string): string {
  if (name === "") return "";
  return `=?UTF-8?B?${Buffer.from(name).toString("base64")}?=`;
}

export function wrapBase64(value: string): string {
  let encoded = Buffer.from(value).toString("base64");
  const lines: string[] = [];
  while (encoded.length > 76) {
    lines.push(encoded.slice(0, 76));
    encoded = encoded.slice(76);
  }
  lines.push(encoded);
  return `${lines.join("\r\n")}\r\n`;
}

export async function deliverEmail(service: Service, setting: EmailSettingValue, delivery: EmailDelivery): Promise<void> {
  const started = new Date();
  let error: unknown = null;
  if (service.mailSender) {
    try {
      await service.mailSender(setting, delivery.recipient, delivery.mail.subject, delivery.mail.text);
    } catch (caught) {
      error = caught;
    }
  } else {
    try {
      await sendSMTPMail(setting, delivery.recipient, delivery.mail);
    } catch (caught) {
      error = caught;
    }
  }
  const entry: EmailLog = {
    id: newId(),
    userId: delivery.userId,
    purpose: delivery.purpose,
    recipient: delivery.recipient,
    subject: logSubject(delivery.mail.subject),
    status: emailLogStatusSent,
    stage: "",
    reason: "",
    smtpHost: setting.host,
    durationMs: Date.now() - started.getTime(),
    createdAt: started.toISOString(),
  };
  if (error) {
    const reason = smtpLogError(error, setting, delivery.recipient, delivery.mail.subject, delivery.mail.text);
    console.error("smtp email delivery failed", {
      host: setting.host,
      port: setting.port,
      encryption: setting.encryption,
      recipient: maskedEmail(delivery.recipient),
      error: reason,
    });
    entry.status = emailLogStatusFailed;
    entry.reason = truncateRunes(reason, 500);
    if (error instanceof SMTPStageError) entry.stage = error.stage;
  }
  await appendEmailLogSafely(service, entry);
  if (error) throw error;
}

/** 记录按规则未投递的请求（如找回密码时账号不存在），方便管理员排查“收不到邮件”。 */
export async function recordSkippedEmail(
  service: Service,
  purpose: string,
  userId: string,
  recipient: string,
  reason: string,
): Promise<void> {
  await appendEmailLogSafely(service, {
    id: newId(),
    userId,
    purpose,
    recipient,
    subject: "",
    status: emailLogStatusSkipped,
    stage: "",
    reason,
    smtpHost: "",
    durationMs: 0,
    createdAt: new Date().toISOString(),
  });
}

async function appendEmailLogSafely(service: Service, entry: EmailLog): Promise<void> {
  try {
    await appendEmailLog(service.repo, entry);
  } catch (error) {
    console.warn("email log write failed", { purpose: entry.purpose, recipient: maskedEmail(entry.recipient), error });
  }
}

/** 去掉标题里的验证码，发送记录不保存验证码明文。 */
export function logSubject(subject: string): string {
  return truncateRunes(subject.trim().replace(/[0-9]{6}/g, "******"), 200);
}

/** 供其他业务域（如消费日报）复用平台 SMTP 配置与发送记录。 */
export async function sendSystemEmail(service: Service, delivery: EmailDelivery): Promise<void> {
  const read = await readEmailSetting(service);
  const setting = read.value;
  if (!setting.enabled || setting.host === "" || setting.port < 1 || setting.fromEmail === "") {
    throw forbidden("邮件服务未启用");
  }
  await deliverEmail(service, resolveEmailSender(setting, service.host.brandName()), delivery);
}

/** 邮件里显示的品牌名：发件人名称优先，其次是外观设置的品牌名。 */
export async function emailBrandName(service: Service): Promise<string> {
  try {
    const read = await readEmailSetting(service);
    return resolveEmailSender(read.value, service.host.brandName()).fromName;
  } catch {
    return service.host.brandName();
  }
}

export function smtpLogError(
  error: unknown,
  setting: EmailSettingValue,
  recipient: string,
  subject: string,
  body: string,
): string {
  const secrets = [
    setting.password,
    setting.username,
    setting.fromEmail,
    recipient,
    subject,
    body,
    `\x00${setting.username}\x00${setting.password}`,
    ...(body.match(/[0-9]{6}/g) ?? []),
  ].filter((value) => value !== "");
  const values: string[] = [];
  for (const secret of secrets) {
    values.push(secret, Buffer.from(secret).toString("base64"));
  }
  values.sort((left, right) => right.length - left.length);
  let message = error instanceof Error ? error.message : String(error);
  for (const value of values) message = message.split(value).join("[redacted]");
  return message;
}

export function randomNumericCode(length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) value += String(randomInt(0, 10));
  return value;
}

export function registrationEmail(brandName: string, recipient: string, code: string): OutgoingMail {
  return codeMail({
    brand: brandName,
    heading: "注册",
    intro: `你正在注册${brandName}。请在注册页面输入下方验证码，完成邮箱验证。`,
    code,
    ttlMinutes: 10,
    recipient,
  });
}

export function codeMail(item: CodeEmail): OutgoingMail {
  const rendered = renderCode(item);
  return { subject: rendered.subject, text: rendered.text, html: rendered.html };
}

export function noticeMail(item: NoticeEmail): OutgoingMail {
  const rendered = renderNotice(item);
  return { subject: rendered.subject, text: rendered.text, html: rendered.html };
}

export function maskedEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${Array.from(email.slice(0, at))[0]}***@${email.slice(at + 1)}`;
}

function isValidMailAddress(value: string): boolean {
  return value !== "" && !/\s/.test(value) && /^[^@]+@[^@]+$/.test(value);
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
