// 对应 backend/internal/auth/email_admin.go
// 后台邮件发送记录与测试邮件。

import { badAuthRequest } from "@/internal/kernel/errors";
import type { EmailLog } from "@/internal/model/modelsEmail";
import type { User } from "@/internal/model/modelsIdentity";
import { deleteEmailLogsBefore, emailLogs, emailLogStats } from "@/internal/repository/emailLogs";
import {
  codeMail,
  deliverEmail,
  emailPurposeConsumptionReport,
  emailPurposeEmailChanged,
  emailPurposePasswordReset,
  emailPurposeProfileEmail,
  emailPurposeRegistration,
  emailPurposeTest,
  emailPurposeVerification,
  emailLogStatusFailed,
  emailLogStatusSent,
  emailLogStatusSkipped,
  emailVerificationCodeHash,
  normalizeEmailSetting,
  readEmailSetting,
  resolveEmailSender,
  smtpLogError,
} from "./email";
import { normalizeEmail, type Service } from "./authService";

/** 发送记录只有元数据，保留 90 天足够排查投诉。 */
const emailLogRetentionMs = 90 * 24 * 3600 * 1000;

export interface EmailLogQuery {
  keyword: string;
  purpose: string;
  status: string;
  from: string;
  to: string;
}

export interface EmailLogPage {
  logs: EmailLog[];
  total: number;
  page: number;
  pageSize: number;
  /** 近 24 小时各状态数量（sent/failed/skipped）。 */
  last24h: Record<string, number>;
}

const emailLogPurposes = [
  "",
  emailPurposeRegistration,
  emailPurposePasswordReset,
  emailPurposeVerification,
  emailPurposeProfileEmail,
  emailPurposeEmailChanged,
  emailPurposeTest,
  emailPurposeConsumptionReport,
];

export async function adminEmailLogs(
  service: Service,
  actor: User | null,
  query: EmailLogQuery,
  pageInput: number,
  pageSizeInput: number,
): Promise<EmailLogPage> {
  await service.host.requireAdmin(actor);
  const filter = {
    keyword: query.keyword.trim(),
    purpose: query.purpose.trim(),
    status: query.status.trim(),
    from: null as string | null,
    to: null as string | null,
  };
  if (!emailLogPurposes.includes(filter.purpose) || !["", emailLogStatusSent, emailLogStatusFailed, emailLogStatusSkipped].includes(filter.status)) {
    throw badAuthRequest("邮件记录筛选参数无效");
  }
  if (Array.from(filter.keyword).length > 160) throw badAuthRequest("关键词过长");
  for (const bound of [
    { raw: query.from, assign: (value: string | null) => (filter.from = value) },
    { raw: query.to, assign: (value: string | null) => (filter.to = value) },
  ]) {
    if (bound.raw === "") continue;
    const parsed = new Date(bound.raw);
    if (Number.isNaN(parsed.getTime())) throw badAuthRequest("时间必须使用 RFC3339 格式");
    bound.assign(parsed.toISOString());
  }
  let page = pageInput;
  let pageSize = pageSizeInput;
  if (page < 1) page = 1;
  if (pageSize < 1 || pageSize > 100) pageSize = 20;
  const result = await emailLogs(service.repo, filter, pageSize, (page - 1) * pageSize);
  const stats = await emailLogStats(service.repo, new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  return { logs: result.logs, total: result.total, page, pageSize, last24h: stats };
}

/** 用当前保存的 SMTP 配置给管理员指定的邮箱发一封测试信，失败时返回脱敏后的原因。 */
export async function sendTestEmail(service: Service, actor: User | null, rawRecipient: string): Promise<void> {
  await service.host.requireAdmin(actor);
  let recipient = normalizeEmail(rawRecipient);
  if (recipient === "") recipient = normalizeEmail(actor?.email ?? "");
  if (recipient === "" || !/^[^@\s]+@[^@\s]+$/.test(recipient)) throw badAuthRequest("请填写有效的收件邮箱");
  const read = await readEmailSetting(service);
  const setting = read.value;
  if (setting.host === "" || setting.port < 1 || setting.fromEmail === "") {
    throw badAuthRequest("请先保存 SMTP 主机、端口和发件邮箱");
  }
  const sender = resolveEmailSender(setting, service.host.brandName());
  const mail = codeMail({
    brand: sender.fromName,
    heading: "测试邮件",
    subjectLabel: "测试邮件（示例验证码）",
    intro: "这是一封来自后台的测试邮件，用来确认 SMTP 配置可以正常投递。下方是验证码邮件的示例样式。",
    code: "000000",
    ttlMinutes: 10,
    recipient,
    securityTip:
      "收到这封邮件说明 SMTP 配置可用。如果用户仍反馈收不到验证码，请在后台「邮件发送记录」查看对应邮箱的投递结果。",
  });
  try {
    await deliverEmail(service, sender, { purpose: emailPurposeTest, userId: actor?.id ?? "", recipient, mail });
  } catch (error) {
    throw badAuthRequest(`测试邮件发送失败：${smtpLogError(error, sender, recipient, mail.subject, mail.text)}`);
  }
}

export async function cleanupEmailLogs(service: Service): Promise<number> {
  return deleteEmailLogsBefore(service.repo, new Date(Date.now() - emailLogRetentionMs).toISOString());
}

// 保持与 email.go 中未使用参数一致的导出，避免其他模块重复实现。
export { normalizeEmailSetting, emailVerificationCodeHash };
