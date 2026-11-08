// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
import { Project, Resource } from "./modelsProject";
export interface UserDailyActivity {
  id: string;
  day: string;
  userId: string;
  firstActiveAt: string | null;
  lastActiveAt: string | null;
  loginCount: number;
  taskCount: number;
  agentMessageCount: number;
  canvasActive: boolean;
  assetCount: number;
  resourceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SystemSetting {
  key: string;
  valueJson: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

// ArkPrivateAssetBinding caches the approved Ark private-library asset for an
// immutable local Resource. Ark asset IDs are scoped to one Ark Project.

export interface ArkPrivateAssetBinding {
  id: string;
  userId: string;
  resourceId: string;
  projectName: string;
  assetGroupId: string;
  arkAssetId: string;
  status: string;
  error: string;
  createdAt: string;
  updatedAt: string;
}

// ArkPortraitSession 是一次方舟真人认证（H5 活体）会话。State 是回调地址里的一次性随机凭据，
// BytedToken 加密保存，30 分钟内用于换取本次认证创建的真人素材组 ID。
// Scope 为 user 时由用户自建，可能冻结素材组费用（BillingOrderID）；platform 由管理员为平台素材组发起，不收费。

export interface ArkPortraitSession {
  id: string;
  userId: string;
  scope: string;
  state?: string;
  name: string;
  description: string;
  site: string;
  region: string;
  projectName: string;
  bytedTokenCipher?: string;
  status: string;
  resultCode?: string;
  groupId?: string;
  error?: string;
  billingOrderId?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

// ArkPortraitGroup 是平台方舟账号下的一个素材组。Kind 区分真人（LivenessFace，只能经 H5 认证生成）、
// 虚拟与版权 IP（AIGC）；Scope=user 只属于创建者本人，Scope=platform 由管理员创建并按授权给用户只读使用。
// 真人组的 ExpiresAt 是授权到期时间，到期后不能再上传或用于生成。

export interface ArkPortraitGroup {
  id: string;
  userId: string;
  kind: string;
  scope: string;
  name: string;
  description: string;
  site: string;
  region: string;
  projectName: string;
  groupId: string;
  source: string;
  grantAll: boolean;
  authorizedAt: string | null;
  expiresAt: string | null;
  billingOrderId?: string;
  createdAt: string;
  updatedAt: string;
}

// ArkPortraitAsset 是素材组内的一份素材。需要平台审核时先为 pending_review，管理员通过后才提交方舟；
// 方舟审核通过（active）后，LibraryAssetID 指向素材库中被认证的素材。

export interface ArkPortraitAsset {
  id: string;
  userId: string;
  groupId: string;
  resourceId: string;
  arkAssetId: string;
  assetType: string;
  name: string;
  status: string;
  error?: string;
  libraryAssetId?: string;
  reviewedBy?: string;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// BillingSceneArkAssetGroup 是方舟素材组费用的计费场景：按组一次性收费，不关联生成任务。

export const billingSceneArkAssetGroup = "ark_asset_group";

// ArkPortraitGroupGrant 记录平台素材组授权给的单个用户；GrantAll 的组不逐个写入。

export interface ArkPortraitGroupGrant {
  id: string;
  groupId: string;
  userId: string;
  createdBy: string;
  createdAt: string;
}

export interface UserOSSSetting {
  id: string;
  userId: string;
  enabled: boolean;
  valueJson?: string;
  createdAt: string;
  updatedAt: string;
}

// StorageLocation is an immutable object-storage address. Credentials may be
// rotated in place, while resources keep referring to the same location ID.

export interface StorageLocation {
  id: string;
  scope: string;
  ownerId: string;
  provider: string;
  locationDigest?: string;
  valueJson?: string;
  testedDigest?: string;
  testedAt?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserDailyUploadUsage {
  id: string;
  userId: string;
  day: string;
  bytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface Skill {
  id: string;
  ownerId: string;
  authorName: string;
  authorAvatarUrl: string;
  name: string;
  description: string;
  instruction: string;
  currentVersionId: string;
  versionLabel: string;
  contentHash: string;
  fileCount: number;
  totalBytes: number;
  sourceType: string;
  sourceUrl: string;
  sourceRef: string;
  sourceSubdir: string;
  sourceCommit: string;
  syncStatus: string;
  syncError: string;
  autoUpdate: boolean;
  lastCheckedAt: string | null;
  lastSyncedAt: string | null;
  status: number;
  source: number;
  tag: string;
  sortWeight: number;
  isPrivate: boolean;
  markdownUrl: string;
  showcaseMediaJson?: string;
  extraInfo: string;
  initialLikeCount: number;
  initialAddedCount: number;
  /** AdminInfoEditedAt / AdminContentEditedAt 记录管理员最近一次修改基本信息 / 文件内容的时间（Schema 83）。 // 内置技能启动同步不再覆盖管理员改过的部分；GitHub 同步在 AdminInfoEditedAt 非空时保留名称和简介。 */
  adminInfoEditedAt: string | null;
  adminContentEditedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkillVersion {
  id: string;
  skillId: string;
  versionLabel: string;
  contentHash: string;
  entryPath: string;
  packageKey: string;
  fileCount: number;
  totalBytes: number;
  sourceCommit: string;
  createdAt: string;
}

export interface SkillFile {
  id: string;
  skillVersionId: string;
  path: string;
  kind: string;
  mimeType: string;
  size: number;
  sha256: string;
  createdAt: string;
}

// SkillLibraryCategory separates a user's library taxonomy from Skill.Tag,
// which remains the shared marketplace category.

export interface SkillLibraryCategory {
  id: string;
  name: string;
  normalizedName?: string;
  scope: string;
  ownerId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserSkillState {
  id: string;
  userId: string;
  skillId: string;
  libraryCategoryId: string;
  installedVersionId: string;
  autoUpdate: boolean;
  added: boolean;
  liked: boolean;
  /** AgentMode 为空或 auto 时 Agent 可以自动发现该技能；manual 只在用户点名或固定时使用。 */
  agentMode?: string;
  /** AgentUseCount / AgentLastUsedAt 只记录 Agent 实际读取，用于决定目录里谁优先列出。 */
  agentUseCount: number;
  agentLastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const userSkillAgentModeAuto = "auto";
export const userSkillAgentModeManual = "manual";

export interface Tool {
  id: number;
  type: string;
  labelEn: string;
  label: string;
  desc: string;
  tag: string;
  cover: string;
  extraInfoJson?: string;
  prompt: string;
  ratio: string;
  mediaUrl: string;
  ownerId: string;
  source: string;
  enabled: boolean;
  visibility: string;
  sortWeight: number;
  createdAt: string;
  updatedAt: string;
}

// ToolFavorite 保存用户对工具的收藏关系；一个用户对同一工具只能收藏一次。

export interface ToolFavorite {
  id: number;
  userId: string;
  toolId: number;
  createdAt: string;
}
