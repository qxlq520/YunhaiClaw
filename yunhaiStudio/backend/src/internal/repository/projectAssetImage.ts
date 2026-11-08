// 对应 backend/internal/repository/project_asset_image.go
// 环境/道具图片版本提交；延迟到达的图片不能覆盖更新的工作。

import {
  assetCategoryEnvironment,
  assetCategoryProp,
  resourceStatusReady,
} from "@/internal/model/models";
import type { Asset, AssetRepresentation, AssetVersion } from "@/internal/model/modelsProject";
import { recordNotFound, Repository } from "./repository";

export const errProjectAssetVersionChanged = new Error("project asset version changed");

export interface ProjectAssetImageReference {
  assetId: string;
  resourceId: string;
}

/** ProjectAssetImageReferences returns only server-owned historical image bindings. */
export async function projectAssetImageReferences(
  repo: Repository,
  userId: string,
  assetIds: string[],
): Promise<ProjectAssetImageReference[]> {
  if (assetIds.length === 0) return [];
  const placeholders = assetIds.map(() => "?").join(", ");
  const rows = await repo.db.all<{ asset_id: string; resource_id: string | null }>(
    `SELECT "asset_versions"."asset_id" AS "asset_id", "asset_representations"."resource_id" AS "resource_id" FROM "asset_representations" JOIN "asset_versions" ON "asset_versions"."id" = "asset_representations"."asset_version_id" JOIN "assets" ON "assets"."id" = "asset_versions"."asset_id" WHERE "assets"."user_id" = ? AND "assets"."id" IN (${placeholders}) AND "assets"."category" IN (?, ?) AND "asset_representations"."media_type" = ?`,
    [userId, ...assetIds, assetCategoryEnvironment, assetCategoryProp, "image"],
  );
  return rows.map((row) => ({ assetId: row.asset_id, resourceId: row.resource_id ?? "" }));
}

async function insertAssetVersion(repo: Repository, version: AssetVersion): Promise<void> {
  await repo.db.run(
    'INSERT INTO "asset_versions" ("id", "asset_id", "version", "status", "definition_json", "prompt", "note", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      version.id,
      version.assetId,
      version.version,
      version.status,
      version.definitionJson,
      version.prompt,
      version.note,
      version.createdAt,
      version.updatedAt,
    ],
  );
}

async function insertAssetRepresentation(
  repo: Repository,
  representation: AssetRepresentation,
): Promise<void> {
  await repo.db.run(
    'INSERT INTO "asset_representations" ("id", "task_id", "asset_version_id", "resource_id", "media_type", "role", "metadata_json", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      representation.id,
      representation.taskId ?? "",
      representation.assetVersionId,
      representation.resourceId ?? "",
      representation.mediaType,
      representation.role,
      representation.metadataJson,
      representation.createdAt,
    ],
  );
}

/** CommitProjectAssetImage atomically promotes one image version, retaining historical references. */
export async function commitProjectAssetImage(
  repo: Repository,
  projectId: string,
  expectedVersionId: string,
  asset: Asset,
  version: AssetVersion,
  representation: AssetRepresentation,
): Promise<boolean> {
  return repo.transaction(async (tx) => {
    const existingRows = await tx.db.all<{ total: number }>(
      'SELECT COUNT(*) AS "total" FROM "asset_representations" WHERE "task_id" = ? AND "role" = ?',
      [representation.taskId ?? "", "primary"],
    );
    if (Number(existingRows[0]?.total ?? 0) > 0) return false;
    // 与物理清理竞争时持有资源行锁，提交引用前不得删除该资源。
    const lock = tx.dialect() === "postgres" ? " FOR SHARE" : "";
    const resources = await tx.db.all<{ id: string }>(
      `SELECT "id" FROM "resources" WHERE "id" = ? AND "user_id" = ? AND "kind" = ? AND "status" = ? LIMIT 1${lock}`,
      [representation.resourceId ?? "", asset.userId, "image", resourceStatusReady],
    );
    if (resources.length === 0) throw recordNotFound;
    const changes = await tx.db.run(
      'UPDATE "assets" SET "kind" = ?, "payload_json" = ?, "primary_version_id" = ?, "status" = ?, "updated_at" = ? WHERE "id" = ? AND "user_id" = ? AND "primary_version_id" = ? AND "category" = ? AND "id" IN (SELECT "asset_id" FROM "project_asset_links" WHERE "project_id" = ?)',
      [
        asset.kind,
        asset.payloadJson,
        version.id,
        asset.status,
        asset.updatedAt,
        asset.id,
        asset.userId,
        expectedVersionId,
        asset.category,
        projectId,
      ],
    );
    if (changes !== 1) throw errProjectAssetVersionChanged;
    await insertAssetVersion(tx, version);
    await insertAssetRepresentation(tx, representation);
    // 资产可能被多个项目引用，所有关联项目都需要刷新。
    await tx.db.run(
      'UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" IN (SELECT "project_id" FROM "project_asset_links" WHERE "asset_id" = ?)',
      [new Date().toISOString(), asset.id],
    );
    return true;
  });
}
