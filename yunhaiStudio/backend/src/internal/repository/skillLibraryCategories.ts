// 对应 backend/internal/repository/skill_library_categories.go
// 用户技能库自定义分类的持久化。

import type { SkillLibraryCategory, UserSkillState } from "@/internal/model/modelsPlatform";
import { Repository, toIso } from "./repository";
import { userSkillStateColumns } from "./skills";

const platformSkillLibraryCategoryOwnerId = "__platform__";

const skillLibraryCategoryColumns = `"id", "name", "normalized_name", "scope", "owner_id", "created_at", "updated_at"`;

interface SkillLibraryCategoryRow {
  id: string;
  name: string;
  normalized_name: string | null;
  scope: string;
  owner_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function mapSkillLibraryCategory(row: SkillLibraryCategoryRow): SkillLibraryCategory {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name ?? "",
    scope: row.scope,
    ownerId: row.owner_id ?? "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function insertSkillLibraryCategory(repo: Repository, category: SkillLibraryCategory): Promise<void> {
  await repo.db.run(
    `INSERT INTO "skill_library_categories" (${skillLibraryCategoryColumns}) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      category.id,
      category.name,
      category.normalizedName ?? "",
      category.scope,
      category.ownerId ?? "",
      category.createdAt,
      category.updatedAt,
    ],
  );
}

export async function skillLibraryCategories(repo: Repository, userId: string): Promise<SkillLibraryCategory[]> {
  const rows = await repo.db.all<SkillLibraryCategoryRow>(
    `SELECT ${skillLibraryCategoryColumns} FROM "skill_library_categories" WHERE "scope" = ? OR ("scope" = ? AND "owner_id" = ?) ORDER BY CASE WHEN "scope" = 'platform' THEN 0 ELSE 1 END, "normalized_name" ASC, "created_at" ASC`,
    ["platform", "personal", userId],
  );
  return rows.map(mapSkillLibraryCategory);
}

export async function skillLibraryCategory(repo: Repository, id: string): Promise<SkillLibraryCategory | null> {
  const rows = await repo.db.all<SkillLibraryCategoryRow>(
    `SELECT ${skillLibraryCategoryColumns} FROM "skill_library_categories" WHERE "id" = ? LIMIT 1`,
    [id],
  );
  return rows.length ? mapSkillLibraryCategory(rows[0]) : null;
}

// CreateSkillLibraryCategoryIfAvailable 在用户可见命名空间内原子校验并插入分类。
// 平台分类名与所有个人分类冲突；个人分类名与平台分类及该用户的个人分类冲突。
export async function createSkillLibraryCategoryIfAvailable(
  repo: Repository,
  userId: string,
  category: SkillLibraryCategory,
): Promise<boolean> {
  if (category.scope === "platform") category.ownerId = platformSkillLibraryCategoryOwnerId;
  let created = false;
  await repo.transaction(async (tx) => {
    switch (tx.dialect()) {
      case "postgres":
        await tx.db.all("SELECT pg_advisory_xact_lock(hashtext(?)::bigint)", [category.normalizedName ?? ""]);
        break;
      case "sqlite":
        // SQLite 没有 advisory lock；先执行一次写语句，避免并发名称检查同时通过。
        await tx.db.run('UPDATE "skill_library_categories" SET "updated_at" = "updated_at" WHERE 1 = 0');
        break;
      default:
        throw new Error("invalid database dialect");
    }
    const conditions: string[] = ['"normalized_name" = ?'];
    const values: (string | number | boolean | null)[] = [category.normalizedName ?? ""];
    if (category.scope === "personal") {
      conditions.push('("scope" = ? OR ("scope" = ? AND "owner_id" = ?))');
      values.push("platform", "personal", userId);
    }
    const totals = await tx.db.all<{ total: number }>(
      `SELECT COUNT(*) AS "total" FROM "skill_library_categories" WHERE ${conditions.join(" AND ")}`,
      values,
    );
    if (Number(totals[0]?.total ?? 0) > 0) return;
    await insertSkillLibraryCategory(tx, category);
    created = true;
  });
  return created;
}

export async function deleteSkillLibraryCategory(repo: Repository, id: string): Promise<void> {
  await repo.transaction(async (tx) => {
    await tx.db.run('UPDATE "user_skill_states" SET "library_category_id" = ?, "updated_at" = ? WHERE "library_category_id" = ?', [
      "",
      new Date().toISOString(),
      id,
    ]);
    await tx.db.run('DELETE FROM "skill_library_categories" WHERE "id" = ?', [id]);
  });
}

export async function skillLibraryCategoryCounts(
  repo: Repository,
  userId: string,
  scope: string,
): Promise<Record<string, number>> {
  const conditions: string[] = ["skills.status = ?"];
  const values: (string | number | boolean | null)[] = [userId, 1];
  switch (scope) {
    case "mine":
      conditions.push("(skills.owner_id = ? OR (user_skill_states.added = ? AND skills.is_private = ?))");
      values.push(userId, true, false);
      break;
    case "created":
      conditions.push("skills.owner_id = ?");
      values.push(userId);
      break;
    default:
      throw new Error("invalid data");
  }
  const rows = await repo.db.all<{ library_category_id: string; count: number }>(
    `SELECT COALESCE(user_skill_states."library_category_id", '') AS "library_category_id", COUNT(*) AS "count" FROM "skills" LEFT JOIN user_skill_states ON user_skill_states.skill_id = skills.id AND user_skill_states.user_id = ? WHERE ${conditions.join(" AND ")} GROUP BY user_skill_states."library_category_id"`,
    values,
  );
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.library_category_id ?? ""] = Number(row.count ?? 0);
  return counts;
}

export async function setUserSkillLibraryCategory(repo: Repository, state: UserSkillState): Promise<void> {
  await repo.db.run(
    `INSERT INTO "user_skill_states" (${userSkillStateColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT ("user_id", "skill_id") DO UPDATE SET "library_category_id" = excluded."library_category_id", "updated_at" = excluded."updated_at"`,
    [
      state.id,
      state.userId,
      state.skillId,
      state.libraryCategoryId,
      state.installedVersionId,
      state.autoUpdate,
      state.added,
      state.liked,
      state.agentMode ?? "",
      state.agentUseCount,
      state.agentLastUsedAt ?? null,
      state.createdAt,
      state.updatedAt,
    ],
  );
}
