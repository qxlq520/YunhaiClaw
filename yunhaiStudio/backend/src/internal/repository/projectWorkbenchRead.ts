// 对应 backend/internal/repository/project_workbench_read.go
// 项目工作台的总览指标、单元、镜头与分页列表读取。

import {
  projectUnitStatusCompleted,
  projectUnitStatusDraft,
  taskStatusSucceeded,
} from "@/internal/model/models";
import { taskTypeTimelineRender } from "@/internal/model/timelineTaskType";
import type {
  Asset,
  AssetRepresentation,
  AssetVersion,
  CanvasProject,
  CanvasUnitLink,
  ProjectAssetCandidate,
  ProjectUnit,
  Shot,
  ShotArtifact,
  ShotAssetReference,
  ShotRevision,
  WorkflowInstance,
} from "@/internal/model/modelsProject";
import { Repository, toBool, toIso } from "./repository";

export interface ProjectOverviewMetrics {
  unitCount: number;
  completedUnitCount: number;
  totalWordCount: number;
  unitsWithoutText: number;
  unitsWithoutShots: number;
  canvasCount: number;
  assetCount: number;
  shotCount: number;
  pendingCandidateCount: number;
  readyStoryboardCount: number;
  readyPrevizCount: number;
  readyVideoCount: number;
  timelineRenderSucceededCount: number;
  staleArtifactCount: number;
}

export interface ProjectOverviewUnitRow extends ProjectUnit {
  shotCount: number;
  candidateCount: number;
  canvasCount: number;
}

export interface ProjectAssetCountRow {
  key: string;
  count: number;
}

interface ProjectUnitRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  kind: string;
  title: string;
  source_text: string | null;
  word_count: number;
  status: string;
  position: number;
  created_at: string;
  updated_at: string;
}

function mapProjectUnit(row: ProjectUnitRow): ProjectUnit {
  return {
    id: row.id,
    projectId: row.project_id,
    parentId: row.parent_id ?? "",
    kind: row.kind,
    title: row.title,
    sourceText: row.source_text ?? "",
    wordCount: Number(row.word_count ?? 0),
    status: row.status,
    position: Number(row.position ?? 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

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
    position: Number(row.position ?? 0),
    durationMs: Number(row.duration_ms ?? 0),
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

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
    version: Number(row.version ?? 0),
    plotDescription: row.plot_description,
    action: row.action,
    dialogue: row.dialogue,
    shotSize: row.shot_size,
    cameraAngle: row.camera_angle,
    cameraMovement: row.camera_movement,
    durationMs: Number(row.duration_ms ?? 0),
    imagePrompt: row.image_prompt,
    videoPrompt: row.video_prompt,
    negativePrompt: row.negative_prompt,
    continuityNotes: row.continuity_notes,
    actionBeatsJson: row.action_beats_json,
    createdBy: row.created_by ?? "",
    createdAt: toIso(row.created_at),
  };
}

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
    version: Number(row.version ?? 0),
    resourceId: row.resource_id ?? "",
    status: row.status,
    selected: toBool(row.selected),
    metadataJson: row.metadata_json,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

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

interface AssetVersionRow {
  id: string;
  asset_id: string;
  version: number;
  status: string;
  definition_json: string;
  prompt: string;
  note: string;
  created_at: string;
  updated_at: string;
}

function mapAssetVersion(row: AssetVersionRow): AssetVersion {
  return {
    id: row.id,
    assetId: row.asset_id,
    version: Number(row.version ?? 0),
    status: row.status,
    definitionJson: row.definition_json,
    prompt: row.prompt,
    note: row.note,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

interface AssetRepresentationRow {
  id: string;
  task_id: string | null;
  asset_version_id: string;
  resource_id: string | null;
  media_type: string;
  role: string;
  metadata_json: string;
  created_at: string;
}

function mapAssetRepresentation(row: AssetRepresentationRow): AssetRepresentation {
  return {
    id: row.id,
    taskId: row.task_id ?? "",
    assetVersionId: row.asset_version_id,
    resourceId: row.resource_id ?? "",
    mediaType: row.media_type,
    role: row.role,
    metadataJson: row.metadata_json,
    createdAt: toIso(row.created_at),
  };
}

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
    revision: Number(row.revision ?? 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

interface CanvasUnitLinkRow {
  id: string;
  project_id: string;
  canvas_id: string;
  unit_id: string;
  role: string;
  created_at: string;
}

function mapCanvasUnitLink(row: CanvasUnitLinkRow): CanvasUnitLink {
  return {
    id: row.id,
    projectId: row.project_id,
    canvasId: row.canvas_id,
    unitId: row.unit_id,
    role: row.role,
    createdAt: toIso(row.created_at),
  };
}

interface CanvasProjectRow {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  payload_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

function mapCanvasProject(row: CanvasProjectRow): CanvasProject {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    projectId: row.project_id ?? "",
    title: row.title,
    payloadJson: row.payload_json ?? "",
    revision: Number(row.revision ?? 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function projectUnitCanvasCounts(repo: Repository, projectId: string): Promise<Map<string, number>> {
  const rows = await repo.db.all<{ key: string; count: number }>(
    'SELECT "unit_id" AS "key", COUNT(DISTINCT "canvas_id") AS "count" FROM "canvas_unit_links" WHERE "project_id" = ? GROUP BY "unit_id"',
    [projectId],
  );
  return new Map(rows.map((row) => [row.key, Number(row.count ?? 0)]));
}

interface ProjectOverviewMetricsRow {
  unit_count: number;
  completed_unit_count: number;
  total_word_count: number;
  units_without_text: number;
  units_without_shots: number;
  canvas_count: number;
  asset_count: number;
  shot_count: number;
  pending_candidate_count: number;
  ready_storyboard_count: number;
  ready_previz_count: number;
  ready_video_count: number;
  timeline_render_succeeded_count: number;
  stale_artifact_count: number;
}

export async function projectOverviewMetrics(
  repo: Repository,
  projectId: string,
): Promise<ProjectOverviewMetrics> {
  const rows = await repo.db.all<ProjectOverviewMetricsRow>(
    `
      SELECT
        (SELECT COUNT(*) FROM "project_units" WHERE "project_id" = ?) AS "unit_count",
        (SELECT COUNT(*) FROM "project_units" WHERE "project_id" = ? AND "status" = ?) AS "completed_unit_count",
        (SELECT COALESCE(SUM("word_count"), 0) FROM "project_units" WHERE "project_id" = ?) AS "total_word_count",
        (SELECT COUNT(*) FROM "project_units" WHERE "project_id" = ? AND "word_count" = 0) AS "units_without_text",
        (SELECT COUNT(*) FROM "project_units" pu WHERE pu."project_id" = ? AND pu."status" <> ? AND NOT EXISTS (SELECT 1 FROM "shots" s WHERE s."project_id" = pu."project_id" AND s."unit_id" = pu."id")) AS "units_without_shots",
        (SELECT COUNT(*) FROM "canvas_projects" WHERE "project_id" = ?) AS "canvas_count",
        (SELECT COUNT(*) FROM "project_asset_links" WHERE "project_id" = ?) AS "asset_count",
        (SELECT COUNT(*) FROM "shots" WHERE "project_id" = ?) AS "shot_count",
        (SELECT COUNT(*) FROM "project_asset_candidates" WHERE "project_id" = ? AND "status" = 'pending_confirmation') AS "pending_candidate_count",
        (SELECT COUNT(DISTINCT "shot_id") FROM "shot_artifacts" WHERE "project_id" = ? AND "type" = 'storyboard' AND "selected" = ? AND "status" = 'ready') AS "ready_storyboard_count",
        (SELECT COUNT(DISTINCT "shot_id") FROM "shot_artifacts" WHERE "project_id" = ? AND "type" = 'action_board' AND "selected" = ? AND "status" = 'ready') AS "ready_previz_count",
        (SELECT COUNT(DISTINCT "shot_id") FROM "shot_artifacts" WHERE "project_id" = ? AND "type" = 'video' AND "selected" = ? AND "status" = 'ready') AS "ready_video_count",
        (SELECT COUNT(*) FROM "tasks" WHERE "project_id" = ? AND "type" = ? AND "status" = ?) AS "timeline_render_succeeded_count",
        (SELECT COUNT(*) FROM "shot_artifacts" WHERE "project_id" = ? AND "status" = 'stale') AS "stale_artifact_count"
    `,
    [
      projectId,
      projectId,
      projectUnitStatusCompleted,
      projectId,
      projectId,
      projectId,
      projectUnitStatusDraft,
      projectId,
      projectId,
      projectId,
      projectId,
      projectId,
      true,
      projectId,
      true,
      projectId,
      true,
      projectId,
      taskTypeTimelineRender,
      taskStatusSucceeded,
      projectId,
    ],
  );
  const row = rows[0];
  return {
    unitCount: Number(row?.unit_count ?? 0),
    completedUnitCount: Number(row?.completed_unit_count ?? 0),
    totalWordCount: Number(row?.total_word_count ?? 0),
    unitsWithoutText: Number(row?.units_without_text ?? 0),
    unitsWithoutShots: Number(row?.units_without_shots ?? 0),
    canvasCount: Number(row?.canvas_count ?? 0),
    assetCount: Number(row?.asset_count ?? 0),
    shotCount: Number(row?.shot_count ?? 0),
    pendingCandidateCount: Number(row?.pending_candidate_count ?? 0),
    readyStoryboardCount: Number(row?.ready_storyboard_count ?? 0),
    readyPrevizCount: Number(row?.ready_previz_count ?? 0),
    readyVideoCount: Number(row?.ready_video_count ?? 0),
    timelineRenderSucceededCount: Number(row?.timeline_render_succeeded_count ?? 0),
    staleArtifactCount: Number(row?.stale_artifact_count ?? 0),
  };
}

interface ProjectOverviewUnitDbRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  kind: string;
  title: string;
  word_count: number;
  status: string;
  position: number;
  created_at: string;
  updated_at: string;
  shot_count: number;
  candidate_count: number;
  canvas_count: number;
}

export async function projectOverviewUnits(
  repo: Repository,
  projectId: string,
  limit: number,
): Promise<ProjectOverviewUnitRow[]> {
  const size = limit <= 0 || limit > 20 ? 8 : limit;
  const rows = await repo.db.all<ProjectOverviewUnitDbRow>(
    `
      SELECT pu."id", pu."project_id", pu."parent_id", pu."kind", pu."title", pu."word_count", pu."status", pu."position", pu."created_at", pu."updated_at",
        (SELECT COUNT(*) FROM "shots" s WHERE s."project_id" = pu."project_id" AND s."unit_id" = pu."id") AS "shot_count",
        (SELECT COUNT(*) FROM "project_asset_candidates" pac WHERE pac."project_id" = pu."project_id" AND pac."unit_id" = pu."id") AS "candidate_count",
        (SELECT COUNT(DISTINCT cul."canvas_id") FROM "canvas_unit_links" cul WHERE cul."project_id" = pu."project_id" AND cul."unit_id" = pu."id") AS "canvas_count"
      FROM "project_units" pu
      WHERE pu."project_id" = ?
      ORDER BY pu."position" ASC, pu."created_at" ASC
      LIMIT ?
    `,
    [projectId, size],
  );
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    parentId: row.parent_id ?? "",
    kind: row.kind,
    title: row.title,
    sourceText: "",
    wordCount: Number(row.word_count ?? 0),
    status: row.status,
    position: Number(row.position ?? 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    shotCount: Number(row.shot_count ?? 0),
    candidateCount: Number(row.candidate_count ?? 0),
    canvasCount: Number(row.canvas_count ?? 0),
  }));
}

export async function projectUnitShots(repo: Repository, projectId: string, unitId: string): Promise<Shot[]> {
  const rows = await repo.db.all<ShotRow>(
    'SELECT * FROM "shots" WHERE "project_id" = ? AND "unit_id" = ? ORDER BY "position" ASC, "created_at" ASC',
    [projectId, unitId],
  );
  return rows.map(mapShot);
}

export async function projectUnitShotRevisions(
  repo: Repository,
  projectId: string,
  unitId: string,
): Promise<ShotRevision[]> {
  const rows = await repo.db.all<ShotRevisionRow>(
    'SELECT "shot_revisions".* FROM "shot_revisions" JOIN "shots" ON "shots"."id" = "shot_revisions"."shot_id" WHERE "shots"."project_id" = ? AND "shots"."unit_id" = ? ORDER BY "shots"."position" ASC, "shot_revisions"."version" ASC',
    [projectId, unitId],
  );
  return rows.map(mapShotRevision);
}

export async function projectUnitShotArtifacts(
  repo: Repository,
  projectId: string,
  unitId: string,
): Promise<ShotArtifact[]> {
  const rows = await repo.db.all<ShotArtifactRow>(
    'SELECT * FROM "shot_artifacts" WHERE "project_id" = ? AND "unit_id" = ? ORDER BY "shot_id" ASC, "type" ASC, "version" ASC',
    [projectId, unitId],
  );
  return rows.map(mapShotArtifact);
}

export async function projectUnitShotAssetReferences(
  repo: Repository,
  projectId: string,
  unitId: string,
): Promise<ShotAssetReference[]> {
  const rows = await repo.db.all<ShotAssetReferenceRow>(
    'SELECT "shot_asset_references".* FROM "shot_asset_references" JOIN "shots" ON "shots"."id" = "shot_asset_references"."shot_id" WHERE "shots"."project_id" = ? AND "shots"."unit_id" = ? ORDER BY "shot_asset_references"."created_at" ASC',
    [projectId, unitId],
  );
  return rows.map(mapShotAssetReference);
}

export async function projectAssetVersionsByIds(
  repo: Repository,
  projectId: string,
  versionIds: string[],
): Promise<AssetVersion[]> {
  if (versionIds.length === 0) return [];
  const placeholders = versionIds.map(() => "?").join(", ");
  const rows = await repo.db.all<AssetVersionRow>(
    `SELECT "asset_versions".* FROM "asset_versions" JOIN "project_asset_links" ON "project_asset_links"."asset_id" = "asset_versions"."asset_id" WHERE "project_asset_links"."project_id" = ? AND "asset_versions"."id" IN (${placeholders})`,
    [projectId, ...versionIds],
  );
  return rows.map(mapAssetVersion);
}

export async function assetRepresentationsByVersionIds(
  repo: Repository,
  versionIds: string[],
): Promise<AssetRepresentation[]> {
  if (versionIds.length === 0) return [];
  const placeholders = versionIds.map(() => "?").join(", ");
  const rows = await repo.db.all<AssetRepresentationRow>(
    `SELECT * FROM "asset_representations" WHERE "asset_version_id" IN (${placeholders}) ORDER BY "asset_version_id" ASC, "role" ASC, "created_at" ASC`,
    versionIds,
  );
  return rows.map(mapAssetRepresentation);
}

export async function projectUnitAssetCandidates(
  repo: Repository,
  projectId: string,
  unitId: string,
): Promise<ProjectAssetCandidate[]> {
  const rows = await repo.db.all<ProjectAssetCandidateRow>(
    'SELECT * FROM "project_asset_candidates" WHERE "project_id" = ? AND ("unit_id" = ? OR "unit_id" = \'\') ORDER BY "created_at" ASC',
    [projectId, unitId],
  );
  return rows.map(mapProjectAssetCandidate);
}

export async function projectUnitAssets(
  repo: Repository,
  userId: string,
  projectId: string,
  unitId: string,
): Promise<Asset[]> {
  const rows = await repo.db.all<AssetRow>(
    'SELECT DISTINCT "assets".* FROM "assets" JOIN "project_asset_links" pal ON pal."asset_id" = "assets"."id" AND pal."project_id" = ? JOIN "asset_versions" av ON av."asset_id" = "assets"."id" JOIN "shot_asset_references" sar ON sar."asset_version_id" = av."id" JOIN "shots" s ON s."id" = sar."shot_id" AND s."project_id" = ? AND s."unit_id" = ? WHERE "assets"."user_id" = ? ORDER BY "assets"."updated_at" DESC',
    [projectId, projectId, unitId, userId],
  );
  return rows.map(mapAsset);
}

export async function projectWorkflowInstancesForUnit(
  repo: Repository,
  projectId: string,
  unitId: string,
): Promise<WorkflowInstance[]> {
  const rows = await repo.db.all<WorkflowInstanceRow>(
    'SELECT * FROM "workflow_instances" WHERE "project_id" = ? AND "unit_id" = ? ORDER BY "created_at" ASC',
    [projectId, unitId],
  );
  return rows.map(mapWorkflowInstance);
}

export async function projectCanvasSummariesPage(
  repo: Repository,
  userId: string,
  projectId: string,
  page: number,
  pageSize: number,
): Promise<{ canvases: CanvasProject[]; total: number }> {
  const totals = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "canvas_projects" WHERE "user_id" = ? AND "project_id" = ?',
    [userId, projectId],
  );
  const total = Number(totals[0]?.total ?? 0);
  const rows = await repo.db.all<CanvasProjectRow>(
    'SELECT "id", "user_id", "project_id", "title", "created_at", "updated_at" FROM "canvas_projects" WHERE "user_id" = ? AND "project_id" = ? ORDER BY "updated_at" DESC LIMIT ? OFFSET ?',
    [userId, projectId, pageSize, (page - 1) * pageSize],
  );
  return { canvases: rows.map(mapCanvasProject), total };
}

export async function userCanvasProjectsPage(
  repo: Repository,
  userId: string,
  page: number,
  pageSize: number,
  projectId: string,
  search: string,
  sort: string,
): Promise<{ projects: CanvasProject[]; total: number }> {
  const conditions = ['"user_id" = ?'];
  const values: string[] = [userId];
  if (projectId === "independent") {
    conditions.push('("project_id" = \'\' OR "project_id" IS NULL)');
  } else if (projectId !== "" && projectId !== "all") {
    conditions.push('"project_id" = ?');
    values.push(projectId);
  }
  const keyword = search.trim();
  if (keyword !== "") {
    conditions.push('LOWER("title") LIKE ?');
    values.push(`%${keyword.toLowerCase()}%`);
  }
  const where = ` WHERE ${conditions.join(" AND ")}`;
  const totals = await repo.db.all<{ total: number }>(`SELECT COUNT(*) AS "total" FROM "canvas_projects"${where}`, values);
  const total = Number(totals[0]?.total ?? 0);
  let order = '"updated_at" DESC, "id" ASC';
  if (sort === "name") {
    order = '"title" ASC, "id" ASC';
  } else if (sort === "nodes") {
    order =
      repo.dialect() === "postgres"
        ? 'COALESCE(jsonb_array_length("payload_json"::jsonb->\'nodes\'), 0) DESC, "id" ASC'
        : 'COALESCE(json_array_length("payload_json", \'$.nodes\'), 0) DESC, "id" ASC';
  }
  const rows = await repo.db.all<CanvasProjectRow>(
    `SELECT * FROM "canvas_projects"${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...values, pageSize, (page - 1) * pageSize],
  );
  return { projects: rows.map(mapCanvasProject), total };
}

export async function projectCanvasUnitLinksForCanvases(
  repo: Repository,
  projectId: string,
  canvasIds: string[],
): Promise<CanvasUnitLink[]> {
  if (canvasIds.length === 0) return [];
  const placeholders = canvasIds.map(() => "?").join(", ");
  const rows = await repo.db.all<CanvasUnitLinkRow>(
    `SELECT * FROM "canvas_unit_links" WHERE "project_id" = ? AND "canvas_id" IN (${placeholders}) ORDER BY "created_at" ASC`,
    [projectId, ...canvasIds],
  );
  return rows.map(mapCanvasUnitLink);
}

export async function projectAssetCandidatesPage(
  repo: Repository,
  projectId: string,
  page: number,
  pageSize: number,
  unitId: string,
  status: string,
  category: string,
  queryText: string,
): Promise<{ candidates: ProjectAssetCandidate[]; total: number }> {
  const conditions = ['"project_id" = ?'];
  const values: string[] = [projectId];
  const unitValue = unitId.trim();
  if (unitValue !== "") {
    conditions.push('"unit_id" = ?');
    values.push(unitValue);
  }
  const statusValue = status.trim();
  if (statusValue !== "") {
    conditions.push('"status" = ?');
    values.push(statusValue);
  }
  const categoryValue = category.trim();
  if (categoryValue !== "") {
    conditions.push('"category" = ?');
    values.push(categoryValue);
  }
  const keyword = queryText.trim();
  if (keyword !== "") {
    conditions.push('LOWER("name") LIKE ?');
    values.push(`%${keyword.toLowerCase()}%`);
  }
  const where = ` WHERE ${conditions.join(" AND ")}`;
  const totals = await repo.db.all<{ total: number }>(
    `SELECT COUNT(*) AS "total" FROM "project_asset_candidates"${where}`,
    values,
  );
  const total = Number(totals[0]?.total ?? 0);
  const rows = await repo.db.all<ProjectAssetCandidateRow>(
    `SELECT * FROM "project_asset_candidates"${where} ORDER BY "created_at" DESC LIMIT ? OFFSET ?`,
    [...values, pageSize, (page - 1) * pageSize],
  );
  return { candidates: rows.map(mapProjectAssetCandidate), total };
}

export async function projectAssetsPage(
  repo: Repository,
  userId: string,
  projectId: string,
  page: number,
  pageSize: number,
  category: string,
  mediaType: string,
  status: string,
  folderId: string | null,
  queryText: string,
): Promise<{ assets: Asset[]; total: number }> {
  const conditions = ['"assets"."user_id" = ?', '"project_asset_links"."project_id" = ?'];
  const values: string[] = [userId, projectId];
  const categoryValue = category.trim();
  if (categoryValue !== "") {
    conditions.push('"assets"."category" = ?');
    values.push(categoryValue);
  }
  const mediaTypeValue = mediaType.trim();
  if (mediaTypeValue !== "") {
    conditions.push('"assets"."kind" = ?');
    values.push(mediaTypeValue);
  }
  const statusValue = status.trim();
  if (statusValue !== "") {
    conditions.push('"assets"."status" = ?');
    values.push(statusValue);
  }
  if (folderId !== null) {
    conditions.push('"project_asset_links"."folder_id" = ?');
    values.push(folderId.trim());
  }
  const keyword = queryText.trim();
  if (keyword !== "") {
    conditions.push('LOWER("assets"."title") LIKE ?');
    values.push(`%${keyword.toLowerCase()}%`);
  }
  const where = ` WHERE ${conditions.join(" AND ")}`;
  const from = ' FROM "assets" JOIN "project_asset_links" ON "project_asset_links"."asset_id" = "assets"."id"';
  const totals = await repo.db.all<{ total: number }>(`SELECT COUNT(*) AS "total"${from}${where}`, values);
  const total = Number(totals[0]?.total ?? 0);
  const rows = await repo.db.all<AssetRow>(
    `SELECT "assets".*${from}${where} ORDER BY "assets"."updated_at" DESC LIMIT ? OFFSET ?`,
    [...values, pageSize, (page - 1) * pageSize],
  );
  return { assets: rows.map(mapAsset), total };
}

export async function projectAssetFacets(
  repo: Repository,
  projectId: string,
): Promise<{ categories: ProjectAssetCountRow[]; folders: ProjectAssetCountRow[] }> {
  const categoryRows = await repo.db.all<{ key: string | null; count: number }>(
    'SELECT "assets"."category" AS "key", COUNT(*) AS "count" FROM "assets" JOIN "project_asset_links" pal ON pal."asset_id" = "assets"."id" WHERE pal."project_id" = ? GROUP BY "assets"."category"',
    [projectId],
  );
  const folderRows = await repo.db.all<{ key: string | null; count: number }>(
    'SELECT "folder_id" AS "key", COUNT(*) AS "count" FROM "project_asset_links" WHERE "project_id" = ? GROUP BY "folder_id"',
    [projectId],
  );
  return {
    categories: categoryRows.map((row) => ({ key: row.key ?? "", count: Number(row.count ?? 0) })),
    folders: folderRows.map((row) => ({ key: row.key ?? "", count: Number(row.count ?? 0) })),
  };
}
