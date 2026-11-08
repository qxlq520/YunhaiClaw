// 对应 backend/internal/repository/skills.go
// 技能广场、用户技能库状态、内置技能幂等更新与技能统计的持久化。

import type { SqlValue } from "@/internal/database/database";
import type { User } from "@/internal/model/modelsIdentity";
import type { Skill, UserSkillState } from "@/internal/model/modelsPlatform";
import { recordNotFound, Repository, toBool, toIso, toNullableIso } from "./repository";
import { effectiveCurationCategory } from "./skillCuration";
import { effectiveCurationRoot } from "./skillCurationRoots";

export interface SkillListFilter {
  platformRootId: string;
  platformCategoryId: string;
  platformUncategorized: boolean;
  userId: string;
  scope: string;
  search: string;
  tag: string;
  libraryCategoryId: string;
  libraryUncategorized: boolean;
  sort: string;
  limit: number;
  offset: number;
}

export interface AdminSkillListFilter {
  keyword: string;
  status: string;
  sourceType: string;
  tag: string;
  limit: number;
  offset: number;
}

export interface SkillMetrics {
  skillId: string;
  addedCount: number;
  likeCount: number;
}

export interface SkillCategoryCount {
  tag: string;
  count: number;
}

export interface SkillRow {
  id: string;
  owner_id: string | null;
  author_name: string | null;
  author_avatar_url: string | null;
  name: string | null;
  description: string | null;
  instruction: string | null;
  current_version_id: string | null;
  version_label: string | null;
  content_hash: string | null;
  file_count: number | null;
  total_bytes: number | null;
  source_type: string | null;
  source_url: string | null;
  source_ref: string | null;
  source_subdir: string | null;
  source_commit: string | null;
  sync_status: string | null;
  sync_error: string | null;
  auto_update: unknown;
  last_checked_at: string | null;
  last_synced_at: string | null;
  status: number | null;
  source: number | null;
  tag: string | null;
  sort_weight: number | null;
  is_private: unknown;
  markdown_url: string | null;
  showcase_media_json: string | null;
  extra_info: string | null;
  initial_like_count: number | null;
  initial_added_count: number | null;
  admin_info_edited_at: string | null;
  admin_content_edited_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export const skillColumns = `"id", "owner_id", "author_name", "author_avatar_url", "name", "description", "instruction", "current_version_id", "version_label", "content_hash", "file_count", "total_bytes", "source_type", "source_url", "source_ref", "source_subdir", "source_commit", "sync_status", "sync_error", "auto_update", "last_checked_at", "last_synced_at", "status", "source", "tag", "sort_weight", "is_private", "markdown_url", "showcase_media_json", "extra_info", "initial_like_count", "initial_added_count", "admin_info_edited_at", "admin_content_edited_at", "created_at", "updated_at"`;

export const userSkillStateColumns = `"id", "user_id", "skill_id", "library_category_id", "installed_version_id", "auto_update", "added", "liked", "agent_mode", "agent_use_count", "agent_last_used_at", "created_at", "updated_at"`;

// 只由 updateSkillStatus 修改；同步、编辑等整行保存可能持有下架前读出的旧行，不能把下架改回上架。
const skillStatusColumn = "status";

export function mapSkillRow(row: SkillRow): Skill {
  return {
    id: row.id,
    ownerId: row.owner_id ?? "",
    authorName: row.author_name ?? "",
    authorAvatarUrl: row.author_avatar_url ?? "",
    name: row.name ?? "",
    description: row.description ?? "",
    instruction: row.instruction ?? "",
    currentVersionId: row.current_version_id ?? "",
    versionLabel: row.version_label ?? "",
    contentHash: row.content_hash ?? "",
    fileCount: Number(row.file_count ?? 0),
    totalBytes: Number(row.total_bytes ?? 0),
    sourceType: row.source_type ?? "",
    sourceUrl: row.source_url ?? "",
    sourceRef: row.source_ref ?? "",
    sourceSubdir: row.source_subdir ?? "",
    sourceCommit: row.source_commit ?? "",
    syncStatus: row.sync_status ?? "",
    syncError: row.sync_error ?? "",
    autoUpdate: toBool(row.auto_update),
    lastCheckedAt: toNullableIso(row.last_checked_at),
    lastSyncedAt: toNullableIso(row.last_synced_at),
    status: Number(row.status ?? 0),
    source: Number(row.source ?? 0),
    tag: row.tag ?? "",
    sortWeight: Number(row.sort_weight ?? 0),
    isPrivate: toBool(row.is_private),
    markdownUrl: row.markdown_url ?? "",
    showcaseMediaJson: row.showcase_media_json ?? "",
    extraInfo: row.extra_info ?? "",
    initialLikeCount: Number(row.initial_like_count ?? 0),
    initialAddedCount: Number(row.initial_added_count ?? 0),
    adminInfoEditedAt: toNullableIso(row.admin_info_edited_at),
    adminContentEditedAt: toNullableIso(row.admin_content_edited_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function skillColumnValues(skill: Skill): [string, SqlValue][] {
  return [
    ["id", skill.id],
    ["owner_id", skill.ownerId],
    ["author_name", skill.authorName],
    ["author_avatar_url", skill.authorAvatarUrl],
    ["name", skill.name],
    ["description", skill.description],
    ["instruction", skill.instruction],
    ["current_version_id", skill.currentVersionId],
    ["version_label", skill.versionLabel],
    ["content_hash", skill.contentHash],
    ["file_count", skill.fileCount],
    ["total_bytes", skill.totalBytes],
    ["source_type", skill.sourceType],
    ["source_url", skill.sourceUrl],
    ["source_ref", skill.sourceRef],
    ["source_subdir", skill.sourceSubdir],
    ["source_commit", skill.sourceCommit],
    ["sync_status", skill.syncStatus],
    ["sync_error", skill.syncError],
    ["auto_update", skill.autoUpdate],
    ["last_checked_at", skill.lastCheckedAt ?? null],
    ["last_synced_at", skill.lastSyncedAt ?? null],
    ["status", skill.status],
    ["source", skill.source],
    ["tag", skill.tag],
    ["sort_weight", skill.sortWeight],
    ["is_private", skill.isPrivate],
    ["markdown_url", skill.markdownUrl],
    ["showcase_media_json", skill.showcaseMediaJson ?? ""],
    ["extra_info", skill.extraInfo],
    ["initial_like_count", skill.initialLikeCount],
    ["initial_added_count", skill.initialAddedCount],
    ["admin_info_edited_at", skill.adminInfoEditedAt ?? null],
    ["admin_content_edited_at", skill.adminContentEditedAt ?? null],
    ["created_at", skill.createdAt],
    ["updated_at", skill.updatedAt],
  ];
}

function quoteIdentifier(column: string): string {
  return `"${column.replace(/"/g, '""')}"`;
}

export async function insertSkillRow(repo: Repository, skill: Skill, omitColumns: string[] = []): Promise<void> {
  const entries = skillColumnValues(skill).filter(([column]) => !omitColumns.includes(column));
  const columns = entries.map(([column]) => quoteIdentifier(column)).join(", ");
  const placeholders = entries.map(() => "?").join(", ");
  await repo.db.run(
    `INSERT INTO "skills" (${columns}) VALUES (${placeholders})`,
    entries.map(([, value]) => value),
  );
}

// GORM Save：按主键整行覆盖（status 除外），行不存在时退化为插入。
export async function saveSkillRow(repo: Repository, skill: Skill): Promise<void> {
  const entries = skillColumnValues(skill).filter(([column]) => column !== "id" && column !== skillStatusColumn);
  const assignments = entries.map(([column]) => `${quoteIdentifier(column)} = ?`).join(", ");
  const affected = await repo.db.run(`UPDATE "skills" SET ${assignments} WHERE "id" = ?`, [...entries.map(([, value]) => value), skill.id]);
  if (affected === 0) await insertSkillRow(repo, skill, [skillStatusColumn]);
}

interface UserSkillStateRow {
  id: string;
  user_id: string | null;
  skill_id: string | null;
  library_category_id: string | null;
  installed_version_id: string | null;
  auto_update: unknown;
  added: unknown;
  liked: unknown;
  agent_mode: string | null;
  agent_use_count: number | null;
  agent_last_used_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function mapUserSkillState(row: UserSkillStateRow): UserSkillState {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    skillId: row.skill_id ?? "",
    libraryCategoryId: row.library_category_id ?? "",
    installedVersionId: row.installed_version_id ?? "",
    autoUpdate: toBool(row.auto_update),
    added: toBool(row.added),
    liked: toBool(row.liked),
    agentMode: row.agent_mode ?? "",
    agentUseCount: Number(row.agent_use_count ?? 0),
    agentLastUsedAt: toNullableIso(row.agent_last_used_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function userSkillStateValues(state: UserSkillState): SqlValue[] {
  return [
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
  ];
}

export async function insertUserSkillState(repo: Repository, state: UserSkillState): Promise<void> {
  await repo.db.run(
    `INSERT INTO "user_skill_states" (${userSkillStateColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userSkillStateValues(state),
  );
}

async function insertSkills(repo: Repository, skills: Skill[], conflict: string): Promise<void> {
  const values: SqlValue[] = [];
  const rows: string[] = [];
  for (const skill of skills) {
    const entries = skillColumnValues(skill);
    values.push(...entries.map(([, value]) => value));
    rows.push(`(${entries.map(() => "?").join(", ")})`);
  }
  await repo.db.run(`INSERT INTO "skills" (${skillColumns}) VALUES ${rows.join(", ")} ${conflict}`, values);
}

// PublicSkillCategoryCounts 返回技能广场中已启用公开技能的共享分类数量。
export async function publicSkillCategoryCounts(repo: Repository): Promise<Record<string, number>> {
  const rows = await repo.db.all<{ tag: string | null; count: number }>(
    'SELECT "tag", COUNT(*) AS "count" FROM "skills" WHERE "status" = ? AND "is_private" = ? GROUP BY "tag"',
    [1, false],
  );
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.tag ?? ""] = Number(row.count ?? 0);
  return counts;
}

export async function skills(repo: Repository, filter: SkillListFilter): Promise<{ skills: Skill[]; total: number }> {
  const joins: string[] = [];
  const joinValues: SqlValue[] = [];
  const conditions: string[] = ["skills.status = ?"];
  const values: SqlValue[] = [1];
  switch (filter.scope) {
    case "mine":
      joins.push("LEFT JOIN user_skill_states ON user_skill_states.skill_id = skills.id AND user_skill_states.user_id = ?");
      joinValues.push(filter.userId);
      conditions.push("(skills.owner_id = ? OR (user_skill_states.added = ? AND skills.is_private = ?))");
      values.push(filter.userId, true, false);
      break;
    case "created":
      conditions.push("skills.owner_id = ?");
      values.push(filter.userId);
      if (filter.libraryCategoryId !== "" || filter.libraryUncategorized) {
        joins.push("LEFT JOIN user_skill_states ON user_skill_states.skill_id = skills.id AND user_skill_states.user_id = ?");
        joinValues.push(filter.userId);
      }
      break;
    case "favorites":
      joins.push("JOIN user_skill_states ON user_skill_states.skill_id = skills.id AND user_skill_states.user_id = ? AND user_skill_states.liked = ?");
      joinValues.push(filter.userId, true);
      conditions.push("(skills.owner_id = ? OR skills.is_private = ?)");
      values.push(filter.userId, false);
      break;
    default:
      conditions.push("skills.is_private = ?");
      values.push(false);
      break;
  }
  if (filter.search !== "") {
    const pattern = `%${filter.search.toLowerCase()}%`;
    joins.push("LEFT JOIN users skill_owners ON skill_owners.id = skills.owner_id");
    conditions.push(
      "(lower(skills.name) LIKE ? OR lower(skills.description) LIKE ? OR lower(skills.instruction) LIKE ? OR lower(skills.extra_info) LIKE ? OR lower(skills.author_name) LIKE ? OR lower(skill_owners.display_name) LIKE ? OR lower(skill_owners.username) LIKE ?)",
    );
    values.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }
  if (filter.tag !== "") {
    conditions.push("skills.tag = ?");
    values.push(filter.tag);
  }
  if (filter.platformRootId !== "") {
    conditions.push(`${effectiveCurationRoot} = ?`);
    values.push(filter.platformRootId);
  }
  if (filter.platformCategoryId !== "") {
    conditions.push(`EXISTS (${effectiveCurationCategory} AND c.id = ?)`);
    values.push(filter.platformCategoryId);
  }
  if (filter.platformUncategorized) {
    conditions.push(`NOT EXISTS (${effectiveCurationCategory})`);
  }
  if (filter.libraryCategoryId !== "") {
    conditions.push("user_skill_states.library_category_id = ?");
    values.push(filter.libraryCategoryId);
  } else if (filter.libraryUncategorized) {
    conditions.push("COALESCE(user_skill_states.library_category_id, '') = ''");
  }
  const from = joins.length ? ` FROM "skills" ${joins.join(" ")}` : ` FROM "skills"`;
  const where = ` WHERE ${conditions.join(" AND ")}`;
  // 用户状态按用户和技能唯一，列表 JOIN 不会重复；不要设置 DISTINCT，避免 PostgreSQL 的热门排序查询额外去重。
  const totals = await repo.db.all<{ total: number }>(`SELECT COUNT(*) AS "total"${from}${where}`, [...joinValues, ...values]);
  let order = "skills.sort_weight desc, skills.updated_at desc";
  switch (filter.sort) {
    case "new":
      order = "skills.created_at desc";
      break;
    case "popular":
      order =
        "(skills.initial_added_count + (SELECT COUNT(*) FROM user_skill_states metric_states WHERE metric_states.skill_id = skills.id AND metric_states.added = true)) desc, skills.updated_at desc";
      break;
  }
  const pageValues: SqlValue[] = [...joinValues, ...values];
  const pageClauses: string[] = [];
  if (filter.limit >= 0) {
    pageClauses.push("LIMIT ?");
    pageValues.push(filter.limit);
  }
  if (filter.offset > 0) {
    pageClauses.push("OFFSET ?");
    pageValues.push(filter.offset);
  }
  const page = pageClauses.length ? ` ${pageClauses.join(" ")}` : "";
  const rows = await repo.db.all<SkillRow>(`SELECT skills.*${from}${where} ORDER BY ${order}${page}`, pageValues);
  return { skills: rows.map(mapSkillRow), total: Number(totals[0]?.total ?? 0) };
}

// 内置技能使用稳定的外部技能 ID 幂等更新，用户加入和收藏关系保留在独立状态表中。
// columns 是冲突时覆盖的列，由调用方按管理员是否改过该技能决定；status 不应出现在其中，下架状态只由管理员修改。
export async function upsertBuiltinSkills(repo: Repository, skillsToUpsert: Skill[], columns: string[]): Promise<void> {
  if (skillsToUpsert.length === 0) throw new Error("builtin skills are empty");
  if (columns.length === 0) {
    await insertSkills(repo, skillsToUpsert, 'ON CONFLICT ("id") DO NOTHING');
    return;
  }
  const updates = columns.map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`).join(", ");
  await insertSkills(repo, skillsToUpsert, `ON CONFLICT ("id") DO UPDATE SET ${updates}`);
}

export async function skill(repo: Repository, id: string): Promise<Skill | null> {
  const rows = await repo.db.all<SkillRow>(`SELECT ${skillColumns} FROM "skills" WHERE "id" = ? AND "status" = ? LIMIT 1`, [id, 1]);
  return rows.length ? mapSkillRow(rows[0]) : null;
}

// SkillAnyStatus 读取技能而不过滤上架状态，只给管理员入口和内置技能同步使用。
export async function skillAnyStatus(repo: Repository, id: string): Promise<Skill | null> {
  const rows = await repo.db.all<SkillRow>(`SELECT ${skillColumns} FROM "skills" WHERE "id" = ? LIMIT 1`, [id]);
  return rows.length ? mapSkillRow(rows[0]) : null;
}

export async function skillsByIDsAnyStatus(repo: Repository, ids: string[]): Promise<Skill[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await repo.db.all<SkillRow>(`SELECT ${skillColumns} FROM "skills" WHERE "id" IN (${placeholders})`, ids);
  return rows.map(mapSkillRow);
}

// AdminSkills 列出全部技能（含私有和已下架），按最近更新排序。
export async function adminSkills(
  repo: Repository,
  filter: AdminSkillListFilter,
): Promise<{ skills: Skill[]; total: number }> {
  const conditions: string[] = [];
  const values: SqlValue[] = [];
  switch (filter.status) {
    case "enabled":
      conditions.push("skills.status = ?");
      values.push(1);
      break;
    case "disabled":
      conditions.push("COALESCE(skills.status, 0) <> ?");
      values.push(1);
      break;
  }
  switch (filter.sourceType) {
    case "":
      break;
    case "markdown":
      conditions.push("skills.source_type IN (?, ?)");
      values.push("markdown", "");
      break;
    default:
      conditions.push("skills.source_type = ?");
      values.push(filter.sourceType);
      break;
  }
  if (filter.tag !== "") {
    conditions.push("skills.tag = ?");
    values.push(filter.tag);
  }
  let joins = "";
  if (filter.keyword !== "") {
    const pattern = `%${filter.keyword.toLowerCase()}%`;
    joins = " LEFT JOIN users skill_owners ON skill_owners.id = skills.owner_id";
    conditions.push(
      "(skills.id = ? OR lower(skills.name) LIKE ? OR lower(skills.description) LIKE ? OR lower(skills.author_name) LIKE ? OR lower(skill_owners.display_name) LIKE ? OR lower(skill_owners.username) LIKE ? OR lower(skills.source_url) LIKE ?)",
    );
    values.push(filter.keyword, pattern, pattern, pattern, pattern, pattern, pattern);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const totals = await repo.db.all<{ total: number }>(`SELECT COUNT(*) AS "total" FROM "skills"${joins}${where}`, values);
  const pageValues: SqlValue[] = [...values];
  const pageClauses: string[] = [];
  if (filter.limit >= 0) {
    pageClauses.push("LIMIT ?");
    pageValues.push(filter.limit);
  }
  if (filter.offset > 0) {
    pageClauses.push("OFFSET ?");
    pageValues.push(filter.offset);
  }
  const page = pageClauses.length ? ` ${pageClauses.join(" ")}` : "";
  const rows = await repo.db.all<SkillRow>(
    `SELECT skills.* FROM "skills"${joins}${where} ORDER BY skills.updated_at desc, skills.id asc${page}`,
    pageValues,
  );
  return { skills: rows.map(mapSkillRow), total: Number(totals[0]?.total ?? 0) };
}

// UpdateSkillStatus 只改上架状态，不刷新 updated_at，避免下架 / 上架改变技能广场的“最近更新”排序。
export async function updateSkillStatus(repo: Repository, id: string, status: number): Promise<void> {
  await repo.db.run('UPDATE "skills" SET "status" = ? WHERE "id" = ?', [status, id]);
}

// UpdateSkillFields 按列更新技能行，避免整行保存覆盖并发写入的状态或版本字段。
export async function updateSkillFields(repo: Repository, id: string, fields: Record<string, unknown>): Promise<void> {
  const entries: [string, SqlValue][] = Object.entries(fields).map(([column, value]) => [column, (value ?? null) as SqlValue]);
  if (!entries.some(([column]) => column === "updated_at")) entries.push(["updated_at", new Date().toISOString()]);
  const assignments = entries.map(([column]) => `${quoteIdentifier(column)} = ?`).join(", ");
  await repo.db.run(`UPDATE "skills" SET ${assignments} WHERE "id" = ?`, [...entries.map(([, value]) => value), id]);
}

export async function createSkill(repo: Repository, skillRow: Skill, ownerState: UserSkillState): Promise<void> {
  await repo.transaction(async (tx) => {
    await insertSkillRow(tx, skillRow);
    await insertUserSkillState(tx, ownerState);
  });
}

export async function deleteSkill(repo: Repository, id: string): Promise<void> {
  await repo.transaction(async (tx) => {
    const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    const locked = await tx.db.all<{ id: string }>(`SELECT "id" FROM "skills" WHERE "id" = ? LIMIT 1${locking}`, [id]);
    if (locked.length === 0) throw recordNotFound;
    await tx.db.run('DELETE FROM "skill_curation_assignments" WHERE "skill_id" = ?', [id]);
    await tx.db.run('DELETE FROM "skill_curation_root_assignments" WHERE "skill_id" = ?', [id]);
    await tx.db.run('DELETE FROM "user_skill_states" WHERE "skill_id" = ?', [id]);
    const versions = await tx.db.all<{ id: string }>('SELECT "id" FROM "skill_versions" WHERE "skill_id" = ?', [id]);
    const versionIds = versions.map((version) => version.id);
    if (versionIds.length > 0) {
      const placeholders = versionIds.map(() => "?").join(", ");
      await tx.db.run(`DELETE FROM "skill_files" WHERE "skill_version_id" IN (${placeholders})`, versionIds);
    }
    await tx.db.run('DELETE FROM "skill_versions" WHERE "skill_id" = ?', [id]);
    await tx.db.run('DELETE FROM "skills" WHERE "id" = ?', [id]);
  });
}

export async function userSkillState(repo: Repository, userId: string, skillId: string): Promise<UserSkillState | null> {
  const rows = await repo.db.all<UserSkillStateRow>(
    `SELECT ${userSkillStateColumns} FROM "user_skill_states" WHERE "user_id" = ? AND "skill_id" = ? LIMIT 1`,
    [userId, skillId],
  );
  return rows.length ? mapUserSkillState(rows[0]) : null;
}

export async function userSkillStatesBySkillIds(
  repo: Repository,
  userId: string,
  skillIds: string[],
): Promise<UserSkillState[]> {
  if (skillIds.length === 0) return [];
  const placeholders = skillIds.map(() => "?").join(", ");
  const rows = await repo.db.all<UserSkillStateRow>(
    `SELECT ${userSkillStateColumns} FROM "user_skill_states" WHERE "user_id" = ? AND "skill_id" IN (${placeholders})`,
    [userId, ...skillIds],
  );
  return rows.map(mapUserSkillState);
}

export async function setUserSkillAdded(repo: Repository, state: UserSkillState): Promise<void> {
  await repo.db.run(
    `INSERT INTO "user_skill_states" (${userSkillStateColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT ("user_id", "skill_id") DO UPDATE SET "added" = excluded."added", "installed_version_id" = excluded."installed_version_id", "auto_update" = excluded."auto_update", "library_category_id" = excluded."library_category_id", "updated_at" = excluded."updated_at"`,
    userSkillStateValues(state),
  );
}

export async function setUserSkillLiked(repo: Repository, state: UserSkillState): Promise<void> {
  await repo.db.run(
    `INSERT INTO "user_skill_states" (${userSkillStateColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT ("user_id", "skill_id") DO UPDATE SET "liked" = excluded."liked", "updated_at" = excluded."updated_at"`,
    userSkillStateValues(state),
  );
}

export async function skillMetrics(repo: Repository, skillIds: string[]): Promise<Record<string, SkillMetrics>> {
  const metrics: Record<string, SkillMetrics> = {};
  if (skillIds.length === 0) return metrics;
  const placeholders = skillIds.map(() => "?").join(", ");
  const rows = await repo.db.all<{ skill_id: string; added_count: number; like_count: number }>(
    `SELECT "skill_id", SUM(CASE WHEN "added" THEN 1 ELSE 0 END) AS "added_count", SUM(CASE WHEN "liked" THEN 1 ELSE 0 END) AS "like_count" FROM "user_skill_states" WHERE "skill_id" IN (${placeholders}) GROUP BY "skill_id"`,
    skillIds,
  );
  for (const row of rows) {
    metrics[row.skill_id] = {
      skillId: row.skill_id,
      addedCount: Number(row.added_count ?? 0),
      likeCount: Number(row.like_count ?? 0),
    };
  }
  return metrics;
}

interface SkillOwnerRow {
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

const skillOwnerColumns = `"id", "username", "email", "phone", "email_verified_at", "phone_verified_at", "display_name", "avatar_mode", "avatar_preset", "avatar_version", "role", "status", "is_promoter", "user_group", "password_hash", "last_login_at", "created_at", "updated_at"`;

function mapSkillOwner(row: SkillOwnerRow): User {
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

export async function skillOwners(repo: Repository, ownerIds: string[]): Promise<Record<string, User>> {
  const owners: Record<string, User> = {};
  if (ownerIds.length === 0) return owners;
  const placeholders = ownerIds.map(() => "?").join(", ");
  const rows = await repo.db.all<SkillOwnerRow>(
    `SELECT ${skillOwnerColumns} FROM "users" WHERE "id" IN (${placeholders})`,
    ownerIds,
  );
  for (const row of rows) owners[row.id] = mapSkillOwner(row);
  return owners;
}

export async function skillOwnerAvatars(repo: Repository, ownerIds: string[]): Promise<Record<string, string>> {
  const avatars: Record<string, string> = {};
  if (ownerIds.length === 0) return avatars;
  const placeholders = ownerIds.map(() => "?").join(", ");
  const rows = await repo.db.all<{ user_id: string; avatar_url: string }>(
    `SELECT "user_id", "avatar_url" FROM "user_identities" WHERE "user_id" IN (${placeholders}) AND "avatar_url" <> '' ORDER BY "updated_at" desc`,
    ownerIds,
  );
  for (const row of rows) {
    if (!avatars[row.user_id]) avatars[row.user_id] = row.avatar_url;
  }
  return avatars;
}
