// 对应 backend/internal/repository/repository_user_groups.go
// 用户分组与分组渠道绑定的持久化。分组本身和渠道绑定必须在同一事务内写入，
// 避免出现“分组已限制渠道但绑定尚未落库”的窗口把用户的模型目录清空。

import type { UserGroup, UserGroupChannel } from "@/internal/model/modelsUserGroup";
import { Repository, toBool, toIso } from "./repository";

// 分组仍有用户，不能删除。
export const errUserGroupInUse = new Error("user group in use");

const userGroupColumns = `"id", "code", "name", "description", "badge_label", "badge_style", "sort_order", "ratio_basis_points", "points_per_usd", "points_per_cny", "all_channels", "model_overrides_json", "created_at", "updated_at"`;

interface UserGroupRow {
  id: string;
  code: string;
  name: string;
  description: string;
  badge_label: string;
  badge_style: string;
  sort_order: number;
  ratio_basis_points: number;
  points_per_usd: number;
  points_per_cny: number;
  all_channels: unknown;
  model_overrides_json: string;
  created_at: string;
  updated_at: string;
}

function mapUserGroup(row: UserGroupRow): UserGroup {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    badgeLabel: row.badge_label,
    badgeStyle: row.badge_style,
    sortOrder: Number(row.sort_order ?? 0),
    ratioBasisPoints: Number(row.ratio_basis_points ?? 0),
    pointsPerUsdMicrocredits: Number(row.points_per_usd ?? 0),
    pointsPerCnyMicrocredits: Number(row.points_per_cny ?? 0),
    allChannels: toBool(row.all_channels),
    modelOverridesJson: row.model_overrides_json ?? "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

interface UserGroupChannelRow {
  group_id: string;
  channel_id: string;
  created_at: string;
}

function mapUserGroupChannel(row: UserGroupChannelRow): UserGroupChannel {
  return {
    groupId: row.group_id,
    channelId: row.channel_id,
    createdAt: toIso(row.created_at),
  };
}

async function insertUserGroup(repo: Repository, group: UserGroup): Promise<void> {
  await repo.db.run(
    `INSERT INTO "user_groups" (${userGroupColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      group.id,
      group.code,
      group.name,
      group.description,
      group.badgeLabel,
      group.badgeStyle,
      group.sortOrder,
      group.ratioBasisPoints,
      group.pointsPerUsdMicrocredits,
      group.pointsPerCnyMicrocredits,
      group.allChannels,
      group.modelOverridesJson ?? "",
      group.createdAt,
      group.updatedAt,
    ],
  );
}

export async function userGroups(repo: Repository): Promise<UserGroup[]> {
  const rows = await repo.db.all<UserGroupRow>(
    `SELECT ${userGroupColumns} FROM "user_groups" ORDER BY "sort_order" ASC, "created_at" ASC, "id" ASC`,
  );
  return rows.map(mapUserGroup);
}

export async function userGroup(repo: Repository, id: string): Promise<UserGroup | null> {
  const rows = await repo.db.all<UserGroupRow>(`SELECT ${userGroupColumns} FROM "user_groups" WHERE "id" = ? LIMIT 1`, [id]);
  return rows.length ? mapUserGroup(rows[0]) : null;
}

export async function userGroupByCode(repo: Repository, code: string): Promise<UserGroup | null> {
  const rows = await repo.db.all<UserGroupRow>(`SELECT ${userGroupColumns} FROM "user_groups" WHERE "code" = ? LIMIT 1`, [code]);
  return rows.length ? mapUserGroup(rows[0]) : null;
}

export async function userGroupChannels(repo: Repository): Promise<UserGroupChannel[]> {
  const rows = await repo.db.all<UserGroupChannelRow>(
    'SELECT "group_id", "channel_id", "created_at" FROM "user_group_channels" ORDER BY "group_id" ASC, "channel_id" ASC',
  );
  return rows.map(mapUserGroupChannel);
}

/** 创建或更新分组，并整体替换其渠道绑定。 */
export async function saveUserGroupWithChannels(
  repo: Repository,
  group: UserGroup,
  channelIds: string[],
  create: boolean,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const now = new Date().toISOString();
    group.updatedAt = now;
    if (create) {
      group.createdAt = now;
      await insertUserGroup(tx, group);
    } else {
      const affected = await tx.db.run(
        'UPDATE "user_groups" SET "code" = ?, "name" = ?, "description" = ?, "badge_label" = ?, "badge_style" = ?, "sort_order" = ?, "ratio_basis_points" = ?, "points_per_usd" = ?, "points_per_cny" = ?, "all_channels" = ?, "model_overrides_json" = ?, "created_at" = ?, "updated_at" = ? WHERE "id" = ?',
        [
          group.code,
          group.name,
          group.description,
          group.badgeLabel,
          group.badgeStyle,
          group.sortOrder,
          group.ratioBasisPoints,
          group.pointsPerUsdMicrocredits,
          group.pointsPerCnyMicrocredits,
          group.allChannels,
          group.modelOverridesJson ?? "",
          group.createdAt,
          group.updatedAt,
          group.id,
        ],
      );
      if (affected === 0) await insertUserGroup(tx, group);
    }
    await tx.db.run('DELETE FROM "user_group_channels" WHERE "group_id" = ?', [group.id]);
    if (channelIds.length === 0) return;
    const placeholders = channelIds.map(() => "(?, ?, ?)").join(", ");
    const params = channelIds.flatMap((channelId) => [group.id, channelId, now]);
    await tx.db.run(`INSERT INTO "user_group_channels" ("group_id", "channel_id", "created_at") VALUES ${placeholders}`, params);
  });
}

/** 在同一事务内确认分组没有用户后删除分组和绑定；默认分组由 service 层禁止删除。 */
export async function deleteUserGroup(repo: Repository, id: string, code: string): Promise<void> {
  await repo.transaction(async (tx) => {
    const rows = await tx.db.all<{ total: number }>('SELECT COUNT(*) AS "total" FROM "users" WHERE "user_group" = ?', [code]);
    if (Number(rows[0]?.total ?? 0) > 0) throw errUserGroupInUse;
    await tx.db.run('DELETE FROM "user_group_channels" WHERE "group_id" = ?', [id]);
    await tx.db.run('DELETE FROM "user_groups" WHERE "id" = ?', [id]);
  });
}

/** 返回每个分组编码的用户数；空编码原样返回，由调用方归入默认分组。 */
export async function userGroupUserCounts(repo: Repository): Promise<Record<string, number>> {
  const rows = await repo.db.all<{ user_group: string | null; count: number }>(
    'SELECT "user_group", COUNT(*) AS "count" FROM "users" GROUP BY "user_group"',
  );
  const result: Record<string, number> = {};
  for (const row of rows) {
    const key = row.user_group ?? "";
    result[key] = (result[key] ?? 0) + Number(row.count ?? 0);
  }
  return result;
}
