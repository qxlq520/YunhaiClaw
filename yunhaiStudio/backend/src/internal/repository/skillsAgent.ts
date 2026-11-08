// 对应 backend/internal/repository/skills_agent.go
// Agent 技能目录、文件清单与使用记录的持久化。

import type { UserSkillState } from "@/internal/model/modelsPlatform";
import { recordNotFound, Repository, toBool, toNullableIso } from "./repository";
import { userSkillStateColumns } from "./skills";

// AgentSkillCatalogRow 是 Agent 技能目录需要的最小字段集：不取正文，避免每轮建目录时搬运整份 SKILL.md。
export interface AgentSkillCatalogRow {
  id: string;
  name: string;
  description: string;
  tag: string;
  currentVersionId: string;
  versionLabel: string;
  contentHash: string;
  fileCount: number;
  sortWeight: number;
  ownerId: string;
  initialAddedCount: number;
  added: boolean;
  agentMode: string;
  agentUseCount: number;
  agentLastUsedAt: string | null;
  installedAt: string | null;
}

// SkillFilePathRow 是某个技能版本里的一个文件路径。
export interface SkillFilePathRow {
  skillVersionId: string;
  path: string;
  mimeType: string;
  size: number;
}

const agentSkillCatalogColumns = `skills."id", skills."name", skills."description", skills."tag", skills."current_version_id", skills."version_label", skills."content_hash", skills."file_count", skills."sort_weight", skills."owner_id", skills."initial_added_count", COALESCE(user_skill_states."added", false) AS "added", user_skill_states."agent_mode", COALESCE(user_skill_states."agent_use_count", 0) AS "agent_use_count", user_skill_states."agent_last_used_at", user_skill_states."created_at" AS "installed_at"`;

interface AgentSkillCatalogDbRow {
  id: string | null;
  name: string | null;
  description: string | null;
  tag: string | null;
  current_version_id: string | null;
  version_label: string | null;
  content_hash: string | null;
  file_count: number | null;
  sort_weight: number | null;
  owner_id: string | null;
  initial_added_count: number | null;
  added: unknown;
  agent_mode: string | null;
  agent_use_count: number | null;
  agent_last_used_at: string | null;
  installed_at: string | null;
}

function mapAgentSkillCatalogRow(row: AgentSkillCatalogDbRow): AgentSkillCatalogRow {
  return {
    id: row.id ?? "",
    name: row.name ?? "",
    description: row.description ?? "",
    tag: row.tag ?? "",
    currentVersionId: row.current_version_id ?? "",
    versionLabel: row.version_label ?? "",
    contentHash: row.content_hash ?? "",
    fileCount: Number(row.file_count ?? 0),
    sortWeight: Number(row.sort_weight ?? 0),
    ownerId: row.owner_id ?? "",
    initialAddedCount: Number(row.initial_added_count ?? 0),
    added: toBool(row.added),
    agentMode: row.agent_mode ?? "",
    agentUseCount: Number(row.agent_use_count ?? 0),
    agentLastUsedAt: toNullableIso(row.agent_last_used_at),
    installedAt: toNullableIso(row.installed_at),
  };
}

// AgentSkillCatalogRows 返回用户技能库中启用的技能（自建 + 已安装的公开技能），口径与“我的技能”一致。
export async function agentSkillCatalogRows(repo: Repository, userId: string): Promise<AgentSkillCatalogRow[]> {
  const trimmed = userId.trim();
  if (trimmed === "") throw recordNotFound;
  const rows = await repo.db.all<AgentSkillCatalogDbRow>(
    `SELECT ${agentSkillCatalogColumns} FROM "skills" LEFT JOIN user_skill_states ON user_skill_states.skill_id = skills.id AND user_skill_states.user_id = ? WHERE skills.status = ? AND (skills.owner_id = ? OR (user_skill_states.added = ? AND skills.is_private = ?)) ORDER BY skills.id ASC`,
    [trimmed, 1, trimmed, true, false],
  );
  return rows.map(mapAgentSkillCatalogRow);
}

// AgentSkillCatalogRowsByIDs 只取指定技能的目录字段，范围仍限于该用户可见的启用技能。
export async function agentSkillCatalogRowsByIds(
  repo: Repository,
  userId: string,
  ids: string[],
): Promise<AgentSkillCatalogRow[]> {
  const trimmed = userId.trim();
  if (trimmed === "") throw recordNotFound;
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await repo.db.all<AgentSkillCatalogDbRow>(
    `SELECT ${agentSkillCatalogColumns} FROM "skills" LEFT JOIN user_skill_states ON user_skill_states.skill_id = skills.id AND user_skill_states.user_id = ? WHERE skills.status = ? AND skills.id IN (${placeholders}) AND (skills.owner_id = ? OR skills.is_private = ?)`,
    [trimmed, 1, ...ids, trimmed, false],
  );
  return rows.map(mapAgentSkillCatalogRow);
}

// MarketSkillCatalogRows 返回该用户尚未安装的公开启用技能，用于在对话里推荐安装。
export async function marketSkillCatalogRows(
  repo: Repository,
  userId: string,
  limit: number,
): Promise<AgentSkillCatalogRow[]> {
  const trimmed = userId.trim();
  if (trimmed === "") throw recordNotFound;
  let effectiveLimit = limit;
  if (effectiveLimit <= 0 || effectiveLimit > 2000) effectiveLimit = 2000;
  const rows = await repo.db.all<AgentSkillCatalogDbRow>(
    `SELECT ${agentSkillCatalogColumns} FROM "skills" LEFT JOIN user_skill_states ON user_skill_states.skill_id = skills.id AND user_skill_states.user_id = ? WHERE skills.status = ? AND skills.is_private = ? AND skills.owner_id <> ? AND COALESCE(user_skill_states.added, ?) = ? ORDER BY skills.sort_weight DESC, skills.id ASC LIMIT ?`,
    [trimmed, 1, false, trimmed, false, false, effectiveLimit],
  );
  return rows.map(mapAgentSkillCatalogRow);
}

// SetUserSkillAgentMode 只改 agent_mode，不触碰安装、收藏和分类状态。
export async function setUserSkillAgentMode(repo: Repository, state: UserSkillState | null): Promise<void> {
  if (!state || state.userId.trim() === "" || state.skillId.trim() === "") throw recordNotFound;
  await repo.db.run(
    `INSERT INTO "user_skill_states" (${userSkillStateColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT ("user_id", "skill_id") DO UPDATE SET "agent_mode" = excluded."agent_mode", "updated_at" = excluded."updated_at"`,
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

// RecordUserSkillAgentUse 记录 Agent 实际读取过这些技能；没有安装状态行的技能（如自建技能旧数据）忽略。
export async function recordUserSkillAgentUse(
  repo: Repository,
  userId: string,
  skillIds: string[],
  at: string,
): Promise<void> {
  const trimmed = userId.trim();
  if (trimmed === "" || skillIds.length === 0) return;
  const placeholders = skillIds.map(() => "?").join(", ");
  await repo.db.run(
    `UPDATE "user_skill_states" SET "agent_use_count" = COALESCE("agent_use_count", 0) + 1, "agent_last_used_at" = ?, "updated_at" = ? WHERE "user_id" = ? AND "skill_id" IN (${placeholders})`,
    [at, new Date().toISOString(), trimmed, ...skillIds],
  );
}

// SkillFilePathsByVersionIDs 一次取回多个技能版本的文件清单（不含内容）。
export async function skillFilePathsByVersionIds(
  repo: Repository,
  versionIds: string[],
): Promise<Record<string, SkillFilePathRow[]>> {
  const result: Record<string, SkillFilePathRow[]> = {};
  if (versionIds.length === 0) return result;
  const placeholders = versionIds.map(() => "?").join(", ");
  const rows = await repo.db.all<{
    skill_version_id: string;
    path: string;
    mime_type: string | null;
    size: number | null;
  }>(
    `SELECT "skill_version_id", "path", "mime_type", "size" FROM "skill_files" WHERE "skill_version_id" IN (${placeholders}) ORDER BY "path" ASC`,
    versionIds,
  );
  for (const row of rows) {
    const item: SkillFilePathRow = {
      skillVersionId: row.skill_version_id,
      path: row.path,
      mimeType: row.mime_type ?? "",
      size: Number(row.size ?? 0),
    };
    (result[row.skill_version_id] ??= []).push(item);
  }
  return result;
}
