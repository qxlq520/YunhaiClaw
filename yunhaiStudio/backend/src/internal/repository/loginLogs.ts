// 对应 backend/internal/repository/login_logs.go
// 登录日志与会话撤销的持久化。

import type { LoginLog } from "@/internal/model/modelsLoginLog";
import { Repository, toIso } from "./repository";

export interface LoginLogFilter {
  keyword?: string;
  event?: string;
  method?: string;
  result?: string;
  ip?: string;
  from?: string | null;
  to?: string | null;
}

const loginLogColumns = `"id", "user_id", "username", "display_name", "account", "event", "method", "source", "result", "ip", "user_agent", "session_ref", "reason", "message", "created_at"`;

interface LoginLogRow {
  id: string;
  user_id: string | null;
  username: string;
  display_name: string;
  account: string;
  event: string;
  method: string;
  source: string;
  result: string;
  ip: string;
  user_agent: string;
  session_ref: string;
  reason: string;
  message: string;
  created_at: string;
}

function mapLoginLog(row: LoginLogRow): LoginLog {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    account: row.account,
    event: row.event,
    method: row.method,
    source: row.source,
    result: row.result,
    ip: row.ip,
    userAgent: row.user_agent,
    sessionRef: row.session_ref,
    reason: row.reason,
    message: row.message,
    createdAt: toIso(row.created_at),
  };
}

export async function insertLoginLog(repo: Repository, event: LoginLog): Promise<void> {
  await repo.db.run(
    `INSERT INTO "login_logs" (${loginLogColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.id,
      event.userId ?? null,
      event.username,
      event.displayName,
      event.account,
      event.event,
      event.method,
      event.source,
      event.result,
      event.ip,
      event.userAgent,
      event.sessionRef,
      event.reason,
      event.message,
      event.createdAt,
    ],
  );
}

export async function appendLoginLog(repo: Repository, event: LoginLog): Promise<void> {
  await insertLoginLog(repo, event);
}

export async function loginLogs(
  repo: Repository,
  filter: LoginLogFilter,
  limit: number,
  offset: number,
): Promise<{ logs: LoginLog[]; total: number }> {
  const conditions: string[] = [];
  const values: (string | number | null)[] = [];
  if (filter.keyword) {
    const term = `%${filter.keyword}%`;
    conditions.push(
      '(lower("username") LIKE lower(?) OR lower("display_name") LIKE lower(?) OR lower("account") LIKE lower(?) OR "user_id" = ?)',
    );
    values.push(term, term, term, filter.keyword);
  }
  if (filter.event) {
    conditions.push('"event" = ?');
    values.push(filter.event);
  }
  if (filter.method) {
    conditions.push('"method" = ?');
    values.push(filter.method);
  }
  if (filter.result) {
    conditions.push('"result" = ?');
    values.push(filter.result);
  }
  if (filter.ip) {
    conditions.push('"ip" = ?');
    values.push(filter.ip);
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
  const totals = await repo.db.all<{ total: number }>(`SELECT COUNT(*) AS "total" FROM "login_logs"${where}`, values);
  const rows = await repo.db.all<LoginLogRow>(
    `SELECT ${loginLogColumns} FROM "login_logs"${where} ORDER BY "created_at" DESC, "id" DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset],
  );
  return { logs: rows.map(mapLoginLog), total: Number(totals[0]?.total ?? 0) };
}

export async function loginLog(repo: Repository, id: string): Promise<LoginLog | null> {
  const rows = await repo.db.all<LoginLogRow>(`SELECT ${loginLogColumns} FROM "login_logs" WHERE "id" = ? LIMIT 1`, [id]);
  return rows.length ? mapLoginLog(rows[0]) : null;
}

/** 凭据校验、撤销和日志提交在同一事务中；只有真正撤销的有效会话写成功事件。 */
export async function revokeAuthSessionWithLog(repo: Repository, sessionId: string, tokenHash: string, event: LoginLog): Promise<void> {
  await repo.transaction(async (tx) => {
    // SQLite 先取得写锁，避免并发退出在读快照后升级写锁时互相冲突。
    if (tx.db.dialect === "sqlite") {
      await tx.db.run(
        'UPDATE "auth_sessions" SET "updated_at" = "updated_at" WHERE "id" = ? AND "token_hash" = ?',
        [sessionId, tokenHash],
      );
    }
    const rows = await tx.db.all<{ user_id: string; expires_at: string }>(
      'SELECT "user_id", "expires_at" FROM "auth_sessions" WHERE "id" = ? AND "token_hash" = ? LIMIT 1',
      [sessionId, tokenHash],
    );
    if (!rows.length) return;
    const session = rows[0];
    if (new Date(session.expires_at).getTime() <= Date.now()) return;
    const users = await tx.db.all<{ id: string; username: string; display_name: string }>(
      'SELECT "id", "username", "display_name" FROM "users" WHERE "id" = ? LIMIT 1',
      [session.user_id],
    );
    if (!users.length) return;
    const user = users[0];
    event.userId = user.id;
    event.username = user.username;
    event.displayName = user.display_name;
    event.account = user.username;
    const loginRows = await tx.db.all<{ method: string }>(
      'SELECT "method" FROM "login_logs" WHERE "session_ref" = ? AND "event" = ? AND "result" = ? LIMIT 1',
      [event.sessionRef, "login", "success"],
    );
    if (loginRows.length) event.method = loginRows[0].method;
    const deleted = await tx.db.run(
      'DELETE FROM "auth_sessions" WHERE "id" = ? AND "token_hash" = ? AND "expires_at" = ?',
      [sessionId, tokenHash, session.expires_at],
    );
    if (deleted === 0) return;
    await insertLoginLog(tx, event);
  });
}
