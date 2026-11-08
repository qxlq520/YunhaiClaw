// 对应 backend/internal/repository/oauth.go
// 第三方身份与 OAuth state 的持久化。

import type { OAuthState, User, UserIdentity } from "@/internal/model/modelsIdentity";
import { checkEmailAvailable, lockRegistrationEmail } from "./emailIdentity";
import { Repository, toIso, toNullableIso } from "./repository";

const identityColumns = `"id", "user_id", "provider", "subject", "provider_username", "avatar_url", "created_at", "updated_at"`;

interface IdentityRow {
  id: string;
  user_id: string;
  provider: string;
  subject: string;
  provider_username: string;
  avatar_url: string;
  created_at: string;
  updated_at: string;
}

function mapIdentity(row: IdentityRow): UserIdentity {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    subject: row.subject,
    providerUsername: row.provider_username,
    avatarUrl: row.avatar_url,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function userIdentity(repo: Repository, provider: string, subject: string): Promise<UserIdentity | null> {
  const rows = await repo.db.all<IdentityRow>(
    `SELECT ${identityColumns} FROM "user_identities" WHERE "provider" = ? AND "subject" = ? LIMIT 1`,
    [provider, subject],
  );
  return rows.length ? mapIdentity(rows[0]) : null;
}

export async function userIdentityForUser(repo: Repository, userId: string, provider: string): Promise<UserIdentity | null> {
  const rows = await repo.db.all<IdentityRow>(
    `SELECT ${identityColumns} FROM "user_identities" WHERE "user_id" = ? AND "provider" = ? LIMIT 1`,
    [userId, provider],
  );
  return rows.length ? mapIdentity(rows[0]) : null;
}

export async function createOAuthState(repo: Repository, state: OAuthState): Promise<void> {
  await repo.db.run(
    `INSERT INTO "oauth_states" ("reauth_user_id", "reauth_session_id", "id", "provider", "state_hash", "code_verifier", "next_path", "accepted_terms", "expires_at", "used_at", "created_at")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      state.reauthUserId ?? "",
      state.reauthSessionId ?? "",
      state.id,
      state.provider,
      state.stateHash ?? "",
      state.codeVerifier ?? "",
      state.nextPath,
      state.acceptedTerms,
      state.expiresAt,
      state.usedAt ?? null,
      state.createdAt,
    ],
  );
}

interface OAuthStateRow {
  reauth_user_id: string | null;
  reauth_session_id: string | null;
  id: string;
  provider: string;
  state_hash: string;
  code_verifier: string;
  next_path: string;
  accepted_terms: unknown;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

function mapOAuthState(row: OAuthStateRow): OAuthState {
  return {
    reauthUserId: row.reauth_user_id ?? "",
    reauthSessionId: row.reauth_session_id ?? "",
    id: row.id,
    provider: row.provider,
    stateHash: row.state_hash,
    codeVerifier: row.code_verifier,
    nextPath: row.next_path,
    acceptedTerms: row.accepted_terms === true || row.accepted_terms === 1 || row.accepted_terms === "1",
    expiresAt: toIso(row.expires_at),
    usedAt: toNullableIso(row.used_at),
    createdAt: toIso(row.created_at),
  };
}

export async function consumeOAuthState(repo: Repository, provider: string, stateHash: string): Promise<OAuthState | null> {
  let state: OAuthState | null = null;
  await repo.transaction(async (tx) => {
    const rows = await tx.db.all<OAuthStateRow>(
      'SELECT * FROM "oauth_states" WHERE "provider" = ? AND "state_hash" = ? AND "used_at" IS NULL AND "expires_at" > ? LIMIT 1',
      [provider, stateHash, new Date().toISOString()],
    );
    if (!rows.length) throw new Error("record not found");
    const current = mapOAuthState(rows[0]);
    const now = new Date().toISOString();
    const affected = await tx.db.run('UPDATE "oauth_states" SET "used_at" = ? WHERE "id" = ? AND "used_at" IS NULL', [now, current.id]);
    if (affected !== 1) throw new Error("record not found");
    current.usedAt = now;
    state = current;
  });
  return state;
}

export async function createOAuthUser(repo: Repository, user: User, identity: UserIdentity): Promise<void> {
  await repo.transaction(async (tx) => {
    await lockRegistrationEmail(tx, user.email ?? "");
    await checkEmailAvailable(tx, user.email ?? "", "");
    await tx.db.run(
      `INSERT INTO "users" ("id", "username", "email", "phone", "email_verified_at", "phone_verified_at", "display_name", "avatar_mode", "avatar_preset", "avatar_version", "role", "status", "is_promoter", "user_group", "password_hash", "last_login_at", "created_at", "updated_at")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    await tx.db.run(
      `INSERT INTO "user_identities" (${identityColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        identity.id,
        identity.userId,
        identity.provider,
        identity.subject,
        identity.providerUsername,
        identity.avatarUrl,
        identity.createdAt,
        identity.updatedAt,
      ],
    );
    await tx.db.run('INSERT INTO "credit_accounts" ("user_id") VALUES (?)', [user.id]);
  });
}
