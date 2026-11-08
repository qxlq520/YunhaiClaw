// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
// EmailLog 记录每次系统邮件投递结果；不保存正文和验证码，失败原因已脱敏。

export interface EmailLog {
  id: string;
  userId: string;
  purpose: string;
  recipient: string;
  subject: string;
  status: string;
  stage: string;
  reason: string;
  smtpHost: string;
  durationMs: number;
  createdAt: string;
}

// UserNotificationSetting 保存用户邮件订阅；LastConsumptionReportDate 用条件更新保证每天最多发一次。

export interface UserNotificationSetting {
  userId: string;
  consumptionReportEnabled: boolean;
  lastConsumptionReportDate?: string;
  createdAt: string;
  updatedAt: string;
}
