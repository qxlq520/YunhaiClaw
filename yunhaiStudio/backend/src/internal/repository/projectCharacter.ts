// 对应 backend/internal/repository/project_character.go
// 角色素材、版本、声音绑定与角色创建/保存事务。

import { assetCategoryCharacter, assetVersionStatusArchived, taskStatusSucceeded } from "@/internal/model/models";
import type {
  Asset,
  AssetRepresentation,
  AssetVersion,
  CharacterVoiceBinding,
  ProjectAssetCandidate,
  ProjectAssetLink,
  VoiceProfile,
} from "@/internal/model/modelsProject";
import type { Task } from "@/internal/model/modelsTask";
import { recordNotFound, Repository, toIso } from "./repository";

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

interface VoiceProfileRow {
  id: string;
  user_id: string;
  name: string;
  provider: string;
  voice_key: string;
  language: string;
  timbre: string;
  sample_resource_id: string | null;
  compatible_models_json: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapVoiceProfile(row: VoiceProfileRow): VoiceProfile {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    provider: row.provider,
    voiceKey: row.voice_key,
    language: row.language,
    timbre: row.timbre,
    sampleResourceId: row.sample_resource_id ?? "",
    compatibleModelsJson: row.compatible_models_json,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

interface CharacterVoiceBindingRow {
  id: string;
  asset_version_id: string;
  voice_profile_id: string;
  instructions: string;
  created_at: string;
  updated_at: string;
}

function mapCharacterVoiceBinding(row: CharacterVoiceBindingRow): CharacterVoiceBinding {
  return {
    id: row.id,
    assetVersionId: row.asset_version_id,
    voiceProfileId: row.voice_profile_id,
    instructions: row.instructions,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const booleanColumns = new Set(["agent_execution_ready", "can_recover_media"]);

function camelize(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_match, character: string) => character.toUpperCase());
}

function mapTaskRow(row: Record<string, unknown>): Task {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (booleanColumns.has(key)) result[camelize(key)] = value === 1 || value === true || value === "1";
    else result[camelize(key)] = value;
  }
  return result as unknown as Task;
}

export async function projectCharacterAsset(
  repo: Repository,
  userId: string,
  projectId: string,
  assetId: string,
): Promise<Asset | null> {
  const rows = await repo.db.all<AssetRow>(
    'SELECT "assets".* FROM "assets" JOIN "project_asset_links" ON "project_asset_links"."asset_id" = "assets"."id" WHERE "assets"."id" = ? AND "assets"."user_id" = ? AND "assets"."category" = ? AND "project_asset_links"."project_id" = ? LIMIT 1',
    [assetId, userId, assetCategoryCharacter, projectId],
  );
  return rows.length ? mapAsset(rows[0]) : null;
}

export async function userCharacterAsset(
  repo: Repository,
  userId: string,
  assetId: string,
): Promise<Asset | null> {
  const rows = await repo.db.all<AssetRow>(
    `SELECT ${assetColumns} FROM "assets" WHERE "id" = ? AND "user_id" = ? AND "category" = ? AND "kind" = ? LIMIT 1`,
    [assetId, userId, assetCategoryCharacter, "entity"],
  );
  return rows.length ? mapAsset(rows[0]) : null;
}

function characterAssetQuery(
  userId: string,
  query: string,
): { where: string; values: string[] } {
  const conditions = ['"user_id" = ?', '"category" = ?', '"kind" = ?', '"status" <> ?'];
  const values = [userId, assetCategoryCharacter, "entity", assetVersionStatusArchived];
  const keyword = query.trim();
  if (keyword !== "") {
    const pattern = `%${keyword.toLowerCase()}%`;
    conditions.push('(LOWER("title") LIKE ? OR LOWER("payload_json") LIKE ?)');
    values.push(pattern, pattern);
  }
  return { where: ` WHERE ${conditions.join(" AND ")}`, values };
}

export async function userCharacterAssetsPage(
  repo: Repository,
  userId: string,
  query: string,
  page: number,
  pageSize: number,
): Promise<{ assets: Asset[]; total: number }> {
  let currentPage = page;
  if (currentPage < 1) currentPage = 1;
  let size = pageSize;
  if (size < 1 || size > 48) size = 12;
  const filter = characterAssetQuery(userId, query);
  const totals = await repo.db.all<{ total: number }>(
    `SELECT COUNT(*) AS "total" FROM "assets"${filter.where}`,
    filter.values,
  );
  const total = Number(totals[0]?.total ?? 0);
  const rows = await repo.db.all<AssetRow>(
    `SELECT ${assetColumns} FROM "assets"${filter.where} ORDER BY "updated_at" DESC, "id" DESC LIMIT ? OFFSET ?`,
    [...filter.values, size, (currentPage - 1) * size],
  );
  return { assets: rows.map(mapAsset), total };
}

export async function userCharacterAssetsByIds(
  repo: Repository,
  userId: string,
  ids: string[],
): Promise<Asset[]> {
  if (ids.length === 0) return [];
  const selected = ids.slice(0, 80);
  const placeholders = selected.map(() => "?").join(", ");
  const rows = await repo.db.all<AssetRow>(
    `SELECT ${assetColumns} FROM "assets" WHERE "user_id" = ? AND "category" = ? AND "kind" = ? AND "id" IN (${placeholders})`,
    [userId, assetCategoryCharacter, "entity", ...selected],
  );
  return rows.map(mapAsset);
}

export async function assetVersion(repo: Repository, id: string): Promise<AssetVersion | null> {
  const rows = await repo.db.all<AssetVersionRow>('SELECT * FROM "asset_versions" WHERE "id" = ? LIMIT 1', [id]);
  return rows.length ? mapAssetVersion(rows[0]) : null;
}

export async function assetRepresentations(
  repo: Repository,
  assetVersionId: string,
): Promise<AssetRepresentation[]> {
  const rows = await repo.db.all<AssetRepresentationRow>(
    'SELECT * FROM "asset_representations" WHERE "asset_version_id" = ? ORDER BY "role" ASC, "created_at" ASC',
    [assetVersionId],
  );
  return rows.map(mapAssetRepresentation);
}

export async function assetRepresentationsForTask(
  repo: Repository,
  taskId: string,
): Promise<AssetRepresentation[]> {
  const rows = await repo.db.all<AssetRepresentationRow>(
    'SELECT * FROM "asset_representations" WHERE "task_id" = ? ORDER BY "role" ASC, "created_at" ASC',
    [taskId],
  );
  return rows.map(mapAssetRepresentation);
}

export async function unboundCharacterTurnaroundTasks(
  repo: Repository,
  userId: string,
  projectId: string,
): Promise<Task[]> {
  const rows = await repo.db.all<Record<string, unknown>>(
    'SELECT * FROM "tasks" WHERE "user_id" = ? AND "project_id" = ? AND "status" = ? AND "type" = ? AND "input_json" LIKE ? AND NOT EXISTS (SELECT 1 FROM "asset_representations" WHERE "asset_representations"."task_id" = "tasks"."id") ORDER BY "created_at" ASC LIMIT 100',
    [userId, projectId, taskStatusSucceeded, "canvas_image", "%character_turnaround%"],
  );
  return rows.map(mapTaskRow);
}

export async function characterVoiceBinding(
  repo: Repository,
  assetVersionId: string,
): Promise<CharacterVoiceBinding | null> {
  const rows = await repo.db.all<CharacterVoiceBindingRow>(
    'SELECT * FROM "character_voice_bindings" WHERE "asset_version_id" = ? LIMIT 1',
    [assetVersionId],
  );
  return rows.length ? mapCharacterVoiceBinding(rows[0]) : null;
}

export async function voiceProfileForUser(
  repo: Repository,
  userId: string,
  id: string,
): Promise<VoiceProfile | null> {
  const rows = await repo.db.all<VoiceProfileRow>(
    'SELECT * FROM "voice_profiles" WHERE "id" = ? AND "user_id" = ? LIMIT 1',
    [id, userId],
  );
  return rows.length ? mapVoiceProfile(rows[0]) : null;
}

export async function voiceProfiles(repo: Repository, userId: string): Promise<VoiceProfile[]> {
  const rows = await repo.db.all<VoiceProfileRow>(
    'SELECT * FROM "voice_profiles" WHERE "user_id" = ? AND "status" = ? ORDER BY "created_at" ASC',
    [userId, "active"],
  );
  return rows.map(mapVoiceProfile);
}

const voiceProfileColumns =
  '"id", "user_id", "name", "provider", "voice_key", "language", "timbre", "sample_resource_id", "compatible_models_json", "status", "created_at", "updated_at"';

function voiceProfileValues(profile: VoiceProfile): (string | number | boolean | null)[] {
  return [
    profile.id,
    profile.userId,
    profile.name,
    profile.provider,
    profile.voiceKey,
    profile.language,
    profile.timbre,
    profile.sampleResourceId ?? "",
    profile.compatibleModelsJson,
    profile.status,
    profile.createdAt,
    profile.updatedAt,
  ];
}

export async function ensureVoiceProfiles(repo: Repository, profiles: VoiceProfile[]): Promise<void> {
  if (profiles.length === 0) return;
  const placeholders = profiles.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
  await repo.db.run(
    `INSERT INTO "voice_profiles" (${voiceProfileColumns}) VALUES ${placeholders} ON CONFLICT ("user_id", "provider", "voice_key") DO NOTHING`,
    profiles.flatMap(voiceProfileValues),
  );
}

export async function createVoiceProfile(repo: Repository, profile: VoiceProfile): Promise<void> {
  await repo.db.run(
    `INSERT INTO "voice_profiles" (${voiceProfileColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    voiceProfileValues(profile),
  );
}

/** RenameVoiceProfile 只改用户上传样本声音的显示名；内置音色的名称由系统维护。 */
export async function renameVoiceProfile(
  repo: Repository,
  userId: string,
  id: string,
  name: string,
): Promise<void> {
  await repo.db.run(
    'UPDATE "voice_profiles" SET "name" = ?, "updated_at" = ? WHERE "id" = ? AND "user_id" = ? AND "provider" = ?',
    [name, new Date().toISOString(), id, userId, "user_upload"],
  );
}

export async function voiceProfileBySampleResource(
  repo: Repository,
  userId: string,
  resourceId: string,
): Promise<VoiceProfile | null> {
  const rows = await repo.db.all<VoiceProfileRow>(
    'SELECT * FROM "voice_profiles" WHERE "user_id" = ? AND "sample_resource_id" = ? AND "status" = ? LIMIT 1',
    [userId, resourceId, "active"],
  );
  return rows.length ? mapVoiceProfile(rows[0]) : null;
}

async function insertAsset(repo: Repository, asset: Asset): Promise<void> {
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

async function insertAssetRepresentations(
  repo: Repository,
  representations: AssetRepresentation[],
): Promise<void> {
  if (representations.length === 0) return;
  const placeholders = representations.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
  await repo.db.run(
    `INSERT INTO "asset_representations" ("id", "task_id", "asset_version_id", "resource_id", "media_type", "role", "metadata_json", "created_at") VALUES ${placeholders}`,
    representations.flatMap((item) => [
      item.id,
      item.taskId ?? "",
      item.assetVersionId,
      item.resourceId ?? "",
      item.mediaType,
      item.role,
      item.metadataJson,
      item.createdAt,
    ]),
  );
}

async function insertCharacterVoiceBinding(
  repo: Repository,
  voice: CharacterVoiceBinding,
): Promise<void> {
  await repo.db.run(
    'INSERT INTO "character_voice_bindings" ("id", "asset_version_id", "voice_profile_id", "instructions", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?)',
    [voice.id, voice.assetVersionId, voice.voiceProfileId, voice.instructions, voice.createdAt, voice.updatedAt],
  );
}

export async function createUserCharacter(
  repo: Repository,
  asset: Asset,
  version: AssetVersion,
  representations: AssetRepresentation[],
  voice: CharacterVoiceBinding | null,
): Promise<void> {
  await repo.transaction(async (tx) => {
    await insertAsset(tx, asset);
    await insertAssetVersion(tx, version);
    if (representations.length > 0) await insertAssetRepresentations(tx, representations);
    if (voice) await insertCharacterVoiceBinding(tx, voice);
  });
}

/** CreateProjectCharacter 将角色身份、首版本和项目关联放入同一事务。 */
export async function createProjectCharacter(
  repo: Repository,
  projectId: string,
  asset: Asset,
  version: AssetVersion,
  link: ProjectAssetLink,
): Promise<void> {
  await repo.transaction(async (tx) => {
    await insertAsset(tx, asset);
    await insertAssetVersion(tx, version);
    await tx.db.run(
      'INSERT INTO "project_asset_links" ("id", "project_id", "asset_id", "folder_id", "position", "created_at") VALUES (?, ?, ?, ?, ?, ?)',
      [link.id, link.projectId, link.assetId, link.folderId ?? "", link.position, link.createdAt],
    );
    await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [
      asset.updatedAt,
      projectId,
    ]);
  });
}

async function saveCharacterVersionTx(
  repo: Repository,
  asset: Asset,
  version: AssetVersion,
  representations: AssetRepresentation[],
  voice: CharacterVoiceBinding | null,
): Promise<void> {
  await insertAssetVersion(repo, version);
  if (representations.length > 0) await insertAssetRepresentations(repo, representations);
  if (voice) await insertCharacterVoiceBinding(repo, voice);
  const changes = await repo.db.run(
    'UPDATE "assets" SET "kind" = ?, "category" = ?, "status" = ?, "primary_version_id" = ?, "title" = ?, "payload_json" = ?, "updated_at" = ? WHERE "id" = ? AND "user_id" = ?',
    [
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
  if (changes !== 1) throw recordNotFound;
}

/** SaveCharacterVersion 通过不可变版本替换角色当前状态，旧镜头仍可继续引用历史版本。 */
export async function saveCharacterVersion(
  repo: Repository,
  projectId: string,
  asset: Asset,
  version: AssetVersion,
  representations: AssetRepresentation[],
  voice: CharacterVoiceBinding | null,
): Promise<void> {
  await repo.transaction(async (tx) => {
    await saveCharacterVersionTx(tx, asset, version, representations, voice);
    let projectIds: string[] = [];
    if (projectId !== "") {
      projectIds = [projectId];
    } else {
      const rows = await tx.db.all<{ project_id: string }>(
        'SELECT DISTINCT "project_id" FROM "project_asset_links" WHERE "asset_id" = ?',
        [asset.id],
      );
      projectIds = rows.map((row) => row.project_id);
    }
    for (const linkedProjectId of projectIds) {
      await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [
        new Date().toISOString(),
        linkedProjectId,
      ]);
    }
  });
}

/** ConfirmProjectCharacterCandidate 保证角色归并版本与候选确认同时生效，失败时不会留下孤立版本。 */
export async function confirmProjectCharacterCandidate(
  repo: Repository,
  candidate: ProjectAssetCandidate,
  asset: Asset,
  version: AssetVersion,
  representations: AssetRepresentation[],
  voice: CharacterVoiceBinding | null,
): Promise<void> {
  await repo.transaction(async (tx) => {
    await saveCharacterVersionTx(tx, asset, version, representations, voice);
    const changes = await tx.db.run(
      'UPDATE "project_asset_candidates" SET "status" = ?, "resolved_asset_id" = ?, "updated_at" = ? WHERE "id" = ? AND "project_id" = ? AND "status" = ?',
      [
        candidate.status,
        candidate.resolvedAssetId ?? "",
        candidate.updatedAt,
        candidate.id,
        candidate.projectId,
        "pending_confirmation",
      ],
    );
    if (changes !== 1) throw new Error("invalid data");
    await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [
      candidate.updatedAt,
      candidate.projectId,
    ]);
  });
}
