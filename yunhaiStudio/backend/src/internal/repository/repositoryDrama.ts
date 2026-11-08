// 对应 backend/internal/repository/repository_drama.go
// 短剧自动制作域：制作控制面、章节/集、设定、镜头、剧情段、版本记录与调度作业。

import type { SqlValue } from "@/internal/database/database";
import { newId } from "@/internal/kernel/errors";
import { projectUnitKindChapter, projectUnitStatusReady, projectUnitStatusReserved, taskStatusSucceeded } from "@/internal/model/models";
import type { DramaCast, DramaEpisode, DramaJob, DramaProduction, DramaSegment, DramaShot, DramaTake } from "@/internal/model/modelsDrama";
import {
  dramaEpisodeDefaultTitle,
  dramaJobCanceled,
  dramaJobCastImage,
  dramaJobFailed,
  dramaJobQueued,
  dramaJobRender,
  dramaJobRunning,
  dramaJobSegmentPrompt,
  dramaJobSegmentVideo,
  dramaJobSucceeded,
  dramaMediaFailed,
  dramaMediaReady,
  dramaMediaRunning,
  dramaMediaStale,
  dramaStatusDraft,
  dramaStatusRunning,
} from "@/internal/model/modelsDrama";
import type { Project, ProjectUnit } from "@/internal/model/modelsProject";
import { recordNotFound, Repository, toBool, toIso, toNullableIso } from "./repository";
import { errProjectNameConflict } from "./repositoryProjects";
import { errInvalidData } from "./repositoryShotsWorkflows";

// ErrDramaPlanPending 表示还有章节在等待分集规划，此时不能逐集追加。
export const errDramaPlanPending = new Error("drama plan pending");
// ErrDramaDraftStarted 表示要重存的草稿已经开工（状态不是草稿或已有作业）。
export const errDramaDraftStarted = new Error("drama draft started");
// ErrDramaLastEpisode 表示作品只剩这一集，不能再删。
export const errDramaLastEpisode = new Error("drama last episode");
// ErrDramaEpisodeBusy 表示这一集还有已提交的生成任务在进行，结果回写前不能删除。
export const errDramaEpisodeBusy = new Error("drama episode busy");
// ErrDramaEpisodeConfirmRequired 表示这一集生成过视频，删除需要用户输入确认。
export const errDramaEpisodeConfirmRequired = new Error("drama episode confirm required");
// ErrDramaChaptersChanged 表示要加入制作的章节已不是预留状态（已被加入或不属于本作品）。
export const errDramaChaptersChanged = new Error("drama chapters changed");
// ErrDramaJobChanged 表示作业在读取后已被取消、重试或绑定到其他任务，本次写入作废。
export const errDramaJobChanged = new Error("短剧作业已变化，请重新读取");

const errReopenRaced = new Error("drama segment changed during reopen");

// 字段值里的原始 SQL 表达式（对应 gorm.Expr）。
export interface SqlExpr {
  sql: string;
}

export function sqlExpr(sql: string): SqlExpr {
  return { sql };
}

function isSqlExpr(value: unknown): value is SqlExpr {
  return typeof value === "object" && value !== null && typeof (value as { sql?: unknown }).sql === "string";
}

function quote(column: string): string {
  return `"${column.replace(/"/g, '""')}"`;
}

function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}

// 部分列更新的 SET 片段；SqlExpr 直接拼进 SQL，其余走占位符。
function assignments(fields: Record<string, unknown>): { sql: string; params: SqlValue[] } {
  const parts: string[] = [];
  const params: SqlValue[] = [];
  for (const [column, value] of Object.entries(fields)) {
    if (isSqlExpr(value)) {
      parts.push(`${quote(column)} = ${value.sql}`);
    } else {
      parts.push(`${quote(column)} = ?`);
      params.push((value ?? null) as SqlValue);
    }
  }
  return { sql: parts.join(", "), params };
}

async function updateFields(repo: Repository, table: string, fields: Record<string, unknown>, where: string, params: SqlValue[]): Promise<number> {
  const built = assignments(fields);
  return repo.db.run(`UPDATE ${quote(table)} SET ${built.sql} WHERE ${where}`, [...built.params, ...params]);
}

async function insertRows(repo: Repository, table: string, columns: string[], rows: SqlValue[][], batchSize?: number): Promise<void> {
  if (rows.length === 0) return;
  const tuple = `(${placeholders(columns.length)})`;
  const size = batchSize && batchSize > 0 ? batchSize : rows.length;
  for (let index = 0; index < rows.length; index += size) {
    const batch = rows.slice(index, index + size);
    await repo.db.run(`INSERT INTO ${quote(table)} (${columns.map(quote).join(", ")}) VALUES ${batch.map(() => tuple).join(", ")}`, batch.flat());
  }
}

async function updateRow(
  repo: Repository,
  table: string,
  columns: string[],
  values: SqlValue[],
  where: string,
  params: SqlValue[],
  omit: string[] = [],
): Promise<number> {
  const pairs = columns.map((column, index) => ({ column, value: values[index] })).filter((pair) => !omit.includes(pair.column));
  const sql = pairs.map((pair) => `${quote(pair.column)} = ?`).join(", ");
  return repo.db.run(`UPDATE ${quote(table)} SET ${sql} WHERE ${where}`, [...pairs.map((pair) => pair.value), ...params]);
}

async function firstOrThrow<T>(repo: Repository, sql: string, params: SqlValue[]): Promise<T> {
  const rows = await repo.db.all<T>(sql, params);
  if (rows.length === 0) throw recordNotFound;
  return rows[0];
}

// ===== 行映射 =====

interface DramaProductionRow {
  project_id: string;
  user_id: string;
  status: string;
  stage: string;
  settings_json: string;
  bible_json: string;
  budget_microcredits: number;
  spent_microcredits: number;
  plan_cursor: number;
  plan_done: unknown;
  sample_approved: unknown;
  assets_released: unknown;
  pause_reason: string;
  draft_json: string | null;
  revision: number;
  last_tick_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapDramaProduction(row: DramaProductionRow): DramaProduction {
  return {
    projectId: row.project_id,
    userId: row.user_id,
    status: row.status,
    stage: row.stage,
    settingsJson: row.settings_json,
    bibleJson: row.bible_json,
    budgetMicrocredits: Number(row.budget_microcredits),
    spentMicrocredits: Number(row.spent_microcredits),
    planCursor: Number(row.plan_cursor),
    planDone: toBool(row.plan_done),
    sampleApproved: toBool(row.sample_approved),
    assetsReleased: toBool(row.assets_released),
    pauseReason: row.pause_reason,
    draftJson: row.draft_json ?? "",
    revision: Number(row.revision),
    lastTickAt: toNullableIso(row.last_tick_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const dramaProductionColumns = [
  "project_id",
  "user_id",
  "status",
  "stage",
  "settings_json",
  "bible_json",
  "budget_microcredits",
  "spent_microcredits",
  "plan_cursor",
  "plan_done",
  "sample_approved",
  "assets_released",
  "pause_reason",
  "draft_json",
  "revision",
  "last_tick_at",
  "created_at",
  "updated_at",
];

const dramaProductionSelect = dramaProductionColumns.map(quote).join(", ");

function dramaProductionValues(production: DramaProduction): SqlValue[] {
  return [
    production.projectId,
    production.userId,
    production.status,
    production.stage,
    production.settingsJson,
    production.bibleJson,
    production.budgetMicrocredits,
    production.spentMicrocredits,
    production.planCursor,
    production.planDone,
    production.sampleApproved,
    production.assetsReleased,
    production.pauseReason,
    production.draftJson ?? "",
    production.revision,
    production.lastTickAt ?? null,
    production.createdAt,
    production.updatedAt,
  ];
}

interface DramaCastRow {
  revision: number;
  id: string;
  project_id: string;
  kind: string;
  name: string;
  aliases_json: string;
  role: string;
  description: string;
  appearance: string;
  image_prompt: string;
  voice_instructions: string;
  voice_profile_id: string | null;
  voice_sample_resource_id: string | null;
  parent_id: string | null;
  look_name: string | null;
  look_from_chapter: number | null;
  look_to_chapter: number | null;
  importance: number;
  image_resource_id: string | null;
  image_status: string;
  image_version: number;
  locked: unknown;
  position: number;
  created_at: string;
  updated_at: string;
}

function mapDramaCast(row: DramaCastRow): DramaCast {
  return {
    revision: Number(row.revision),
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    name: row.name,
    aliasesJson: row.aliases_json,
    role: row.role,
    description: row.description,
    appearance: row.appearance,
    imagePrompt: row.image_prompt,
    voiceInstructions: row.voice_instructions,
    voiceProfileId: row.voice_profile_id ?? "",
    voiceSampleResourceId: row.voice_sample_resource_id ?? "",
    parentId: row.parent_id ?? "",
    lookName: row.look_name ?? "",
    lookFromChapter: Number(row.look_from_chapter ?? 0),
    lookToChapter: Number(row.look_to_chapter ?? 0),
    importance: Number(row.importance),
    imageResourceId: row.image_resource_id ?? "",
    imageStatus: row.image_status,
    imageVersion: Number(row.image_version),
    locked: toBool(row.locked),
    position: Number(row.position),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const dramaCastColumns = [
  "revision",
  "id",
  "project_id",
  "kind",
  "name",
  "aliases_json",
  "role",
  "description",
  "appearance",
  "image_prompt",
  "voice_instructions",
  "voice_profile_id",
  "voice_sample_resource_id",
  "parent_id",
  "look_name",
  "look_from_chapter",
  "look_to_chapter",
  "importance",
  "image_resource_id",
  "image_status",
  "image_version",
  "locked",
  "position",
  "created_at",
  "updated_at",
];

const dramaCastSelect = dramaCastColumns.map(quote).join(", ");

function dramaCastValues(cast: DramaCast): SqlValue[] {
  return [
    cast.revision,
    cast.id,
    cast.projectId,
    cast.kind,
    cast.name,
    cast.aliasesJson,
    cast.role,
    cast.description,
    cast.appearance,
    cast.imagePrompt,
    cast.voiceInstructions,
    cast.voiceProfileId ?? "",
    cast.voiceSampleResourceId ?? "",
    cast.parentId ?? "",
    cast.lookName ?? "",
    cast.lookFromChapter ?? 0,
    cast.lookToChapter ?? 0,
    cast.importance,
    cast.imageResourceId ?? "",
    cast.imageStatus,
    cast.imageVersion,
    cast.locked,
    cast.position,
    cast.createdAt,
    cast.updatedAt,
  ];
}

interface DramaEpisodeRow {
  id: string;
  project_id: string;
  number: number;
  title: string;
  synopsis: string;
  hook: string;
  cliffhanger: string;
  chapter_i_ds_json: string;
  source_format: string;
  stage: string;
  error: string;
  shot_count: number;
  duration_ms: number;
  approved: unknown;
  media_released: unknown;
  final_resource_id: string | null;
  final_stale: unknown;
  subtitle_srt: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

function mapDramaEpisode(row: DramaEpisodeRow): DramaEpisode {
  return {
    id: row.id,
    projectId: row.project_id,
    number: Number(row.number),
    title: row.title,
    synopsis: row.synopsis,
    hook: row.hook,
    cliffhanger: row.cliffhanger,
    chapterIdsJson: row.chapter_i_ds_json,
    sourceFormat: row.source_format,
    stage: row.stage,
    error: row.error,
    shotCount: Number(row.shot_count),
    durationMs: Number(row.duration_ms),
    approved: toBool(row.approved),
    mediaReleased: toBool(row.media_released),
    finalResourceId: row.final_resource_id ?? "",
    finalStale: toBool(row.final_stale),
    subtitleSrt: row.subtitle_srt ?? "",
    revision: Number(row.revision),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const dramaEpisodeColumns = [
  "id",
  "project_id",
  "number",
  "title",
  "synopsis",
  "hook",
  "cliffhanger",
  "chapter_i_ds_json",
  "source_format",
  "stage",
  "error",
  "shot_count",
  "duration_ms",
  "approved",
  "media_released",
  "final_resource_id",
  "final_stale",
  "subtitle_srt",
  "revision",
  "created_at",
  "updated_at",
];

const dramaEpisodeSelect = dramaEpisodeColumns.map(quote).join(", ");
// Omit("subtitle_srt") 的列表查询。
const dramaEpisodeListSelect = dramaEpisodeColumns
  .filter((column) => column !== "subtitle_srt")
  .map(quote)
  .join(", ");

function dramaEpisodeValues(episode: DramaEpisode): SqlValue[] {
  return [
    episode.id,
    episode.projectId,
    episode.number,
    episode.title,
    episode.synopsis,
    episode.hook,
    episode.cliffhanger,
    episode.chapterIdsJson,
    episode.sourceFormat,
    episode.stage,
    episode.error,
    episode.shotCount,
    episode.durationMs,
    episode.approved,
    episode.mediaReleased,
    episode.finalResourceId ?? "",
    episode.finalStale,
    episode.subtitleSrt,
    episode.revision,
    episode.createdAt,
    episode.updatedAt,
  ];
}

interface DramaShotRow {
  id: string;
  project_id: string;
  episode_id: string;
  position: number;
  segment_index: number;
  segment_title: string;
  scene: string;
  scene_cast_id: string | null;
  cast_i_ds_json: string;
  prop_i_ds_json: string;
  look_cast_i_ds_json: string;
  speaker: string;
  dialogue: string;
  action: string;
  shot_size: string;
  camera: string;
  transition: string;
  duration_ms: number;
  image_prompt: string;
  video_prompt: string;
  source_quote: string;
  created_at: string;
  updated_at: string;
}

function mapDramaShot(row: DramaShotRow): DramaShot {
  return {
    id: row.id,
    projectId: row.project_id,
    episodeId: row.episode_id,
    position: Number(row.position),
    segmentIndex: Number(row.segment_index),
    segmentTitle: row.segment_title,
    scene: row.scene,
    sceneCastId: row.scene_cast_id ?? "",
    castIdsJson: row.cast_i_ds_json,
    propIdsJson: row.prop_i_ds_json,
    lookCastIdsJson: row.look_cast_i_ds_json,
    speaker: row.speaker,
    dialogue: row.dialogue,
    action: row.action,
    shotSize: row.shot_size,
    camera: row.camera,
    transition: row.transition,
    durationMs: Number(row.duration_ms),
    imagePrompt: row.image_prompt,
    videoPrompt: row.video_prompt,
    sourceQuote: row.source_quote,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const dramaShotColumns = [
  "id",
  "project_id",
  "episode_id",
  "position",
  "segment_index",
  "segment_title",
  "scene",
  "scene_cast_id",
  "cast_i_ds_json",
  "prop_i_ds_json",
  "look_cast_i_ds_json",
  "speaker",
  "dialogue",
  "action",
  "shot_size",
  "camera",
  "transition",
  "duration_ms",
  "image_prompt",
  "video_prompt",
  "source_quote",
  "created_at",
  "updated_at",
];

const dramaShotSelect = dramaShotColumns.map(quote).join(", ");

function dramaShotValues(shot: DramaShot): SqlValue[] {
  return [
    shot.id,
    shot.projectId,
    shot.episodeId,
    shot.position,
    shot.segmentIndex,
    shot.segmentTitle,
    shot.scene,
    shot.sceneCastId ?? "",
    shot.castIdsJson,
    shot.propIdsJson,
    shot.lookCastIdsJson,
    shot.speaker,
    shot.dialogue,
    shot.action,
    shot.shotSize,
    shot.camera,
    shot.transition,
    shot.durationMs,
    shot.imagePrompt,
    shot.videoPrompt,
    shot.sourceQuote,
    shot.createdAt,
    shot.updatedAt,
  ];
}

interface DramaSegmentRow {
  prompt_seconds: number;
  revision: number;
  id: string;
  project_id: string;
  episode_id: string;
  segment_index: number;
  video_prompt: string;
  prompt_status: string;
  prompt_error: string;
  video_prompt_override: string;
  video_model_json: string;
  reference_cast_i_ds_json: string;
  reference_images_json: string;
  audio_cast_i_ds_json: string;
  video_status: string;
  video_resource_id: string | null;
  tail_frame_resource_id: string | null;
  video_seconds: number;
  video_error: string;
  created_at: string;
  updated_at: string;
}

function mapDramaSegment(row: DramaSegmentRow): DramaSegment {
  return {
    promptSeconds: Number(row.prompt_seconds),
    revision: Number(row.revision),
    id: row.id,
    projectId: row.project_id,
    episodeId: row.episode_id,
    segmentIndex: Number(row.segment_index),
    videoPrompt: row.video_prompt,
    promptStatus: row.prompt_status,
    promptError: row.prompt_error,
    videoPromptOverride: row.video_prompt_override,
    videoModelJson: row.video_model_json,
    referenceCastIdsJson: row.reference_cast_i_ds_json,
    referenceImagesJson: row.reference_images_json,
    audioCastIdsJson: row.audio_cast_i_ds_json,
    videoStatus: row.video_status,
    videoResourceId: row.video_resource_id ?? "",
    tailFrameResourceId: row.tail_frame_resource_id ?? "",
    videoSeconds: Number(row.video_seconds),
    videoError: row.video_error,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const dramaSegmentColumns = [
  "prompt_seconds",
  "revision",
  "id",
  "project_id",
  "episode_id",
  "segment_index",
  "video_prompt",
  "prompt_status",
  "prompt_error",
  "video_prompt_override",
  "video_model_json",
  "reference_cast_i_ds_json",
  "reference_images_json",
  "audio_cast_i_ds_json",
  "video_status",
  "video_resource_id",
  "tail_frame_resource_id",
  "video_seconds",
  "video_error",
  "created_at",
  "updated_at",
];

const dramaSegmentSelect = dramaSegmentColumns.map(quote).join(", ");

function dramaSegmentValues(segment: DramaSegment): SqlValue[] {
  return [
    segment.promptSeconds,
    segment.revision,
    segment.id,
    segment.projectId,
    segment.episodeId,
    segment.segmentIndex,
    segment.videoPrompt,
    segment.promptStatus,
    segment.promptError,
    segment.videoPromptOverride,
    segment.videoModelJson,
    segment.referenceCastIdsJson,
    segment.referenceImagesJson,
    segment.audioCastIdsJson,
    segment.videoStatus,
    segment.videoResourceId ?? "",
    segment.tailFrameResourceId ?? "",
    segment.videoSeconds,
    segment.videoError,
    segment.createdAt,
    segment.updatedAt,
  ];
}

interface DramaTakeRow {
  id: string;
  project_id: string;
  owner_id: string;
  kind: string;
  version: number;
  resource_id: string;
  task_id: string;
  prompt: string;
  duration_ms: number;
  created_at: string;
}

function mapDramaTake(row: DramaTakeRow): DramaTake {
  return {
    id: row.id,
    projectId: row.project_id,
    ownerId: row.owner_id,
    kind: row.kind,
    version: Number(row.version),
    resourceId: row.resource_id,
    taskId: row.task_id,
    prompt: row.prompt,
    durationMs: Number(row.duration_ms),
    createdAt: toIso(row.created_at),
  };
}

const dramaTakeColumns = ["id", "project_id", "owner_id", "kind", "version", "resource_id", "task_id", "prompt", "duration_ms", "created_at"];

const dramaTakeSelect = dramaTakeColumns.map(quote).join(", ");

function dramaTakeValues(take: DramaTake): SqlValue[] {
  return [take.id, take.projectId, take.ownerId, take.kind, take.version, take.resourceId, take.taskId, take.prompt, take.durationMs, take.createdAt];
}

interface DramaJobRow {
  id: string;
  project_id: string;
  status: string;
  kind: string;
  episode_id: string | null;
  shot_id: string | null;
  cast_id: string | null;
  task_id: string | null;
  priority: number;
  attempt: number;
  label: string;
  payload_json: string | null;
  attempts_json: string | null;
  error: string;
  cost_microcredits: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapDramaJob(row: DramaJobRow): DramaJob {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    kind: row.kind,
    episodeId: row.episode_id ?? "",
    shotId: row.shot_id ?? "",
    castId: row.cast_id ?? "",
    taskId: row.task_id ?? "",
    priority: Number(row.priority),
    attempt: Number(row.attempt),
    label: row.label,
    payloadJson: row.payload_json ?? "",
    attemptsJson: row.attempts_json ?? "",
    error: row.error,
    costMicrocredits: Number(row.cost_microcredits),
    startedAt: toNullableIso(row.started_at),
    finishedAt: toNullableIso(row.finished_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const dramaJobColumns = [
  "id",
  "project_id",
  "status",
  "kind",
  "episode_id",
  "shot_id",
  "cast_id",
  "task_id",
  "priority",
  "attempt",
  "label",
  "payload_json",
  "attempts_json",
  "error",
  "cost_microcredits",
  "started_at",
  "finished_at",
  "created_at",
  "updated_at",
];

const dramaJobSelect = dramaJobColumns.map(quote).join(", ");

function dramaJobValues(job: DramaJob): SqlValue[] {
  return [
    job.id,
    job.projectId,
    job.status,
    job.kind,
    job.episodeId ?? "",
    job.shotId ?? "",
    job.castId ?? "",
    job.taskId ?? "",
    job.priority,
    job.attempt,
    job.label,
    job.payloadJson ?? "",
    job.attemptsJson ?? "",
    job.error,
    job.costMicrocredits,
    job.startedAt ?? null,
    job.finishedAt ?? null,
    job.createdAt,
    job.updatedAt,
  ];
}

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  type: string;
  aspect_ratio: string;
  source_type: string;
  description: string;
  cover_resource_id: string | null;
  style_preset_id: string;
  style_profile_json: string;
  default_image_model: string | null;
  default_video_model: string | null;
  status: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type,
    aspectRatio: row.aspect_ratio,
    sourceType: row.source_type,
    description: row.description,
    coverResourceId: row.cover_resource_id ?? "",
    stylePresetId: row.style_preset_id,
    styleProfileJson: row.style_profile_json,
    defaultImageModel: row.default_image_model ?? "",
    defaultVideoModel: row.default_video_model ?? "",
    status: row.status,
    revision: Number(row.revision),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const projectColumns = [
  "id",
  "user_id",
  "name",
  "type",
  "aspect_ratio",
  "source_type",
  "description",
  "cover_resource_id",
  "style_preset_id",
  "style_profile_json",
  "default_image_model",
  "default_video_model",
  "status",
  "revision",
  "created_at",
  "updated_at",
];

const projectSelect = projectColumns.map(quote).join(", ");
const projectJoinSelect = projectColumns.map((column) => `"projects".${quote(column)}`).join(", ");

function projectValues(project: Project): SqlValue[] {
  return [
    project.id,
    project.userId,
    project.name,
    project.type,
    project.aspectRatio,
    project.sourceType,
    project.description,
    project.coverResourceId ?? "",
    project.stylePresetId,
    project.styleProfileJson,
    project.defaultImageModel ?? "",
    project.defaultVideoModel ?? "",
    project.status,
    project.revision,
    project.createdAt,
    project.updatedAt,
  ];
}

interface ProjectUnitRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  kind: string;
  title: string;
  source_text: string;
  word_count: number;
  status: string;
  position: number;
  created_at: string;
  updated_at: string;
}

function mapProjectUnit(row: Partial<ProjectUnitRow> & Pick<ProjectUnitRow, "id" | "project_id" | "kind" | "title" | "status" | "position">): ProjectUnit {
  return {
    id: row.id,
    projectId: row.project_id,
    parentId: row.parent_id ?? "",
    kind: row.kind,
    title: row.title,
    sourceText: row.source_text ?? "",
    wordCount: Number(row.word_count ?? 0),
    status: row.status,
    position: Number(row.position),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const projectUnitColumns = [
  "id",
  "project_id",
  "parent_id",
  "kind",
  "title",
  "source_text",
  "word_count",
  "status",
  "position",
  "created_at",
  "updated_at",
];

const projectUnitSelect = projectUnitColumns.map(quote).join(", ");
const projectUnitSummarySelect = ["id", "project_id", "kind", "title", "word_count", "position", "status", "created_at", "updated_at"]
  .map(quote)
  .join(", ");

function projectUnitValues(unit: ProjectUnit): SqlValue[] {
  return [
    unit.id,
    unit.projectId,
    unit.parentId ?? "",
    unit.kind,
    unit.title,
    unit.sourceText,
    unit.wordCount,
    unit.status,
    unit.position,
    unit.createdAt,
    unit.updatedAt,
  ];
}

// ===== 制作控制面 =====

export async function dramaProduction(repo: Repository, projectId: string): Promise<DramaProduction | null> {
  const rows = await repo.db.all<DramaProductionRow>(`SELECT ${dramaProductionSelect} FROM "drama_productions" WHERE "project_id" = ? LIMIT 1`, [projectId]);
  return rows.length ? mapDramaProduction(rows[0]) : null;
}

// RunningDramaProductions 返回需要调度循环推进的项目：运行中的项目，以及暂停或已完成但仍有已派发任务的项目。
// 后者只回收任务结果（已付费的视频、尾帧），不再派发新工作。
export async function runningDramaProductions(repo: Repository, limit: number): Promise<DramaProduction[]> {
  const rows = await repo.db.all<DramaProductionRow>(
    `SELECT ${dramaProductionSelect} FROM "drama_productions" WHERE "status" = ? OR "project_id" IN (SELECT "project_id" FROM "drama_jobs" WHERE "status" = ?) ORDER BY "updated_at" ASC LIMIT ?`,
    [dramaStatusRunning, dramaJobRunning, limit],
  );
  return rows.map(mapDramaProduction);
}

// CreateDramaProject 在同一事务内写入项目、章节与制作控制面，避免出现无章节的半成品项目。
// episodes 非空表示每章直接成为一集（逐集制作），不经过分集规划。
export async function createDramaProject(
  repo: Repository,
  project: Project,
  chapters: ProjectUnit[],
  production: DramaProduction,
  episodes: DramaEpisode[] = [],
): Promise<void> {
  await repo.transaction(async (tx) => {
    const changes = await tx.db.run(
      `INSERT INTO "projects" (${projectSelect}) VALUES (${placeholders(projectColumns.length)}) ON CONFLICT ("user_id", "name") DO NOTHING`,
      projectValues(project),
    );
    if (changes === 0) throw errProjectNameConflict;
    await insertRows(tx, "project_units", projectUnitColumns, chapters.map(projectUnitValues), 200);
    await insertRows(tx, "drama_episodes", dramaEpisodeColumns, episodes.map(dramaEpisodeValues), 200);
    await insertRows(tx, "drama_productions", dramaProductionColumns, [dramaProductionValues(production)]);
  });
}

// ReplaceDramaDraft 在同一事务内整体替换草稿：项目名称与画幅、原著章节、按章分集的集和制作控制面。
// 只在作品仍是草稿且没有任何作业时替换；名称与同用户其他项目重复时返回 ErrProjectNameConflict。
export async function replaceDramaDraft(
  repo: Repository,
  project: Project,
  chapters: ProjectUnit[],
  production: DramaProduction,
  episodes: DramaEpisode[],
): Promise<void> {
  await repo.transaction(async (tx) => {
    const current = mapDramaProduction(
      await firstOrThrow<DramaProductionRow>(
        tx,
        `SELECT ${dramaProductionSelect} FROM "drama_productions" WHERE "project_id" = ? AND "user_id" = ? LIMIT 1`,
        [project.id, project.userId],
      ),
    );
    const jobs = await tx.db.all<{ total: number }>('SELECT COUNT(*) AS "total" FROM "drama_jobs" WHERE "project_id" = ?', [project.id]);
    if (current.status !== dramaStatusDraft || Number(jobs[0]?.total ?? 0) > 0) throw errDramaDraftStarted;
    const taken = await tx.db.all<{ total: number }>('SELECT COUNT(*) AS "total" FROM "projects" WHERE "user_id" = ? AND "name" = ? AND "id" <> ?', [
      project.userId,
      project.name,
      project.id,
    ]);
    if (Number(taken[0]?.total ?? 0) > 0) throw errProjectNameConflict;
    await tx.db.run(
      'UPDATE "projects" SET "name" = ?, "aspect_ratio" = ?, "source_type" = ?, "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ? AND "user_id" = ?',
      [project.name, project.aspectRatio, project.sourceType, project.updatedAt, project.id, project.userId],
    );
    await tx.db.run('DELETE FROM "project_units" WHERE "project_id" = ? AND "kind" = ?', [project.id, projectUnitKindChapter]);
    await tx.db.run('DELETE FROM "drama_episodes" WHERE "project_id" = ?', [project.id]);
    await insertRows(tx, "project_units", projectUnitColumns, chapters.map(projectUnitValues), 200);
    await insertRows(tx, "drama_episodes", dramaEpisodeColumns, episodes.map(dramaEpisodeValues), 200);
    production.revision = current.revision + 1;
    await updateRow(tx, "drama_productions", dramaProductionColumns, dramaProductionValues(production), '"project_id" = ?', [project.id], ["project_id"]);
  });
}

// DramaEpisodePlacement 指定新的一集插在哪一集之前或之后。
export interface DramaEpisodePlacement {
  anchorEpisodeId: string;
  before: boolean;
}

// AddDramaEpisodeSource 写入一章原文和对应的一集，并把分集游标推过这一章，调度循环不会再把它交给分集规划。
// placement 为 nil 时追加到末尾；否则插到锚点集之前或之后。
export async function addDramaEpisodeSource(
  repo: Repository,
  projectId: string,
  chapter: ProjectUnit,
  episode: DramaEpisode,
  placement: DramaEpisodePlacement | null,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const production = mapDramaProduction(
      await firstOrThrow<DramaProductionRow>(tx, `SELECT ${dramaProductionSelect} FROM "drama_productions" WHERE "project_id" = ? LIMIT 1`, [projectId]),
    );
    if (!production.planDone) throw errDramaPlanPending;
    // 规划游标只数已加入制作的章节；追加时位置仍排在全部章节（含预留章节）之后。
    const countRows = await tx.db.all<{ total: number }>(
      'SELECT COUNT(*) AS "total" FROM "project_units" WHERE "project_id" = ? AND "kind" = ? AND "status" <> ?',
      [projectId, projectUnitKindChapter, projectUnitStatusReserved],
    );
    const count = Number(countRows[0]?.total ?? 0);
    const positionRows = await tx.db.all<{ position: number | null }>(
      'SELECT COALESCE(MAX("position"), -1) AS "position" FROM "project_units" WHERE "project_id" = ? AND "kind" = ?',
      [projectId, projectUnitKindChapter],
    );
    const position = Number(positionRows[0]?.position ?? -1);
    const numberRows = await tx.db.all<{ number: number | null }>(
      'SELECT COALESCE(MAX("number"), 0) AS "number" FROM "drama_episodes" WHERE "project_id" = ?',
      [projectId],
    );
    const number = Number(numberRows[0]?.number ?? 0);
    chapter.position = position + 1;
    episode.number = number + 1;
    if (placement) {
      const anchorRow = await firstOrThrow<{ id: string; number: number; chapter_i_ds_json: string }>(
        tx,
        'SELECT "id", "number", "chapter_i_ds_json" FROM "drama_episodes" WHERE "id" = ? AND "project_id" = ? LIMIT 1',
        [placement.anchorEpisodeId, projectId],
      );
      episode.number = Number(anchorRow.number) + 1;
      if (placement.before) episode.number = Number(anchorRow.number);
      const ids = decodeDramaIDs(anchorRow.chapter_i_ds_json);
      const positions: number[] = [];
      if (ids.length > 0) {
        const rows = await tx.db.all<{ position: number }>(
          `SELECT "position" FROM "project_units" WHERE "project_id" = ? AND "kind" = ? AND "id" IN (${placeholders(ids.length)})`,
          [projectId, projectUnitKindChapter, ...ids],
        );
        for (const row of rows) positions.push(Number(row.position));
      }
      // 锚点集没有关联章节时原文仍排到末尾，只调整集号。
      if (positions.length > 0) {
        chapter.position = Math.max(...positions) + 1;
        if (placement.before) chapter.position = Math.min(...positions);
        await shiftDramaChaptersForInsert(tx, projectId, chapter.position);
      }
      await shiftDramaEpisodeNumbers(tx, projectId, episode.number, 1);
    }
    if (chapter.title === "") chapter.title = dramaEpisodeDefaultTitle(episode.number);
    if (episode.title === "") episode.title = dramaEpisodeDefaultTitle(episode.number);
    await insertRows(tx, "project_units", projectUnitColumns, [projectUnitValues(chapter)]);
    await insertRows(tx, "drama_episodes", dramaEpisodeColumns, [dramaEpisodeValues(episode)]);
    await tx.db.run('UPDATE "drama_productions" SET "plan_cursor" = ?, "plan_done" = ?, "updated_at" = ? WHERE "project_id" = ?', [
      count + 1,
      true,
      new Date().toISOString(),
      projectId,
    ]);
  });
}

// DeleteDramaEpisode 删除一集及其镜头、剧情段、段视频与成片的版本记录和调度作业，后续集号前移一位。
// releaseChapterIDs 是只被这一集使用的章节，退回预留状态，规划游标随之重算。
// 这一集生成过视频且 confirmed=false 时返回 ErrDramaEpisodeConfirmRequired，不做任何修改。
export async function deleteDramaEpisode(
  repo: Repository,
  projectId: string,
  episodeId: string,
  releaseChapterIds: string[],
  confirmed: boolean,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const production = mapDramaProduction(
      await firstOrThrow<DramaProductionRow>(tx, `SELECT ${dramaProductionSelect} FROM "drama_productions" WHERE "project_id" = ? LIMIT 1`, [projectId]),
    );
    if (!production.planDone) throw errDramaPlanPending;
    const episode = await firstOrThrow<{ id: string; number: number; final_resource_id: string | null }>(
      tx,
      'SELECT "id", "number", "final_resource_id" FROM "drama_episodes" WHERE "id" = ? AND "project_id" = ? LIMIT 1',
      [episodeId, projectId],
    );
    const totalRows = await tx.db.all<{ total: number }>('SELECT COUNT(*) AS "total" FROM "drama_episodes" WHERE "project_id" = ?', [projectId]);
    if (Number(totalRows[0]?.total ?? 0) <= 1) throw errDramaLastEpisode;
    // 已提交的任务已经计费，结果要回写到本集的剧情段；等它们结束再删，避免付费结果无处落地。
    const runningRows = await tx.db.all<{ total: number }>('SELECT COUNT(*) AS "total" FROM "drama_jobs" WHERE "project_id" = ? AND "episode_id" = ? AND "status" = ?', [
      projectId,
      episode.id,
      dramaJobRunning,
    ]);
    if (Number(runningRows[0]?.total ?? 0) > 0) throw errDramaEpisodeBusy;
    if (!confirmed) {
      if (await dramaEpisodeHasVideo(tx, projectId, episode.id, episode.final_resource_id ?? "")) throw errDramaEpisodeConfirmRequired;
    }
    const segmentIds = 'SELECT "id" FROM "drama_segments" WHERE "episode_id" = ?';
    await tx.db.run(
      `DELETE FROM "drama_takes" WHERE "project_id" = ? AND (("kind" = ? AND "owner_id" IN (${segmentIds})) OR ("kind" = ? AND "owner_id" = ?))`,
      [projectId, "video", episode.id, "final", episode.id],
    );
    await tx.db.run('DELETE FROM "drama_jobs" WHERE "project_id" = ? AND "episode_id" = ?', [projectId, episode.id]);
    for (const table of ["drama_segments", "drama_shots"]) {
      await tx.db.run(`DELETE FROM ${quote(table)} WHERE "project_id" = ? AND "episode_id" = ?`, [projectId, episode.id]);
    }
    await tx.db.run('DELETE FROM "drama_episodes" WHERE "id" = ? AND "project_id" = ?', [episode.id, projectId]);
    await shiftDramaEpisodeNumbers(tx, projectId, Number(episode.number) + 1, -1);
    const now = new Date().toISOString();
    if (releaseChapterIds.length > 0) {
      await tx.db.run(
        `UPDATE "project_units" SET "status" = ?, "updated_at" = ? WHERE "project_id" = ? AND "kind" = ? AND "id" IN (${placeholders(releaseChapterIds.length)})`,
        [projectUnitStatusReserved, now, projectId, projectUnitKindChapter, ...releaseChapterIds],
      );
    }
    const countRows = await tx.db.all<{ total: number }>(
      'SELECT COUNT(*) AS "total" FROM "project_units" WHERE "project_id" = ? AND "kind" = ? AND "status" <> ?',
      [projectId, projectUnitKindChapter, projectUnitStatusReserved],
    );
    await tx.db.run('UPDATE "drama_productions" SET "plan_cursor" = ?, "updated_at" = ? WHERE "project_id" = ?', [
      Number(countRows[0]?.total ?? 0),
      now,
      projectId,
    ]);
  });
}

// dramaEpisodeHasVideo 判断一集是否生成过视频：成片、当前段视频、段视频与成片的历史版本，
// 以及成功的段视频或合成作业（重新改编会删掉旧剧情段，旧段视频只能从作业记录对上本集）。
async function dramaEpisodeHasVideo(repo: Repository, projectId: string, episodeId: string, finalResourceId: string): Promise<boolean> {
  if (finalResourceId !== "") return true;
  const segmentIds = 'SELECT "id" FROM "drama_segments" WHERE "episode_id" = ?';
  const checks: { sql: string; params: SqlValue[] }[] = [
    {
      sql: 'SELECT COUNT(*) AS "total" FROM "drama_segments" WHERE "project_id" = ? AND "episode_id" = ? AND "video_resource_id" <> \'\'',
      params: [projectId, episodeId],
    },
    {
      sql: `SELECT COUNT(*) AS "total" FROM "drama_takes" WHERE "project_id" = ? AND (("kind" = ? AND "owner_id" IN (${segmentIds})) OR ("kind" = ? AND "owner_id" = ?))`,
      params: [projectId, "video", episodeId, "final", episodeId],
    },
    {
      sql: 'SELECT COUNT(*) AS "total" FROM "drama_jobs" WHERE "project_id" = ? AND "episode_id" = ? AND "kind" IN (?, ?) AND "status" = ?',
      params: [projectId, episodeId, dramaJobSegmentVideo, dramaJobRender, dramaJobSucceeded],
    },
  ];
  for (const check of checks) {
    const rows = await repo.db.all<{ total: number }>(check.sql, check.params);
    if (Number(rows[0]?.total ?? 0) > 0) return true;
  }
  return false;
}

// shiftDramaChaptersForInsert 为插到 position 的新章节腾位置：之后的章节（含预留章节）后移一位，
// 造型的默认适用章节号（从 1 起，0 表示不限）同步后移，仍对应原来那些章节。
async function shiftDramaChaptersForInsert(repo: Repository, projectId: string, position: number): Promise<void> {
  const now = new Date().toISOString();
  await repo.db.run(
    'UPDATE "project_units" SET "position" = "position" + 1, "updated_at" = ? WHERE "project_id" = ? AND "kind" = ? AND "position" >= ?',
    [now, projectId, projectUnitKindChapter, position],
  );
  for (const column of ["look_from_chapter", "look_to_chapter"]) {
    await repo.db.run(
      `UPDATE "drama_casts" SET ${quote(column)} = ${quote(column)} + 1, "updated_at" = ? WHERE "project_id" = ? AND ${quote(column)} >= ?`,
      [now, projectId, position + 1],
    );
  }
}

// shiftDramaEpisodeNumbers 把 from 号及之后各集的集号加 delta（插入 +1，删除 -1）。(project_id, number) 唯一，
// 逐行加减会和相邻集号冲突，所以先翻成负数再写回。仍是默认标题的集随新集号改名，以“第 N 集”开头的作业标签同步改号。
async function shiftDramaEpisodeNumbers(repo: Repository, projectId: string, from: number, delta: number): Promise<void> {
  const episodes = await repo.db.all<{ id: string; number: number; title: string }>(
    'SELECT "id", "number", "title" FROM "drama_episodes" WHERE "project_id" = ? AND "number" >= ?',
    [projectId, from],
  );
  if (episodes.length === 0) return;
  const now = new Date().toISOString();
  await repo.db.run('UPDATE "drama_episodes" SET "number" = -(number + ?), "updated_at" = ? WHERE "project_id" = ? AND "number" >= ?', [delta, now, projectId, from]);
  await repo.db.run('UPDATE "drama_episodes" SET "number" = -number, "updated_at" = ? WHERE "project_id" = ? AND "number" < 0', [now, projectId]);
  for (const episode of episodes) {
    const before = dramaEpisodeDefaultTitle(Number(episode.number));
    const after = dramaEpisodeDefaultTitle(Number(episode.number) + delta);
    if (episode.title === before) {
      await repo.db.run('UPDATE "drama_episodes" SET "title" = ?, "updated_at" = ? WHERE "id" = ?', [after, now, episode.id]);
    }
    // “第 3 集%”不会匹配“第 30 集”：集号后面紧跟空格。
    // 只改标签不动 updated_at，队列历史仍按原来的时间排序。
    await repo.db.run('UPDATE "drama_jobs" SET "label" = CAST(? AS TEXT) || SUBSTR("label", ?) WHERE "project_id" = ? AND "episode_id" = ? AND "label" LIKE ?', [
      after,
      [...before].length + 1,
      projectId,
      episode.id,
      `${before}%`,
    ]);
  }
}

function decodeDramaIDs(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

// UpdateDramaChapterSource 修改一章原文与字数。
export async function updateDramaChapterSource(repo: Repository, projectId: string, chapterId: string, fields: Record<string, unknown>): Promise<void> {
  fields["updated_at"] = new Date().toISOString();
  await updateFields(repo, "project_units", fields, '"id" = ? AND "project_id" = ? AND "kind" = ?', [chapterId, projectId, projectUnitKindChapter]);
}

// InsertDramaShot 在同一剧情段内插入镜头：后续镜头顺延，本段提示词与视频过期。
export async function insertDramaShot(repo: Repository, shot: DramaShot): Promise<void> {
  await repo.transaction(async (tx) => {
    await tx.db.run('UPDATE "drama_shots" SET "position" = "position" + 1, "updated_at" = ? WHERE "episode_id" = ? AND "position" >= ?', [
      new Date().toISOString(),
      shot.episodeId,
      shot.position,
    ]);
    await insertRows(tx, "drama_shots", dramaShotColumns, [dramaShotValues(shot)]);
    await refreshDramaSegmentAfterShotChange(tx, shot);
  });
}

// DeleteDramaShot 删除镜头并前移后续镜头；调用方保证本段还剩其他镜头。
export async function deleteDramaShot(repo: Repository, shot: DramaShot): Promise<void> {
  await repo.transaction(async (tx) => {
    await tx.db.run('DELETE FROM "drama_shots" WHERE "id" = ? AND "project_id" = ?', [shot.id, shot.projectId]);
    await tx.db.run('UPDATE "drama_shots" SET "position" = "position" - 1, "updated_at" = ? WHERE "episode_id" = ? AND "position" > ?', [
      new Date().toISOString(),
      shot.episodeId,
      shot.position,
    ]);
    await refreshDramaSegmentAfterShotChange(tx, shot);
  });
}

async function refreshDramaSegmentAfterShotChange(repo: Repository, shot: DramaShot): Promise<void> {
  const segment = mapDramaSegment(
    await firstOrThrow<DramaSegmentRow>(
      repo,
      `SELECT ${dramaSegmentSelect} FROM "drama_segments" WHERE "episode_id" = ? AND "segment_index" = ? LIMIT 1`,
      [shot.episodeId, shot.segmentIndex],
    ),
  );
  await invalidateDramaSegment(repo, segment, { prompt_status: promptStatusAfterInputChange(segment.promptStatus), video_prompt_override: "" }, true);
  const now = new Date().toISOString();
  await repo.db.run(
    'UPDATE "drama_episodes" SET "duration_ms" = (SELECT COALESCE(SUM("duration_ms"), 0) FROM "drama_shots" WHERE "episode_id" = ?), "updated_at" = ? WHERE "id" = ?',
    [shot.episodeId, now, shot.episodeId],
  );
  await repo.db.run(
    'UPDATE "drama_episodes" SET "shot_count" = (SELECT COUNT(*) FROM "drama_shots" WHERE "episode_id" = ?), "updated_at" = ? WHERE "id" = ?',
    [shot.episodeId, now, shot.episodeId],
  );
}

// ===== 章节 =====

// DramaChapters 返回已加入制作的章节（不含预留章节），供资产提取与分集规划读取原文。
export async function dramaChapters(repo: Repository, projectId: string): Promise<ProjectUnit[]> {
  const rows = await repo.db.all<ProjectUnitRow>(
    `SELECT ${projectUnitSelect} FROM "project_units" WHERE "project_id" = ? AND "kind" = ? AND "status" <> ? ORDER BY "position" ASC`,
    [projectId, projectUnitKindChapter, projectUnitStatusReserved],
  );
  return rows.map(mapProjectUnit);
}

// DramaChapterSummaries 与 DramaChapters 同一范围但不读原文；分集规划游标按这个列表计数。
export async function dramaChapterSummaries(repo: Repository, projectId: string): Promise<ProjectUnit[]> {
  const rows = await repo.db.all<ProjectUnitRow>(
    `SELECT ${projectUnitSummarySelect} FROM "project_units" WHERE "project_id" = ? AND "kind" = ? AND "status" <> ? ORDER BY "position" ASC`,
    [projectId, projectUnitKindChapter, projectUnitStatusReserved],
  );
  return rows.map(mapProjectUnit);
}

// DramaChapterOutline 返回全部原著章节（含预留章节）的目录，不读原文。
export async function dramaChapterOutline(repo: Repository, projectId: string): Promise<ProjectUnit[]> {
  const rows = await repo.db.all<ProjectUnitRow>(
    `SELECT ${projectUnitSummarySelect} FROM "project_units" WHERE "project_id" = ? AND "kind" = ? ORDER BY "position" ASC`,
    [projectId, projectUnitKindChapter],
  );
  return rows.map(mapProjectUnit);
}

// ProduceDramaChapters 把预留章节加入制作，并在同一事务内追加对应的集（编号接在现有分集之后）、
// 把规划游标推到已加入制作的章节数。只在分集规划完成后允许。
export async function produceDramaChapters(repo: Repository, projectId: string, chapterIds: string[], episodes: DramaEpisode[]): Promise<void> {
  await repo.transaction(async (tx) => {
    const production = mapDramaProduction(
      await firstOrThrow<DramaProductionRow>(tx, `SELECT ${dramaProductionSelect} FROM "drama_productions" WHERE "project_id" = ? LIMIT 1`, [projectId]),
    );
    if (!production.planDone) throw errDramaPlanPending;
    const now = new Date().toISOString();
    let changes = 0;
    if (chapterIds.length > 0) {
      changes = await tx.db.run(
        `UPDATE "project_units" SET "status" = ?, "updated_at" = ? WHERE "project_id" = ? AND "kind" = ? AND "status" = ? AND "id" IN (${placeholders(chapterIds.length)})`,
        [projectUnitStatusReady, now, projectId, projectUnitKindChapter, projectUnitStatusReserved, ...chapterIds],
      );
    }
    if (changes !== chapterIds.length) throw errDramaChaptersChanged;
    const countRows = await tx.db.all<{ total: number }>(
      'SELECT COUNT(*) AS "total" FROM "project_units" WHERE "project_id" = ? AND "kind" = ? AND "status" <> ?',
      [projectId, projectUnitKindChapter, projectUnitStatusReserved],
    );
    const count = Number(countRows[0]?.total ?? 0);
    const numberRows = await tx.db.all<{ number: number | null }>(
      'SELECT COALESCE(MAX("number"), 0) AS "number" FROM "drama_episodes" WHERE "project_id" = ?',
      [projectId],
    );
    const number = Number(numberRows[0]?.number ?? 0);
    for (const [index, episode] of episodes.entries()) episode.number = number + 1 + index;
    await insertRows(tx, "drama_episodes", dramaEpisodeColumns, episodes.map(dramaEpisodeValues), 200);
    await tx.db.run('UPDATE "drama_productions" SET "plan_cursor" = ?, "plan_done" = ?, "updated_at" = ? WHERE "project_id" = ?', [
      count,
      true,
      now,
      projectId,
    ]);
  });
}

export async function dramaChaptersByIDs(repo: Repository, projectId: string, ids: string[]): Promise<ProjectUnit[]> {
  if (ids.length === 0) return [];
  const rows = await repo.db.all<ProjectUnitRow>(
    `SELECT ${projectUnitSelect} FROM "project_units" WHERE "project_id" = ? AND "id" IN (${placeholders(ids.length)}) ORDER BY "position" ASC`,
    [projectId, ...ids],
  );
  return rows.map(mapProjectUnit);
}

// ===== 设定 =====

export async function dramaCasts(repo: Repository, projectId: string): Promise<DramaCast[]> {
  const rows = await repo.db.all<DramaCastRow>(
    `SELECT ${dramaCastSelect} FROM "drama_casts" WHERE "project_id" = ? ORDER BY "kind" ASC, "position" ASC`,
    [projectId],
  );
  return rows.map(mapDramaCast);
}

export async function dramaCast(repo: Repository, projectId: string, id: string): Promise<DramaCast | null> {
  const rows = await repo.db.all<DramaCastRow>(`SELECT ${dramaCastSelect} FROM "drama_casts" WHERE "id" = ? AND "project_id" = ? LIMIT 1`, [id, projectId]);
  return rows.length ? mapDramaCast(rows[0]) : null;
}

export async function createDramaCasts(repo: Repository, casts: DramaCast[]): Promise<void> {
  if (casts.length === 0) return;
  await insertRows(repo, "drama_casts", dramaCastColumns, casts.map(dramaCastValues));
}

// ===== 集 =====

export async function dramaEpisodes(repo: Repository, projectId: string): Promise<DramaEpisode[]> {
  const rows = await repo.db.all<DramaEpisodeRow>(
    `SELECT ${dramaEpisodeListSelect} FROM "drama_episodes" WHERE "project_id" = ? ORDER BY "number" ASC`,
    [projectId],
  );
  return rows.map(mapDramaEpisode);
}

export async function dramaEpisode(repo: Repository, projectId: string, id: string): Promise<DramaEpisode | null> {
  const rows = await repo.db.all<DramaEpisodeRow>(`SELECT ${dramaEpisodeSelect} FROM "drama_episodes" WHERE "id" = ? AND "project_id" = ? LIMIT 1`, [id, projectId]);
  return rows.length ? mapDramaEpisode(rows[0]) : null;
}

export async function maxDramaEpisodeNumber(repo: Repository, projectId: string): Promise<number> {
  const rows = await repo.db.all<{ number: number | null }>('SELECT COALESCE(MAX("number"), 0) AS "number" FROM "drama_episodes" WHERE "project_id" = ?', [projectId]);
  return Number(rows[0]?.number ?? 0);
}

export async function lastDramaEpisode(repo: Repository, projectId: string): Promise<DramaEpisode | null> {
  const rows = await repo.db.all<DramaEpisodeRow>(
    `SELECT ${dramaEpisodeSelect} FROM "drama_episodes" WHERE "project_id" = ? ORDER BY "number" DESC LIMIT 1`,
    [projectId],
  );
  return rows.length ? mapDramaEpisode(rows[0]) : null;
}

// AppendDramaEpisodes 写入规划出的分集并推进规划游标，保证重复回填不会生成重复集。
export async function appendDramaEpisodes(
  repo: Repository,
  production: DramaProduction,
  episodes: DramaEpisode[],
  expectedCursor: number,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const changes = await tx.db.run(
      'UPDATE "drama_productions" SET "plan_cursor" = ?, "plan_done" = ?, "updated_at" = ? WHERE "project_id" = ? AND "plan_cursor" = ?',
      [production.planCursor, production.planDone, new Date().toISOString(), production.projectId, expectedCursor],
    );
    if (changes !== 1) throw errInvalidData;
    if (episodes.length === 0) return;
    await insertRows(tx, "drama_episodes", dramaEpisodeColumns, episodes.map(dramaEpisodeValues));
  });
}

// ===== 镜头 =====

export async function dramaShots(repo: Repository, episodeId: string): Promise<DramaShot[]> {
  const rows = await repo.db.all<DramaShotRow>(`SELECT ${dramaShotSelect} FROM "drama_shots" WHERE "episode_id" = ? ORDER BY "position" ASC`, [episodeId]);
  return rows.map(mapDramaShot);
}

export async function dramaShot(repo: Repository, projectId: string, id: string): Promise<DramaShot | null> {
  const rows = await repo.db.all<DramaShotRow>(`SELECT ${dramaShotSelect} FROM "drama_shots" WHERE "id" = ? AND "project_id" = ? LIMIT 1`, [id, projectId]);
  return rows.length ? mapDramaShot(rows[0]) : null;
}

// ===== 版本记录 =====

export async function createDramaTake(repo: Repository, take: DramaTake): Promise<void> {
  if (take.taskId !== "") {
    const countRows = await repo.db.all<{ total: number }>('SELECT COUNT(*) AS "total" FROM "drama_takes" WHERE "task_id" = ? AND "owner_id" = ? AND "kind" = ?', [
      take.taskId,
      take.ownerId,
      take.kind,
    ]);
    if (Number(countRows[0]?.total ?? 0) > 0) return;
  }
  await repo.transaction(async (tx) => {
    const currentRows = await tx.db.all<{ version: number | null }>(
      'SELECT COALESCE(MAX("version"), 0) AS "version" FROM "drama_takes" WHERE "owner_id" = ? AND "kind" = ?',
      [take.ownerId, take.kind],
    );
    take.version = Number(currentRows[0]?.version ?? 0) + 1;
    await insertRows(tx, "drama_takes", dramaTakeColumns, [dramaTakeValues(take)]);
  });
}

// ===== 调度作业 =====

export async function dramaJobsByStatus(repo: Repository, projectId: string, ...statuses: string[]): Promise<DramaJob[]> {
  if (statuses.length === 0) return [];
  const rows = await repo.db.all<DramaJobRow>(
    `SELECT ${dramaJobSelect} FROM "drama_jobs" WHERE "project_id" = ? AND "status" IN (${placeholders(statuses.length)}) ORDER BY "priority" DESC, "created_at" ASC`,
    [projectId, ...statuses],
  );
  return rows.map(mapDramaJob);
}

export async function dramaJob(repo: Repository, projectId: string, id: string): Promise<DramaJob | null> {
  const rows = await repo.db.all<DramaJobRow>(`SELECT ${dramaJobSelect} FROM "drama_jobs" WHERE "id" = ? AND "project_id" = ? LIMIT 1`, [id, projectId]);
  return rows.length ? mapDramaJob(rows[0]) : null;
}

// LatestDramaJob 返回某集某类工作的最近一条记录，用于回看剧本改编的提示词与模型返回。
export async function latestDramaJob(repo: Repository, projectId: string, kind: string, episodeId: string): Promise<DramaJob | null> {
  const rows = await repo.db.all<DramaJobRow>(
    `SELECT ${dramaJobSelect} FROM "drama_jobs" WHERE "project_id" = ? AND "kind" = ? AND "episode_id" = ? ORDER BY "created_at" DESC LIMIT 1`,
    [projectId, kind, episodeId],
  );
  return rows.length ? mapDramaJob(rows[0]) : null;
}

export async function recentDramaJobs(repo: Repository, projectId: string, limit: number): Promise<DramaJob[]> {
  const rows = await repo.db.all<DramaJobRow>(
    `SELECT ${dramaJobSelect} FROM "drama_jobs" WHERE "project_id" = ? ORDER BY "updated_at" DESC LIMIT ?`,
    [projectId, limit],
  );
  return rows.map(mapDramaJob);
}

export async function dramaJobCounts(repo: Repository, projectId: string): Promise<Record<string, number>> {
  const rows = await repo.db.all<{ status: string; count: number }>(
    'SELECT "status", COUNT(*) AS "count" FROM "drama_jobs" WHERE "project_id" = ? GROUP BY "status"',
    [projectId],
  );
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = Number(row.count);
  return counts;
}

export async function createDramaJobs(repo: Repository, jobs: DramaJob[]): Promise<void> {
  if (jobs.length === 0) return;
  await insertRows(repo, "drama_jobs", dramaJobColumns, jobs.map(dramaJobValues));
}

export async function saveDramaJob(repo: Repository, job: DramaJob): Promise<void> {
  job.updatedAt = new Date().toISOString();
  await updateRow(repo, "drama_jobs", dramaJobColumns, dramaJobValues(job), '"id" = ?', [job.id], ["id"]);
}

// RecordDramaJobCost 按 attempts_json 乐观锁写入本次任务的去重记录与作业花费：结算后先落库再应用结果，
// 中断恢复时已记录的任务不会再记一次。作品花费按订单汇总（DramaBillingTotals），这里不改 drama_productions。
export async function recordDramaJobCost(repo: Repository, job: DramaJob, previousAttempts: string): Promise<void> {
  const changes = await repo.db.run(
    'UPDATE "drama_jobs" SET "attempts_json" = ?, "cost_microcredits" = ?, "updated_at" = ? WHERE "id" = ? AND "project_id" = ? AND "task_id" = ? AND COALESCE("attempts_json", \'\') = ?',
    [job.attemptsJson ?? "", job.costMicrocredits, new Date().toISOString(), job.id, job.projectId, job.taskId ?? "", previousAttempts],
  );
  if (changes !== 1) throw errDramaJobChanged;
}

// BindDramaJobTask 只在作业仍是派发前读到的状态与任务时写入新的绑定（整行写回），
// 防止用户在派发期间取消或重试后被覆盖回运行中，或复活已删除的作业。
export async function bindDramaJobTask(repo: Repository, job: DramaJob, expectedStatus: string, expectedTaskId: string): Promise<void> {
  job.updatedAt = new Date().toISOString();
  const changes = await updateRow(
    repo,
    "drama_jobs",
    dramaJobColumns,
    dramaJobValues(job),
    '"id" = ? AND "project_id" = ? AND "status" = ? AND COALESCE("task_id", \'\') = ?',
    [job.id, job.projectId, expectedStatus, expectedTaskId],
    ["id", "project_id", "created_at"],
  );
  if (changes !== 1) throw errDramaJobChanged;
}

export interface DramaJobFilter {
  where: string;
  params: SqlValue[];
}

// CancelQueuedDramaJobs 取消尚未派发的排队工作；已提交的任务由任务中心各自收尾。
export async function cancelQueuedDramaJobs(repo: Repository, projectId: string, filter?: DramaJobFilter | null): Promise<void> {
  let where = '"project_id" = ? AND "status" = ?';
  const params: SqlValue[] = [projectId, dramaJobQueued];
  if (filter) {
    where += ` AND ${filter.where}`;
    params.push(...filter.params);
  }
  await updateFields(repo, "drama_jobs", { status: dramaJobCanceled, updated_at: new Date().toISOString() }, where, params);
}

export async function deleteDramaProductionData(repo: Repository, projectId: string): Promise<void> {
  await repo.transaction(async (tx) => {
    for (const table of ["drama_jobs", "drama_takes", "drama_segments", "drama_shots", "drama_episodes", "drama_casts", "drama_productions"]) {
      await tx.db.run(`DELETE FROM ${quote(table)} WHERE "project_id" = ?`, [projectId]);
    }
  });
}

// FailedDramaCastErrors 返回各角色/场景最近一次参考图失败的原因，供收件箱展示真实错误。
export async function failedDramaCastErrors(repo: Repository, projectId: string): Promise<Record<string, string>> {
  const rows = await repo.db.all<{ cast_id: string; error: string }>(
    'SELECT "cast_id", "error" FROM "drama_jobs" WHERE "project_id" = ? AND "kind" = ? AND "status" = ? AND "cast_id" <> \'\' ORDER BY "updated_at" ASC',
    [projectId, dramaJobCastImage, dramaJobFailed],
  );
  const result: Record<string, string> = {};
  for (const row of rows) result[row.cast_id] = row.error;
  return result;
}

// ===== 项目列表 =====

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export async function dramaProjectsPage(
  repo: Repository,
  userId: string,
  search: string,
  status: string,
  page: number,
  pageSize: number,
): Promise<{ projects: Project[]; total: number }> {
  const conditions = ['"projects"."user_id" = ?'];
  const params: SqlValue[] = [userId];
  const trimmed = search.trim();
  if (trimmed !== "") {
    conditions.push('LOWER("projects"."name") LIKE ? ESCAPE \'\\\'');
    params.push(`%${escapeLike(trimmed).toLowerCase()}%`);
  }
  if (status !== "") {
    conditions.push('"drama_productions"."status" = ?');
    params.push(status);
  }
  const from = 'FROM "projects" JOIN "drama_productions" ON "drama_productions"."project_id" = "projects"."id"';
  const where = conditions.join(" AND ");
  const countRows = await repo.db.all<{ total: number }>(`SELECT COUNT(*) AS "total" ${from} WHERE ${where}`, params);
  const total = Number(countRows[0]?.total ?? 0);
  const rows = await repo.db.all<ProjectRow>(
    `SELECT ${projectJoinSelect} ${from} WHERE ${where} ORDER BY "projects"."updated_at" DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { projects: rows.map(mapProject), total };
}

// DramaStatusCounts 统计用户各状态的短剧数量，供列表筛选标签显示。
export async function dramaStatusCounts(repo: Repository, userId: string): Promise<Record<string, number>> {
  const rows = await repo.db.all<{ status: string; count: number }>(
    'SELECT "status", COUNT(*) AS "count" FROM "drama_productions" WHERE "user_id" = ? GROUP BY "status"',
    [userId],
  );
  const result: Record<string, number> = {};
  for (const row of rows) result[row.status] = Number(row.count);
  return result;
}

export async function dramaProductionsForUser(repo: Repository, userId: string, projectIds: string[]): Promise<Record<string, DramaProduction>> {
  const result: Record<string, DramaProduction> = {};
  if (projectIds.length === 0) return result;
  const rows = await repo.db.all<DramaProductionRow>(
    `SELECT ${dramaProductionSelect} FROM "drama_productions" WHERE "user_id" = ? AND "project_id" IN (${placeholders(projectIds.length)})`,
    [userId, ...projectIds],
  );
  for (const row of rows) {
    const production = mapDramaProduction(row);
    result[production.projectId] = production;
  }
  return result;
}

// DramaEpisodeCounts 汇总项目列表卡片所需的集数与完成数。
export async function dramaEpisodeCounts(repo: Repository, projectIds: string[]): Promise<Record<string, [number, number]>> {
  const result: Record<string, [number, number]> = {};
  if (projectIds.length === 0) return result;
  const rows = await repo.db.all<{ project_id: string; total: number; done: number | null }>(
    `SELECT "project_id", COUNT(*) AS "total", SUM(CASE WHEN "stage" = 'done' THEN 1 ELSE 0 END) AS "done" FROM "drama_episodes" WHERE "project_id" IN (${placeholders(projectIds.length)}) GROUP BY "project_id"`,
    projectIds,
  );
  for (const row of rows) result[row.project_id] = [Number(row.total), Number(row.done ?? 0)];
  return result;
}

// DramaCoverResources 取每个项目前几张已就绪的角色参考图，列表卡片拼成封面。
export async function dramaCoverResources(repo: Repository, projectIds: string[], limit: number): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  if (projectIds.length === 0) return result;
  const rows = await repo.db.all<{ project_id: string; image_resource_id: string | null; position: number }>(
    `SELECT "project_id", "image_resource_id", "position" FROM "drama_casts" WHERE "project_id" IN (${placeholders(projectIds.length)}) AND "kind" = ? AND "image_status" = ? ORDER BY "position" ASC`,
    [...projectIds, "character", dramaMediaReady],
  );
  for (const row of rows) {
    const images = result[row.project_id] ?? (result[row.project_id] = []);
    if (images.length < limit) images.push(row.image_resource_id ?? "");
  }
  return result;
}

// ===== 定向更新 =====
// 调度循环与用户操作并发写同一行时，整行 Save 会互相覆盖；以下方法只写各自负责的列，
// 并用状态或版本号做条件，过期的写入直接失效，由下一轮调度重新推导。

// UpdateDramaProduction 写入用户侧控制字段，并递增版本。
export async function updateDramaProduction(repo: Repository, projectId: string, fields: Record<string, unknown>): Promise<void> {
  fields["updated_at"] = new Date().toISOString();
  fields["revision"] = sqlExpr("revision + 1");
  await updateFields(repo, "drama_productions", fields, '"project_id" = ?', [projectId]);
}

// SaveDramaProductionProgress 写入调度循环负责的进度字段；状态只在仍处于 expectedStatus 时改变。
export async function saveDramaProductionProgress(
  repo: Repository,
  production: DramaProduction,
  expectedStatus: string,
  statusChanged: boolean,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const now = new Date().toISOString();
    await tx.db.run(
      'UPDATE "drama_productions" SET "stage" = ?, "bible_json" = ?, "spent_microcredits" = ?, "plan_done" = ?, "last_tick_at" = ?, "updated_at" = ? WHERE "project_id" = ?',
      [
        production.stage,
        production.bibleJson,
        production.spentMicrocredits,
        production.planDone,
        production.lastTickAt ?? null,
        now,
        production.projectId,
      ],
    );
    if (!statusChanged) return;
    await tx.db.run('UPDATE "drama_productions" SET "status" = ?, "pause_reason" = ?, "updated_at" = ? WHERE "project_id" = ? AND "status" = ?', [
      production.status,
      production.pauseReason,
      now,
      production.projectId,
      expectedStatus,
    ]);
  });
}

// UpdateDramaEpisodeIfRevision 只在集未被用户改动（版本未变）时写入调度结果。
export async function updateDramaEpisodeIfRevision(repo: Repository, id: string, revision: number, fields: Record<string, unknown>): Promise<boolean> {
  fields["updated_at"] = new Date().toISOString();
  const changes = await updateFields(repo, "drama_episodes", fields, '"id" = ? AND "revision" = ?', [id, revision]);
  return changes === 1;
}

// UpdateDramaEpisodeUser 写入用户修改并递增版本，使调度循环基于旧版本的写入失效。
export async function updateDramaEpisodeUser(repo: Repository, id: string, fields: Record<string, unknown>): Promise<void> {
  fields["updated_at"] = new Date().toISOString();
  fields["revision"] = sqlExpr("revision + 1");
  await updateFields(repo, "drama_episodes", fields, '"id" = ?', [id]);
}

export async function updateDramaCastIf(repo: Repository, id: string, allowed: string[], fields: Record<string, unknown>): Promise<boolean> {
  fields["updated_at"] = new Date().toISOString();
  if (allowed.length === 0) return false;
  const changes = await updateFields(repo, "drama_casts", fields, `"id" = ? AND "image_status" IN (${placeholders(allowed.length)})`, [id, ...allowed]);
  return changes === 1;
}

// ApplyDramaScript 写入一集的新镜头；revision 不为 nil 时要求集版本未变。
export async function applyDramaScript(
  repo: Repository,
  episodeId: string,
  revision: number | null,
  fields: Record<string, unknown>,
  shots: DramaShot[],
): Promise<boolean> {
  let applied = false;
  await repo.transaction(async (tx) => {
    fields["updated_at"] = new Date().toISOString();
    let where = '"id" = ?';
    const params: SqlValue[] = [episodeId];
    if (revision !== null) {
      where += ' AND "revision" = ?';
      params.push(revision);
    } else {
      fields["revision"] = sqlExpr("revision + 1");
    }
    const changes = await updateFields(tx, "drama_episodes", fields, where, params);
    if (changes !== 1) return;
    await tx.db.run('DELETE FROM "drama_shots" WHERE "episode_id" = ?', [episodeId]);
    // 剧情段随镜头重新切分，旧段的提示词不再对得上，重建为待撰写。
    await tx.db.run('DELETE FROM "drama_segments" WHERE "episode_id" = ?', [episodeId]);
    if (shots.length > 0) {
      await insertRows(tx, "drama_shots", dramaShotColumns, shots.map(dramaShotValues), 100);
      const segments: DramaSegment[] = [];
      const seen = new Set<number>();
      const now = new Date().toISOString();
      for (const shot of shots) {
        if (seen.has(shot.segmentIndex)) continue;
        seen.add(shot.segmentIndex);
        segments.push({
          promptSeconds: 0,
          revision: 0,
          id: newId(),
          projectId: shot.projectId,
          episodeId,
          segmentIndex: shot.segmentIndex,
          videoPrompt: "",
          promptStatus: "",
          promptError: "",
          videoPromptOverride: "",
          videoModelJson: "",
          referenceCastIdsJson: "",
          referenceImagesJson: "",
          audioCastIdsJson: "",
          videoStatus: "",
          videoResourceId: "",
          tailFrameResourceId: "",
          videoSeconds: 0,
          videoError: "",
          createdAt: now,
          updatedAt: now,
        });
      }
      await insertRows(tx, "drama_segments", dramaSegmentColumns, segments.map(dramaSegmentValues));
    }
    applied = true;
  });
  return applied;
}

export async function updateDramaCastFields(repo: Repository, id: string, fields: Record<string, unknown>): Promise<void> {
  await repo.transaction(async (tx) => {
    fields["updated_at"] = new Date().toISOString();
    fields["revision"] = sqlExpr("revision + 1");
    await updateFields(tx, "drama_casts", fields, '"id" = ?', [id]);
    // Textual cast changes invalidate prompt inputs. Lock-only edits do not change media.
    let changed = false;
    for (const key of ["name", "appearance", "description", "voice_instructions", "aliases_json"]) {
      if (key in fields) changed = true;
    }
    if (!changed) return;
    const castRow = await firstOrThrow<DramaCastRow>(tx, `SELECT ${dramaCastSelect} FROM "drama_casts" WHERE "id" = ? LIMIT 1`, [id]);
    const cast = mapDramaCast(castRow);
    const pattern = `%"${id}"%`;
    const shots = await tx.db.all<DramaShotRow>(
      `SELECT ${dramaShotSelect} FROM "drama_shots" WHERE "project_id" = ? AND ("scene_cast_id" = ? OR "cast_i_ds_json" LIKE ?)`,
      [cast.projectId, id, pattern],
    );
    const seen = new Set<string>();
    for (const shotRow of shots) {
      const shot = mapDramaShot(shotRow);
      const key = `${shot.episodeId}:${shot.segmentIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const segment = mapDramaSegment(
        await firstOrThrow<DramaSegmentRow>(
          tx,
          `SELECT ${dramaSegmentSelect} FROM "drama_segments" WHERE "episode_id" = ? AND "segment_index" = ? LIMIT 1`,
          [shot.episodeId, shot.segmentIndex],
        ),
      );
      await invalidateDramaSegment(tx, segment, { prompt_status: promptStatusAfterInputChange(segment.promptStatus), video_prompt_override: "" }, true);
    }
  });
}

// promptStatusAfterInputChange 决定撰写素材变化后的提示词状态：写好的才标记过期、等用户确认重写；
// 待撰写或撰写中的退回待撰写，由调度按新素材自动写；失败保持失败，等用户重试。
function promptStatusAfterInputChange(current: string): string {
  switch (current) {
    case dramaMediaReady:
    case dramaMediaStale:
      return dramaMediaStale;
    case dramaMediaFailed:
      return dramaMediaFailed;
  }
  return "";
}

export async function updateDramaCastRevision(repo: Repository, id: string, revision: number, fields: Record<string, unknown>): Promise<boolean> {
  fields["updated_at"] = new Date().toISOString();
  const changes = await updateFields(repo, "drama_casts", fields, '"id" = ? AND "revision" = ?', [id, revision]);
  return changes > 0;
}

// UpdateDramaEpisodeMeta 修改不影响已生成内容的集字段（标题、素材类型），不递增版本，避免打断调度写入。
export async function updateDramaEpisodeMeta(repo: Repository, episodeId: string, fields: Record<string, unknown>): Promise<void> {
  fields["updated_at"] = new Date().toISOString();
  await updateFields(repo, "drama_episodes", fields, '"id" = ?', [episodeId]);
}

// ===== 剧情段 =====

export async function dramaSegments(repo: Repository, episodeId: string): Promise<DramaSegment[]> {
  const rows = await repo.db.all<DramaSegmentRow>(`SELECT ${dramaSegmentSelect} FROM "drama_segments" WHERE "episode_id" = ? ORDER BY "segment_index" ASC`, [
    episodeId,
  ]);
  return rows.map(mapDramaSegment);
}

// SaveDramaSegmentOverride 写入或清除段级提示词改写；行不存在时创建（旧剧本没有段记录）。
export async function saveDramaSegmentOverride(repo: Repository, segment: DramaSegment): Promise<void> {
  await repo.transaction(async (tx) => {
    const current = mapDramaSegment(
      await firstOrThrow<DramaSegmentRow>(
        tx,
        `SELECT ${dramaSegmentSelect} FROM "drama_segments" WHERE "episode_id" = ? AND "segment_index" = ? LIMIT 1`,
        [segment.episodeId, segment.segmentIndex],
      ),
    );
    await invalidateDramaSegment(tx, current, { video_prompt_override: segment.videoPromptOverride }, true);
  });
}

// SaveDramaSegmentReferenceFields 一次保存图片与音色选择，并使在途作业按修订号失效。
export async function saveDramaSegmentReferenceFields(
  repo: Repository,
  episodeId: string,
  index: number,
  fields: Record<string, unknown>,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const current = mapDramaSegment(
      await firstOrThrow<DramaSegmentRow>(
        tx,
        `SELECT ${dramaSegmentSelect} FROM "drama_segments" WHERE "episode_id" = ? AND "segment_index" = ? LIMIT 1`,
        [episodeId, index],
      ),
    );
    const values: Record<string, string> = {
      reference_cast_ids_json: current.referenceCastIdsJson,
      reference_images_json: current.referenceImagesJson,
      audio_cast_ids_json: current.audioCastIdsJson,
    };
    let changed = false;
    for (const [key, value] of Object.entries(fields)) {
      if (values[key] !== value) changed = true;
    }
    if (!changed) return;
    fields["prompt_status"] = promptStatusAfterInputChange(current.promptStatus);
    await invalidateDramaSegment(tx, current, fields, true);
  });
}

// RequestDramaSegmentPrompts 把指定段标记为待撰写；正在撰写的段保持不动。返回实际排队的段数。
export async function requestDramaSegmentPrompts(repo: Repository, projectId: string, episodeId: string, indexes: number[]): Promise<number> {
  let queued = 0;
  await repo.transaction(async (tx) => {
    for (const index of indexes) {
      const segment = mapDramaSegment(
        await firstOrThrow<DramaSegmentRow>(
          tx,
          `SELECT ${dramaSegmentSelect} FROM "drama_segments" WHERE "project_id" = ? AND "episode_id" = ? AND "segment_index" = ? LIMIT 1`,
          [projectId, episodeId, index],
        ),
      );
      if (segment.promptStatus === dramaMediaRunning) continue;
      await invalidateDramaSegment(tx, segment, { prompt_status: "", prompt_error: "" }, true);
      queued += 1;
    }
  });
  return queued;
}

// PendingDramaSegments 返回待撰写提示词的段；按集与段序排列。
export async function pendingDramaSegments(repo: Repository, projectId: string): Promise<DramaSegment[]> {
  const rows = await repo.db.all<DramaSegmentRow>(
    `SELECT ${dramaSegmentSelect} FROM "drama_segments" WHERE "project_id" = ? AND "prompt_status" = ? ORDER BY "episode_id" ASC, "segment_index" ASC LIMIT 500`,
    [projectId, ""],
  );
  return rows.map(mapDramaSegment);
}

export async function dramaSegment(repo: Repository, projectId: string, id: string): Promise<DramaSegment | null> {
  const rows = await repo.db.all<DramaSegmentRow>(`SELECT ${dramaSegmentSelect} FROM "drama_segments" WHERE "id" = ? AND "project_id" = ? LIMIT 1`, [id, projectId]);
  return rows.length ? mapDramaSegment(rows[0]) : null;
}

// MarkDramaSegmentVideoStale 在参考图重做后让该段已生成或生成中的视频过期。提示词只引用参考图编号，
// 不含图片内容，因此保持不变；尚未生成的视频提交时会读取新参考图，无需处理。返回是否有视频被标记。
export async function markDramaSegmentVideoStale(repo: Repository, episodeId: string, index: number): Promise<boolean> {
  let marked = false;
  await repo.transaction(async (tx) => {
    const segment = mapDramaSegment(
      await firstOrThrow<DramaSegmentRow>(
        tx,
        `SELECT ${dramaSegmentSelect} FROM "drama_segments" WHERE "episode_id" = ? AND "segment_index" = ? LIMIT 1`,
        [episodeId, index],
      ),
    );
    if (segment.videoStatus !== dramaMediaReady && segment.videoStatus !== dramaMediaRunning) return;
    const fields: Record<string, unknown> = { video_status: dramaMediaStale, revision: sqlExpr("revision + 1"), updated_at: new Date().toISOString() };
    // 版本递增会让撰写中的提示词结果作废，退回待撰写由调度重写。
    if (segment.promptStatus === dramaMediaRunning) fields["prompt_status"] = "";
    await updateFields(tx, "drama_segments", fields, '"id" = ?', [segment.id]);
    marked = true;
    await markLaterSegmentsStale(tx, segment.episodeId, segment.segmentIndex);
  });
  return marked;
}

// DeleteDramaCastLook 删除一套造型，并把引用它的镜头回退到角色本体（从 look_cast_ids_json 里移除）。
// 段级手动参考中的造型同步回退到角色本体，重新编号后提示词与视频过期。
export async function deleteDramaCastLook(repo: Repository, projectId: string, lookId: string): Promise<void> {
  await repo.transaction(async (tx) => {
    const look = mapDramaCast(
      await firstOrThrow<DramaCastRow>(
        tx,
        `SELECT ${dramaCastSelect} FROM "drama_casts" WHERE "id" = ? AND "project_id" = ? AND "parent_id" <> \'\' LIMIT 1`,
        [lookId, projectId],
      ),
    );
    const pattern = `%"${lookId}"%`;
    const shots = await tx.db.all<DramaShotRow>(`SELECT ${dramaShotSelect} FROM "drama_shots" WHERE "project_id" = ? AND "look_cast_i_ds_json" LIKE ?`, [
      projectId,
      pattern,
    ]);
    for (const shot of shots) {
      const ids = decodeDramaIDs(shot.look_cast_i_ds_json);
      const kept = ids.filter((id) => id !== lookId);
      await tx.db.run('UPDATE "drama_shots" SET "look_cast_i_ds_json" = ?, "updated_at" = ? WHERE "id" = ?', [JSON.stringify(kept), new Date().toISOString(), shot.id]);
    }
    const segments = await tx.db.all<DramaSegmentRow>(
      `SELECT ${dramaSegmentSelect} FROM "drama_segments" WHERE "project_id" = ? AND "reference_cast_i_ds_json" LIKE ?`,
      [projectId, pattern],
    );
    for (const segmentRow of segments) {
      const segment = mapDramaSegment(segmentRow);
      const ids = JSON.parse(segment.referenceCastIdsJson) as string[];
      const kept: string[] = [];
      const seen = new Set<string>();
      for (let id of ids) {
        if (id === lookId) id = look.parentId ?? "";
        if (seen.has(id)) continue;
        kept.push(id);
        seen.add(id);
      }
      await invalidateDramaSegment(
        tx,
        segment,
        { reference_cast_ids_json: JSON.stringify(kept), prompt_status: promptStatusAfterInputChange(segment.promptStatus) },
        true,
      );
    }
    await tx.db.run('DELETE FROM "drama_casts" WHERE "id" = ? AND "project_id" = ?', [lookId, projectId]);
  });
}

export async function dramaShotsReferencingCast(repo: Repository, projectId: string, castId: string): Promise<DramaShot[]> {
  const pattern = `%"${castId}"%`;
  const rows = await repo.db.all<DramaShotRow>(
    `SELECT ${dramaShotSelect} FROM "drama_shots" WHERE "project_id" = ? AND ("scene_cast_id" = ? OR "cast_i_ds_json" LIKE ? OR "prop_i_ds_json" LIKE ? OR "look_cast_i_ds_json" LIKE ? OR EXISTS (SELECT 1 FROM "drama_segments" WHERE "drama_segments"."episode_id" = "drama_shots"."episode_id" AND "drama_segments"."segment_index" = "drama_shots"."segment_index" AND ("reference_cast_i_ds_json" LIKE ? OR "audio_cast_i_ds_json" LIKE ?)))`,
    [projectId, castId, pattern, pattern, pattern, pattern, pattern],
  );
  return rows.map(mapDramaShot);
}

// DramaSegmentStat 是集列表进度使用的剧情段聚合计数；VideoGenerated 是持有视频的段（含已过期的旧视频）。
export interface DramaSegmentStat {
  episodeId: string;
  total: number;
  promptReady: number;
  videoReady: number;
  videoGenerated: number;
  failed: number;
}

export async function dramaSegmentStats(repo: Repository, projectId: string): Promise<Record<string, DramaSegmentStat>> {
  const rows = await repo.db.all<{
    episode_id: string;
    total: number;
    prompt_ready: number | null;
    video_ready: number | null;
    video_generated: number | null;
    failed: number | null;
  }>(
    `SELECT "episode_id",
      COUNT(*) AS "total",
      SUM(CASE WHEN ("prompt_status" = 'ready' OR "video_prompt_override" <> '') THEN 1 ELSE 0 END) AS "prompt_ready",
      SUM(CASE WHEN "video_status" = 'ready' THEN 1 ELSE 0 END) AS "video_ready",
      SUM(CASE WHEN "video_resource_id" <> '' THEN 1 ELSE 0 END) AS "video_generated",
      SUM(CASE WHEN "prompt_status" = 'failed' OR "video_status" = 'failed' THEN 1 ELSE 0 END) AS "failed"
      FROM "drama_segments" WHERE "project_id" = ? GROUP BY "episode_id"`,
    [projectId],
  );
  const stats: Record<string, DramaSegmentStat> = {};
  for (const row of rows) {
    stats[row.episode_id] = {
      episodeId: row.episode_id,
      total: Number(row.total),
      promptReady: Number(row.prompt_ready ?? 0),
      videoReady: Number(row.video_ready ?? 0),
      videoGenerated: Number(row.video_generated ?? 0),
      failed: Number(row.failed ?? 0),
    };
  }
  return stats;
}

// FailedDramaSegments 返回提示词或视频失败的剧情段，供待处理与一键重试使用。
export async function failedDramaSegments(repo: Repository, projectId: string, limit: number): Promise<DramaSegment[]> {
  const rows = await repo.db.all<DramaSegmentRow>(
    `SELECT ${dramaSegmentSelect} FROM "drama_segments" WHERE "project_id" = ? AND ("prompt_status" = ? OR "video_status" = ?) ORDER BY "updated_at" DESC LIMIT ?`,
    [projectId, dramaMediaFailed, dramaMediaFailed, limit],
  );
  return rows.map(mapDramaSegment);
}

export async function updateDramaSegmentFields(repo: Repository, id: string, fields: Record<string, unknown>): Promise<void> {
  fields["updated_at"] = new Date().toISOString();
  await updateFields(repo, "drama_segments", fields, '"id" = ?', [id]);
}

export async function updateDramaSegmentRevision(repo: Repository, id: string, revision: number, fields: Record<string, unknown>): Promise<boolean> {
  fields["updated_at"] = new Date().toISOString();
  const changes = await updateFields(repo, "drama_segments", fields, '"id" = ? AND "revision" = ?', [id, revision]);
  return changes > 0;
}

// SetDramaSegmentTail 写入后台抽好的尾帧：只在段版本未变、段视频仍是抽取的那一条且尚无尾帧时生效，
// 迟到的旧视频尾帧不会落到新视频上。
export async function setDramaSegmentTail(repo: Repository, id: string, revision: number, videoResourceId: string, tailResourceId: string): Promise<boolean> {
  const changes = await repo.db.run(
    'UPDATE "drama_segments" SET "tail_frame_resource_id" = ?, "updated_at" = ? WHERE "id" = ? AND "revision" = ? AND "video_resource_id" = ? AND "tail_frame_resource_id" = \'\'',
    [tailResourceId, new Date().toISOString(), id, revision, videoResourceId],
  );
  return changes > 0;
}

async function markLaterSegmentsStale(repo: Repository, episodeId: string, index: number): Promise<void> {
  // Queued descendants remain requested, but receive a new revision and wait for the new tail.
  // The new revision also voids running prompt jobs, so those segments go back to pending instead of staying "running".
  await repo.db.run(
    'UPDATE "drama_segments" SET "video_status" = CASE WHEN "video_status" IN (?, ?) THEN ? ELSE "video_status" END, "prompt_status" = CASE WHEN "prompt_status" = ? THEN \'\' ELSE "prompt_status" END, "revision" = "revision" + 1, "updated_at" = ? WHERE "episode_id" = ? AND "segment_index" > ?',
    [dramaMediaReady, dramaMediaRunning, dramaMediaStale, dramaMediaRunning, new Date().toISOString(), episodeId, index],
  );
}

// invalidateDramaSegment makes user edits and downstream invalidation one transaction.
async function invalidateDramaSegment(
  repo: Repository,
  segment: DramaSegment,
  fields: Record<string, unknown>,
  prompts: boolean,
): Promise<void> {
  if (!("video_status" in fields)) {
    if (segment.videoStatus !== "") fields["video_status"] = dramaMediaStale;
  }
  fields["revision"] = sqlExpr("revision + 1");
  fields["updated_at"] = new Date().toISOString();
  await updateFields(repo, "drama_segments", fields, '"id" = ?', [segment.id]);
  await markLaterSegmentsStale(repo, segment.episodeId, segment.segmentIndex);
  const stage = prompts ? "prompts" : "video";
  await repo.db.run(
    'UPDATE "drama_episodes" SET "stage" = ?, "approved" = ?, "final_stale" = ?, "error" = ?, "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?',
    [stage, false, true, "", new Date().toISOString(), segment.episodeId],
  );
  await repo.db.run(
    'UPDATE "drama_jobs" SET "status" = ?, "updated_at" = ? WHERE "episode_id" = ? AND "status" = ? AND "kind" IN (?, ?, ?)',
    [dramaJobCanceled, new Date().toISOString(), segment.episodeId, dramaJobQueued, dramaJobSegmentPrompt, dramaJobSegmentVideo, dramaJobRender],
  );
}

export async function updateDramaShotScript(repo: Repository, shot: DramaShot, fields: Record<string, unknown>): Promise<void> {
  await repo.transaction(async (tx) => {
    fields["updated_at"] = new Date().toISOString();
    await updateFields(tx, "drama_shots", fields, '"id" = ? AND "project_id" = ?', [shot.id, shot.projectId]);
    const segment = mapDramaSegment(
      await firstOrThrow<DramaSegmentRow>(
        tx,
        `SELECT ${dramaSegmentSelect} FROM "drama_segments" WHERE "episode_id" = ? AND "segment_index" = ? LIMIT 1`,
        [shot.episodeId, shot.segmentIndex],
      ),
    );
    await invalidateDramaSegment(tx, segment, { prompt_status: promptStatusAfterInputChange(segment.promptStatus), video_prompt_override: "" }, true);
    await tx.db.run(
      'UPDATE "drama_episodes" SET "duration_ms" = (SELECT COALESCE(SUM("duration_ms"), 0) FROM "drama_shots" WHERE "episode_id" = ?), "updated_at" = ? WHERE "id" = ?',
      [shot.episodeId, new Date().toISOString(), shot.episodeId],
    );
  });
}

export async function requestDramaSegmentVideos(
  repo: Repository,
  projectId: string,
  episodeId: string,
  indexes: number[],
  modelJson: string | null,
): Promise<void> {
  await repo.transaction(async (tx) => {
    for (const index of indexes) {
      const segment = mapDramaSegment(
        await firstOrThrow<DramaSegmentRow>(
          tx,
          `SELECT ${dramaSegmentSelect} FROM "drama_segments" WHERE "project_id" = ? AND "episode_id" = ? AND "segment_index" = ? LIMIT 1`,
          [projectId, episodeId, index],
        ),
      );
      if (segment.videoStatus === "running") throw new Error("剧情段视频正在生成");
      const fields: Record<string, unknown> = { video_status: "queued", video_error: "" };
      if (modelJson !== null) fields["video_model_json"] = modelJson;
      await invalidateDramaSegment(tx, segment, fields, false);
    }
    await tx.db.run('UPDATE "drama_episodes" SET "approved" = ?, "media_released" = ?, "updated_at" = ? WHERE "id" = ?', [
      true,
      true,
      new Date().toISOString(),
      episodeId,
    ]);
  });
}

export async function retryDramaResultJobs(repo: Repository, projectId: string): Promise<void> {
  await repo.transaction(async (tx) => {
    // A successful provider task is re-applied, never submitted a second time.
    await tx.db.run(
      'UPDATE "drama_jobs" SET "status" = ?, "error" = ?, "finished_at" = NULL, "updated_at" = ? WHERE "project_id" = ? AND "status" = ? AND "task_id" IN (SELECT "id" FROM "tasks" WHERE "status" = ?)',
      ["running", "", new Date().toISOString(), projectId, "failed", taskStatusSucceeded],
    );
  });
}

// ReopenDramaSegmentVideoJob 把生成任务已成功、回写失败的段视频作业重新置为运行中，
// 调度循环会重放同一任务结果；段状态同步改回生成中。返回作业是否仍满足重放条件。
export async function reopenDramaSegmentVideoJob(repo: Repository, jobId: string, segmentId: string): Promise<boolean> {
  let reopened = false;
  try {
    await repo.transaction(async (tx) => {
      const now = new Date().toISOString();
      const changes = await tx.db.run(
        'UPDATE "drama_jobs" SET "status" = ?, "error" = ?, "finished_at" = NULL, "updated_at" = ? WHERE "id" = ? AND "shot_id" = ? AND "kind" = ? AND "status" = ? AND "task_id" IN (SELECT "id" FROM "tasks" WHERE "status" = ?)',
        [dramaJobRunning, "", now, jobId, segmentId, dramaJobSegmentVideo, dramaJobFailed, taskStatusSucceeded],
      );
      if (changes === 0) return;
      const segmentChanges = await tx.db.run(
        'UPDATE "drama_segments" SET "video_status" = ?, "video_error" = ?, "updated_at" = ? WHERE "id" = ? AND "video_status" = ?',
        [dramaMediaRunning, "", now, segmentId, dramaMediaFailed],
      );
      if (segmentChanges === 0) {
        // 段状态已被并发操作改变（例如用户刚点了重新生成），放弃重放。
        throw errReopenRaced;
      }
      reopened = true;
    });
  } catch (error) {
    if (error === errReopenRaced) return false;
    throw error;
  }
  return reopened;
}

export async function recentDramaSegmentJobs(repo: Repository, projectId: string, episodeId: string): Promise<DramaJob[]> {
  const rows = await repo.db.all<DramaJobRow>(
    `SELECT ${dramaJobSelect} FROM "drama_jobs" WHERE "project_id" = ? AND "episode_id" = ? AND "kind" IN (?, ?) ORDER BY "created_at" DESC`,
    [projectId, episodeId, dramaJobSegmentPrompt, dramaJobSegmentVideo],
  );
  return rows.map(mapDramaJob);
}
