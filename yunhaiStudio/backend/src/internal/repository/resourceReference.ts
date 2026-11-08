// 对应 backend/internal/repository/resource_reference.go
// 资源引用快照、素材删除级联与按用户/存储位置查询资源。

import type { SqlValue } from "@/internal/database/database";
import { resourceStatusReady } from "@/internal/model/models";
import type { TaskStatus } from "@/internal/model/models";
import type {
  Asset,
  AssetRepresentation,
  AssetVersion,
  CanvasProject,
  EcommerceProject,
  Project,
  Resource,
  ResourceDeletionJob,
  StyleProfile,
  VoiceProfile,
} from "@/internal/model/modelsProject";
import type { CreationRun, CreationSubmission } from "@/internal/model/modelsCreation";
import type { LoggedTool } from "./typesInternal";
import { canvasHistoryResourceReferences, requireNoCanvasHistoryReferences } from "./canvasHistory";
import { feedbackResourceReferenceKind } from "./repositoryFeedback";
import { recordNotFound, Repository, toIso } from "./repository";
import { insertResourceDeletionJobs } from "./resourceDeletion";
import { dramaResourceReferences } from "./repositoryDramaCanvas";

// 资源删除校验使用的只读业务文档快照。
// repository 只按用户范围读取记录；JSON 中的资源引用合同由 service 统一解释。
export interface ResourceReferenceDocument {
  kind: string;
  id: string;
  title: string;
  primaryJson: string;
  secondaryJson: string;
  taskStatus: TaskStatus;
}

export interface ResourceDirectReference {
  kind: string;
  id: string;
  title: string;
  resourceId: string;
}

export interface ResourceReferenceSnapshot {
  documents: ResourceReferenceDocument[];
  direct: ResourceDirectReference[];
}

function referenceDocument(fields: { kind: string; id: string; primaryJson: string; title?: string; secondaryJson?: string; taskStatus?: TaskStatus }): ResourceReferenceDocument {
  return {
    kind: fields.kind,
    id: fields.id,
    title: fields.title ?? "",
    primaryJson: fields.primaryJson,
    secondaryJson: fields.secondaryJson ?? "",
    taskStatus: fields.taskStatus ?? "",
  };
}

function directReference(kind: string, id: string, title: string, resourceId: string): ResourceDirectReference {
  return { kind, id, title, resourceId };
}

function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}

interface AssetVersionRow {
  id: string;
  asset_id: string;
  version: number;
  status: AssetVersion["status"];
  definition_json: string;
  prompt: string;
  note: string;
  created_at: string;
  updated_at: string;
}

const assetVersionColumns = '"id", "asset_id", "version", "status", "definition_json", "prompt", "note", "created_at", "updated_at"';

function mapAssetVersion(row: AssetVersionRow): AssetVersion {
  return {
    id: row.id,
    assetId: row.asset_id,
    version: Number(row.version),
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

const assetRepresentationColumns = '"id", "task_id", "asset_version_id", "resource_id", "media_type", "role", "metadata_json", "created_at"';

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

interface AssetRow {
  id: string;
  user_id: string;
  folder_id: string | null;
  kind: string;
  category: Asset["category"];
  status: Asset["status"];
  primary_version_id: string | null;
  title: string;
  payload_json: string;
  created_at: string;
  updated_at: string;
}

function mapAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    userId: row.user_id,
    folderId: row.folder_id ?? "",
    kind: row.kind,
    category: row.category,
    status: row.status,
    primaryVersionId: row.primary_version_id ?? "",
    title: row.title,
    payloadJson: row.payload_json,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const assetColumns = '"id", "user_id", "folder_id", "kind", "category", "status", "primary_version_id", "title", "payload_json", "created_at", "updated_at"';

interface ResourceRow {
  id: string;
  user_id: string;
  kind: string;
  status: Resource["status"];
  provider: string;
  endpoint: string;
  bucket: string;
  storage_setting_id: string | null;
  object_key: string;
  public_url: string;
  mime_type: string;
  size: number;
  width: number;
  height: number;
  duration_ms: number;
  e_tag: string;
  playback_status: string;
  playback_object_key: string;
  playback_error: string;
  thumbnail_status: string;
  thumbnail_mime_type: string;
  thumbnail_size: number;
  thumbnail_width: number;
  thumbnail_height: number;
  upload_key: string | null;
  error: string;
  created_at: string;
  updated_at: string;
}

const resourceColumns =
  '"id", "user_id", "kind", "status", "provider", "endpoint", "bucket", "storage_setting_id", "object_key", "public_url", "mime_type", "size", "width", "height", "duration_ms", "e_tag", "playback_status", "playback_object_key", "playback_error", "thumbnail_status", "thumbnail_mime_type", "thumbnail_size", "thumbnail_width", "thumbnail_height", "upload_key", "error", "created_at", "updated_at"';

function mapResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    status: row.status,
    provider: row.provider,
    endpoint: row.endpoint,
    bucket: row.bucket,
    storageSettingId: row.storage_setting_id ?? "",
    objectKey: row.object_key,
    publicUrl: row.public_url,
    mimeType: row.mime_type,
    size: Number(row.size),
    width: Number(row.width),
    height: Number(row.height),
    durationMs: Number(row.duration_ms),
    etag: row.e_tag,
    playbackStatus: row.playback_status,
    playbackObjectKey: row.playback_object_key,
    playbackError: row.playback_error,
    thumbnailStatus: row.thumbnail_status,
    thumbnailMimeType: row.thumbnail_mime_type,
    thumbnailSize: Number(row.thumbnail_size),
    thumbnailWidth: Number(row.thumbnail_width),
    thumbnailHeight: Number(row.thumbnail_height),
    uploadKey: row.upload_key,
    error: row.error,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function assetResourceRecords(repo: Repository, assetId: string): Promise<[AssetVersion[], AssetRepresentation[]]> {
  return assetsResourceRecords(repo, [assetId]);
}

export async function assetsResourceRecords(repo: Repository, assetIds: string[]): Promise<[AssetVersion[], AssetRepresentation[]]> {
  if (assetIds.length === 0) return [[], []];
  const versionRows = await repo.db.all<AssetVersionRow>(
    `SELECT ${assetVersionColumns} FROM "asset_versions" WHERE "asset_id" IN (${placeholders(assetIds.length)})`,
    assetIds,
  );
  const versions = versionRows.map(mapAssetVersion);
  if (versions.length === 0) return [versions, []];
  const versionIds = versions.map((version) => version.id);
  const representationRows = await repo.db.all<AssetRepresentationRow>(
    `SELECT ${assetRepresentationColumns} FROM "asset_representations" WHERE "asset_version_id" IN (${placeholders(versionIds.length)})`,
    versionIds,
  );
  return [versions, representationRows.map(mapAssetRepresentation)];
}

// 只查询整批删除范围之外的素材，不扫描任务和画布。
export async function otherAssetResourceReferences(repo: Repository, userId: string, excludedAssetIds: string[]): Promise<ResourceReferenceSnapshot> {
  const snapshot: ResourceReferenceSnapshot = { documents: [], direct: [] };
  const params: SqlValue[] = [userId];
  let where = '"user_id" = ?';
  if (excludedAssetIds.length > 0) {
    where += ` AND "id" NOT IN (${placeholders(excludedAssetIds.length)})`;
    params.push(...excludedAssetIds);
  }
  const assetRows = await repo.db.all<AssetRow>(`SELECT ${assetColumns} FROM "assets" WHERE ${where}`, params);
  const ids: string[] = [];
  for (const asset of assetRows) {
    ids.push(asset.id);
    snapshot.documents.push(referenceDocument({ kind: "素材", id: asset.id, primaryJson: asset.payload_json }));
  }
  if (ids.length === 0) return snapshot;
  const [versions, representations] = await assetsResourceRecords(repo, ids);
  for (const version of versions) {
    snapshot.documents.push(referenceDocument({ kind: "素材", id: version.id, primaryJson: version.definitionJson }));
  }
  for (const representation of representations) {
    snapshot.direct.push(directReference("素材", representation.id, "", representation.resourceId ?? ""));
    snapshot.documents.push(referenceDocument({ kind: "素材", id: representation.id, primaryJson: representation.metadataJson }));
  }
  return snapshot;
}

export async function resourcesForUserIds(repo: Repository, userId: string, resourceIds: string[]): Promise<Resource[]> {
  if (resourceIds.length === 0) return [];
  const rows = await repo.db.all<ResourceRow>(
    `SELECT ${resourceColumns} FROM "resources" WHERE "user_id" = ? AND "id" IN (${placeholders(resourceIds.length)})`,
    [userId, ...resourceIds],
  );
  return rows.map(mapResource);
}

export async function resourcesByIds(repo: Repository, resourceIds: string[]): Promise<Resource[]> {
  if (resourceIds.length === 0) return [];
  const rows = await repo.db.all<ResourceRow>(
    `SELECT ${resourceColumns} FROM "resources" WHERE "id" IN (${placeholders(resourceIds.length)})`,
    resourceIds,
  );
  return rows.map(mapResource);
}

// 返回未包含在 excludedResourceIds 中、但指向同一物理对象的资源记录数。
// 这用于兼容历史数据中多个 Resource 行复用一个对象路径的情况。
export async function resourceStorageReferenceCount(repo: Repository, resource: Resource | null, excludedResourceIds: string[]): Promise<number> {
  if (resource === null) return 0;
  let where = '"endpoint" = ? AND "bucket" = ? AND "object_key" = ?';
  const params: SqlValue[] = [resource.endpoint, resource.bucket, resource.objectKey];
  const provider = (resource.provider ?? "").trim();
  if (provider === "" || provider.toLowerCase() === "local") {
    where += ' AND "provider" IN (?, ?)';
    params.push("", "local");
  } else {
    where += ' AND "provider" = ?';
    params.push(resource.provider);
  }
  if (excludedResourceIds.length > 0) {
    where += ` AND "id" NOT IN (${placeholders(excludedResourceIds.length)})`;
    params.push(...excludedResourceIds);
  }
  const rows = await repo.db.all<{ total: number }>(`SELECT COUNT(*) AS "total" FROM "resources" WHERE ${where}`, params);
  return Number(rows[0]?.total ?? 0);
}

export async function resourceReferenceSnapshot(repo: Repository, userId: string, excludingAssetId: string, resourceIds: string[]): Promise<ResourceReferenceSnapshot> {
  return resourceReferenceSnapshotExcludingAssets(repo, userId, [excludingAssetId], resourceIds);
}

export async function resourceReferenceSnapshotExcludingAssets(
  repo: Repository,
  userId: string,
  excludingAssetIds: string[],
  resourceIds: string[],
): Promise<ResourceReferenceSnapshot> {
  const snapshot: ResourceReferenceSnapshot = { documents: [], direct: [] };
  if (resourceIds.length === 0) return snapshot;
  const history = await canvasHistoryResourceReferences(repo, resourceIds);
  snapshot.direct.push(...history);
  const dramaReferences = await dramaResourceReferences(repo, userId, resourceIds);
  snapshot.direct.push(...dramaReferences);

  const resourcePlaceholders = placeholders(resourceIds.length);

  const leaseRows = await repo.db.all<{ owner_id: string; resource_id: string }>(
    `SELECT "owner_id", "resource_id" FROM "cloud_agent_resource_leases" WHERE "user_id" = ? AND "resource_id" IN (${resourcePlaceholders}) AND "expires_at" > ?`,
    [userId, ...resourceIds, new Date().toISOString()],
  );
  for (const lease of leaseRows) {
    snapshot.direct.push(directReference("Agent 待执行引用", lease.owner_id, "已准备的生成输入", lease.resource_id));
  }

  const toolRows = await repo.db.all<{ id: number; label: string; cover: string; media_url: string; extra_info_json: string | null }>(
    'SELECT "id", "label", "cover", "media_url", "extra_info_json" FROM "tools" WHERE "owner_id" = ?',
    [userId],
  );
  for (const tool of toolRows) {
    let extra: string[] = [];
    if (tool.extra_info_json) extra = JSON.parse(tool.extra_info_json) as string[];
    const payload = JSON.stringify({ coverUrl: tool.cover, referenceUrls: extra, url: tool.media_url });
    snapshot.documents.push(referenceDocument({ kind: "工具", id: String(tool.id), title: tool.label, primaryJson: payload }));
  }

  const workbenchToolRows = await repo.db.all<{ id: string; name: string; icon_resource_id: string | null; cover_resource_id: string | null }>(
    `SELECT "id", "name", "icon_resource_id", "cover_resource_id" FROM "workbench_tools" WHERE ("icon_resource_id" IN (${resourcePlaceholders}) OR "cover_resource_id" IN (${resourcePlaceholders})) AND "enabled" = ?`,
    [...resourceIds, ...resourceIds, true],
  );
  for (const tool of workbenchToolRows) {
    if (tool.icon_resource_id && resourceIds.includes(tool.icon_resource_id)) {
      snapshot.direct.push(directReference("工作台工具图标", tool.id, tool.name, tool.icon_resource_id));
    }
    if (tool.cover_resource_id && resourceIds.includes(tool.cover_resource_id)) {
      snapshot.direct.push(directReference("工作台工具封面", tool.id, tool.name, tool.cover_resource_id));
    }
  }

  const assetParams: SqlValue[] = [userId];
  let assetWhere = '"user_id" = ?';
  if (excludingAssetIds.length > 0) {
    assetWhere += ` AND "id" NOT IN (${placeholders(excludingAssetIds.length)})`;
    assetParams.push(...excludingAssetIds);
  }
  const assetRows = await repo.db.all<AssetRow>(`SELECT ${assetColumns} FROM "assets" WHERE ${assetWhere}`, assetParams);
  for (const asset of assetRows) {
    snapshot.documents.push(referenceDocument({ kind: "素材", id: asset.id, title: asset.title, primaryJson: asset.payload_json }));
  }

  const canvasRows = await repo.db.all<CanvasProject & { created_at: string; updated_at: string }>(
    'SELECT "id", "title", "payload_json" FROM "canvas_projects" WHERE "user_id" = ?',
    [userId],
  );
  for (const canvas of canvasRows) {
    snapshot.documents.push(referenceDocument({ kind: "画布", id: canvas.id, title: canvas.title, primaryJson: canvas.payload_json }));
  }

  const taskParams: SqlValue[] = [userId];
  let taskWhere = '"user_id" = ?';
  if (resourceIds.length <= 100) {
    const conditions: string[] = [];
    for (const resourceId of resourceIds) {
      conditions.push('"input_json" LIKE ? OR "result_json" LIKE ?');
      taskParams.push(`%${resourceId}%`, `%${resourceId}%`);
    }
    if (conditions.length > 0) taskWhere += ` AND ${conditions.join(" OR ")}`;
  }
  const taskRows = await repo.db.all<{ id: string; prompt: string; status: TaskStatus; input_json: string; result_json: string }>(
    `SELECT "id", "prompt", "status", "input_json", "result_json" FROM "tasks" WHERE ${taskWhere}`,
    taskParams,
  );
  const taskStatuses = new Map<string, TaskStatus>();
  for (const task of taskRows) {
    taskStatuses.set(task.id, task.status);
    snapshot.documents.push(
      referenceDocument({
        kind: "任务",
        id: task.id,
        title: task.prompt,
        primaryJson: task.input_json,
        secondaryJson: task.result_json,
        taskStatus: task.status,
      }),
    );
  }

  const runRows = await repo.db.all<{ id: string; state_json: string; approved_operations_json: string }>(
    'SELECT "id", "state_json", "approved_operations_json" FROM "creation_runs" WHERE "user_id" = ?',
    [userId],
  );
  for (const run of runRows) {
    snapshot.documents.push(referenceDocument({ kind: "创作会话", id: run.id, title: "智能创作", primaryJson: run.state_json, secondaryJson: run.approved_operations_json }));
  }

  const submissionRows = await repo.db.all<{ id: string; item_key: string; request_json: string }>(
    'SELECT "id", "item_key", "request_json" FROM "creation_submissions" WHERE "user_id" = ? AND "revoked_at" IS NULL',
    [userId],
  );
  for (const submission of submissionRows) {
    snapshot.documents.push(referenceDocument({ kind: "创作执行项", id: submission.id, title: submission.item_key, primaryJson: submission.request_json }));
  }

  const taskLogParams: SqlValue[] = [userId];
  let taskLogWhere = '"user_id" = ?';
  if (resourceIds.length <= 100) {
    const conditions: string[] = [];
    for (const resourceId of resourceIds) {
      conditions.push('"payload" LIKE ?');
      taskLogParams.push(`%${resourceId}%`);
    }
    if (conditions.length > 0) taskLogWhere += ` AND ${conditions.join(" OR ")}`;
  }
  const taskLogRows = await repo.db.all<{ id: string; task_id: string; message: string; payload: string }>(
    `SELECT "id", "task_id", "message", "payload" FROM "task_logs" WHERE ${taskLogWhere}`,
    taskLogParams,
  );
  for (const taskLog of taskLogRows) {
    snapshot.documents.push(
      referenceDocument({ kind: "任务日志", id: taskLog.id, title: taskLog.message, primaryJson: taskLog.payload, taskStatus: taskStatuses.get(taskLog.task_id) ?? "" }),
    );
  }

  const resultRows = await repo.db.all<{ id: string; task_id: string; kind: string; url: string; payload: string }>(
    'SELECT "id", "task_id", "kind", "url", "payload" FROM "results" WHERE "user_id" = ?',
    [userId],
  );
  for (const result of resultRows) {
    snapshot.documents.push(
      referenceDocument({
        kind: "任务结果",
        id: result.id,
        title: result.kind,
        primaryJson: result.url,
        secondaryJson: result.payload,
        taskStatus: taskStatuses.get(result.task_id) ?? "",
      }),
    );
  }

  const projectRows = await repo.db.all<Project & { cover_resource_id: string | null }>(
    'SELECT "id", "name", "cover_resource_id", "style_profile_json" FROM "projects" WHERE "user_id" = ?',
    [userId],
  );
  for (const project of projectRows) {
    snapshot.documents.push(referenceDocument({ kind: "项目", id: project.id, title: project.name, primaryJson: project.style_profile_json }));
    const coverResourceId = project.cover_resource_id ?? "";
    if (coverResourceId !== "" && resourceIds.includes(coverResourceId)) {
      snapshot.direct.push(directReference("项目主图", project.id, project.name, coverResourceId));
    }
  }

  const ecommerceRows = await repo.db.all<EcommerceProject>('SELECT "id", "name", "draft_json", "plan_json" FROM "ecommerce_projects" WHERE "user_id" = ?', [userId]);
  for (const project of ecommerceRows) {
    snapshot.documents.push(referenceDocument({ kind: "电商项目", id: project.id, title: project.name, primaryJson: project.draft_json, secondaryJson: project.plan_json }));
  }

  const styleRows = await repo.db.all<StyleProfile>('SELECT "id", "name", "cover_url", "profile_json" FROM "style_profiles" WHERE "user_id" = ?', [userId]);
  for (const style of styleRows) {
    snapshot.documents.push(referenceDocument({ kind: "风格", id: style.id, title: style.name, primaryJson: style.cover_url, secondaryJson: style.profile_json }));
  }

  interface JoinedDocumentRow {
    id: string;
    title: string | null;
    primary_json: string | null;
    secondary_json?: string | null;
  }

  const versionParams: SqlValue[] = [userId];
  let versionWhere = '"assets"."user_id" = ?';
  if (excludingAssetIds.length > 0) {
    versionWhere += ` AND "assets"."id" NOT IN (${placeholders(excludingAssetIds.length)})`;
    versionParams.push(...excludingAssetIds);
  }
  const versionRows = await repo.db.all<JoinedDocumentRow>(
    `SELECT "asset_versions"."id", "assets"."title", "asset_versions"."definition_json" AS "primary_json" FROM "asset_versions" JOIN "assets" ON "assets"."id" = "asset_versions"."asset_id" WHERE ${versionWhere}`,
    versionParams,
  );
  for (const version of versionRows) {
    snapshot.documents.push(referenceDocument({ kind: "素材", id: version.id, title: version.title ?? "", primaryJson: version.primary_json ?? "" }));
  }

  const candidateRows = await repo.db.all<JoinedDocumentRow>(
    `SELECT "project_asset_candidates"."id", "projects"."name" AS "title", "project_asset_candidates"."details_json" AS "primary_json" FROM "project_asset_candidates" JOIN "projects" ON "projects"."id" = "project_asset_candidates"."project_id" WHERE "projects"."user_id" = ?`,
    [userId],
  );
  for (const candidate of candidateRows) {
    snapshot.documents.push(referenceDocument({ kind: "项目", id: candidate.id, title: candidate.title ?? "", primaryJson: candidate.primary_json ?? "" }));
  }

  const stepRows = await repo.db.all<JoinedDocumentRow>(
    `SELECT "workflow_step_instances"."id", "workflow_step_instances"."name" AS "title", "workflow_step_instances"."input_json" AS "primary_json", "workflow_step_instances"."output_json" AS "secondary_json" FROM "workflow_step_instances" JOIN "workflow_instances" ON "workflow_instances"."id" = "workflow_step_instances"."workflow_instance_id" JOIN "projects" ON "projects"."id" = "workflow_instances"."project_id" WHERE "projects"."user_id" = ?`,
    [userId],
  );
  for (const step of stepRows) {
    snapshot.documents.push(
      referenceDocument({ kind: "工作流", id: step.id, title: step.title ?? "", primaryJson: step.primary_json ?? "", secondaryJson: step.secondary_json ?? "" }),
    );
  }

  const artifactDocumentRows = await repo.db.all<JoinedDocumentRow>(
    `SELECT "shot_artifacts"."id", "shots"."title", "shot_artifacts"."metadata_json" AS "primary_json" FROM "shot_artifacts" JOIN "shots" ON "shots"."id" = "shot_artifacts"."shot_id" JOIN "projects" ON "projects"."id" = "shots"."project_id" WHERE "projects"."user_id" = ?`,
    [userId],
  );
  for (const artifact of artifactDocumentRows) {
    snapshot.documents.push(referenceDocument({ kind: "镜头产物", id: artifact.id, title: artifact.title ?? "", primaryJson: artifact.primary_json ?? "" }));
  }

  interface JoinedRepresentationRow {
    id: string;
    title: string | null;
    resource_id: string | null;
    metadata_json: string;
  }

  const representationParams: SqlValue[] = [userId];
  let representationWhere = '"assets"."user_id" = ?';
  if (excludingAssetIds.length > 0) {
    representationWhere += ` AND "assets"."id" NOT IN (${placeholders(excludingAssetIds.length)})`;
    representationParams.push(...excludingAssetIds);
  }
  const representationRows = await repo.db.all<JoinedRepresentationRow>(
    `SELECT "asset_representations"."id", "assets"."title", "asset_representations"."resource_id", "asset_representations"."metadata_json" FROM "asset_representations" JOIN "asset_versions" ON "asset_versions"."id" = "asset_representations"."asset_version_id" JOIN "assets" ON "assets"."id" = "asset_versions"."asset_id" WHERE ${representationWhere}`,
    representationParams,
  );
  for (const representation of representationRows) {
    snapshot.direct.push(directReference("素材", representation.id, representation.title ?? "", representation.resource_id ?? ""));
    snapshot.documents.push(
      referenceDocument({ kind: "素材", id: representation.id, title: representation.title ?? "", primaryJson: representation.metadata_json }),
    );
  }

  const voiceRows = await repo.db.all<VoiceProfile>(
    `SELECT "id", "name", "sample_resource_id" FROM "voice_profiles" WHERE "user_id" = ? AND "sample_resource_id" IN (${resourcePlaceholders})`,
    [userId, ...resourceIds],
  );
  for (const voice of voiceRows) {
    snapshot.direct.push(directReference("声音", voice.id, voice.name, voice.sample_resource_id ?? ""));
  }

  const artifactRows = await repo.db.all<{ id: string; title: string | null; resource_id: string | null }>(
    `SELECT "shot_artifacts"."id", "shots"."title", "shot_artifacts"."resource_id" FROM "shot_artifacts" JOIN "shots" ON "shots"."id" = "shot_artifacts"."shot_id" JOIN "projects" ON "projects"."id" = "shots"."project_id" WHERE "projects"."user_id" = ? AND "shot_artifacts"."resource_id" IN (${resourcePlaceholders})`,
    [userId, ...resourceIds],
  );
  for (const artifact of artifactRows) {
    snapshot.direct.push(directReference("镜头产物", artifact.id, artifact.title ?? "", artifact.resource_id ?? ""));
  }

  const announcementRows = await repo.db.all<{ id: string; title: string; image_resource_id: string | null }>(
    `SELECT "id", "title", "image_resource_id" FROM "announcements" WHERE "created_by" = ? AND "image_resource_id" IN (${resourcePlaceholders})`,
    [userId, ...resourceIds],
  );
  for (const announcement of announcementRows) {
    snapshot.direct.push(directReference("公告", announcement.id, announcement.title, announcement.image_resource_id ?? ""));
  }

  const announcementDraftRows = await repo.db.all<{ resource_id: string }>(
    `SELECT "resource_id" FROM "announcement_image_drafts" WHERE "user_id" = ? AND "resource_id" IN (${resourcePlaceholders})`,
    [userId, ...resourceIds],
  );
  for (const draft of announcementDraftRows) {
    snapshot.direct.push(directReference("公告草稿", draft.resource_id, "", draft.resource_id));
  }

  // 反馈附件只记录在 user_feedbacks.attachments 中，不进入素材或画布；漏掉会被孤儿清理删除，后台收件箱无法查看。
  const feedbackRows = await repo.db.all<{ id: string; title: string; attachments: string }>(
    'SELECT "id", "title", "attachments" FROM "user_feedbacks" WHERE "user_id" = ? AND "attachments" <> ? AND "attachments" <> ?',
    [userId, "", "[]"],
  );
  for (const feedback of feedbackRows) {
    snapshot.documents.push(referenceDocument({ kind: feedbackResourceReferenceKind, id: feedback.id, title: feedback.title, primaryJson: feedback.attachments }));
  }
  return snapshot;
}

export async function assetBusinessReferences(repo: Repository, userId: string, assetId: string): Promise<ResourceDirectReference[]> {
  interface ProjectReferenceRow {
    id: string;
    title: string | null;
  }
  const projectRows = await repo.db.all<ProjectReferenceRow>(
    `SELECT DISTINCT "projects"."id", "projects"."name" AS "title" FROM "project_asset_links" JOIN "projects" ON "projects"."id" = "project_asset_links"."project_id" WHERE "projects"."user_id" = ? AND "project_asset_links"."asset_id" = ?`,
    [userId, assetId],
  );
  const shotProjectRows = await repo.db.all<ProjectReferenceRow>(
    `SELECT DISTINCT "projects"."id", "projects"."name" AS "title" FROM "shot_asset_references" JOIN "asset_versions" ON "asset_versions"."id" = "shot_asset_references"."asset_version_id" JOIN "shots" ON "shots"."id" = "shot_asset_references"."shot_id" JOIN "projects" ON "projects"."id" = "shots"."project_id" WHERE "projects"."user_id" = ? AND "asset_versions"."asset_id" = ?`,
    [userId, assetId],
  );
  const candidateProjectRows = await repo.db.all<ProjectReferenceRow>(
    `SELECT DISTINCT "projects"."id", "projects"."name" AS "title" FROM "project_asset_candidates" JOIN "projects" ON "projects"."id" = "project_asset_candidates"."project_id" WHERE "projects"."user_id" = ? AND "project_asset_candidates"."resolved_asset_id" = ?`,
    [userId, assetId],
  );
  return [...projectRows, ...shotProjectRows, ...candidateProjectRows].map((project) => directReference("项目", project.id, project.title ?? "", ""));
}

export async function deleteAssetAndResources(
  repo: Repository,
  userId: string,
  assetId: string,
  resourceIds: string[],
  deletionJobs: ResourceDeletionJob[],
  deleteReferencedResources: boolean,
): Promise<void> {
  return deleteAssetsAndResources(repo, userId, [assetId], resourceIds, deletionJobs, deleteReferencedResources);
}

export async function deleteAssetsAndResources(
  repo: Repository,
  userId: string,
  assetIds: string[],
  resourceIds: string[],
  deletionJobs: ResourceDeletionJob[],
  deleteReferencedResources: boolean,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    let ownedAssetCount = 0;
    if (assetIds.length > 0) {
      const ownedRows = await tx.db.all<{ id: string }>(
        `SELECT "id" FROM "assets" WHERE "user_id" = ? AND "id" IN (${placeholders(assetIds.length)}) ORDER BY "id"${locking}`,
        [userId, ...assetIds],
      );
      ownedAssetCount = ownedRows.length;
    }
    if (assetIds.length === 0 || ownedAssetCount !== assetIds.length) throw recordNotFound;

    if (deleteReferencedResources) {
      // 彻底删除：移除被删资源的画布历史索引，让删除 worker 可以释放物理对象；
      // 历史快照正文保留，恢复该版本时由画布断链修复处理失效媒体。
      if (resourceIds.length > 0) {
        const resourcePlaceholders = placeholders(resourceIds.length);
        // 与历史快照写入串行化，避免清除索引后又插入外键引用。
        if (tx.dialect() === "postgres") {
          await tx.db.all(`SELECT "id" FROM "resources" WHERE "id" IN (${resourcePlaceholders}) ORDER BY "id" FOR UPDATE`, resourceIds);
        }
        await tx.db.run(`DELETE FROM "canvas_snapshot_resources" WHERE "resource_id" IN (${resourcePlaceholders})`, resourceIds);
      }
    } else {
      // 受保护删除不得让任何画布历史快照失效。
      await requireNoCanvasHistoryReferences(tx, resourceIds);
    }

    const assetPlaceholders = placeholders(assetIds.length);
    const versionIds = `SELECT "id" FROM "asset_versions" WHERE "asset_id" IN (${assetPlaceholders})`;
    await tx.db.run(`DELETE FROM "shot_asset_references" WHERE "asset_version_id" IN (${versionIds})`, assetIds);
    await tx.db.run(`DELETE FROM "character_voice_bindings" WHERE "asset_version_id" IN (${versionIds})`, assetIds);
    await tx.db.run(`DELETE FROM "asset_representations" WHERE "asset_version_id" IN (${versionIds})`, assetIds);
    await tx.db.run(`DELETE FROM "project_asset_links" WHERE "asset_id" IN (${assetPlaceholders})`, assetIds);
    await tx.db.run(`DELETE FROM "project_asset_candidates" WHERE "resolved_asset_id" IN (${assetPlaceholders})`, assetIds);
    await tx.db.run(`DELETE FROM "asset_versions" WHERE "asset_id" IN (${assetPlaceholders})`, assetIds);
    await tx.db.run(`DELETE FROM "assets" WHERE "id" IN (${assetPlaceholders}) AND "user_id" = ?`, [...assetIds, userId]);

    await insertResourceDeletionJobs(tx, deletionJobs);

    if (resourceIds.length === 0) return;
    const resourcePlaceholders = placeholders(resourceIds.length);
    await tx.db.run(`DELETE FROM "ark_private_asset_bindings" WHERE "resource_id" IN (${resourcePlaceholders})`, resourceIds);
    await tx.db.run(`DELETE FROM "resources" WHERE "user_id" = ? AND "id" IN (${resourcePlaceholders})`, [userId, ...resourceIds]);
  });
}
