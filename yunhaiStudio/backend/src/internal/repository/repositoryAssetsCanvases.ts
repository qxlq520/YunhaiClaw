// 对应 backend/internal/repository/repository_assets_canvases.go
// 素材与画布项目的基础读写。
//
// 素材的彻底删除（含引用、Outbox）在 resourceReference 的 deleteAssetsAndResources。

import { assetVersionStatusArchived } from "@/internal/model/models";
import type { Asset, CanvasProject } from "@/internal/model/modelsProject";
import { Repository, toIso } from "./repository";
import { canvasProject, listCanvasProjects } from "./project";
import { lockCanvasMutation } from "./canvasMutationReceipts";
import { checkCanvasEditLeases } from "./canvasEditLeases";
import { deleteCanvasSnapshots } from "./canvasHistory";
import { deleteAssetsAndResources } from "./resourceReference";

export const errCanvasRevisionConflict = new Error("画布已被更新，请刷新后重试");

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

function mapAsset(row: Partial<AssetRow> & Pick<AssetRow, "id" | "kind" | "category" | "status" | "title" | "created_at" | "updated_at">): Asset {
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

interface AssetSummaryRow {
  id: string;
  folder_id: string | null;
  kind: string;
  category: string;
  status: string;
  primary_version_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

const assetColumns = '"id", "user_id", "folder_id", "kind", "category", "status", "primary_version_id", "title", "payload_json", "created_at", "updated_at"';

export async function assets(repo: Repository, userId: string): Promise<Asset[]> {
  const rows = await repo.db.all<AssetRow>(`SELECT ${assetColumns} FROM "assets" WHERE "user_id" = ? ORDER BY "updated_at" DESC`, [userId]);
  return rows.map(mapAsset);
}

export async function assetSummaries(repo: Repository, userId: string): Promise<Asset[]> {
  const rows = await repo.db.all<AssetSummaryRow>(
    'SELECT "id", "folder_id", "kind", "category", "status", "primary_version_id", "title", "created_at", "updated_at" FROM "assets" WHERE "user_id" = ? ORDER BY "updated_at" DESC',
    [userId],
  );
  return rows.map(mapAsset);
}

export async function assetForUser(repo: Repository, userId: string, id: string): Promise<Asset | null> {
  const rows = await repo.db.all<AssetRow>(`SELECT ${assetColumns} FROM "assets" WHERE "id" = ? AND "user_id" = ? LIMIT 1`, [id, userId]);
  return rows.length ? mapAsset(rows[0]) : null;
}

export async function assetsForUserIds(repo: Repository, userId: string, ids: string[]): Promise<Asset[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await repo.db.all<AssetRow>(
    `SELECT ${assetColumns} FROM "assets" WHERE "user_id" = ? AND "id" IN (${placeholders})`,
    [userId, ...ids],
  );
  return rows.map(mapAsset);
}

export async function upsertAsset(repo: Repository, asset: Asset): Promise<void> {
  const changes = await repo.db.run(
    'UPDATE "assets" SET "folder_id" = ?, "kind" = ?, "category" = ?, "status" = ?, "primary_version_id" = ?, "title" = ?, "payload_json" = ?, "updated_at" = ? WHERE "id" = ? AND "user_id" = ?',
    [
      asset.folderId ?? "",
      asset.kind,
      asset.category,
      asset.status,
      asset.primaryVersionId ?? "",
      asset.title,
      asset.payloadJson,
      asset.updatedAt,
      asset.id,
      asset.userId,
    ],
  );
  if (changes > 0) return;
  await repo.db.run(
    `INSERT INTO "assets" (${assetColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      asset.id,
      asset.userId,
      asset.folderId ?? "",
      asset.kind,
      asset.category,
      asset.status,
      asset.primaryVersionId ?? "",
      asset.title,
      asset.payloadJson,
      asset.createdAt,
      asset.updatedAt,
    ],
  );
}

export async function deleteAsset(repo: Repository, userId: string, id: string): Promise<void> {
  await deleteAssetsAndResources(repo, userId, [id], [], [], false);
}

export async function findExpiredArchivedAssets(repo: Repository, cutoff: string, limit: number): Promise<Asset[]> {
  const size = limit <= 0 ? 100 : limit;
  const rows = await repo.db.all<AssetRow>(
    'SELECT ' +
      assetColumns +
      ' FROM "assets" WHERE "status" = ? AND "updated_at" <= ? ORDER BY "updated_at" ASC, "id" ASC LIMIT ?',
    [assetVersionStatusArchived, cutoff, size],
  );
  return rows.map(mapAsset);
}

export async function replaceAssets(repo: Repository, userId: string, items: Asset[]): Promise<void> {
  await repo.transaction(async (tx) => {
    await tx.db.run('DELETE FROM "assets" WHERE "user_id" = ?', [userId]);
    if (items.length === 0) return;
    const placeholders = items.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const values = items.flatMap((asset) => [
      asset.id,
      asset.userId,
      asset.folderId ?? "",
      asset.kind,
      asset.category,
      asset.status,
      asset.primaryVersionId ?? "",
      asset.title,
      asset.payloadJson,
      asset.createdAt,
      asset.updatedAt,
    ]);
    await tx.db.run(`INSERT INTO "assets" (${assetColumns}) VALUES ${placeholders}`, values);
  });
}

export async function canvasProjects(repo: Repository, userId: string): Promise<CanvasProject[]> {
  return listCanvasProjects(repo, userId);
}

export async function canvasProjectSummaries(repo: Repository, userId: string): Promise<CanvasProject[]> {
  const rows = await repo.db.all<{
    id: string;
    title: string;
    revision: number;
    created_at: string;
    updated_at: string;
  }>(
    'SELECT "id", "title", "revision", "created_at", "updated_at" FROM "canvas_projects" WHERE "user_id" = ? ORDER BY "updated_at" DESC',
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    userId: "",
    projectId: "",
    title: row.title,
    payloadJson: "",
    revision: Number(row.revision),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }));
}

export async function canvasProjectForUser(repo: Repository, userId: string, id: string): Promise<CanvasProject | null> {
  return canvasProject(repo, userId, id);
}

export async function upsertCanvasProject(repo: Repository, project: CanvasProject): Promise<void> {
  await repo.transaction(async (tx) => {
    if (project.revision > 0) {
      await lockCanvasMutation(tx, project.userId, project.id);
      const before = await canvasProject(tx, project.userId, project.id);
      if (!before) throw errCanvasRevisionConflict;
      await checkCanvasEditLeases(tx, before, project);
    }
    await upsertCanvasProjectRow(tx, project);
  });
}

async function upsertCanvasProjectRow(repo: Repository, project: CanvasProject): Promise<void> {
  const expected = project.revision;
  if (expected < 0) throw errCanvasRevisionConflict;
  if (expected === 0) {
    const changes = await repo.db.run(
      'INSERT INTO "canvas_projects" ("id", "user_id", "project_id", "title", "payload_json", "revision", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
      [project.id, project.userId, project.projectId ?? "", project.title, project.payloadJson, 1, project.createdAt, project.updatedAt],
    );
    if (changes !== 1) throw errCanvasRevisionConflict;
    project.revision = 1;
    repo.canvasChanged(project.userId, project.id);
    return;
  }
  const changes = await repo.db.run(
    'UPDATE "canvas_projects" SET "project_id" = ?, "title" = ?, "payload_json" = ?, "updated_at" = ?, "revision" = ? WHERE "id" = ? AND "user_id" = ? AND "revision" = ?',
    [
      project.projectId ?? "",
      project.title,
      project.payloadJson,
      project.updatedAt,
      expected + 1,
      project.id,
      project.userId,
      expected,
    ],
  );
  if (changes !== 1) throw errCanvasRevisionConflict;
  project.revision = expected + 1;
  repo.canvasChanged(project.userId, project.id);
}

export async function deleteCanvasProject(repo: Repository, userId: string, id: string): Promise<void> {
  await repo.transaction(async (tx) => {
    // 先和保存共用同一行锁，再读取需要清理的历史 ID。
    await tx.db.run('UPDATE "canvas_projects" SET "revision" = "revision" WHERE "user_id" = ? AND "id" = ?', [userId, id]);
    const before = await canvasProject(tx, userId, id);
    if (!before) return;
    await checkCanvasEditLeases(tx, before, null);
    await tx.db.run('DELETE FROM "canvas_edit_leases" WHERE "user_id" = ? AND "canvas_id" = ?', [userId, id]);
    const snapshotRows = await tx.db.all<{ id: string }>(
      'SELECT "id" FROM "canvas_snapshots" WHERE "user_id" = ? AND "canvas_id" = ?',
      [userId, id],
    );
    await deleteCanvasSnapshots(tx, snapshotRows.map((row) => row.id));
    await tx.db.run('DELETE FROM "canvas_shares" WHERE "user_id" = ? AND "project_id" = ?', [userId, id]);
    await tx.db.run('DELETE FROM "canvas_unit_links" WHERE "canvas_id" = ?', [id]);
    // 任务和会话是审计记录，不随独立画布实体保留归属 ID。
    await tx.db.run('UPDATE "tasks" SET "project_id" = ?, "updated_at" = ? WHERE "user_id" = ? AND "project_id" = ?', [
      "",
      new Date().toISOString(),
      userId,
      id,
    ]);
    await tx.db.run('DELETE FROM "canvas_projects" WHERE "id" = ? AND "user_id" = ?', [id, userId]);
    tx.canvasChanged(userId, id);
  });
}
