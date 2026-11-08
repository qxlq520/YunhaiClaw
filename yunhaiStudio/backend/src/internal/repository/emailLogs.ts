// 对应 backend/internal/repository/email_logs.go
// 系统邮件投递日志的持久化与汇总。

import type { EmailLog } from "@/internal/model/modelsEmail";
import { Repository, toIso } from "./repository";

export interface EmailLogFilter {
  keyword?: string;
  purpose?: string;
  status?: string;
  from?: string | null;
  to?: string | null;
}

const emailLogColumns = `"id", "user_id", "purpose", "recipient", "subject", "status", "stage", "reason", "smtp_host", "duration_ms", "created_at"`;

interface EmailLogRow {
  id: string;
  user_id: string;
  purpose: string;
  recipient: string;
  subject: string;
  status: string;
  stage: string;
  reason: string;
  smtp_host: string;
  duration_ms: number;
  created_at: string;
}

function mapEmailLog(row: EmailLogRow): EmailLog {
  return {
    id: row.id,
    userId: row.user_id,
    purpose: row.purpose,
    recipient: row.recipient,
    subject: row.subject,
    status: row.status,
    stage: row.stage,
    reason: row.reason,
    smtpHost: row.smtp_host,
    durationMs: Number(row.duration_ms ?? 0),
    createdAt: toIso(row.created_at),
  };
}

export async function appendEmailLog(repo: Repository, entry: EmailLog): Promise<void> {
  await repo.db.run(
    `INSERT INTO "email_logs" (${emailLogColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id,
      entry.userId,
      entry.purpose,
      entry.recipient,
      entry.subject,
      entry.status,
      entry.stage,
      entry.reason,
      entry.smtpHost,
      entry.durationMs,
      entry.createdAt,
    ],
  );
}

export async function emailLogs(
  repo: Repository,
  filter: EmailLogFilter,
  limit: number,
  offset: number,
): Promise<{ logs: EmailLog[]; total: number }> {
  const conditions: string[] = [];
  const values: (string | number | null)[] = [];
  if (filter.keyword) {
    const term = `%${filter.keyword}%`;
    conditions.push('(lower("recipient") LIKE lower(?) OR lower("subject") LIKE lower(?) OR "user_id" = ?)');
    values.push(term, term, filter.keyword);
  }
  if (filter.purpose) {
    conditions.push('"purpose" = ?');
    values.push(filter.purpose);
  }
  if (filter.status) {
    conditions.push('"status" = ?');
    values.push(filter.status);
  }
  if (filter.from) {
    conditions.push('"created_at" >= ?');
    values.push(filter.from);
  }
  if (filter.to) {
    conditions.push('"created_at" <= ?');
    values.push(filter.to);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const totals = await repo.db.all<{ total: number }>(`SELECT COUNT(*) AS "total" FROM "email_logs"${where}`, values);
  const rows = await repo.db.all<EmailLogRow>(
    `SELECT ${emailLogColumns} FROM "email_logs"${where} ORDER BY "created_at" DESC, "id" DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset],
  );
  return { logs: rows.map(mapEmailLog), total: Number(totals[0]?.total ?? 0) };
}

/** 汇总时间窗口内各状态的数量，供后台概览。 */
export async function emailLogStats(repo: Repository, since: string): Promise<Record<string, number>> {
  const rows = await repo.db.all<{ status: string; count: number }>(
    'SELECT "status", COUNT(*) AS "count" FROM "email_logs" WHERE "created_at" >= ? GROUP BY "status"',
    [since],
  );
  const result: Record<string, number> = {};
  for (const row of rows) result[row.status] = Number(row.count ?? 0);
  return result;
}

export async function deleteEmailLogsBefore(repo: Repository, before: string): Promise<number> {
  return repo.db.run('DELETE FROM "email_logs" WHERE "created_at" < ?', [before]);
}
