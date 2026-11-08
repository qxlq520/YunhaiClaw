// 对应 backend/internal/auth/password_reset.go
// 邮箱验证码找回密码。

import { badAuthRequest } from "@/internal/kernel/errors";
import type { EmailVerificationCode } from "@/internal/model/modelsIdentity";
import {
  deleteEmailVerificationCode,
  deleteExpiredEmailVerificationCodes,
  latestEmailVerificationCode,
  resetUserPasswordWithEmailVerification,
  userByEmail,
} from "@/internal/repository/account";
import { userStatusActive } from "@/internal/model/models";
import {
  codeMail,
  deliverEmail,
  emailPurposePasswordReset,
  emailVerificationCodeHash,
  emailEnabled,
  maskedEmail,
  randomNumericCode,
  readEmailSetting,
  recordSkippedEmail,
  resolveEmailSender,
  type OutgoingMail,
} from "./email";
import { hashPassword, normalizeEmail, validateEmail, validatePassword, type Service } from "./authService";
import { newId } from "@/internal/kernel/errors";

export const passwordResetEmailPurpose = "password_reset";
const passwordResetCodeTtlMs = 10 * 60 * 1000;

export interface PasswordResetRequest {
  email: string;
  emailCode: string;
  password: string;
}

export async function sendPasswordResetEmailCode(service: Service, rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  validateEmail(email);
  const read = await readEmailSetting(service);
  const setting = read.value;
  if (!setting.enabled || setting.host === "" || setting.port < 1 || setting.fromEmail === "") {
    throw badAuthRequest("管理员尚未启用密码找回，请联系管理员");
  }
  await service.emailCodeMutex.run(async () => {
    // 以下不发信的分支对外仍返回成功，避免枚举账号；原因写入发送记录，管理员可在后台排查。
    const user = await userByEmail(service.repo, email);
    if (!user) {
      await recordSkippedEmail(service, emailPurposePasswordReset, "", email, "该邮箱未绑定任何账号");
      return;
    }
    if (user.status !== userStatusActive) {
      await recordSkippedEmail(service, emailPurposePasswordReset, user.id, email, "账号已停用");
      return;
    }
    if ((user.passwordHash ?? "").trim() === "") {
      await recordSkippedEmail(
        service,
        emailPurposePasswordReset,
        user.id,
        email,
        "账号未设置密码（第三方登录或验证码注册），请用原方式登录后在账号设置中设置密码",
      );
      return;
    }
    const latest = await latestEmailVerificationCode(service.repo, email, passwordResetEmailPurpose);
    if (latest && Date.now() - new Date(latest.createdAt).getTime() < 60 * 1000) {
      await recordSkippedEmail(service, emailPurposePasswordReset, user.id, email, "60 秒内已发送过验证码，本次未重复发送");
      return;
    }
    const code = randomNumericCode(6);
    const codeHash = await emailVerificationCodeHash(service, passwordResetEmailPurpose, email, code);
    const now = new Date();
    const record: EmailVerificationCode = {
      id: newId(),
      email,
      codeHash,
      purpose: passwordResetEmailPurpose,
      expiresAt: new Date(now.getTime() + passwordResetCodeTtlMs).toISOString(),
      usedAt: null,
      attempts: 0,
      createdAt: now.toISOString(),
    };
    await service.repo.db.run(
      'INSERT INTO "email_verification_codes" ("attempts", "id", "email", "code_hash", "purpose", "expires_at", "used_at", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [record.attempts ?? 0, record.id, record.email, record.codeHash ?? "", record.purpose, record.expiresAt, record.usedAt, record.createdAt],
    );
    const sender = resolveEmailSender(setting, service.host.brandName());
    const mail = passwordResetEmail(sender.fromName, email, code);
    try {
      await deliverEmail(service, sender, { purpose: emailPurposePasswordReset, userId: user.id, recipient: email, mail });
    } catch (error) {
      console.warn("password reset email cleanup failed", { recipient: maskedEmail(email), error });
      try {
        await deleteEmailVerificationCode(service.repo, record.id);
      } catch {
        // 清理失败不影响对外结果。
      }
      return;
    }
    try {
      await deleteExpiredEmailVerificationCodes(service.repo, new Date(now.getTime() - 24 * 3600 * 1000).toISOString());
    } catch (error) {
      console.warn("expired password reset code cleanup failed", { error });
    }
  });
}

export async function resetPassword(service: Service, req: PasswordResetRequest): Promise<void> {
  const email = normalizeEmail(req.email);
  validateEmail(email);
  validatePassword(req.password);
  const code = req.emailCode.trim();
  if (Array.from(code).length !== 6) throw invalidPasswordResetCode();
  const user = await userByEmail(service.repo, email);
  if (!user) throw invalidPasswordResetCode();
  if (user.status !== userStatusActive || (user.passwordHash ?? "").trim() === "") throw invalidPasswordResetCode();
  const record = await latestEmailVerificationCode(service.repo, email, passwordResetEmailPurpose);
  if (!record) throw invalidPasswordResetCode();
  if (Date.now() > new Date(record.expiresAt).getTime()) throw invalidPasswordResetCode();
  const expectedHash = await emailVerificationCodeHash(service, passwordResetEmailPurpose, email, code);
  if (expectedHash !== record.codeHash) throw invalidPasswordResetCode();
  const passwordHash = await hashPassword(req.password);
  try {
    await resetUserPasswordWithEmailVerification(
      service.repo,
      user.id,
      email,
      passwordResetEmailPurpose,
      record.id,
      passwordHash,
      new Date().toISOString(),
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("邮箱验证码已失效")) throw invalidPasswordResetCode();
    throw error;
  }
}

function invalidPasswordResetCode(): Error {
  return badAuthRequest("验证码无效或已过期");
}

export function passwordResetEmail(brandName: string, recipient: string, code: string): OutgoingMail {
  return codeMail({
    brand: brandName,
    heading: "重置密码",
    subjectLabel: "密码重置验证码",
    intro: `你正在重置${brandName}账号密码。请在找回密码页面输入下方验证码，然后设置新密码。`,
    code,
    ttlMinutes: 10,
    recipient,
    securityTip:
      "如果这不是你本人的操作，请忽略本邮件，密码不会被修改；同时建议检查邮箱账号的安全。重置成功后，所有设备上的登录会话都会退出。",
  });
}
