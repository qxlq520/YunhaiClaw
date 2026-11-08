// 对应 backend/internal/repository/user_avatar.go
// 用户头像数据的持久化。

import type { User } from "@/internal/model/modelsIdentity";
import { userStatusActive } from "@/internal/model/models";
import { userById } from "./account";
import { errProfileAvatarUserUnavailable } from "./errors";
import { Repository } from "./repository";

export async function userAvatar(repo: Repository, userId: string): Promise<Uint8Array | null> {
  const rows = await repo.db.all<{ data: Uint8Array }>('SELECT "data" FROM "user_avatars" WHERE "user_id" = ? LIMIT 1', [userId]);
  return rows.length ? rows[0].data : null;
}

/**
 * 头像写入在用户行上串行化，保证负载与缓存版本来自同一次提交。
 */
export async function updateUserAvatar(
  repo: Repository,
  userId: string,
  data: Uint8Array | null,
  version: string,
  preset: string,
  now: string,
): Promise<User> {
  let user: User | null = null;
  await repo.transaction(async (tx) => {
    const mode = data && data.length > 0 ? "custom" : "default";
    const assignments = ['"avatar_mode" = ?', '"avatar_version" = ?', '"updated_at" = ?'];
    const values: (string | number | null)[] = [mode, version, now];
    if (mode === "default") {
      assignments.push('"avatar_preset" = ?');
      values.push(preset);
    }
    values.push(userId, userStatusActive);
    const affected = await tx.db.run(
      `UPDATE "users" SET ${assignments.join(", ")} WHERE "id" = ? AND "status" = ?`,
      values,
    );
    if (affected !== 1) throw errProfileAvatarUserUnavailable;
    if (mode === "custom") {
      await tx.db.run(
        'INSERT INTO "user_avatars" ("user_id", "data", "updated_at") VALUES (?, ?, ?) ON CONFLICT ("user_id") DO UPDATE SET "data" = excluded."data", "updated_at" = excluded."updated_at"',
        [userId, data, now],
      );
    } else {
      await tx.db.run('DELETE FROM "user_avatars" WHERE "user_id" = ?', [userId]);
    }
    user = await userById(tx, userId);
  });
  if (!user) throw errProfileAvatarUserUnavailable;
  return user;
}
