import type { DocumentResourceReference } from "@/internal/assets/references";
import { collectDocumentResourceReferences } from "@/internal/assets/references";
import { resourceStatusReady } from "@/internal/model/models";
import type { CanvasSnapshot } from "@/internal/model/modelsCanvasHistory";
import type { CanvasProject, Resource } from "@/internal/model/modelsProject";
import { canvasProjectMetadataForUser } from "./canvasProjectRead";
import { Repository, toIso } from "./repository";
import { upsertCanvasProject } from "./repositoryAssetsCanvases";
import type { ResourceDirectReference } from "./resourceReference";

export const errCanvasHistoryResourceMissing = new Error("画布历史引用的资源不存在");
export const errCanvasHistoryResourceReferenced = new Error("资源仍被画布历史引用，无法删除");

export class CanvasHistoryResourceMissingError extends Error {
  readonly resourceIds: string[];
  readonly references: DocumentResourceReference[];

  constructor(resourceIds: string[], references: DocumentResourceReference[]) {
    super(`canvas history resources missing: [${resourceIds.join(" ")}]`);
    this.name = "CanvasHistoryResourceMissingError";
    this.cause = errCanvasHistoryResourceMissing;
    this.resourceIds = resourceIds;
    this.references = references;
  }
}

interface CanvasSnapshotRow {
  id: string;
  canvas_id: string;
  user_id: string | null;
  revision: number;
  title: string | null;
  node_count: number;
  connection_count: number;
  payload_bytes: number;
  payload_json?: string | null;
  reason: string | null;
  content_updated_at: string | null;
  created_at: string;
}

function mapSnapshot(row: CanvasSnapshotRow, withPayload: boolean): CanvasSnapshot {
  return {
    id: row.id,
    canvasId: row.canvas_id,
    userId: row.user_id ?? "",
    revision: Number(row.revision),
    title: row.title ?? "",
    nodeCount: Number(row.node_count),
    connectionCount: Number(row.connection_count),
    payloadBytes: Number(row.payload_bytes),
    ...(withPayload ? { payloadJson: row.payload_json ?? "" } : {}),
    reason: row.reason ?? "",
    contentUpdatedAt: toIso(row.content_updated_at),
    createdAt: toIso(row.created_at),
  };
}

const canvasSnapshotSummaryColumns = '"id", "canvas_id", "user_id", "revision", "title", "node_count", "connection_count", "payload_bytes", "reason", "content_updated_at", "created_at"';

const canvasSnapshotColumns = `${canvasSnapshotSummaryColumns}, "payload_json"`;

export async function canvasProjectMetadata(repo: Repository, userId: string, id: string): Promise<CanvasProject | null> {
  return canvasProjectMetadataForUser(repo, userId, id);
}

export async function canvasSnapshots(repo: Repository, userId: string, canvasId: string, limit: number): Promise<CanvasSnapshot[]> {
  const limitClause = limit >= 0 ? " LIMIT ?" : "";
  const params: (string | number)[] = [userId, canvasId];
  if (limit >= 0) params.push(limit);
  const rows = await repo.db.all<CanvasSnapshotRow>(
    `SELECT ${canvasSnapshotSummaryColumns} FROM "canvas_snapshots" WHERE "user_id" = ? AND "canvas_id" = ? ORDER BY "revision" DESC${limitClause}`,
    params,
  );
  return rows.map((row) => mapSnapshot(row, false));
}

export async function canvasSnapshot(repo: Repository, userId: string, canvasId: string, id: string): Promise<CanvasSnapshot | null> {
  const rows = await repo.db.all<CanvasSnapshotRow>(
    `SELECT ${canvasSnapshotColumns} FROM "canvas_snapshots" WHERE "id" = ? AND "user_id" = ? AND "canvas_id" = ? LIMIT 1`,
    [id, userId, canvasId],
  );
  return rows.length ? mapSnapshot(rows[0], true) : null;
}

// 成功的 CAS 先锁画布行，再检查历史。快照创建、引用保护与保留策略随内容一起提交。
export async function saveCanvasWithSnapshot(
  repo: Repository,
  project: CanvasProject,
  snapshot: CanvasSnapshot | null,
  resourceIds: string[],
  currentResourceIds: string[],
  cutoff: string,
  limit: number,
  force: boolean,
): Promise<void> {
  const next = { ...project };
  await repo.transaction(async (tx) => {
    await upsertCanvasProject(tx, next);
    let capture = false;
    if (snapshot) {
      const lastRows = await tx.db.all<{ id: string; revision: number; created_at: string }>(
        'SELECT "id", "revision", "created_at" FROM "canvas_snapshots" WHERE "canvas_id" = ? ORDER BY "revision" DESC LIMIT 1',
        [project.id],
      );
      const last = lastRows[0];
      capture = !last || (Number(last.revision) !== snapshot.revision && (force || new Date(toIso(last.created_at)).getTime() <= new Date(cutoff).getTime()));
    }
    let requiredIds = [...currentResourceIds];
    if (capture) requiredIds.push(...resourceIds);
    requiredIds.sort();
    requiredIds = requiredIds.filter((id, index) => index === 0 || id !== requiredIds[index - 1]);
    if (requiredIds.length > 0) {
      const placeholders = requiredIds.map(() => "?").join(", ");
      const locking = repo.dialect() === "postgres" ? " FOR UPDATE" : "";
      const resourceRows = await tx.db.all<{ id: string }>(
        `SELECT "id" FROM "resources" WHERE "id" IN (${placeholders}) AND "user_id" = ? AND "status" = ? ORDER BY "id"${locking}`,
        [...requiredIds, project.userId, resourceStatusReady],
      );
      const found = new Set(resourceRows.map((row) => row.id));
      const allowDamagedPreimage = snapshot !== null && (snapshot.reason === "before_resource_repair" || snapshot.reason === "before_restore");
      const missingIds: string[] = [];
      for (const id of requiredIds) {
        if (found.has(id)) continue;
        if (allowDamagedPreimage && !currentResourceIds.includes(id)) continue;
        missingIds.push(id);
      }
      if (missingIds.length > 0) {
        const missingSet = new Set(missingIds);
        const missingRefs: DocumentResourceReference[] = [];
        const documents: Record<string, string> = { current: project.payloadJson };
        if (capture && snapshot) documents.history = snapshot.payloadJson ?? "";
        for (const source of ["current", "history"]) {
          const references = collectDocumentResourceReferences(documents[source] ?? "");
          for (const reference of references) {
            if (missingSet.has(reference.resourceId)) missingRefs.push({ ...reference, source });
          }
        }
        for (const id of missingIds) {
          if (!containsResourceReference(missingRefs, id)) {
            missingRefs.push({ resourceId: id, path: "history", referenceType: "snapshot" });
          }
        }
        throw new CanvasHistoryResourceMissingError(missingIds, missingRefs);
      }
      if (allowDamagedPreimage) {
        resourceIds = resourceIds.filter((id) => found.has(id));
      }
    }
    if (!capture || !snapshot) return;
    await tx.db.run(
      'INSERT INTO "canvas_snapshots" ("id", "canvas_id", "user_id", "revision", "title", "node_count", "connection_count", "payload_bytes", "payload_json", "reason", "content_updated_at", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        snapshot.id,
        snapshot.canvasId,
        snapshot.userId ?? "",
        snapshot.revision,
        snapshot.title ?? "",
        snapshot.nodeCount,
        snapshot.connectionCount,
        snapshot.payloadBytes,
        snapshot.payloadJson ?? "",
        snapshot.reason ?? "",
        snapshot.contentUpdatedAt,
        snapshot.createdAt,
      ],
    );
    for (let index = 0; index < resourceIds.length; index += 200) {
      const batch = resourceIds.slice(index, index + 200);
      const values = batch.map(() => "(?, ?)").join(", ");
      await tx.db.run(
        `INSERT INTO "canvas_snapshot_resources" ("snapshot_id", "resource_id") VALUES ${values}`,
        batch.flatMap((resourceId) => [snapshot.id, resourceId]),
      );
    }
    const offsetClause = limit > 0 ? " OFFSET ?" : "";
    const expiredParams: (string | number)[] = [project.id];
    if (limit > 0) expiredParams.push(limit);
    const expiredRows = await tx.db.all<{ id: string }>(
      `SELECT "id" FROM "canvas_snapshots" WHERE "canvas_id" = ? ORDER BY "revision" DESC LIMIT 100${offsetClause}`,
      expiredParams,
    );
    await deleteCanvasSnapshots(tx, expiredRows.map((row) => row.id));
  });
  Object.assign(project, next);
}

export async function canvasHistoryReferencesObject(repo: Repository, resource: Resource): Promise<boolean> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "canvas_snapshot_resources" WHERE "resource_id" = ? OR "resource_id" IN (SELECT "id" FROM "resources" WHERE "endpoint" = ? AND "bucket" = ? AND "object_key" = ?)',
    [resource.id, resource.endpoint, resource.bucket, resource.objectKey],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

function containsResourceReference(references: DocumentResourceReference[], resourceId: string): boolean {
  return references.some((reference) => reference.resourceId === resourceId);
}

export async function deleteCanvasSnapshots(repo: Repository, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(", ");
  await repo.db.run(`DELETE FROM "canvas_snapshot_resources" WHERE "snapshot_id" IN (${placeholders})`, ids);
  await repo.db.run(`DELETE FROM "canvas_snapshots" WHERE "id" IN (${placeholders})`, ids);
}

interface ResourceDirectReferenceRow {
  kind: string;
  id: string;
  title: string | null;
  resource_id: string;
}

export async function canvasHistoryResourceReferences(repo: Repository, resourceIds: string[]): Promise<ResourceDirectReference[]> {
  if (!resourceIds.length) return [];
  const placeholders = resourceIds.map(() => "?").join(", ");
  const rows = await repo.db.all<ResourceDirectReferenceRow>(
    `SELECT DISTINCT '画布历史版本' AS "kind", snapshots."canvas_id" AS "id", snapshots."title" AS "title", refs."resource_id" AS "resource_id" FROM "canvas_snapshot_resources" AS refs JOIN "canvas_snapshots" AS snapshots ON snapshots."id" = refs."snapshot_id" WHERE refs."resource_id" IN (${placeholders})`,
    resourceIds,
  );
  return rows.map((row) => ({ kind: row.kind, id: row.id, title: row.title ?? "", resourceId: row.resource_id }));
}

export async function requireNoCanvasHistoryReferences(repo: Repository, resourceIds: string[]): Promise<void> {
  if (!resourceIds.length) return;
  const placeholders = resourceIds.map(() => "?").join(", ");
  const locking = repo.dialect() === "postgres" ? " FOR UPDATE" : "";
  await repo.db.all<{ id: string }>(`SELECT "id" FROM "resources" WHERE "id" IN (${placeholders}) ORDER BY "id"${locking}`, resourceIds);
  const refs = await canvasHistoryResourceReferences(repo, resourceIds);
  if (refs.length > 0) throw errCanvasHistoryResourceReferenced;
}
