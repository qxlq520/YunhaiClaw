import { createHash } from "node:crypto";
import { userRoleAdmin, userRoleUser, userStatusActive, userStatusDisabled } from "@/internal/model/models";
import type { AuthSession, EmailVerificationCode, User } from "@/internal/model/modelsIdentity";
import type { LoginLog } from "@/internal/model/modelsLoginLog";
import type { AuthVerification } from "@/internal/model/modelsNotifications";
import { defaultUserGroupCode } from "@/internal/model/modelsUserGroup";
import { recordNotFound, Repository, toBool, toIso, toNullableIso } from "./repository";
import { checkEmailAvailable, lockRegistrationEmail } from "./emailIdentity";
import { errEmailVerificationCodeInvalid, errProfileAuthorization, errVerificationInvalid } from "./errors";
import { insertLoginLog } from "./loginLogs";

export { errProfileAuthorization } from "./errors";

interface UserRow {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  email_verified_at: string | null;
  phone_verified_at: string | null;
  display_name: string;
  avatar_mode: string;
  avatar_preset: string | null;
  avatar_version: string | null;
  role: User["role"];
  status: User["status"];
  is_promoter: unknown;
  user_group: string | null;
  password_hash: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    email: row.email ?? "",
    phone: row.phone ?? "",
    emailVerifiedAt: toNullableIso(row.email_verified_at),
    phoneVerifiedAt: toNullableIso(row.phone_verified_at),
    displayName: row.display_name,
    avatarMode: row.avatar_mode,
    avatarPreset: row.avatar_preset ?? "",
    avatarVersion: row.avatar_version ?? "",
    role: row.role,
    status: row.status,
    isPromoter: toBool(row.is_promoter),
    userGroup: row.user_group ?? "",
    passwordHash: row.password_hash ?? "",
    lastLoginAt: toNullableIso(row.last_login_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const userColumns = `"id", "username", "email", "phone", "email_verified_at", "phone_verified_at", "display_name", "avatar_mode", "avatar_preset", "avatar_version", "role", "status", "is_promoter", "user_group", "password_hash", "last_login_at", "created_at", "updated_at"`;

export async function userCount(repo: Repository): Promise<number> {
  const rows = await repo.db.all<{ total: number }>('SELECT COUNT(*) AS "total" FROM "users"');
  return Number(rows[0]?.total ?? 0);
}

export async function userById(repo: Repository, id: string): Promise<User | null> {
  const rows = await repo.db.all<UserRow>(`SELECT ${userColumns} FROM "users" WHERE "id" = ? LIMIT 1`, [id]);
  return rows.length ? mapUser(rows[0]) : null;
}

export async function userByAccount(repo: Repository, account: string): Promise<User | null> {
  const rows = await repo.db.all<UserRow>(
    `SELECT ${userColumns} FROM "users" WHERE lower("username") = lower(?) OR lower("email") = lower(?) LIMIT 1`,
    [account, account],
  );
  return rows.length ? mapUser(rows[0]) : null;
}

export async function userByUsername(repo: Repository, username: string): Promise<User | null> {
  const rows = await repo.db.all<UserRow>(`SELECT ${userColumns} FROM "users" WHERE lower("username") = lower(?) LIMIT 1`, [username]);
  return rows.length ? mapUser(rows[0]) : null;
}

export async function userByEmail(repo: Repository, email: string): Promise<User | null> {
  const rows = await repo.db.all<UserRow>(`SELECT ${userColumns} FROM "users" WHERE lower("email") = lower(?) LIMIT 1`, [email]);
  return rows.length ? mapUser(rows[0]) : null;
}

export async function createUser(repo: Repository, user: User): Promise<void> {
  await insertUser(repo, user);
}

export async function insertUser(repo: Repository, user: User): Promise<void> {
  await repo.db.run(
    `INSERT INTO "users" (${userColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user.id,
      user.username,
      user.email ?? "",
      user.phone ?? "",
      user.emailVerifiedAt ?? null,
      user.phoneVerifiedAt ?? null,
      user.displayName,
      user.avatarMode,
      user.avatarPreset ?? "",
      user.avatarVersion ?? "",
      user.role,
      user.status,
      user.isPromoter,
      user.userGroup,
      user.passwordHash ?? "",
      user.lastLoginAt ?? null,
      user.createdAt,
      user.updatedAt,
    ],
  );
}

export async function updateUserLoginTime(repo: Repository, userId: string, now: string): Promise<void> {
  await repo.db.run('UPDATE "users" SET "last_login_at" = ?, "updated_at" = ? WHERE "id" = ?', [now, now, userId]);
}

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  reauthenticated_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

function mapSession(row: SessionRow): AuthSession {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    reauthenticatedAt: toNullableIso(row.reauthenticated_at),
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function createAuthSession(repo: Repository, session: AuthSession): Promise<void> {
  await repo.db.run(
    'INSERT INTO "auth_sessions" ("id", "user_id", "token_hash", "reauthenticated_at", "expires_at", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?)',
    [session.id, session.userId, session.tokenHash ?? "", session.reauthenticatedAt ?? null, session.expiresAt, session.createdAt, session.updatedAt],
  );
}

export async function authSession(repo: Repository, id: string): Promise<AuthSession | null> {
  const rows = await repo.db.all<SessionRow>(
    'SELECT "id", "user_id", "token_hash", "reauthenticated_at", "expires_at", "created_at", "updated_at" FROM "auth_sessions" WHERE "id" = ? LIMIT 1',
    [id],
  );
  return rows.length ? mapSession(rows[0]) : null;
}

export async function deleteAuthSession(repo: Repository, id: string): Promise<void> {
  await repo.db.run('DELETE FROM "auth_sessions" WHERE "id" = ?', [id]);
}

export async function requireUser(repo: Repository, id: string): Promise<User> {
  const user = await userById(repo, id);
  if (!user) throw recordNotFound;
  return user;
}

export async function deleteUserAuthSessions(repo: Repository, userId: string): Promise<void> {
  await repo.db.run('DELETE FROM "auth_sessions" WHERE "user_id" = ?', [userId]);
}

export async function deleteExpiredAuthSessions(repo: Repository): Promise<void> {
  await repo.db.run('DELETE FROM "auth_sessions" WHERE "expires_at" <= ?', [new Date().toISOString()]);
}

export const profileReauthenticationTtlMs = 5 * 60 * 1000;

export function profileCredentialHash(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("hex");
}

async function lockProfileUser(tx: Repository, userId: string): Promise<void> {
  if (tx.db.dialect === "sqlite") {
    await tx.db.run('UPDATE "users" SET "updated_at" = "updated_at" WHERE "id" = ?', [userId]);
  }
}

/** 会话签发与凭据变更串行化，避免旧凭据校验通过后写入已认证会话。 */
export async function createAuthSessionForUser(
  repo: Repository,
  expected: User,
  session: AuthSession,
  events: LoginLog[] = [],
): Promise<void> {
  await repo.transaction(async (tx) => {
    if (session.userId !== expected.id) throw errProfileAuthorization;
    await lockProfileUser(tx, expected.id);
    const current = await userById(tx, expected.id);
    if (!current) throw errProfileAuthorization;
    if (
      current.status !== userStatusActive ||
      (current.passwordHash ?? "") !== (expected.passwordHash ?? "") ||
      (current.email ?? "") !== (expected.email ?? "")
    ) {
      throw errProfileAuthorization;
    }
    await createAuthSession(tx, session);
    for (const event of events) {
      if (event.userId !== expected.id || event.event !== "login" || event.result !== "success") {
        throw errProfileAuthorization;
      }
      await insertLoginLog(tx, event);
    }
  });
}

async function profileAuthorization(
  tx: Repository,
  expected: User,
  session: AuthSession,
  _now: string,
  requireReauth: boolean,
): Promise<void> {
  const current = await userById(tx, expected.id);
  if (!current) throw errProfileAuthorization;
  if (
    current.status !== userStatusActive ||
    (current.passwordHash ?? "") !== (expected.passwordHash ?? "") ||
    (current.email ?? "") !== (expected.email ?? "")
  ) {
    throw errProfileAuthorization;
  }
  const stored = await authSession(tx, session.id);
  if (!stored || stored.userId !== expected.id) throw errProfileAuthorization;
  // 事务可能等待其他账号写入；取得锁后再检查过期时间。
  const now = Date.now();
  if (stored.tokenHash !== session.tokenHash || new Date(stored.expiresAt).getTime() <= now) {
    throw errProfileAuthorization;
  }
  if (requireReauth) {
    if (!stored.reauthenticatedAt) throw errProfileAuthorization;
    const reauthenticatedAt = new Date(stored.reauthenticatedAt).getTime();
    if (reauthenticatedAt > now || reauthenticatedAt + profileReauthenticationTtlMs <= now) {
      throw errProfileAuthorization;
    }
  }
}

export async function changeProfilePassword(
  repo: Repository,
  expected: User,
  session: AuthSession,
  newHash: string,
  now: string,
): Promise<void> {
  await repo.transaction(async (tx) => {
    await lockProfileUser(tx, expected.id);
    await profileAuthorization(tx, expected, session, now, (expected.passwordHash ?? "") === "");
    const affected = await tx.db.run(
      'UPDATE "users" SET "password_hash" = ?, "updated_at" = ? WHERE "id" = ? AND "password_hash" = ? AND "status" = ?',
      [newHash, now, expected.id, expected.passwordHash ?? "", userStatusActive],
    );
    if (affected !== 1) throw errProfileAuthorization;
    await tx.db.run('DELETE FROM "auth_sessions" WHERE "user_id" = ?', [expected.id]);
  });
}

export async function changeProfileEmail(
  repo: Repository,
  expected: User,
  session: AuthSession,
  verification: AuthVerification,
  now: string,
): Promise<void> {
  await repo.transaction(async (tx) => {
    await lockRegistrationEmail(tx, verification.email);
    await profileAuthorization(tx, expected, session, now, (expected.passwordHash ?? "") === "");
    const current = new Date().toISOString();
    await checkEmailAvailable(tx, verification.email, expected.id);
    const consumed = await tx.db.run(
      'UPDATE "auth_verifications" SET "used_at" = ? WHERE "id" = ? AND "user_id" = ? AND "session_id" = ? AND "purpose" = ? AND "credential_hash" = ? AND "email" = ? AND "ready" = ? AND "used_at" IS NULL AND "expires_at" > ? AND "attempts" <= 5',
      [
        current,
        verification.id,
        expected.id,
        session.id,
        "profile_email",
        profileCredentialHash(expected.passwordHash ?? ""),
        verification.email,
        true,
        current,
      ],
    );
    if (consumed !== 1) throw errVerificationInvalid;
    const updated = await tx.db.run(
      'UPDATE "users" SET "email" = ?, "email_verified_at" = ?, "updated_at" = ? WHERE "id" = ? AND "password_hash" = ? AND "status" = ?',
      [verification.email ?? "", current, current, expected.id, expected.passwordHash ?? "", userStatusActive],
    );
    if (updated !== 1) throw errProfileAuthorization;
    await tx.db.run('DELETE FROM "auth_sessions" WHERE "user_id" = ?', [expected.id]);
  });
}

export async function reauthenticateLinuxDOSession(
  repo: Repository,
  expected: User,
  session: AuthSession,
  subject: string,
  now: string,
): Promise<void> {
  await repo.transaction(async (tx) => {
    await lockProfileUser(tx, expected.id);
    await profileAuthorization(tx, expected, session, now, false);
    const rows = await tx.db.all<{ total: number }>(
      'SELECT COUNT(*) AS "total" FROM "user_identities" WHERE "provider" = ? AND "subject" = ? AND "user_id" = ?',
      ["linuxdo", subject, expected.id],
    );
    if (Number(rows[0]?.total ?? 0) !== 1) throw errProfileAuthorization;
    const affected = await tx.db.run(
      'UPDATE "auth_sessions" SET "reauthenticated_at" = ?, "updated_at" = ? WHERE "id" = ? AND "user_id" = ? AND "token_hash" = ?',
      [now, now, session.id, expected.id, session.tokenHash ?? ""],
    );
    if (affected !== 1) throw errProfileAuthorization;
  });
}

export async function linuxDOReauthenticationState(repo: Repository, stateHash: string): Promise<boolean> {
  const rows = await repo.db.all<{ reauth_user_id: string | null; reauth_session_id: string | null }>(
    'SELECT "reauth_user_id", "reauth_session_id" FROM "oauth_states" WHERE "provider" = ? AND "state_hash" = ? LIMIT 1',
    ["linuxdo", stateHash],
  );
  if (!rows.length) return false;
  return Boolean(rows[0].reauth_user_id) && Boolean(rows[0].reauth_session_id);
}

export async function latestEmailVerificationCode(
  repo: Repository,
  email: string,
  purpose: string,
): Promise<EmailVerificationCode | null> {
  const rows = await repo.db.all<{
    attempts: number;
    id: string;
    email: string;
    code_hash: string;
    purpose: string;
    expires_at: string;
    used_at: string | null;
    created_at: string;
  }>(
    'SELECT * FROM "email_verification_codes" WHERE "email" = ? AND "purpose" = ? AND "used_at" IS NULL ORDER BY "created_at" DESC LIMIT 1',
    [email, purpose],
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    attempts: Number(row.attempts ?? 0),
    id: row.id,
    email: row.email,
    codeHash: row.code_hash,
    purpose: row.purpose,
    expiresAt: toIso(row.expires_at),
    usedAt: toNullableIso(row.used_at),
    createdAt: toIso(row.created_at),
  };
}

export async function markEmailVerificationCodeUsed(repo: Repository, id: string, usedAt: string): Promise<void> {
  await repo.db.run('UPDATE "email_verification_codes" SET "used_at" = ? WHERE "id" = ? AND "used_at" IS NULL', [usedAt, id]);
}

export async function deleteEmailVerificationCode(repo: Repository, id: string): Promise<void> {
  await repo.db.run('DELETE FROM "email_verification_codes" WHERE "id" = ?', [id]);
}

export async function createUserWithEmailVerification(
  repo: Repository,
  user: User,
  verificationCodeId: string,
  usedAt: string,
): Promise<void> {
  await repo.transaction(async (tx) => {
    await lockRegistrationEmail(tx, user.email ?? "");
    await checkEmailAvailable(tx, user.email ?? "", "");
    const affected = await tx.db.run(
      'UPDATE "email_verification_codes" SET "used_at" = ? WHERE "id" = ? AND "used_at" IS NULL AND "expires_at" > ?',
      [usedAt, verificationCodeId, usedAt],
    );
    if (affected !== 1) throw new Error("邮箱验证码已失效，请重新获取");
    await insertUser(tx, user);
  });
}

export async function resetUserPasswordWithEmailVerification(
  repo: Repository,
  userId: string,
  email: string,
  purpose: string,
  verificationCodeId: string,
  passwordHash: string,
  usedAt: string,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const codeAffected = await tx.db.run(
      'UPDATE "email_verification_codes" SET "used_at" = ? WHERE "id" = ? AND "email" = ? AND "purpose" = ? AND "used_at" IS NULL AND "expires_at" > ?',
      [usedAt, verificationCodeId, email, purpose, usedAt],
    );
    if (codeAffected !== 1) throw errEmailVerificationCodeInvalid;
    const userAffected = await tx.db.run(
      'UPDATE "users" SET "password_hash" = ?, "updated_at" = ? WHERE "id" = ? AND "email" <> \'\' AND lower("email") = lower(?) AND "status" = ? AND "password_hash" <> \'\'',
      [passwordHash, usedAt, userId, email, userStatusActive],
    );
    if (userAffected !== 1) throw errEmailVerificationCodeInvalid;
    await tx.db.run('DELETE FROM "auth_sessions" WHERE "user_id" = ?', [userId]);
    await tx.db.run(
      'UPDATE "email_verification_codes" SET "used_at" = ? WHERE "email" = ? AND "purpose" = ? AND "used_at" IS NULL',
      [usedAt, email, purpose],
    );
  });
}

export async function deleteExpiredEmailVerificationCodes(repo: Repository, now: string): Promise<void> {
  await repo.db.run('DELETE FROM "email_verification_codes" WHERE "expires_at" <= ? OR "used_at" IS NOT NULL', [now]);
}

export async function users(repo: Repository): Promise<User[]> {
  const rows = await repo.db.all<UserRow>(`SELECT ${userColumns} FROM "users" ORDER BY "created_at" DESC`);
  return rows.map(mapUser);
}

export async function totalCreditBalance(repo: Repository): Promise<number> {
  try {
    const rows = await repo.db.all<{ total: number }>('SELECT COALESCE(SUM("available_microcredits"), 0) AS "total" FROM "credit_accounts"');
    return Number(rows[0]?.total ?? 0);
  } catch (error) {
    // 早期分析库可能没有钱包表；余额卡片是只读增强，不能让总览接口整体不可用。
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("no such table") || message.toLowerCase().includes("does not exist")) return 0;
    throw error;
  }
}

/** group 为空表示不过滤；default 分组同时匹配未分配分组（空编码）的用户。 */
export async function adminUsers(
  repo: Repository,
  keyword: string,
  role: User["role"],
  status: User["status"],
  group: string,
  limit: number,
  offset: number,
): Promise<{ users: User[]; total: number }> {
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  const groupValue = group.trim();
  if (groupValue === defaultUserGroupCode) {
    conditions.push(`("user_group" = ? OR "user_group" = '')`);
    values.push(groupValue);
  } else if (groupValue !== "") {
    conditions.push('"user_group" = ?');
    values.push(groupValue);
  }
  const keywordValue = keyword.trim();
  if (keywordValue !== "") {
    const pattern = `%${keywordValue.toLowerCase()}%`;
    conditions.push('(lower("username") LIKE ? OR lower("display_name") LIKE ? OR lower("email") LIKE ?)');
    values.push(pattern, pattern, pattern);
  }
  if (role === userRoleAdmin || role === userRoleUser) {
    conditions.push('"role" = ?');
    values.push(role);
  }
  if (status === userStatusActive || status === userStatusDisabled) {
    conditions.push('"status" = ?');
    values.push(status);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const totals = await repo.db.all<{ total: number }>(`SELECT COUNT(*) AS "total" FROM "users"${where}`, values);
  const rows = await repo.db.all<UserRow>(
    `SELECT ${userColumns} FROM "users"${where} ORDER BY "created_at" DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset],
  );
  return { users: rows.map(mapUser), total: Number(totals[0]?.total ?? 0) };
}

export async function adminUserReferences(repo: Repository): Promise<User[]> {
  const rows = await repo.db.all<{ id: string; username: string; display_name: string }>(
    'SELECT "id", "username", "display_name" FROM "users" ORDER BY "created_at" DESC LIMIT 100',
  );
  return rows.map((row) =>
    mapUser({
      id: row.id,
      username: row.username,
      email: null,
      phone: null,
      email_verified_at: null,
      phone_verified_at: null,
      display_name: row.display_name,
      avatar_mode: "",
      avatar_preset: null,
      avatar_version: null,
      role: "",
      status: "",
      is_promoter: false,
      user_group: null,
      password_hash: null,
      last_login_at: null,
      created_at: "",
      updated_at: "",
    }),
  );
}

export async function activeAdminCountExcluding(repo: Repository, userId: string): Promise<number> {
  let query = 'SELECT COUNT(*) AS "total" FROM "users" WHERE "role" = ? AND "status" = ?';
  const values: string[] = [userRoleAdmin, userStatusActive];
  if (userId !== "") {
    query += ' AND "id" <> ?';
    values.push(userId);
  }
  const rows = await repo.db.all<{ total: number }>(query, values);
  return Number(rows[0]?.total ?? 0);
}
