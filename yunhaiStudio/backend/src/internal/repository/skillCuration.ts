// 对应 backend/internal/repository/skill_curation.go
// 技能分类总览、版本化更新与管理员审计。

import { forbidden, newAppError, newId } from "@/internal/kernel/errors";
import { userRoleAdmin, userStatusActive } from "@/internal/model/models";
import type { Skill } from "@/internal/model/modelsPlatform";
import type {
  SkillCurationAssignment,
  SkillCurationCategory,
  SkillCurationSetting,
} from "@/internal/model/skillCuration";
import type { SkillCurationRoot, SkillCurationRootAssignment } from "@/internal/model/skillCurationRoots";
import { recordNotFound, Repository, toBool } from "./repository";
import { effectiveCurationRoot, skillCurationRoots, unassignedSkillRoot } from "./skillCurationRoots";
import { mapSkillRow, skillColumns, type SkillRow } from "./skills";

export interface SkillCuration extends SkillCurationSetting {
  roots?: SkillCurationRoot[];
  rootAssignments?: SkillCurationRootAssignment[];
  categories: SkillCurationCategory[];
  assignments: SkillCurationAssignment[];
}

const skillCurationCategoryColumns = `"id", "root_tag", "name", "normalized_name", "sort_order", "enabled"`;

interface SkillCurationCategoryRow {
  id: string;
  root_tag: string;
  name: string;
  normalized_name: string | null;
  sort_order: number | null;
  enabled: unknown;
}

function mapSkillCurationCategory(row: SkillCurationCategoryRow): SkillCurationCategory {
  return {
    id: row.id,
    rootTag: row.root_tag,
    name: row.name,
    normalizedName: row.normalized_name ?? "",
    sortOrder: Number(row.sort_order ?? 0),
    enabled: toBool(row.enabled),
  };
}

async function readSkillCurationSetting(repo: Repository): Promise<SkillCurationSetting> {
  const rows = await repo.db.all<{ id: number; enabled: unknown; revision: number | null }>(
    'SELECT "id", "enabled", "revision" FROM "skill_curation_settings" WHERE "id" = ? LIMIT 1',
    [1],
  );
  if (rows.length === 0) throw recordNotFound;
  return { id: Number(rows[0].id ?? 1), enabled: toBool(rows[0].enabled), revision: Number(rows[0].revision ?? 0) };
}

// 读取快照前后各取一次版本号，避免并发编辑产生客户端可凭旧版本号覆盖的混合快照。
export async function skillCuration(repo: Repository, admin: boolean): Promise<SkillCuration> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const setting = await readSkillCurationSetting(repo);
    if (!admin && !setting.enabled) {
      return { enabled: setting.enabled, revision: setting.revision, categories: [], assignments: [] };
    }
    const roots: SkillCurationRoot[] = [];
    for (const root of await skillCurationRoots(repo)) {
      if (admin || root.enabled) roots.push(root);
    }
    if (!admin) {
      roots.push({ id: unassignedSkillRoot, name: "未归入启用分类", normalizedName: "", iconKey: "shapes", sortOrder: 0, enabled: true });
    }
    const rootAssignmentRows = await repo.db.all<{ skill_id: string; root_id: string }>(
      'SELECT "skill_curation_root_assignments"."skill_id", "skill_curation_root_assignments"."root_id" FROM "skill_curation_root_assignments" JOIN skills ON skills.id = skill_curation_root_assignments.skill_id WHERE skills.status = 1 AND skills.is_private = false ORDER BY "skill_id"',
    );
    const rootAssignments: SkillCurationRootAssignment[] = rootAssignmentRows.map((row) => ({
      skillId: row.skill_id,
      rootId: row.root_id,
    }));
    const categoryValues: (string | number | boolean | null)[] = [];
    let categoryWhere = "";
    if (!admin) {
      categoryWhere = ' WHERE "enabled" = ?';
      categoryValues.push(true);
    }
    let categories = (
      await repo.db.all<SkillCurationCategoryRow>(
        `SELECT ${skillCurationCategoryColumns} FROM "skill_curation_categories"${categoryWhere} ORDER BY "sort_order", "id"`,
        categoryValues,
      )
    ).map(mapSkillCurationCategory);
    if (!admin) {
      categories = categories.filter((category) => roots.some((root) => root.id === category.rootTag));
    }
    let assignmentsSql =
      'SELECT "skill_curation_assignments"."skill_id", "skill_curation_assignments"."category_id" FROM "skill_curation_assignments" JOIN skills ON skills.id = skill_curation_assignments.skill_id';
    const assignmentConditions = ["skills.status = 1", "skills.is_private = false"];
    if (!admin) {
      assignmentsSql += " JOIN skill_curation_categories c ON c.id = skill_curation_assignments.category_id";
      assignmentConditions.push(`c.enabled = true AND c.root_tag = ${effectiveCurationRoot}`);
    }
    assignmentsSql += ` WHERE ${assignmentConditions.join(" AND ")} ORDER BY "skill_id", "category_id"`;
    const assignmentRows = await repo.db.all<{ skill_id: string; category_id: string }>(assignmentsSql);
    const out: SkillCuration = {
      enabled: setting.enabled,
      revision: setting.revision,
      categories,
      assignments: assignmentRows.map((row) => ({ skillId: row.skill_id, categoryId: row.category_id })),
    };
    if (roots.length > 0) out.roots = roots;
    if (rootAssignments.length > 0) out.rootAssignments = rootAssignments;
    const after = await readSkillCurationSetting(repo);
    if (after.revision === out.revision) return out;
  }
  throw newAppError(409, "分类正在更新，请重新加载");
}

export async function updateSkillCuration(
  repo: Repository,
  actorId: string,
  revision: number,
  requestId: string,
  change: (repo: Repository) => Promise<void>,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const affected = await tx.db.run(
      'UPDATE "skill_curation_settings" SET "revision" = ? WHERE "id" = 1 AND "revision" = ?',
      [revision + 1, revision],
    );
    if (affected !== 1) throw newAppError(409, "分类版本已更新，请重新加载");
    const actors = await tx.db.all<{ role: string; status: string }>('SELECT "role", "status" FROM "users" WHERE "id" = ? LIMIT 1', [
      actorId,
    ]);
    if (actors.length === 0) throw recordNotFound;
    const actor = actors[0];
    if (actor.role !== userRoleAdmin || actor.status !== userStatusActive) throw forbidden("需要管理员权限");
    const before = await skillCuration(tx, true);
    await change(tx);
    const after = await skillCuration(tx, true);
    before.revision = revision;
    const metadata = JSON.stringify({ requestId, before, after });
    await tx.db.run(
      'INSERT INTO "admin_audit_events" ("id", "actor_user_id", "action", "target_type", "target_id", "summary", "metadata_json", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [newId(), actorId, "skill_curation.update", "skill_curation", "1", "", metadata, new Date().toISOString()],
    );
  });
}

export async function setSkillCurationEnabled(repo: Repository, enabled: boolean): Promise<void> {
  await repo.db.run('UPDATE "skill_curation_settings" SET "enabled" = ? WHERE "id" = 1', [enabled]);
}

async function insertSkillCurationCategory(repo: Repository, category: SkillCurationCategory): Promise<void> {
  await repo.db.run(
    `INSERT INTO "skill_curation_categories" (${skillCurationCategoryColumns}) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      category.id,
      category.rootTag,
      category.name,
      category.normalizedName ?? "",
      category.sortOrder,
      category.enabled,
    ],
  );
}

// GORM Save：按主键整行覆盖，行不存在时退化为插入。
export async function saveSkillCurationCategory(repo: Repository, category: SkillCurationCategory): Promise<void> {
  if (category.id === "") {
    await insertSkillCurationCategory(repo, category);
    return;
  }
  const affected = await repo.db.run(
    'UPDATE "skill_curation_categories" SET "root_tag" = ?, "name" = ?, "normalized_name" = ?, "sort_order" = ?, "enabled" = ? WHERE "id" = ?',
    [
      category.rootTag,
      category.name,
      category.normalizedName ?? "",
      category.sortOrder,
      category.enabled,
      category.id,
    ],
  );
  if (affected === 0) await insertSkillCurationCategory(repo, category);
}

export async function curationSkill(repo: Repository, id: string): Promise<Skill | null> {
  const locking = repo.dialect() === "postgres" ? " FOR UPDATE" : "";
  const rows = await repo.db.all<SkillRow>(
    `SELECT ${skillColumns} FROM "skills" WHERE "id" = ? AND "status" = ? AND "is_private" = ? LIMIT 1${locking}`,
    [id, 1, false],
  );
  return rows.length ? mapSkillRow(rows[0]) : null;
}

export async function assignSkillCuration(repo: Repository, skillId: string, ids: string[]): Promise<void> {
  await repo.db.run('DELETE FROM "skill_curation_assignments" WHERE "skill_id" = ?', [skillId]);
  for (const id of ids) {
    await repo.db.run('INSERT INTO "skill_curation_assignments" ("skill_id", "category_id") VALUES (?, ?)', [skillId, id]);
  }
}

export const effectiveCurationCategory = `SELECT 1 FROM skill_curation_assignments a JOIN skill_curation_categories c ON c.id = a.category_id WHERE a.skill_id = skills.id AND c.enabled = true AND c.root_tag = ${effectiveCurationRoot} AND skills.is_private = false`;
