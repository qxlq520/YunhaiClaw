import type { AuthSession, User } from "@/internal/model/modelsIdentity";
import { recordNotFound, Repository, toBool, toIso, toNullableIso } from "./repository";

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
