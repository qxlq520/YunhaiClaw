// 对应 backend/internal/repository/plugin_states.go
// 插件平台可用性与用户启用状态的持久化。

import type { PluginPlatformState, UserPluginState } from "@/internal/model/modelsPlugin";
import { Repository, toBool, toIso } from "./repository";

const pluginPlatformStateColumns = `"plugin_id", "available", "updated_by", "created_at", "updated_at"`;

interface PluginPlatformStateRow {
  plugin_id: string;
  available: unknown;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

function mapPluginPlatformState(row: PluginPlatformStateRow): PluginPlatformState {
  return {
    pluginId: row.plugin_id,
    available: toBool(row.available),
    updatedBy: row.updated_by,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const userPluginStateColumns = `"id", "user_id", "plugin_id", "enabled", "created_at", "updated_at"`;

interface UserPluginStateRow {
  id: string;
  user_id: string;
  plugin_id: string;
  enabled: unknown;
  created_at: string;
  updated_at: string;
}

function mapUserPluginState(row: UserPluginStateRow): UserPluginState {
  return {
    id: row.id,
    userId: row.user_id,
    pluginId: row.plugin_id,
    enabled: toBool(row.enabled),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function pluginPlatformState(repo: Repository, pluginId: string): Promise<PluginPlatformState | null> {
  const rows = await repo.db.all<PluginPlatformStateRow>(
    `SELECT ${pluginPlatformStateColumns} FROM "plugin_platform_states" WHERE "plugin_id" = ? LIMIT 1`,
    [pluginId],
  );
  return rows.length ? mapPluginPlatformState(rows[0]) : null;
}

export async function pluginPlatformStates(repo: Repository): Promise<PluginPlatformState[]> {
  const rows = await repo.db.all<PluginPlatformStateRow>(
    `SELECT ${pluginPlatformStateColumns} FROM "plugin_platform_states" ORDER BY "plugin_id" ASC`,
  );
  return rows.map(mapPluginPlatformState);
}

export async function savePluginPlatformState(repo: Repository, state: PluginPlatformState): Promise<void> {
  await repo.db.run(
    `INSERT INTO "plugin_platform_states" (${pluginPlatformStateColumns}) VALUES (?, ?, ?, ?, ?) ON CONFLICT ("plugin_id") DO UPDATE SET "available" = excluded."available", "updated_by" = excluded."updated_by", "updated_at" = excluded."updated_at"`,
    [state.pluginId, state.available, state.updatedBy, state.createdAt, state.updatedAt],
  );
}

export async function deletePluginPlatformState(repo: Repository, pluginId: string): Promise<void> {
  await repo.db.run('DELETE FROM "plugin_platform_states" WHERE "plugin_id" = ?', [pluginId]);
}

export async function userPluginState(repo: Repository, userId: string, pluginId: string): Promise<UserPluginState | null> {
  const rows = await repo.db.all<UserPluginStateRow>(
    `SELECT ${userPluginStateColumns} FROM "user_plugin_states" WHERE "user_id" = ? AND "plugin_id" = ? LIMIT 1`,
    [userId, pluginId],
  );
  return rows.length ? mapUserPluginState(rows[0]) : null;
}

export async function userPluginStates(repo: Repository, userId: string): Promise<UserPluginState[]> {
  const rows = await repo.db.all<UserPluginStateRow>(
    `SELECT ${userPluginStateColumns} FROM "user_plugin_states" WHERE "user_id" = ? ORDER BY "plugin_id" ASC`,
    [userId],
  );
  return rows.map(mapUserPluginState);
}

export async function saveUserPluginState(repo: Repository, state: UserPluginState): Promise<void> {
  await repo.db.run(
    `INSERT INTO "user_plugin_states" (${userPluginStateColumns}) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT ("user_id", "plugin_id") DO UPDATE SET "enabled" = excluded."enabled", "updated_at" = excluded."updated_at"`,
    [state.id, state.userId, state.pluginId, state.enabled, state.createdAt, state.updatedAt],
  );
}

export async function deleteUserPluginStates(repo: Repository, pluginId: string): Promise<void> {
  await repo.db.run('DELETE FROM "user_plugin_states" WHERE "plugin_id" = ?', [pluginId]);
}

export async function enabledPluginUserCounts(repo: Repository): Promise<Record<string, number>> {
  const rows = await repo.db.all<{ plugin_id: string; count: number }>(
    'SELECT "plugin_id", COUNT(*) AS "count" FROM "user_plugin_states" WHERE "enabled" = ? GROUP BY "plugin_id"',
    [true],
  );
  const result: Record<string, number> = {};
  for (const row of rows) result[row.plugin_id] = Number(row.count ?? 0);
  return result;
}
