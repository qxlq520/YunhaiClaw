// 对应 backend/internal/repository/email_identity.go
// 邮箱唯一性校验与注册邮箱串行化。

import type { User } from "@/internal/model/modelsIdentity";
import { canonicalEmail } from "@/internal/emailidentity/email";
import { badAuthRequest } from "@/internal/kernel/errors";
import { Repository } from "./repository";

/**
 * 比较邮箱等价性，但不改写历史登录地址。
 * ACT: 与 Go 的 SQL 表达式等价，这里在应用层归一化；用户量级由邮箱唯一性约束兜底。
 */
export async function checkEmailAvailable(repo: Repository, email: string, ownId: string): Promise<void> {
  if (!email) return;
  const target = canonicalEmail(email);
  const rows = await repo.db.all<{ id: string; email: string }>(
    'SELECT "id", "email" FROM "users" WHERE "id" <> ? AND "email" <> \'\'',
    [ownId],
  );
  if (rows.some((row) => canonicalEmail(row.email) === target)) {
    throw badAuthRequest("邮箱已被注册");
  }
}

/** 所有公开注册路径先加锁再检查与写入。 */
export async function lockRegistrationEmail(tx: Repository, email: string): Promise<void> {
  if (tx.db.dialect === "postgres") {
    await tx.db.run('SELECT pg_advisory_xact_lock(hashtext(?)::bigint)', [`registration-email:${canonicalEmail(email)}`]);
    return;
  }
  if (tx.db.dialect === "sqlite") {
    await tx.db.run('UPDATE "users" SET "updated_at" = "updated_at" WHERE 1 = 0');
    return;
  }
  throw new Error("invalid database dialect");
}

export async function createRegisteredUser(repo: Repository, user: User): Promise<void> {
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
  });
}
