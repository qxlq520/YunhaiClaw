// 对应 backend/internal/repository/skill_curation_roots.go
// 技能平台分类根节点、技能归属与默认分类的持久化。

import type { Skill } from "@/internal/model/modelsPlatform";
import { defaultSkillCurationRoots, type SkillCurationRoot, type SkillCurationRootAssignment } from "@/internal/model/skillCurationRoots";
import { Repository, toBool } from "./repository";

export const unassignedSkillRoot = "__unassigned__";

const skillCurationRootColumns = `"id", "name", "normalized_name", "icon_key", "sort_order", "enabled"`;

interface SkillCurationRootRow {
  id: string;
  name: string;
  normalized_name: string;
  icon_key: string;
  sort_order: number;
  enabled: unknown;
}

function mapSkillCurationRoot(row: SkillCurationRootRow): SkillCurationRoot {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    iconKey: row.icon_key,
    sortOrder: Number(row.sort_order ?? 0),
    enabled: toBool(row.enabled),
  };
}

async function insertSkillCurationRoot(repo: Repository, root: SkillCurationRoot): Promise<void> {
  await repo.db.run(
    `INSERT INTO "skill_curation_roots" (${skillCurationRootColumns}) VALUES (?, ?, ?, ?, ?, ?)`,
    [root.id, root.name, root.normalizedName ?? "", root.iconKey, root.sortOrder, root.enabled],
  );
}

export async function skillCurationRoots(repo: Repository): Promise<SkillCurationRoot[]> {
  const rows = await repo.db.all<SkillCurationRootRow>(
    `SELECT ${skillCurationRootColumns} FROM "skill_curation_roots" ORDER BY "sort_order", "id"`,
  );
  if (rows.length === 0) return defaultSkillCurationRoots();
  return rows.map(mapSkillCurationRoot);
}

export async function saveSkillCurationRoot(repo: Repository, root: SkillCurationRoot): Promise<void> {
  // 首次编辑前物化默认分类，保证已有子分类在空表兜底后仍挂在稳定的根节点 ID 上。
  const totals = await repo.db.all<{ total: number }>('SELECT COUNT(*) AS "total" FROM "skill_curation_roots"');
  if (Number(totals[0]?.total ?? 0) === 0) {
    for (const row of defaultSkillCurationRoots()) await insertSkillCurationRoot(repo, row);
  }
  const affected = await repo.db.run(
    'UPDATE "skill_curation_roots" SET "name" = ?, "normalized_name" = ?, "icon_key" = ?, "sort_order" = ?, "enabled" = ? WHERE "id" = ?',
    [root.name, root.normalizedName ?? "", root.iconKey, root.sortOrder, root.enabled, root.id],
  );
  if (affected === 0) await insertSkillCurationRoot(repo, root);
}

export async function assignSkillCurationRoot(repo: Repository, skillId: string, rootId: string): Promise<void> {
  await repo.db.run('DELETE FROM "skill_curation_root_assignments" WHERE "skill_id" = ?', [skillId]);
  if (rootId === "") return;
  await repo.db.run('INSERT INTO "skill_curation_root_assignments" ("skill_id", "root_id") VALUES (?, ?)', [skillId, rootId]);
}

export interface SkillCurationState {
  roots: SkillCurationRoot[];
  rootAssignments: SkillCurationRootAssignment[];
}

export function effectiveRoot(state: SkillCurationState, skill: Skill): string {
  let id = skill.tag;
  if (!skill.isPrivate) {
    for (const assignment of state.rootAssignments) {
      if (assignment.skillId === skill.id) {
        id = assignment.rootId;
        break;
      }
    }
  }
  for (const root of state.roots) {
    if (root.id === id && root.enabled) return id;
  }
  return unassignedSkillRoot;
}

// 显式归属覆盖来源标签；禁用或缺失的目标保留在默认桶，不会落到其他根节点。
export const curationRootId = `COALESCE((SELECT ra.root_id FROM skill_curation_root_assignments ra WHERE ra.skill_id = skills.id AND skills.is_private = false),skills.tag)`;
export const effectiveCurationRoot = `(CASE WHEN NOT EXISTS (SELECT 1 FROM skill_curation_roots) THEN CASE WHEN ${curationRootId} IN ('drama','ecommerce','creative','social','others') THEN ${curationRootId} ELSE '__unassigned__' END ELSE COALESCE((SELECT r.id FROM skill_curation_roots r WHERE r.enabled = true AND r.id = ${curationRootId}), '__unassigned__') END)`;
