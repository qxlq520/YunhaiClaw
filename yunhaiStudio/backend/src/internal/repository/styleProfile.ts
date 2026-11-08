// 对应 backend/internal/repository/style_profile.go
// 用户风格源的持久化；项目只保存应用时的 JSON 快照。

import type { StyleProfile } from "@/internal/model/modelsProject";
import { recordNotFound, Repository, toBool, toIso, toNullableIso } from "./repository";

const styleProfileColumns = `"id", "user_id", "name", "description", "cover_url", "tags_json", "profile_json", "favorite", "last_used_at", "revision", "created_at", "updated_at"`;

interface StyleProfileRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  cover_url: string;
  tags_json: string;
  profile_json: string;
  favorite: unknown;
  last_used_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

function mapStyleProfile(row: StyleProfileRow): StyleProfile {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    coverUrl: row.cover_url,
    tagsJson: row.tags_json,
    profileJson: row.profile_json,
    favorite: toBool(row.favorite),
    lastUsedAt: toNullableIso(row.last_used_at),
    revision: Number(row.revision ?? 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function styleProfiles(repo: Repository, userId: string): Promise<StyleProfile[]> {
  const rows = await repo.db.all<StyleProfileRow>(
    `SELECT ${styleProfileColumns} FROM "style_profiles" WHERE "user_id" = ? ORDER BY "favorite" DESC, "updated_at" DESC`,
    [userId],
  );
  return rows.map(mapStyleProfile);
}

export async function styleProfileCount(repo: Repository, userId: string): Promise<number> {
  const rows = await repo.db.all<{ total: number }>('SELECT COUNT(*) AS "total" FROM "style_profiles" WHERE "user_id" = ?', [userId]);
  return Number(rows[0]?.total ?? 0);
}

export async function styleProfileForUser(repo: Repository, userId: string, id: string): Promise<StyleProfile | null> {
  const rows = await repo.db.all<StyleProfileRow>(
    `SELECT ${styleProfileColumns} FROM "style_profiles" WHERE "id" = ? AND "user_id" = ? LIMIT 1`,
    [id, userId],
  );
  return rows.length ? mapStyleProfile(rows[0]) : null;
}

export async function createStyleProfile(repo: Repository, profile: StyleProfile): Promise<void> {
  await repo.db.run(
    `INSERT INTO "style_profiles" (${styleProfileColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      profile.id,
      profile.userId,
      profile.name,
      profile.description,
      profile.coverUrl,
      profile.tagsJson,
      profile.profileJson,
      profile.favorite,
      profile.lastUsedAt ?? null,
      profile.revision,
      profile.createdAt,
      profile.updatedAt,
    ],
  );
}

export async function updateStyleProfile(repo: Repository, profile: StyleProfile): Promise<void> {
  await repo.db.run(
    'UPDATE "style_profiles" SET "name" = ?, "description" = ?, "cover_url" = ?, "tags_json" = ?, "profile_json" = ?, "revision" = ?, "updated_at" = ? WHERE "id" = ? AND "user_id" = ?',
    [
      profile.name,
      profile.description,
      profile.coverUrl,
      profile.tagsJson,
      profile.profileJson,
      profile.revision,
      profile.updatedAt,
      profile.id,
      profile.userId,
    ],
  );
}

export async function setStyleProfileFavorite(repo: Repository, userId: string, id: string, favorite: boolean): Promise<void> {
  const affected = await repo.db.run(
    'UPDATE "style_profiles" SET "favorite" = ?, "updated_at" = ? WHERE "id" = ? AND "user_id" = ?',
    [favorite, new Date().toISOString(), id, userId],
  );
  if (affected === 0) throw recordNotFound;
}

export async function touchStyleProfile(repo: Repository, userId: string, id: string, usedAt: string): Promise<void> {
  const affected = await repo.db.run(
    'UPDATE "style_profiles" SET "last_used_at" = ?, "updated_at" = ? WHERE "id" = ? AND "user_id" = ?',
    [usedAt, new Date().toISOString(), id, userId],
  );
  if (affected === 0) throw recordNotFound;
}

export async function deleteStyleProfile(repo: Repository, userId: string, id: string): Promise<void> {
  const affected = await repo.db.run('DELETE FROM "style_profiles" WHERE "id" = ? AND "user_id" = ?', [id, userId]);
  if (affected === 0) throw recordNotFound;
}
