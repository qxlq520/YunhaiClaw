// 对应 backend/internal/repository/asset_library.go
// 用户素材库：列表、facets、分类目录与移动。

import { assetVersionStatusArchived } from "@/internal/model/models";
import type { Asset, AssetFolder } from "@/internal/model/modelsProject";
import { recordNotFound, Repository, toIso } from "./repository";

export interface UserAssetPageFilter {
  kind?: string;
  category?: string;
  folderId?: string | null;
  uncategorized?: boolean;
  status?: string;
  query?: string;
}

export interface UserAssetFacetRow {
  key: string;
  count: number;
}

interface AssetRow {
  id: string;
  user_id: string;
  folder_id: string | null;
  kind: string;
  category: string;
  status: string;
  primary_version_id: string | null;
  title: string;
  payload_json: string;
  created_at: string;
  updated_at: string;
}

function mapAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    folderId: row.folder_id ?? "",
    kind: row.kind,
    category: row.category,
    status: row.status,
    primaryVersionId: row.primary_version_id ?? "",
    title: row.title,
    payloadJson: row.payload_json ?? "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const assetColumns =
  '"id", "user_id", "folder_id", "kind", "category", "status", "primary_version_id", "title", "payload_json", "created_at", "updated_at"';

interface AssetFolderRow {
  id: string;
  user_id: string;
  name: string;
  name_key: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

function mapAssetFolder(row: AssetFolderRow): AssetFolder {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    nameKey: row.name_key ?? "",
    position: Number(row.position ?? 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const assetFolderColumns = '"id", "user_id", "name", "name_key", "position", "created_at", "updated_at"';

function userAssetFilterWhere(
  userId: string,
  filter: UserAssetPageFilter,
  includeSearch: boolean,
): { where: string; values: string[] } {
  const conditions = ['"user_id" = ?'];
  const values = [userId];
  const kind = (filter.kind ?? "").trim();
  if (kind !== "") {
    conditions.push('"kind" = ?');
    values.push(kind);
  }
  const category = (filter.category ?? "").trim();
  if (category !== "") {
    conditions.push('"category" = ?');
    values.push(category);
  }
  if (filter.uncategorized) {
    conditions.push('"folder_id" = \'\'');
  } else if (filter.folderId !== null && filter.folderId !== undefined) {
    conditions.push('"folder_id" = ?');
    values.push(filter.folderId.trim());
  }
  const status = (filter.status ?? "").trim();
  switch (status) {
    case "active":
      conditions.push('"status" <> ?');
      values.push(assetVersionStatusArchived);
      break;
    case "archived":
      conditions.push('"status" = ?');
      values.push(assetVersionStatusArchived);
      break;
    case "":
      break;
    default:
      conditions.push('"status" = ?');
      values.push(status);
      break;
  }
  if (includeSearch) {
    const query = (filter.query ?? "").trim().toLowerCase();
    if (query !== "") {
      const pattern = `%${query}%`;
      conditions.push('(LOWER("title") LIKE ? OR LOWER("payload_json") LIKE ?)');
      values.push(pattern, pattern);
    }
  }
  return { where: ` WHERE ${conditions.join(" AND ")}`, values };
}

export async function userAssetsPage(
  repo: Repository,
  userId: string,
  page: number,
  pageSize: number,
  filter: UserAssetPageFilter,
): Promise<{ assets: Asset[]; total: number }> {
  const query = userAssetFilterWhere(userId, filter, true);
  const totals = await repo.db.all<{ total: number }>(`SELECT COUNT(*) AS "total" FROM "assets"${query.where}`, query.values);
  const total = Number(totals[0]?.total ?? 0);
  const rows = await repo.db.all<AssetRow>(
    `SELECT ${assetColumns} FROM "assets"${query.where} ORDER BY "updated_at" DESC, "id" DESC LIMIT ? OFFSET ?`,
    [...query.values, pageSize, (page - 1) * pageSize],
  );
  return { assets: rows.map(mapAsset), total };
}

export async function userAssetFacets(
  repo: Repository,
  userId: string,
  status: string,
): Promise<{ kinds: UserAssetFacetRow[]; categories: UserAssetFacetRow[]; folders: UserAssetFacetRow[] }> {
  const query = userAssetFilterWhere(userId, { status }, false);
  const kindRows = await repo.db.all<{ key: string | null; count: number }>(
    `SELECT "kind" AS "key", COUNT(*) AS "count" FROM "assets"${query.where} GROUP BY "kind"`,
    query.values,
  );
  const categoryRows = await repo.db.all<{ key: string | null; count: number }>(
    `SELECT "category" AS "key", COUNT(*) AS "count" FROM "assets"${query.where} GROUP BY "category"`,
    query.values,
  );
  const folderRows = await repo.db.all<{ key: string | null; count: number }>(
    `SELECT "folder_id" AS "key", COUNT(*) AS "count" FROM "assets"${query.where} GROUP BY "folder_id"`,
    query.values,
  );
  const mapFacet = (row: { key: string | null; count: number }): UserAssetFacetRow => ({
    key: row.key ?? "",
    count: Number(row.count ?? 0),
  });
  return {
    kinds: kindRows.map(mapFacet),
    categories: categoryRows.map(mapFacet),
    folders: folderRows.map(mapFacet),
  };
}

export async function assetFolders(repo: Repository, userId: string): Promise<AssetFolder[]> {
  const rows = await repo.db.all<AssetFolderRow>(
    `SELECT ${assetFolderColumns} FROM "asset_folders" WHERE "user_id" = ? ORDER BY "position" ASC, "created_at" ASC`,
    [userId],
  );
  return rows.map(mapAssetFolder);
}

export async function assetFolderForUser(
  repo: Repository,
  userId: string,
  folderId: string,
): Promise<AssetFolder | null> {
  const rows = await repo.db.all<AssetFolderRow>(
    `SELECT ${assetFolderColumns} FROM "asset_folders" WHERE "id" = ? AND "user_id" = ? LIMIT 1`,
    [folderId, userId],
  );
  return rows.length ? mapAssetFolder(rows[0]) : null;
}

export async function assetFolderNameExists(
  repo: Repository,
  userId: string,
  nameKey: string,
  excludeId: string,
): Promise<boolean> {
  const conditions = ['"user_id" = ?', '"name_key" = ?'];
  const values = [userId, nameKey];
  if (excludeId !== "") {
    conditions.push('"id" <> ?');
    values.push(excludeId);
  }
  const rows = await repo.db.all<{ total: number }>(
    `SELECT COUNT(*) AS "total" FROM "asset_folders" WHERE ${conditions.join(" AND ")}`,
    values,
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

export async function nextAssetFolderPosition(repo: Repository, userId: string): Promise<number> {
  const rows = await repo.db.all<{ maximum: number }>(
    'SELECT COALESCE(MAX("position"), -1) AS "maximum" FROM "asset_folders" WHERE "user_id" = ?',
    [userId],
  );
  return Number(rows[0]?.maximum ?? -1) + 1;
}

export async function createAssetFolder(repo: Repository, folder: AssetFolder): Promise<void> {
  await repo.db.run(`INSERT INTO "asset_folders" (${assetFolderColumns}) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    folder.id,
    folder.userId,
    folder.name,
    folder.nameKey ?? "",
    folder.position,
    folder.createdAt,
    folder.updatedAt,
  ]);
}

export async function updateAssetFolder(repo: Repository, folder: AssetFolder): Promise<void> {
  const changes = await repo.db.run(
    'UPDATE "asset_folders" SET "name" = ?, "name_key" = ?, "updated_at" = ? WHERE "id" = ? AND "user_id" = ?',
    [folder.name, folder.nameKey ?? "", folder.updatedAt, folder.id, folder.userId],
  );
  if (changes !== 1) throw recordNotFound;
}

export async function moveUserAssetsToFolder(
  repo: Repository,
  userId: string,
  assetIds: string[],
  folderId: string,
): Promise<void> {
  await repo.transaction(async (tx) => {
    await moveUserAssetsToFolderTx(tx, userId, assetIds, folderId);
  });
}

export async function deleteAssetFolder(
  repo: Repository,
  userId: string,
  folderId: string,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const folders = await tx.db.all<AssetFolderRow>(
      `SELECT ${assetFolderColumns} FROM "asset_folders" WHERE "id" = ? AND "user_id" = ? LIMIT 1`,
      [folderId, userId],
    );
    if (folders.length === 0) throw recordNotFound;
    const assets = await tx.db.all<AssetRow>(
      `SELECT ${assetColumns} FROM "assets" WHERE "user_id" = ? AND "folder_id" = ?`,
      [userId, folderId],
    );
    await moveUserAssetsToFolderTx(
      tx,
      userId,
      assets.map((asset) => asset.id),
      "",
    );
    const changes = await tx.db.run('DELETE FROM "asset_folders" WHERE "id" = ? AND "user_id" = ?', [
      folderId,
      userId,
    ]);
    if (changes !== 1) throw recordNotFound;
  });
}

async function moveUserAssetsToFolderTx(
  repo: Repository,
  userId: string,
  assetIds: string[],
  folderId: string,
): Promise<void> {
  if (assetIds.length === 0) return;
  const placeholders = assetIds.map(() => "?").join(", ");
  const assets = await repo.db.all<AssetRow>(
    `SELECT ${assetColumns} FROM "assets" WHERE "user_id" = ? AND "id" IN (${placeholders})`,
    [userId, ...assetIds],
  );
  if (assets.length !== assetIds.length) throw recordNotFound;
  const now = new Date();
  for (const asset of assets) {
    const payloadJson = assetPayloadWithFolder(asset.payload_json, folderId, now);
    await repo.db.run(
      'UPDATE "assets" SET "folder_id" = ?, "payload_json" = ?, "updated_at" = ? WHERE "id" = ? AND "user_id" = ?',
      [folderId, payloadJson, now.toISOString(), asset.id, userId],
    );
  }
}

function formatRfc3339Nano(value: Date): string {
  return value.toISOString().replace(/\.?0+Z$/, "Z");
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJson((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function assetPayloadWithFolder(payloadJson: string, folderId: string, updatedAt: Date): string {
  const payload: unknown = JSON.parse(payloadJson);
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new SyntaxError("asset payload must be a JSON object");
  }
  const record = payload as Record<string, unknown>;
  if (folderId === "") delete record.folderId;
  else record.folderId = folderId;
  record.updatedAt = formatRfc3339Nano(updatedAt);
  return JSON.stringify(sortJson(record));
}

export function isAssetFolderNotFound(error: unknown): boolean {
  return error === recordNotFound;
}
