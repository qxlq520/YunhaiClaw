// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
import { AnnouncementLevel, AnnouncementStatus, AssetCategory, AssetVersionStatus, ProjectStatus, ProjectUnitKind, ProjectUnitStatus, ResourceDeletionStatus, ResourceStatus, WorkflowStatus, WorkflowStepStatus } from "./models";
import { Task } from "./modelsTask";

export const projectUnitTitleMaxRunes = 240;

export const assetIdMaxLength = 80;

export interface Resource {
  id: string;
  userId: string;
  kind: string;
  status: ResourceStatus;
  provider: string;
  endpoint: string;
  bucket: string;
  /** 用户 OSS 每次修改都会生成新版本，资源固定引用创建时的存储与密钥；只有同一存储位置才可复用当前 CDN。 */
  storageSettingId?: string;
  objectKey: string;
  publicUrl: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  durationMs: number;
  etag: string;
  /** 浏览器兼容播放副本（HEVC/H.265 原片在 Chrome 等无法解码，由 ffmpeg 转 H.264）： // PlaybackStatus: none|processing|ready|failed；PlaybackObjectKey 为本地播放目录下的文件名。 */
  playbackStatus: string;
  playbackObjectKey: string;
  playbackError: string;
  /** 单档画布展示缩略图；对象键固定由 ObjectKey 派生，不单独持久化。 */
  thumbnailStatus: string;
  thumbnailMimeType: string;
  thumbnailSize: number;
  thumbnailWidth: number;
  thumbnailHeight: number;
  /** UploadKey 是客户端逻辑上传身份的摘要；NULL 表示不参与幂等约束。 */
  uploadKey?: string | null;
  error: string;
  createdAt: string;
  updatedAt: string;
}

// ResourceDeletionJob is the durable handoff between database deletion and
// physical object cleanup. Storage fields are frozen because the Resource row
// is removed in the same transaction that creates this job.

export interface ResourceDeletionJob {
  id: string;
  userId: string;
  resourceId: string;
  provider: string;
  endpoint: string;
  bucket: string;
  storageSettingId?: string;
  objectKey: string;
  status: ResourceDeletionStatus;
  attempts: number;
  lastError: string;
  nextAttemptAt: string;
  leaseOwner?: string;
  leaseExpiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// AnnouncementImageDraft marks an uploaded image as temporary until an
// announcement create or update transaction consumes it.

export interface AnnouncementImageDraft {
  resourceId: string;
  userId: string;
  createdAt: string;
}

export interface Asset {
  id: string;
  userId: string;
  folderId?: string;
  kind: string;
  category: AssetCategory;
  status: AssetVersionStatus;
  primaryVersionId?: string;
  title: string;
  payloadJson: string;
  createdAt: string;
  updatedAt: string;
}

// AssetFolder 是用户素材库的一层自定义分类；业务分类仍由 Asset.Category 表达。

export interface AssetFolder {
  id: string;
  userId: string;
  name: string;
  nameKey?: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectAssetLink {
  id: string;
  projectId: string;
  assetId: string;
  folderId?: string;
  position: number;
  createdAt: string;
}

// ProjectAssetFolder 只保存项目内的目录结构；真实媒体仍由 Asset/Resource 唯一持有。

export interface ProjectAssetFolder {
  id: string;
  projectId: string;
  parentId?: string;
  name: string;
  nameKey?: string;
  style: string;
  theme: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectAssetCandidate {
  id: string;
  projectId: string;
  unitId?: string;
  shotId?: string;
  name: string;
  nameKey?: string;
  category: AssetCategory;
  status: string;
  source?: string;
  detailsJson: string;
  resolvedAssetId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssetVersion {
  id: string;
  assetId: string;
  version: number;
  status: AssetVersionStatus;
  definitionJson: string;
  prompt: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssetRepresentation {
  id: string;
  taskId?: string;
  assetVersionId: string;
  resourceId?: string;
  mediaType: string;
  role: string;
  metadataJson: string;
  createdAt: string;
}

// VoiceProfile 是可复用的声音身份；试听音频只是表现资源，不等同于声音本身。

export interface VoiceProfile {
  id: string;
  userId: string;
  name: string;
  provider: string;
  voiceKey: string;
  language: string;
  timbre: string;
  sampleResourceId?: string;
  compatibleModelsJson: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterVoiceBinding {
  id: string;
  assetVersionId: string;
  voiceProfileId: string;
  instructions: string;
  createdAt: string;
  updatedAt: string;
}

// Project 是短剧领域聚合根；CanvasProject 仍代表可独立创作的画布文档。

export interface Project {
  id: string;
  userId: string;
  name: string;
  type: string;
  aspectRatio: string;
  sourceType: string;
  description: string;
  coverResourceId?: string;
  stylePresetId: string;
  styleProfileJson: string;
  defaultImageModel?: string;
  defaultVideoModel?: string;
  status: ProjectStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

// StyleProfile 是用户可持续编辑的风格源；项目只保存应用当时的 JSON 快照，避免源对象更新污染历史生成。

export interface StyleProfile {
  id: string;
  userId: string;
  name: string;
  description: string;
  coverUrl: string;
  tagsJson: string;
  profileJson: string;
  favorite: boolean;
  lastUsedAt?: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectUnit {
  id: string;
  projectId: string;
  parentId?: string;
  kind: ProjectUnitKind;
  title: string;
  sourceText: string;
  wordCount: number;
  status: ProjectUnitStatus;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasUnitLink {
  id: string;
  projectId: string;
  canvasId: string;
  unitId: string;
  role: string;
  createdAt: string;
}

export interface Shot {
  id: string;
  projectId: string;
  unitId: string;
  currentRevisionId?: string;
  title: string;
  description: string;
  position: number;
  durationMs: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

// ShotRevision 保存可复现的分镜脚本版本；Shot 只保留稳定身份、排序和当前版本指针。

export interface ShotRevision {
  id: string;
  shotId: string;
  version: number;
  plotDescription: string;
  action: string;
  dialogue: string;
  shotSize: string;
  cameraAngle: string;
  cameraMovement: string;
  durationMs: number;
  imagePrompt: string;
  videoPrompt: string;
  negativePrompt: string;
  continuityNotes: string;
  actionBeatsJson: string;
  createdBy?: string;
  createdAt: string;
}

// ShotArtifact 是镜头的版本化生产产物。修改分镜或资产引用时只标记 stale，不删除历史。

export interface ShotArtifact {
  id: string;
  projectId: string;
  unitId: string;
  shotId: string;
  revisionId?: string;
  taskId?: string;
  type: string;
  version: number;
  resourceId?: string;
  status: string;
  selected: boolean;
  metadataJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShotAssetReference {
  id: string;
  shotId: string;
  assetVersionId: string;
  role: string;
  status: string;
  createdAt: string;
}

export interface WorkflowTemplateVersion {
  id: string;
  templateKey: string;
  name: string;
  version: number;
  definitionJson: string;
  createdAt: string;
}

export interface WorkflowInstance {
  id: string;
  projectId: string;
  unitId?: string;
  templateVersionId: string;
  scope: string;
  status: WorkflowStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStepInstance {
  id: string;
  workflowInstanceId: string;
  stepKey: string;
  name: string;
  position: number;
  status: WorkflowStepStatus;
  inputJson: string;
  outputJson: string;
  error: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStepTask {
  id: string;
  workflowStepId: string;
  taskId: string;
  createdAt: string;
}

// ProductionTaskLink 显式区分领域项目、画布和镜头上下文，避免继续复用 Task.ProjectID 表达多种身份。

export interface ProductionTaskLink {
  id: string;
  taskId: string;
  projectId: string;
  canvasId?: string;
  unitId?: string;
  shotId?: string;
  workflowStepId?: string;
  artifactType?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasProject {
  id: string;
  userId: string;
  projectId?: string;
  title: string;
  payloadJson: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasShare {
  id: string;
  userId: string;
  projectId: string;
  tokenHash?: string;
  tokenCipher?: string;
  enabled: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PromptTemplate {
  id: string;
  operation: string;
  name: string;
  version: number;
  content: string;
  outputType: string;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// UserPromptCustomization 只保存用户的创作策略层，动态上下文和输出契约始终由服务端编译器注入。

export interface UserPromptCustomization {
  id: string;
  userId: string;
  operation: string;
  mode: string;
  content: string;
  baseTemplateId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  imageResourceId?: string;
  imageUrl?: string;
  level: AnnouncementLevel;
  pinned: boolean;
  status: AnnouncementStatus;
  createdBy: string;
  publishedAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserAnnouncementRead {
  id: string;
  userId: string;
  announcementId: string;
  readAt: string;
}

// BannerTitleRun 是通知标题中一段连续文本的样式覆盖；零值字段表示沿用默认样式。
// 字重与字号用指针区分「未设置」和「显式设置为默认值」。

export interface BannerTitleRun {
  text: string;
}

export interface BannerAnnouncement {
  id: string;
  /** TitleRuns 是标题的样式分段，前端按段渲染；持久化在 title_runs 文本列，由仓储层显式编解码。 */
  titleRuns?: BannerTitleRun[];
  titleRunsJson?: string;
  /** NoticeType 决定通知条底色（"notice" | "activity" | "update" | "warning"），取值白名单见 app 层。 */
  noticeType: string;
  sortOrder: number;
  startsAt?: string | null;
  endsAt?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export const projectUnitHtmlTagPattern = /<[^>]+>/g;

function unescapeHtmlEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? match;
  });
}

export function projectUnitWordCount(sourceText: string): number {
  const plainText = sourceText.replace(projectUnitHtmlTagPattern, "");
  return [...unescapeHtmlEntities(plainText).trim()].length;
}

export function normalizeProjectUnitTitle(value: string): string {
  return value.trim();
}

export function validProjectUnitTitle(value: string): boolean {
  const title = normalizeProjectUnitTitle(value);
  return title !== "" && [...title].length <= projectUnitTitleMaxRunes;
}
