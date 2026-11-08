// 对应 backend/internal/repository/repository_shots_workflows.go
// 镜头、镜头产物、素材引用与项目工作流。
//
// 镜头与素材引用的变更会使所在单元的工作流步骤失效（invalidateUnitWorkflowTx），
// 保证下游步骤不会基于过期镜头继续生成。

import { workflowStatusActive, workflowStepStatusPending, workflowStepStatusRunning } from "@/internal/model/models";
import type {
  Asset,
  AssetRepresentation,
  AssetVersion,
  ProductionTaskLink,
  ProjectAssetCandidate,
  ProjectAssetLink,
  Shot,
  ShotArtifact,
  ShotAssetReference,
  ShotRevision,
  WorkflowInstance,
  WorkflowStepInstance,
  WorkflowStepTask,
  WorkflowTemplateVersion,
} from "@/internal/model/modelsProject";
import { recordNotFound, Repository, toBool, toIso, toNullableIso } from "./repository";

export const errProjectUnitShotsChanged = new Error("镜头已被修改，请刷新后重试");
export const errInvalidData = new Error("invalid data");
// GORM 对空切片 Create 的既有行为，保持与 Go 仓储一致。
export const errEmptySlice = new Error("empty slice found");

interface ShotRow {
  id: string;
  project_id: string;
  unit_id: string;
  current_revision_id: string | null;
  title: string;
  description: string;
  position: number;
  duration_ms: number;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapShot(row: ShotRow): Shot {
  return {
    id: row.id,
    projectId: row.project_id,
    unitId: row.unit_id,
    currentRevisionId: row.current_revision_id ?? "",
    title: row.title,
    description: row.description,
    position: Number(row.position),
    durationMs: Number(row.duration_ms),
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const shotColumns = '"id", "project_id", "unit_id", "current_revision_id", "title", "description", "position", "duration_ms", "status", "created_at", "updated_at"';

interface ShotRevisionRow {
  id: string;
  shot_id: string;
  version: number;
  plot_description: string;
  action: string;
  dialogue: string;
  shot_size: string;
  camera_angle: string;
  camera_movement: string;
  duration_ms: number;
  image_prompt: string;
  video_prompt: string;
  negative_prompt: string;
  continuity_notes: string;
  action_beats_json: string;
  created_by: string | null;
  created_at: string;
}

function mapShotRevision(row: ShotRevisionRow): ShotRevision {
  return {
    id: row.id,
    shotId: row.shot_id,
    version: Number(row.version),
    plotDescription: row.plot_description,
    action: row.action,
    dialogue: row.dialogue,
    shotSize: row.shot_size,
    cameraAngle: row.camera_angle,
    cameraMovement: row.camera_movement,
    durationMs: Number(row.duration_ms),
    imagePrompt: row.image_prompt,
    videoPrompt: row.video_prompt,
    negativePrompt: row.negative_prompt,
    continuityNotes: row.continuity_notes,
    actionBeatsJson: row.action_beats_json,
    createdBy: row.created_by ?? "",
    createdAt: toIso(row.created_at),
  };
}

const shotRevisionColumns =
  '"id", "shot_id", "version", "plot_description", "action", "dialogue", "shot_size", "camera_angle", "camera_movement", "duration_ms", "image_prompt", "video_prompt", "negative_prompt", "continuity_notes", "action_beats_json", "created_by", "created_at"';

interface ShotArtifactRow {
  id: string;
  project_id: string;
  unit_id: string;
  shot_id: string;
  revision_id: string | null;
  task_id: string | null;
  type: string;
  version: number;
  resource_id: string | null;
  status: string;
  selected: unknown;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

function mapShotArtifact(row: ShotArtifactRow): ShotArtifact {
  return {
    id: row.id,
    projectId: row.project_id,
    unitId: row.unit_id,
    shotId: row.shot_id,
    revisionId: row.revision_id ?? "",
    taskId: row.task_id ?? "",
    type: row.type,
    version: Number(row.version),
    resourceId: row.resource_id ?? "",
    status: row.status,
    selected: toBool(row.selected),
    metadataJson: row.metadata_json,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const shotArtifactColumns =
  '"id", "project_id", "unit_id", "shot_id", "revision_id", "task_id", "type", "version", "resource_id", "status", "selected", "metadata_json", "created_at", "updated_at"';

interface ShotAssetReferenceRow {
  id: string;
  shot_id: string;
  asset_version_id: string;
  role: string;
  status: string;
  created_at: string;
}

function mapShotAssetReference(row: ShotAssetReferenceRow): ShotAssetReference {
  return {
    id: row.id,
    shotId: row.shot_id,
    assetVersionId: row.asset_version_id,
    role: row.role,
    status: row.status,
    createdAt: toIso(row.created_at),
  };
}

const shotAssetReferenceColumns = '"id", "shot_id", "asset_version_id", "role", "status", "created_at"';

interface ProjectAssetCandidateRow {
  id: string;
  project_id: string;
  unit_id: string | null;
  shot_id: string | null;
  name: string;
  name_key: string | null;
  category: string;
  status: string;
  source: string | null;
  details_json: string;
  resolved_asset_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapProjectAssetCandidate(row: ProjectAssetCandidateRow): ProjectAssetCandidate {
  return {
    id: row.id,
    projectId: row.project_id,
    unitId: row.unit_id ?? "",
    shotId: row.shot_id ?? "",
    name: row.name,
    nameKey: row.name_key ?? "",
    category: row.category,
    status: row.status,
    source: row.source ?? "",
    detailsJson: row.details_json,
    resolvedAssetId: row.resolved_asset_id ?? "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const projectAssetCandidateColumns =
  '"id", "project_id", "unit_id", "shot_id", "name", "name_key", "category", "status", "source", "details_json", "resolved_asset_id", "created_at", "updated_at"';

interface WorkflowTemplateVersionRow {
  id: string;
  template_key: string;
  name: string;
  version: number;
  definition_json: string;
  created_at: string;
}

function mapWorkflowTemplateVersion(row: WorkflowTemplateVersionRow): WorkflowTemplateVersion {
  return {
    id: row.id,
    templateKey: row.template_key,
    name: row.name,
    version: Number(row.version),
    definitionJson: row.definition_json,
    createdAt: toIso(row.created_at),
  };
}

const workflowTemplateVersionColumns = '"id", "template_key", "name", "version", "definition_json", "created_at"';

interface WorkflowInstanceRow {
  id: string;
  project_id: string;
  unit_id: string | null;
  template_version_id: string;
  scope: string;
  status: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

function mapWorkflowInstance(row: WorkflowInstanceRow): WorkflowInstance {
  return {
    id: row.id,
    projectId: row.project_id,
    unitId: row.unit_id ?? "",
    templateVersionId: row.template_version_id,
    scope: row.scope,
    status: row.status,
    revision: Number(row.revision),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const workflowInstanceColumns = '"id", "project_id", "unit_id", "template_version_id", "scope", "status", "revision", "created_at", "updated_at"';

interface WorkflowStepInstanceRow {
  id: string;
  workflow_instance_id: string;
  step_key: string;
  name: string;
  position: number;
  status: string;
  input_json: string;
  output_json: string;
  error: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapWorkflowStepInstance(row: WorkflowStepInstanceRow): WorkflowStepInstance {
  return {
    id: row.id,
    workflowInstanceId: row.workflow_instance_id,
    stepKey: row.step_key,
    name: row.name,
    position: Number(row.position),
    status: row.status,
    inputJson: row.input_json,
    outputJson: row.output_json,
    error: row.error,
    startedAt: toNullableIso(row.started_at),
    completedAt: toNullableIso(row.completed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const workflowStepInstanceColumns =
  '"id", "workflow_instance_id", "step_key", "name", "position", "status", "input_json", "output_json", "error", "started_at", "completed_at", "created_at", "updated_at"';

function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}

const assetColumns = '"id", "user_id", "folder_id", "kind", "category", "status", "primary_version_id", "title", "payload_json", "created_at", "updated_at"';

const assetVersionColumns = '"id", "asset_id", "version", "status", "definition_json", "prompt", "note", "created_at", "updated_at"';

const projectAssetLinkColumns = '"id", "project_id", "asset_id", "folder_id", "position", "created_at"';

const productionTaskLinkColumns =
  '"id", "task_id", "project_id", "canvas_id", "unit_id", "shot_id", "workflow_step_id", "artifact_type", "created_at", "updated_at"';

const assetRepresentationColumns = '"id", "task_id", "asset_version_id", "resource_id", "media_type", "role", "metadata_json", "created_at"';

export async function projectShots(repo: Repository, projectId: string): Promise<Shot[]> {
  const rows = await repo.db.all<ShotRow>(`SELECT ${shotColumns} FROM "shots" WHERE "project_id" = ? ORDER BY "unit_id" ASC, "position" ASC`, [projectId]);
  return rows.map(mapShot);
}

export async function saveShot(repo: Repository, shot: Shot, create: boolean): Promise<void> {
  if (create) {
    await repo.db.run(`INSERT INTO "shots" (${shotColumns}) VALUES (${placeholders(11)})`, [
      shot.id,
      shot.projectId,
      shot.unitId,
      shot.currentRevisionId ?? "",
      shot.title,
      shot.description,
      shot.position,
      shot.durationMs,
      shot.status,
      shot.createdAt,
      shot.updatedAt,
    ]);
    return;
  }
  await repo.db.run(
    'UPDATE "shots" SET "unit_id" = ?, "title" = ?, "description" = ?, "position" = ?, "duration_ms" = ?, "status" = ?, "updated_at" = ? WHERE "id" = ? AND "project_id" = ?',
    [shot.unitId, shot.title, shot.description, shot.position, shot.durationMs, shot.status, shot.updatedAt, shot.id, shot.projectId],
  );
}

// 原子保存镜头当前值、新版本和下游失效状态。
export async function saveShotWithRevision(
  repo: Repository,
  shot: Shot,
  revision: ShotRevision,
  create: boolean,
): Promise<void> {
  await repo.transaction(async (tx) => {
    if (create) {
      await tx.db.run(`INSERT INTO "shots" (${shotColumns}) VALUES (${placeholders(11)})`, [
        shot.id,
        shot.projectId,
        shot.unitId,
        shot.currentRevisionId ?? "",
        shot.title,
        shot.description,
        shot.position,
        shot.durationMs,
        shot.status,
        shot.createdAt,
        shot.updatedAt,
      ]);
    } else {
      const changes = await tx.db.run(
        'UPDATE "shots" SET "unit_id" = ?, "title" = ?, "description" = ?, "position" = ?, "duration_ms" = ?, "status" = ?, "updated_at" = ? WHERE "id" = ? AND "project_id" = ?',
        [shot.unitId, shot.title, shot.description, shot.position, shot.durationMs, shot.status, shot.updatedAt, shot.id, shot.projectId],
      );
      if (changes !== 1) throw recordNotFound;
    }
    const versionRows = await tx.db.all<{ current: number }>(
      'SELECT COALESCE(MAX("version"), 0) AS "current" FROM "shot_revisions" WHERE "shot_id" = ?',
      [shot.id],
    );
    revision.version = Number(versionRows[0]?.current ?? 0) + 1;
    await tx.db.run(`INSERT INTO "shot_revisions" (${shotRevisionColumns}) VALUES (${placeholders(17)})`, [
      revision.id,
      revision.shotId,
      revision.version,
      revision.plotDescription,
      revision.action,
      revision.dialogue,
      revision.shotSize,
      revision.cameraAngle,
      revision.cameraMovement,
      revision.durationMs,
      revision.imagePrompt,
      revision.videoPrompt,
      revision.negativePrompt,
      revision.continuityNotes,
      revision.actionBeatsJson,
      revision.createdBy ?? "",
      revision.createdAt,
    ]);
    shot.currentRevisionId = revision.id;
    await tx.db.run(
      'UPDATE "shots" SET "current_revision_id" = ?, "description" = ?, "duration_ms" = ?, "status" = ?, "updated_at" = ? WHERE "id" = ? AND "project_id" = ?',
      [revision.id, shot.description, shot.durationMs, shot.status, shot.updatedAt, shot.id, shot.projectId],
    );
    if (!create) {
      await tx.db.run(
        'UPDATE "shot_artifacts" SET "status" = ?, "selected" = ?, "updated_at" = ? WHERE "shot_id" = ? AND "status" NOT IN (?, ?)',
        ["stale", false, shot.updatedAt, shot.id, "failed", "stale"],
      );
    }
    await invalidateUnitWorkflowTx(tx, shot.projectId, shot.unitId, "storyboard", shot.updatedAt);
    await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [shot.updatedAt, shot.projectId]);
  });
}

export async function replaceProjectUnitShots(
  repo: Repository,
  projectId: string,
  unitId: string,
  shots: Shot[],
  revisions: ShotRevision[],
  references: ShotAssetReference[],
  expectedShotIds: string[] | null,
): Promise<void> {
  await repo.transaction(async (tx) => {
    if (expectedShotIds !== null) {
      const currentRows = await tx.db.all<{ id: string }>(
        'SELECT "id" FROM "shots" WHERE "project_id" = ? AND "unit_id" = ? ORDER BY "id" ASC',
        [projectId, unitId],
      );
      const currentShotIds = currentRows.map((row) => row.id);
      const expected = [...expectedShotIds].sort();
      if (currentShotIds.length !== expected.length || currentShotIds.some((id, index) => id !== expected[index])) {
        throw errProjectUnitShotsChanged;
      }
    }
    const shotIds = 'SELECT "id" FROM "shots" WHERE "project_id" = ? AND "unit_id" = ?';
    await tx.db.run('DELETE FROM "shot_artifacts" WHERE "project_id" = ? AND "unit_id" = ?', [projectId, unitId]);
    await tx.db.run(`DELETE FROM "shot_revisions" WHERE "shot_id" IN (${shotIds})`, [projectId, unitId]);
    await tx.db.run(`DELETE FROM "shot_asset_references" WHERE "shot_id" IN (${shotIds})`, [projectId, unitId]);
    await tx.db.run(`DELETE FROM "project_asset_candidates" WHERE "project_id" = ? AND "shot_id" IN (${shotIds})`, [projectId, projectId, unitId]);
    await tx.db.run('DELETE FROM "shots" WHERE "project_id" = ? AND "unit_id" = ?', [projectId, unitId]);
    if (shots.length === 0) throw errEmptySlice;
    await tx.db.run(
      `INSERT INTO "shots" (${shotColumns}) VALUES ${shots.map(() => `(${placeholders(11)})`).join(", ")}`,
      shots.flatMap((shot) => [
        shot.id,
        shot.projectId,
        shot.unitId,
        shot.currentRevisionId ?? "",
        shot.title,
        shot.description,
        shot.position,
        shot.durationMs,
        shot.status,
        shot.createdAt,
        shot.updatedAt,
      ]),
    );
    if (revisions.length > 0) {
      const values = revisions.map(() => `(${placeholders(17)})`).join(", ");
      await tx.db.run(
        `INSERT INTO "shot_revisions" (${shotRevisionColumns}) VALUES ${values}`,
        revisions.flatMap((revision) => [
          revision.id,
          revision.shotId,
          revision.version,
          revision.plotDescription,
          revision.action,
          revision.dialogue,
          revision.shotSize,
          revision.cameraAngle,
          revision.cameraMovement,
          revision.durationMs,
          revision.imagePrompt,
          revision.videoPrompt,
          revision.negativePrompt,
          revision.continuityNotes,
          revision.actionBeatsJson,
          revision.createdBy ?? "",
          revision.createdAt,
        ]),
      );
    }
    if (references.length > 0) {
      const values = references.map(() => `(${placeholders(6)})`).join(", ");
      await tx.db.run(
        `INSERT INTO "shot_asset_references" (${shotAssetReferenceColumns}) VALUES ${values}`,
        references.flatMap((reference) => [
          reference.id,
          reference.shotId,
          reference.assetVersionId,
          reference.role,
          reference.status,
          reference.createdAt,
        ]),
      );
    }
    const now = new Date().toISOString();
    await invalidateUnitWorkflowTx(tx, projectId, unitId, "storyboard", now);
    await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [now, projectId]);
  });
}

export async function shotForProject(repo: Repository, projectId: string, shotId: string): Promise<Shot | null> {
  const rows = await repo.db.all<ShotRow>(`SELECT ${shotColumns} FROM "shots" WHERE "id" = ? AND "project_id" = ? LIMIT 1`, [shotId, projectId]);
  return rows.length ? mapShot(rows[0]) : null;
}

export async function shotRevisionForShot(repo: Repository, shotId: string, revisionId: string): Promise<ShotRevision | null> {
  const rows = await repo.db.all<ShotRevisionRow>(
    `SELECT ${shotRevisionColumns} FROM "shot_revisions" WHERE "id" = ? AND "shot_id" = ? LIMIT 1`,
    [revisionId, shotId],
  );
  return rows.length ? mapShotRevision(rows[0]) : null;
}

// 原子删除单个镜头的领域关联，并重新压紧同章节镜头顺序。
export async function deleteProjectShot(repo: Repository, projectId: string, shotId: string, updatedAt: string): Promise<void> {
  await repo.transaction(async (tx) => {
    const shotRows = await tx.db.all<ShotRow>(`SELECT ${shotColumns} FROM "shots" WHERE "id" = ? AND "project_id" = ? LIMIT 1`, [shotId, projectId]);
    if (!shotRows.length) throw recordNotFound;
    const shot = mapShot(shotRows[0]);
    await tx.db.run('DELETE FROM "production_task_links" WHERE "project_id" = ? AND "shot_id" = ?', [projectId, shotId]);
    await tx.db.run('DELETE FROM "shot_artifacts" WHERE "project_id" = ? AND "shot_id" = ?', [projectId, shotId]);
    await tx.db.run('DELETE FROM "shot_revisions" WHERE "shot_id" = ?', [shotId]);
    await tx.db.run('DELETE FROM "shot_asset_references" WHERE "shot_id" = ?', [shotId]);
    await tx.db.run('DELETE FROM "project_asset_candidates" WHERE "project_id" = ? AND "shot_id" = ?', [projectId, shotId]);
    const changes = await tx.db.run('DELETE FROM "shots" WHERE "id" = ? AND "project_id" = ?', [shotId, projectId]);
    if (changes !== 1) throw recordNotFound;
    const remaining = await tx.db.all<{ id: string; position: number }>(
      'SELECT "id", "position" FROM "shots" WHERE "project_id" = ? AND "unit_id" = ? ORDER BY "position" ASC, "created_at" ASC, "id" ASC',
      [projectId, shot.unitId],
    );
    for (const [position, item] of remaining.entries()) {
      if (Number(item.position) === position) continue;
      await tx.db.run('UPDATE "shots" SET "position" = ?, "updated_at" = ? WHERE "id" = ? AND "project_id" = ?', [
        position,
        new Date().toISOString(),
        item.id,
        projectId,
      ]);
    }
    await invalidateUnitWorkflowTx(tx, projectId, shot.unitId, "storyboard", updatedAt);
    await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [updatedAt, projectId]);
  });
}

export async function projectShotRevisions(repo: Repository, projectId: string): Promise<ShotRevision[]> {
  const rows = await repo.db.all<ShotRevisionRow>(
    `SELECT ${shotRevisionColumns} FROM "shot_revisions" JOIN "shots" ON "shots"."id" = "shot_revisions"."shot_id" WHERE "shots"."project_id" = ? ORDER BY "shots"."unit_id" ASC, "shots"."position" ASC, "shot_revisions"."version" ASC`,
    [projectId],
  );
  return rows.map(mapShotRevision);
}

export async function projectShotArtifacts(repo: Repository, projectId: string): Promise<ShotArtifact[]> {
  const rows = await repo.db.all<ShotArtifactRow>(
    `SELECT ${shotArtifactColumns} FROM "shot_artifacts" WHERE "project_id" = ? ORDER BY "unit_id" ASC, "shot_id" ASC, "type" ASC, "version" ASC`,
    [projectId],
  );
  return rows.map(mapShotArtifact);
}

export async function createShotArtifact(repo: Repository, artifact: ShotArtifact): Promise<void> {
  await repo.transaction(async (tx) => {
    const versionRows = await tx.db.all<{ current: number }>(
      'SELECT COALESCE(MAX("version"), 0) AS "current" FROM "shot_artifacts" WHERE "shot_id" = ? AND "type" = ?',
      [artifact.shotId, artifact.type],
    );
    artifact.version = Number(versionRows[0]?.current ?? 0) + 1;
    if (artifact.selected) {
      await tx.db.run('UPDATE "shot_artifacts" SET "selected" = ?, "updated_at" = ? WHERE "shot_id" = ? AND "type" = ?', [
        false,
        artifact.updatedAt,
        artifact.shotId,
        artifact.type,
      ]);
    }
    await tx.db.run(`INSERT INTO "shot_artifacts" (${shotArtifactColumns}) VALUES (${placeholders(14)})`, [
      artifact.id,
      artifact.projectId,
      artifact.unitId,
      artifact.shotId,
      artifact.revisionId ?? "",
      artifact.taskId ?? "",
      artifact.type,
      artifact.version,
      artifact.resourceId ?? "",
      artifact.status,
      artifact.selected,
      artifact.metadataJson,
      artifact.createdAt,
      artifact.updatedAt,
    ]);
  });
}

export async function markShotArtifactsStale(repo: Repository, shotId: string, updatedAt: string): Promise<void> {
  await repo.db.run('UPDATE "shot_artifacts" SET "status" = ?, "selected" = ?, "updated_at" = ? WHERE "shot_id" = ? AND "status" NOT IN (?, ?)', [
    "stale",
    false,
    updatedAt,
    shotId,
    "failed",
    "stale",
  ]);
}

export async function upsertProductionTaskLink(repo: Repository, link: ProductionTaskLink): Promise<void> {
  const rows = await repo.db.all<{ id: string }>(
    'SELECT "id" FROM "production_task_links" WHERE "task_id" = ? AND "shot_id" = ? AND "artifact_type" = ? LIMIT 1',
    [link.taskId, link.shotId ?? "", link.artifactType ?? ""],
  );
  if (rows.length) {
    await repo.db.run(
      'UPDATE "production_task_links" SET "project_id" = ?, "canvas_id" = ?, "unit_id" = ?, "shot_id" = ?, "workflow_step_id" = ?, "artifact_type" = ?, "updated_at" = ? WHERE "task_id" = ? AND "shot_id" = ? AND "artifact_type" = ?',
      [
        link.projectId,
        link.canvasId ?? "",
        link.unitId ?? "",
        link.shotId ?? "",
        link.workflowStepId ?? "",
        link.artifactType ?? "",
        link.updatedAt,
        link.taskId,
        link.shotId ?? "",
        link.artifactType ?? "",
      ],
    );
    return;
  }
  await repo.db.run(`INSERT INTO "production_task_links" (${productionTaskLinkColumns}) VALUES (${placeholders(10)})`, [
    link.id,
    link.taskId,
    link.projectId,
    link.canvasId ?? "",
    link.unitId ?? "",
    link.shotId ?? "",
    link.workflowStepId ?? "",
    link.artifactType ?? "",
    link.createdAt,
    link.updatedAt,
  ]);
}

export async function upsertShotAssetReference(repo: Repository, reference: ShotAssetReference): Promise<void> {
  const changes = await repo.db.run(
    'UPDATE "shot_asset_references" SET "status" = ? WHERE "shot_id" = ? AND "asset_version_id" = ? AND "role" = ?',
    [reference.status, reference.shotId, reference.assetVersionId, reference.role],
  );
  if (changes > 0) return;
  await repo.db.run(`INSERT INTO "shot_asset_references" (${shotAssetReferenceColumns}) VALUES (${placeholders(6)})`, [
    reference.id,
    reference.shotId,
    reference.assetVersionId,
    reference.role,
    reference.status,
    reference.createdAt,
  ]);
}

export async function upsertShotAssetReferenceAndInvalidate(
  repo: Repository,
  projectId: string,
  reference: ShotAssetReference,
  updatedAt: string,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const changes = await tx.db.run(
      'UPDATE "shot_asset_references" SET "status" = ? WHERE "shot_id" = ? AND "asset_version_id" = ? AND "role" = ?',
      [reference.status, reference.shotId, reference.assetVersionId, reference.role],
    );
    if (changes === 0) {
      await tx.db.run(`INSERT INTO "shot_asset_references" (${shotAssetReferenceColumns}) VALUES (${placeholders(6)})`, [
        reference.id,
        reference.shotId,
        reference.assetVersionId,
        reference.role,
        reference.status,
        reference.createdAt,
      ]);
    }
    await tx.db.run('UPDATE "shot_artifacts" SET "status" = ?, "selected" = ?, "updated_at" = ? WHERE "shot_id" = ? AND "status" NOT IN (?, ?)', [
      "stale",
      false,
      updatedAt,
      reference.shotId,
      "failed",
      "stale",
    ]);
    const shotRows = await tx.db.all<ShotRow>(`SELECT ${shotColumns} FROM "shots" WHERE "id" = ? AND "project_id" = ? LIMIT 1`, [
      reference.shotId,
      projectId,
    ]);
    if (!shotRows.length) throw recordNotFound;
    const shot = mapShot(shotRows[0]);
    await invalidateUnitWorkflowTx(tx, projectId, shot.unitId, "storyboard", updatedAt);
    await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [updatedAt, projectId]);
  });
}

export async function deleteShotAssetReferenceAndInvalidate(
  repo: Repository,
  projectId: string,
  shotId: string,
  referenceId: string,
  updatedAt: string,
): Promise<boolean> {
  let deleted = false;
  await repo.transaction(async (tx) => {
    const changes = await tx.db.run('DELETE FROM "shot_asset_references" WHERE "id" = ? AND "shot_id" = ?', [referenceId, shotId]);
    if (changes === 0) return;
    deleted = true;
    await tx.db.run('UPDATE "shot_artifacts" SET "status" = ?, "selected" = ?, "updated_at" = ? WHERE "shot_id" = ? AND "status" NOT IN (?, ?)', [
      "stale",
      false,
      updatedAt,
      shotId,
      "failed",
      "stale",
    ]);
    const shotRows = await tx.db.all<ShotRow>(`SELECT ${shotColumns} FROM "shots" WHERE "id" = ? AND "project_id" = ? LIMIT 1`, [shotId, projectId]);
    if (!shotRows.length) throw recordNotFound;
    const shot = mapShot(shotRows[0]);
    await invalidateUnitWorkflowTx(tx, projectId, shot.unitId, "storyboard", updatedAt);
    await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [updatedAt, projectId]);
  });
  return deleted;
}

export async function invalidateUnitWorkflowTx(
  repo: Repository,
  projectId: string,
  unitId: string,
  fromStepKey: string,
  updatedAt: string,
): Promise<void> {
  if (unitId.trim() === "") return;
  const instanceRows = await repo.db.all<WorkflowInstanceRow>(
    `SELECT ${workflowInstanceColumns} FROM "workflow_instances" WHERE "project_id" = ? AND "unit_id" = ?`,
    [projectId, unitId],
  );
  for (const instanceRow of instanceRows) {
    const instance = mapWorkflowInstance(instanceRow);
    const stepRows = await repo.db.all<WorkflowStepInstanceRow>(
      `SELECT ${workflowStepInstanceColumns} FROM "workflow_step_instances" WHERE "workflow_instance_id" = ? ORDER BY "position" ASC`,
      [instance.id],
    );
    const steps = stepRows.map(mapWorkflowStepInstance);
    const from = steps.find((step) => step.stepKey === fromStepKey);
    if (!from) continue;
    for (const step of steps) {
      if (step.position < from.position) continue;
      const status = step.position === from.position ? workflowStepStatusRunning : workflowStepStatusPending;
      await repo.db.run(
        'UPDATE "workflow_step_instances" SET "status" = ?, "error" = ?, "completed_at" = NULL, "updated_at" = ? WHERE "id" = ? AND "workflow_instance_id" = ?',
        [status, "", updatedAt, step.id, instance.id],
      );
    }
    await repo.db.run('UPDATE "workflow_instances" SET "status" = ?, "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [
      workflowStatusActive,
      updatedAt,
      instance.id,
    ]);
  }
}

export async function projectShotAssetReferences(repo: Repository, projectId: string): Promise<ShotAssetReference[]> {
  const rows = await repo.db.all<ShotAssetReferenceRow>(
    `SELECT ${shotAssetReferenceColumns} FROM "shot_asset_references" JOIN "shots" ON "shots"."id" = "shot_asset_references"."shot_id" WHERE "shots"."project_id" = ? ORDER BY "shot_asset_references"."created_at" ASC`,
    [projectId],
  );
  return rows.map(mapShotAssetReference);
}

export async function projectAssetCandidates(repo: Repository, projectId: string): Promise<ProjectAssetCandidate[]> {
  const rows = await repo.db.all<ProjectAssetCandidateRow>(
    `SELECT ${projectAssetCandidateColumns} FROM "project_asset_candidates" WHERE "project_id" = ? ORDER BY "created_at" ASC`,
    [projectId],
  );
  return rows.map(mapProjectAssetCandidate);
}

export async function projectAssetCandidate(
  repo: Repository,
  projectId: string,
  candidateId: string,
): Promise<ProjectAssetCandidate | null> {
  const rows = await repo.db.all<ProjectAssetCandidateRow>(
    `SELECT ${projectAssetCandidateColumns} FROM "project_asset_candidates" WHERE "id" = ? AND "project_id" = ? LIMIT 1`,
    [candidateId, projectId],
  );
  return rows.length ? mapProjectAssetCandidate(rows[0]) : null;
}

export async function createProjectAssetCandidates(repo: Repository, candidates: ProjectAssetCandidate[]): Promise<void> {
  if (candidates.length === 0) return;
  const values = candidates.map(() => `(${placeholders(13)})`).join(", ");
  await repo.db.run(
    `INSERT INTO "project_asset_candidates" (${projectAssetCandidateColumns}) VALUES ${values}`,
    candidates.flatMap(candidateValues),
  );
}

function candidateValues(candidate: ProjectAssetCandidate): (string | number | boolean | null)[] {
  return [
    candidate.id,
    candidate.projectId,
    candidate.unitId ?? "",
    candidate.shotId ?? "",
    candidate.name,
    candidate.nameKey ?? "",
    candidate.category,
    candidate.status,
    candidate.source ?? "",
    candidate.detailsJson,
    candidate.resolvedAssetId ?? "",
    candidate.createdAt,
    candidate.updatedAt,
  ];
}

export async function createProjectAssetCandidate(repo: Repository, candidate: ProjectAssetCandidate): Promise<boolean> {
  const changes = await repo.db.run(
    `INSERT INTO "project_asset_candidates" (${projectAssetCandidateColumns}) VALUES (${placeholders(13)}) ON CONFLICT DO NOTHING`,
    candidateValues(candidate),
  );
  return changes === 1;
}

// 将正式资产身份、首版本、项目引用和候选状态放在同一事务中，避免出现半确认数据。
export async function confirmProjectAssetCandidate(
  repo: Repository,
  candidate: ProjectAssetCandidate,
  asset: Asset,
  version: AssetVersion,
  link: ProjectAssetLink,
  createAsset: boolean,
): Promise<void> {
  await repo.transaction(async (tx) => {
    if (createAsset) {
      await tx.db.run(`INSERT INTO "assets" (${assetColumns}) VALUES (${placeholders(11)})`, [
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
      await tx.db.run(`INSERT INTO "asset_versions" (${assetVersionColumns}) VALUES (${placeholders(9)})`, [
        version.id,
        version.assetId,
        version.version,
        version.status,
        version.definitionJson,
        version.prompt,
        version.note,
        version.createdAt,
        version.updatedAt,
      ]);
    } else {
      const assetRows = await tx.db.all<{ id: string }>('SELECT "id" FROM "assets" WHERE "id" = ? AND "user_id" = ? LIMIT 1', [
        asset.id,
        asset.userId,
      ]);
      if (!assetRows.length) throw recordNotFound;
    }
    const linkRows = await tx.db.all<{ id: string }>(
      'SELECT "id" FROM "project_asset_links" WHERE "project_id" = ? AND "asset_id" = ? LIMIT 1',
      [link.projectId, link.assetId],
    );
    if (!linkRows.length) {
      await tx.db.run(`INSERT INTO "project_asset_links" (${projectAssetLinkColumns}) VALUES (${placeholders(6)})`, [
        link.id,
        link.projectId,
        link.assetId,
        link.folderId ?? "",
        link.position,
        link.createdAt,
      ]);
    }
    const changes = await tx.db.run(
      'UPDATE "project_asset_candidates" SET "status" = ?, "resolved_asset_id" = ?, "updated_at" = ? WHERE "id" = ? AND "project_id" = ? AND "status" = ?',
      [candidate.status, candidate.resolvedAssetId ?? "", candidate.updatedAt, candidate.id, candidate.projectId, "pending_confirmation"],
    );
    if (changes !== 1) throw errInvalidData;
    await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [candidate.updatedAt, candidate.projectId]);
  });
}

export async function workflowTemplateVersion(
  repo: Repository,
  templateKey: string,
  version: number,
): Promise<WorkflowTemplateVersion | null> {
  const rows = await repo.db.all<WorkflowTemplateVersionRow>(
    `SELECT ${workflowTemplateVersionColumns} FROM "workflow_template_versions" WHERE "template_key" = ? AND "version" = ? LIMIT 1`,
    [templateKey, version],
  );
  return rows.length ? mapWorkflowTemplateVersion(rows[0]) : null;
}

export async function createWorkflowTemplateVersion(repo: Repository, template: WorkflowTemplateVersion): Promise<void> {
  await repo.db.run(`INSERT INTO "workflow_template_versions" (${workflowTemplateVersionColumns}) VALUES (${placeholders(6)})`, [
    template.id,
    template.templateKey,
    template.name,
    template.version,
    template.definitionJson,
    template.createdAt,
  ]);
}

export async function projectWorkflowInstances(repo: Repository, projectId: string): Promise<WorkflowInstance[]> {
  const rows = await repo.db.all<WorkflowInstanceRow>(
    `SELECT ${workflowInstanceColumns} FROM "workflow_instances" WHERE "project_id" = ? ORDER BY "created_at" ASC`,
    [projectId],
  );
  return rows.map(mapWorkflowInstance);
}

export async function workflowInstanceForScope(
  repo: Repository,
  projectId: string,
  unitId: string,
  templateVersionId: string,
): Promise<WorkflowInstance | null> {
  const rows = await repo.db.all<WorkflowInstanceRow>(
    `SELECT ${workflowInstanceColumns} FROM "workflow_instances" WHERE "project_id" = ? AND "unit_id" = ? AND "template_version_id" = ? LIMIT 1`,
    [projectId, unitId, templateVersionId],
  );
  return rows.length ? mapWorkflowInstance(rows[0]) : null;
}

export async function workflowInstance(repo: Repository, id: string): Promise<WorkflowInstance | null> {
  const rows = await repo.db.all<WorkflowInstanceRow>(`SELECT ${workflowInstanceColumns} FROM "workflow_instances" WHERE "id" = ? LIMIT 1`, [id]);
  return rows.length ? mapWorkflowInstance(rows[0]) : null;
}

export async function workflowSteps(repo: Repository, instanceId: string): Promise<WorkflowStepInstance[]> {
  const rows = await repo.db.all<WorkflowStepInstanceRow>(
    `SELECT ${workflowStepInstanceColumns} FROM "workflow_step_instances" WHERE "workflow_instance_id" = ? ORDER BY "position" ASC`,
    [instanceId],
  );
  return rows.map(mapWorkflowStepInstance);
}

export async function nextWorkflowStep(
  repo: Repository,
  instanceId: string,
  position: number,
): Promise<WorkflowStepInstance | null> {
  const rows = await repo.db.all<WorkflowStepInstanceRow>(
    `SELECT ${workflowStepInstanceColumns} FROM "workflow_step_instances" WHERE "workflow_instance_id" = ? AND "position" > ? ORDER BY "position" ASC LIMIT 1`,
    [instanceId, position],
  );
  return rows.length ? mapWorkflowStepInstance(rows[0]) : null;
}

export async function createWorkflowInstance(
  repo: Repository,
  instance: WorkflowInstance,
  steps: WorkflowStepInstance[],
): Promise<void> {
  await repo.transaction(async (tx) => {
    await tx.db.run(`INSERT INTO "workflow_instances" (${workflowInstanceColumns}) VALUES (${placeholders(9)})`, [
      instance.id,
      instance.projectId,
      instance.unitId ?? "",
      instance.templateVersionId,
      instance.scope,
      instance.status,
      instance.revision,
      instance.createdAt,
      instance.updatedAt,
    ]);
    if (steps.length === 0) return;
    const values = steps.map(() => `(${placeholders(13)})`).join(", ");
    await tx.db.run(
      `INSERT INTO "workflow_step_instances" (${workflowStepInstanceColumns}) VALUES ${values}`,
      steps.flatMap((step) => [
        step.id,
        step.workflowInstanceId,
        step.stepKey,
        step.name,
        step.position,
        step.status,
        step.inputJson,
        step.outputJson,
        step.error,
        step.startedAt ?? null,
        step.completedAt ?? null,
        step.createdAt,
        step.updatedAt,
      ]),
    );
  });
}

export async function workflowStepForProject(
  repo: Repository,
  projectId: string,
  stepId: string,
): Promise<WorkflowStepInstance | null> {
  const rows = await repo.db.all<WorkflowStepInstanceRow>(
    `SELECT ${workflowStepInstanceColumns} FROM "workflow_step_instances" JOIN "workflow_instances" ON "workflow_instances"."id" = "workflow_step_instances"."workflow_instance_id" WHERE "workflow_instances"."project_id" = ? AND "workflow_step_instances"."id" = ? LIMIT 1`,
    [projectId, stepId],
  );
  return rows.length ? mapWorkflowStepInstance(rows[0]) : null;
}

export async function updateWorkflowStep(repo: Repository, step: WorkflowStepInstance): Promise<void> {
  await repo.db.run(
    'UPDATE "workflow_step_instances" SET "status" = ?, "output_json" = ?, "error" = ?, "started_at" = ?, "completed_at" = ?, "updated_at" = ? WHERE "id" = ? AND "workflow_instance_id" = ?',
    [
      step.status,
      step.outputJson,
      step.error,
      step.startedAt ?? null,
      step.completedAt ?? null,
      step.updatedAt,
      step.id,
      step.workflowInstanceId,
    ],
  );
}

// 原子保存当前步骤、下一步骤和实例状态，确保刷新后流程依赖仍可恢复。
export async function updateWorkflowProgress(
  repo: Repository,
  step: WorkflowStepInstance,
  next: WorkflowStepInstance | null,
  instance: WorkflowInstance,
  projectId: string,
): Promise<void> {
  await repo.transaction(async (tx) => {
    await tx.db.run(
      'UPDATE "workflow_step_instances" SET "status" = ?, "output_json" = ?, "error" = ?, "started_at" = ?, "completed_at" = ?, "updated_at" = ? WHERE "id" = ? AND "workflow_instance_id" = ?',
      [
        step.status,
        step.outputJson,
        step.error,
        step.startedAt ?? null,
        step.completedAt ?? null,
        step.updatedAt,
        step.id,
        step.workflowInstanceId,
      ],
    );
    if (next) {
      await tx.db.run('UPDATE "workflow_step_instances" SET "status" = ?, "updated_at" = ? WHERE "id" = ? AND "workflow_instance_id" = ?', [
        next.status,
        next.updatedAt,
        next.id,
        next.workflowInstanceId,
      ]);
    }
    await tx.db.run('UPDATE "workflow_instances" SET "status" = ?, "revision" = ?, "updated_at" = ? WHERE "id" = ? AND "project_id" = ?', [
      instance.status,
      instance.revision,
      instance.updatedAt,
      instance.id,
      projectId,
    ]);
    await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [step.updatedAt, projectId]);
  });
}

// 将成功任务、流程步骤和产物表示写入同一事务，重复回填使用任务与用途唯一键幂等。
export async function registerWorkflowTaskOutput(
  repo: Repository,
  step: WorkflowStepInstance,
  next: WorkflowStepInstance | null,
  instance: WorkflowInstance,
  projectId: string,
  link: WorkflowStepTask,
  representation: AssetRepresentation | null,
  productionLink: ProductionTaskLink | null,
  artifact: ShotArtifact | null,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const linkRows = await tx.db.all<{ id: string }>(
      'SELECT "id" FROM "workflow_step_tasks" WHERE "workflow_step_id" = ? AND "task_id" = ? LIMIT 1',
      [link.workflowStepId, link.taskId],
    );
    if (!linkRows.length) {
      await tx.db.run(`INSERT INTO "workflow_step_tasks" ("id", "workflow_step_id", "task_id", "created_at") VALUES (?, ?, ?, ?)`, [
        link.id,
        link.workflowStepId,
        link.taskId,
        link.createdAt,
      ]);
    }
    if (representation) {
      const representationRows = await tx.db.all<{ id: string }>(
        'SELECT "id" FROM "asset_representations" WHERE "task_id" = ? AND "role" = ? LIMIT 1',
        [representation.taskId ?? "", representation.role],
      );
      if (!representationRows.length) {
        await tx.db.run(`INSERT INTO "asset_representations" (${assetRepresentationColumns}) VALUES (${placeholders(8)})`, [
          representation.id,
          representation.taskId ?? "",
          representation.assetVersionId,
          representation.resourceId ?? "",
          representation.mediaType,
          representation.role,
          representation.metadataJson,
          representation.createdAt,
        ]);
      }
    }
    if (productionLink) {
      const productionRows = await tx.db.all<{ id: string }>(
        'SELECT "id" FROM "production_task_links" WHERE "task_id" = ? AND "shot_id" = ? AND "artifact_type" = ? LIMIT 1',
        [productionLink.taskId, productionLink.shotId ?? "", productionLink.artifactType ?? ""],
      );
      if (!productionRows.length) {
        await tx.db.run(`INSERT INTO "production_task_links" (${productionTaskLinkColumns}) VALUES (${placeholders(10)})`, [
          productionLink.id,
          productionLink.taskId,
          productionLink.projectId,
          productionLink.canvasId ?? "",
          productionLink.unitId ?? "",
          productionLink.shotId ?? "",
          productionLink.workflowStepId ?? "",
          productionLink.artifactType ?? "",
          productionLink.createdAt,
          productionLink.updatedAt,
        ]);
      } else {
        await tx.db.run(
          'UPDATE "production_task_links" SET "project_id" = ?, "canvas_id" = ?, "unit_id" = ?, "workflow_step_id" = ?, "updated_at" = ? WHERE "id" = ?',
          [
            productionLink.projectId,
            productionLink.canvasId ?? "",
            productionLink.unitId ?? "",
            productionLink.workflowStepId ?? "",
            productionLink.updatedAt,
            productionRows[0].id,
          ],
        );
      }
    }
    let pendingArtifact = artifact;
    if (pendingArtifact) {
      const artifactRows = await tx.db.all<{ id: string }>(
        'SELECT "id" FROM "shot_artifacts" WHERE "task_id" = ? AND "shot_id" = ? AND "type" = ? LIMIT 1',
        [pendingArtifact.taskId ?? "", pendingArtifact.shotId, pendingArtifact.type],
      );
      if (artifactRows.length) pendingArtifact = null;
    }
    if (pendingArtifact) {
      const versionRows = await tx.db.all<{ current: number }>(
        'SELECT COALESCE(MAX("version"), 0) AS "current" FROM "shot_artifacts" WHERE "shot_id" = ? AND "type" = ?',
        [pendingArtifact.shotId, pendingArtifact.type],
      );
      pendingArtifact.version = Number(versionRows[0]?.current ?? 0) + 1;
      if (pendingArtifact.selected) {
        await tx.db.run('UPDATE "shot_artifacts" SET "selected" = ?, "updated_at" = ? WHERE "shot_id" = ? AND "type" = ?', [
          false,
          pendingArtifact.updatedAt,
          pendingArtifact.shotId,
          pendingArtifact.type,
        ]);
      }
      await tx.db.run(`INSERT INTO "shot_artifacts" (${shotArtifactColumns}) VALUES (${placeholders(14)})`, [
        pendingArtifact.id,
        pendingArtifact.projectId,
        pendingArtifact.unitId,
        pendingArtifact.shotId,
        pendingArtifact.revisionId ?? "",
        pendingArtifact.taskId ?? "",
        pendingArtifact.type,
        pendingArtifact.version,
        pendingArtifact.resourceId ?? "",
        pendingArtifact.status,
        pendingArtifact.selected,
        pendingArtifact.metadataJson,
        pendingArtifact.createdAt,
        pendingArtifact.updatedAt,
      ]);
    }
    const stepChanges = await tx.db.run(
      'UPDATE "workflow_step_instances" SET "status" = ?, "output_json" = ?, "error" = ?, "started_at" = ?, "completed_at" = ?, "updated_at" = ? WHERE "id" = ? AND "workflow_instance_id" = ?',
      [
        step.status,
        step.outputJson,
        step.error,
        step.startedAt ?? null,
        step.completedAt ?? null,
        step.updatedAt,
        step.id,
        step.workflowInstanceId,
      ],
    );
    if (stepChanges !== 1) throw errInvalidData;
    if (next) {
      const nextChanges = await tx.db.run(
        'UPDATE "workflow_step_instances" SET "status" = ?, "updated_at" = ? WHERE "id" = ? AND "workflow_instance_id" = ?',
        [next.status, next.updatedAt, next.id, next.workflowInstanceId],
      );
      if (nextChanges !== 1) throw errInvalidData;
    }
    const instanceChanges = await tx.db.run(
      'UPDATE "workflow_instances" SET "status" = ?, "revision" = ?, "updated_at" = ? WHERE "id" = ? AND "project_id" = ?',
      [instance.status, instance.revision, instance.updatedAt, instance.id, projectId],
    );
    if (instanceChanges !== 1) throw errInvalidData;
    const projectChanges = await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [
      step.updatedAt,
      projectId,
    ]);
    if (projectChanges !== 1) throw errInvalidData;
  });
}
