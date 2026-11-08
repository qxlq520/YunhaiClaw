// 对应 backend/internal/repository/notifications.go
// 验证票据、通知配额与手机号相关的持久化。

import type { AuthVerification } from "@/internal/model/modelsNotifications";
import type { User } from "@/internal/model/modelsIdentity";
import { userStatusActive } from "@/internal/model/models";
import { userById } from "./account";
import { checkEmailAvailable, lockRegistrationEmail } from "./emailIdentity";
import { errNotificationLimit, errVerificationInvalid } from "./errors";
import { Repository } from "./repository";

export { errChannelConflict, errEmailVerificationCodeInvalid, errNotificationLimit, errVerificationInvalid } from "./errors";

export async function attemptLegacyEmailVerification(repo: Repository, id: string): Promise<void> {
  const now = new Date().toISOString();
  const affected = await repo.db.run(
    'UPDATE "email_verification_codes" SET "attempts" = "attempts" + 1 WHERE "id" = ? AND "attempts" < 5 AND "used_at" IS NULL AND "expires_at" > ?',
    [id, now],
  );
  if (affected !== 1) throw errVerificationInvalid;
}

export interface NotificationLimit {
  key: string;
  limit: number;
  cooldownMs: number;
  expiresAt: string;
}

async function reserveNotificationLimits(tx: Repository, limits: NotificationLimit[], now: string): Promise<void> {
  for (const limit of limits) {
    await tx.db.run(
      'INSERT INTO "notification_quotas" ("key", "count", "next_at", "expires_at") VALUES (?, 0, ?, ?) ON CONFLICT ("key") DO NOTHING',
      [limit.key, now, limit.expiresAt],
    );
    const affected = await tx.db.run(
      'UPDATE "notification_quotas" SET "count" = "count" + 1, "next_at" = ? WHERE "key" = ? AND "count" < ? AND "next_at" <= ?',
      [new Date(new Date(now).getTime() + limit.cooldownMs).toISOString(), limit.key, limit.limit, now],
    );
    if (affected !== 1) throw errNotificationLimit;
  }
}

export async function reserveNotificationLimitsFor(repo: Repository, limits: NotificationLimit[], now: string): Promise<void> {
  await repo.transaction((tx) => reserveNotificationLimits(tx, limits, now));
}

export async function createAuthVerification(repo: Repository, verification: AuthVerification, limits: NotificationLimit[]): Promise<void> {
  await repo.transaction(async (tx) => {
    // 这些行包含联系方式，只保留短暂的验证窗口。
    const now = new Date().toISOString();
    await tx.db.run('DELETE FROM "auth_verifications" WHERE "expires_at" < ?', [now]);
    await tx.db.run('DELETE FROM "notification_quotas" WHERE "expires_at" < ?', [now]);
    await reserveNotificationLimits(tx, limits, verification.createdAt);
    await tx.db.run(
      `INSERT INTO "auth_verifications" ("session_id", "credential_hash", "id", "token_hash", "purpose", "method", "user_id", "email", "phone", "email_hash", "phone_hash", "policy_hash", "ready", "attempts", "expires_at", "used_at", "created_at")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        verification.sessionId ?? "",
        verification.credentialHash ?? "",
        verification.id,
        verification.tokenHash,
        verification.purpose,
        verification.method,
        verification.userId,
        verification.email,
        verification.phone,
        verification.emailHash,
        verification.phoneHash,
        verification.policyHash,
        verification.ready,
        verification.attempts,
        verification.expiresAt,
        verification.usedAt ?? null,
        verification.createdAt,
      ],
    );
  });
}

interface AuthVerificationRow {
  session_id: string | null;
  credential_hash: string | null;
  id: string;
  token_hash: string;
  purpose: string;
  method: string;
  user_id: string;
  email: string;
  phone: string;
  email_hash: string;
  phone_hash: string;
  policy_hash: string;
  ready: unknown;
  attempts: number;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

function mapAuthVerification(row: AuthVerificationRow): AuthVerification {
  return {
    sessionId: row.session_id ?? "",
    credentialHash: row.credential_hash ?? "",
    id: row.id,
    tokenHash: row.token_hash,
    purpose: row.purpose,
    method: row.method,
    userId: row.user_id,
    email: row.email,
    phone: row.phone,
    emailHash: row.email_hash,
    phoneHash: row.phone_hash,
    policyHash: row.policy_hash,
    ready: row.ready === true || row.ready === 1 || row.ready === "1",
    attempts: Number(row.attempts ?? 0),
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    createdAt: row.created_at,
  };
}

export async function authVerification(repo: Repository, id: string): Promise<AuthVerification | null> {
  const rows = await repo.db.all<AuthVerificationRow>('SELECT * FROM "auth_verifications" WHERE "id" = ? LIMIT 1', [id]);
  return rows.length ? mapAuthVerification(rows[0]) : null;
}

export async function setAuthVerificationReady(repo: Repository, id: string): Promise<void> {
  await repo.db.run('UPDATE "auth_verifications" SET "ready" = ? WHERE "id" = ?', [true, id]);
}

export async function attemptAuthVerification(repo: Repository, id: string, now: string): Promise<void> {
  const affected = await repo.db.run(
    'UPDATE "auth_verifications" SET "attempts" = "attempts" + 1 WHERE "id" = ? AND "ready" = ? AND "used_at" IS NULL AND "expires_at" > ? AND "attempts" < 5',
    [id, true, now],
  );
  if (affected !== 1) throw errVerificationInvalid;
}

async function consumeVerification(tx: Repository, id: string, now: string): Promise<void> {
  const affected = await tx.db.run(
    'UPDATE "auth_verifications" SET "used_at" = ? WHERE "id" = ? AND "ready" = ? AND "used_at" IS NULL AND "expires_at" > ? AND "attempts" <= 5',
    [now, id, true, now],
  );
  if (affected !== 1) throw errVerificationInvalid;
}

export async function createUserWithVerification(repo: Repository, user: User, id: string): Promise<void> {
  await repo.transaction(async (tx) => {
    await lockRegistrationEmail(tx, user.email ?? "");
    await checkEmailAvailable(tx, user.email ?? "", "");
    await consumeVerification(tx, id, new Date().toISOString());
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
  });
}

export async function completeAuthVerification(repo: Repository, verification: AuthVerification, bind: boolean): Promise<User> {
  let user: User | null = null;
  await repo.transaction(async (tx) => {
    if (bind && verification.email) {
      await lockRegistrationEmail(tx, verification.email);
      await checkEmailAvailable(tx, verification.email, verification.userId);
    }
    const now = new Date().toISOString();
    await consumeVerification(tx, verification.id, now);
    const conditions = ['"id" = ?', '"status" = ?'];
    const values: (string | number | boolean | null)[] = [verification.userId, userStatusActive];
    const assignments: string[] = ['"updated_at" = ?'];
    const assignmentsValues: (string | number | boolean | null)[] = [now];
    if (bind) {
      if (verification.email) {
        assignments.push('"email" = ?', '"email_verified_at" = ?');
        assignmentsValues.push(verification.email, now);
      }
      if (verification.phone) {
        assignments.push('"phone" = ?', '"phone_verified_at" = ?');
        assignmentsValues.push(verification.phone, now);
      }
    } else {
      if (verification.email) {
        conditions.push('"email" = ?', '"email_verified_at" IS NOT NULL');
        values.push(verification.email);
      }
      if (verification.phone) {
        conditions.push('"phone" = ?', '"phone_verified_at" IS NOT NULL');
        values.push(verification.phone);
      }
      assignments.push('"last_login_at" = ?');
      assignmentsValues.push(now);
    }
    const affected = await tx.db.run(
      `UPDATE "users" SET ${assignments.join(", ")} WHERE ${conditions.join(" AND ")}`,
      [...assignmentsValues, ...values],
    );
    if (affected !== 1) throw errVerificationInvalid;
    user = await userById(tx, verification.userId);
  });
  if (!user) throw errVerificationInvalid;
  return user;
}

export async function userByPhone(repo: Repository, phone: string): Promise<User | null> {
  const rows = await repo.db.all<{ id: string }>('SELECT "id" FROM "users" WHERE "phone" = ? LIMIT 1', [phone]);
  return rows.length ? userById(repo, rows[0].id) : null;
}
