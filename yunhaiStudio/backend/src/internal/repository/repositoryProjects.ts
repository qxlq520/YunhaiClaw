// 对应 backend/internal/repository/repository_projects.go
// 短剧项目、分集单元、项目素材库与画布-单元关联。

import { taskStatusQueued, taskStatusRunning } from "@/internal/model/models";
import type {
  Asset,
  AssetVersion,
  CanvasProject,
  CanvasUnitLink,
  Project,
  ProjectAssetFolder,
  ProjectAssetLink,
  ProjectUnit,
} from "@/internal/model/modelsProject";
import { recordNotFound, Repository, toIso } from "./repository";
import { errEmptySlice, invalidateUnitWorkflowTx } from "./repositoryShotsWorkflows";

// 同一用户下的项目名称已被占用。
export const errProjectNameConflict = new Error("project name conflict");
export const errProjectHasActiveTasks = new Error("项目中还有进行中的任务，请等待完成后再操作");
export const errProjectAssetFolderNotEmpty = new Error("资产文件夹不为空，无法删除");

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

const projectColumns =
  '"id", "user_id", "name", "type", "aspect_ratio", "source_type", "description", "cover_resource_id", "style_preset_id", "style_profile_json", "default_image_model", "default_video_model", "status", "revision", "created_at", "updated_at"';

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

const projectUnitColumns =
  '"id", "project_id", "parent_id", "kind", "title", "source_text", "word_count", "status", "position", "created_at", "updated_at"';

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

const canvasUnitLinkColumns = '"id", "project_id", "canvas_id", "unit_id", "role", "created_at"';

interface ProjectAssetLinkRow {
  id: string;
  project_id: string;
  asset_id: string;
  folder_id: string | null;
  position: number;
  created_at: string;
}

function mapProjectAssetLink(row: ProjectAssetLinkRow): ProjectAssetLink {
  return {
    id: row.id,
    projectId: row.project_id,
    assetId: row.asset_id,
    folderId: row.folder_id ?? "",
    position: Number(row.position),
    createdAt: toIso(row.created_at),
  };
}

const projectAssetLinkColumns = '"id", "project_id", "asset_id", "folder_id", "position", "created_at"';

interface ProjectAssetFolderRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  name_key: string | null;
  style: string;
  theme: string;
  position: number;
  created_at: string;
  updated_at: string;
}

function mapProjectAssetFolder(row: ProjectAssetFolderRow): ProjectAssetFolder {
  return {
    id: row.id,
    projectId: row.project_id,
    parentId: row.parent_id ?? "",
    name: row.name,
    nameKey: row.name_key ?? "",
    style: row.style,
    theme: row.theme,
    position: Number(row.position),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const projectAssetFolderColumns =
  '"id", "project_id", "parent_id", "name", "name_key", "style", "theme", "position", "created_at", "updated_at"';

interface AssetRow {
  id: string;
  user_id: string | null;
  folder_id: string | null;
  kind: string;
  category: string;
  status: string;
  primary_version_id: string | null;
  title: string;
  payload_json: string | null;
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

const assetColumns = '"id", "user_id", "folder_id", "kind", "category", "status", "primary_version_id", "title", "payload_json", "created_at", "updated_at"';

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
    version: Number(row.version),
    status: row.status,
    definitionJson: row.definition_json,
    prompt: row.prompt,
    note: row.note,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const assetVersionColumns = '"id", "asset_id", "version", "status", "definition_json", "prompt", "note", "created_at", "updated_at"';

function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}

export async function projects(repo: Repository, userId: string): Promise<Project[]> {
  const rows = await repo.db.all<ProjectRow>(`SELECT ${projectColumns} FROM "projects" WHERE "user_id" = ? ORDER BY "updated_at" DESC`, [userId]);
  return rows.map(mapProject);
}

export async function projectsPage(
  repo: Repository,
  userId: string,
  page: number,
  pageSize: number,
): Promise<{ projects: Project[]; total: number }> {
  const totalRows = await repo.db.all<{ total: number }>('SELECT COUNT(*) AS "total" FROM "projects" WHERE "user_id" = ?', [userId]);
  const total = Number(totalRows[0]?.total ?? 0);
  const rows = await repo.db.all<ProjectRow>(
    `SELECT ${projectColumns} FROM "projects" WHERE "user_id" = ? ORDER BY "updated_at" DESC LIMIT ? OFFSET ?`,
    [userId, pageSize, (page - 1) * pageSize],
  );
  return { projects: rows.map(mapProject), total };
}

export async function projectForUser(repo: Repository, userId: string, id: string): Promise<Project | null> {
  const rows = await repo.db.all<ProjectRow>(`SELECT ${projectColumns} FROM "projects" WHERE "id" = ? AND "user_id" = ? LIMIT 1`, [id, userId]);
  return rows.length ? mapProject(rows[0]) : null;
}

// 只忽略用户与名称这一业务唯一索引；主键等其他冲突仍按数据库错误返回。
export async function createProject(repo: Repository, project: Project): Promise<void> {
  const changes = await repo.db.run(
    `INSERT INTO "projects" (${projectColumns}) VALUES (${placeholders(16)}) ON CONFLICT ("user_id", "name") DO NOTHING`,
    [
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
    ],
  );
  if (changes === 0) throw errProjectNameConflict;
}

export async function updateProject(repo: Repository, project: Project): Promise<void> {
  await repo.db.run(
    'UPDATE "projects" SET "name" = ?, "type" = ?, "aspect_ratio" = ?, "source_type" = ?, "description" = ?, "cover_resource_id" = ?, "style_preset_id" = ?, "style_profile_json" = ?, "default_image_model" = ?, "default_video_model" = ?, "status" = ?, "revision" = ?, "updated_at" = ? WHERE "id" = ? AND "user_id" = ?',
    [
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
      project.updatedAt,
      project.id,
      project.userId,
    ],
  );
}

export async function deleteProject(repo: Repository, userId: string, id: string, canvasUpdates: CanvasProject[]): Promise<void> {
  await repo.transaction(async (tx) => {
    const canvasRows = await tx.db.all<{ id: string }>('SELECT "id" FROM "canvas_projects" WHERE "user_id" = ? AND "project_id" = ?', [userId, id]);
    const canvasIds = canvasRows.map((row) => row.id);
    const projectScopeIds = [id, ...canvasIds];
    const activeTaskRows = await tx.db.all<{ total: number }>(
      `SELECT COUNT(*) AS "total" FROM "tasks" WHERE "user_id" = ? AND "project_id" IN (${placeholders(projectScopeIds.length)}) AND "status" IN (?, ?)`,
      [userId, ...projectScopeIds, taskStatusQueued, taskStatusRunning],
    );
    if (Number(activeTaskRows[0]?.total ?? 0) > 0) throw errProjectHasActiveTasks;
    await tx.db.run('DELETE FROM "canvas_shares" WHERE "user_id" = ? AND "project_id" = ?', [userId, id]);
    await tx.db.run('DELETE FROM "canvas_unit_links" WHERE "project_id" = ?', [id]);
    for (const canvas of canvasUpdates) {
      const changes = await tx.db.run(
        'UPDATE "canvas_projects" SET "project_id" = ?, "payload_json" = ?, "updated_at" = ?, "revision" = ? WHERE "id" = ? AND "user_id" = ? AND "project_id" = ? AND "revision" = ?',
        ["", canvas.payloadJson, canvas.updatedAt, canvas.revision + 1, canvas.id, userId, id, canvas.revision],
      );
      if (changes !== 1) throw recordNotFound;
    }
    const remainingRows = await tx.db.all<{ total: number }>(
      'SELECT COUNT(*) AS "total" FROM "canvas_projects" WHERE "user_id" = ? AND "project_id" = ?',
      [userId, id],
    );
    const remainingCanvasCount = Number(remainingRows[0]?.total ?? 0);
    if (remainingCanvasCount !== 0) throw new Error(`项目删除时仍有 ${remainingCanvasCount} 个画布关联未处理`);
    const shotIds = 'SELECT "id" FROM "shots" WHERE "project_id" = ?';
    await tx.db.run('DELETE FROM "production_task_links" WHERE "project_id" = ?', [id]);
    await tx.db.run('DELETE FROM "shot_artifacts" WHERE "project_id" = ?', [id]);
    await tx.db.run(`DELETE FROM "shot_revisions" WHERE "shot_id" IN (${shotIds})`, [id]);
    await tx.db.run(`DELETE FROM "shot_asset_references" WHERE "shot_id" IN (${shotIds})`, [id]);
    await tx.db.run('DELETE FROM "shots" WHERE "project_id" = ?', [id]);
    const instanceIds = 'SELECT "id" FROM "workflow_instances" WHERE "project_id" = ?';
    const stepIds = `SELECT "id" FROM "workflow_step_instances" WHERE "workflow_instance_id" IN (${instanceIds})`;
    await tx.db.run(`DELETE FROM "workflow_step_tasks" WHERE "workflow_step_id" IN (${stepIds})`, [id]);
    await tx.db.run(`DELETE FROM "workflow_step_instances" WHERE "workflow_instance_id" IN (${instanceIds})`, [id]);
    await tx.db.run('DELETE FROM "workflow_instances" WHERE "project_id" = ?', [id]);
    await tx.db.run('DELETE FROM "project_asset_links" WHERE "project_id" = ?', [id]);
    await tx.db.run('DELETE FROM "project_asset_folders" WHERE "project_id" = ?', [id]);
    await tx.db.run('DELETE FROM "project_asset_candidates" WHERE "project_id" = ?', [id]);
    await tx.db.run('DELETE FROM "project_units" WHERE "project_id" = ?', [id]);
    await tx.db.run('UPDATE "tasks" SET "project_id" = ?, "updated_at" = ? WHERE "user_id" = ? AND "project_id" = ?', [
      "",
      new Date().toISOString(),
      userId,
      id,
    ]);
    await tx.db.run('DELETE FROM "projects" WHERE "id" = ? AND "user_id" = ?', [id, userId]);
  });
}

export async function bumpProjectRevision(repo: Repository, projectId: string): Promise<void> {
  await repo.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [new Date().toISOString(), projectId]);
}

export async function projectUnits(repo: Repository, projectId: string): Promise<ProjectUnit[]> {
  const rows = await repo.db.all<ProjectUnitRow>(
    `SELECT ${projectUnitColumns} FROM "project_units" WHERE "project_id" = ? ORDER BY "position" ASC, "created_at" ASC`,
    [projectId],
  );
  return rows.map(mapProjectUnit);
}

export async function projectUnitSummaries(repo: Repository, projectId: string): Promise<ProjectUnit[]> {
  const rows = await repo.db.all<ProjectUnitRow>(
    'SELECT "id", "project_id", "kind", "title", "word_count", "status", "position", "created_at", "updated_at" FROM "project_units" WHERE "project_id" = ? ORDER BY "position" ASC, "created_at" ASC',
    [projectId],
  );
  return rows.map(mapProjectUnit);
}

export async function projectAssetCount(repo: Repository, projectId: string): Promise<number> {
  const rows = await repo.db.all<{ total: number }>('SELECT COUNT(*) AS "total" FROM "project_asset_links" WHERE "project_id" = ?', [projectId]);
  return Number(rows[0]?.total ?? 0);
}

export async function createProjectUnit(repo: Repository, unit: ProjectUnit): Promise<void> {
  await repo.db.run(`INSERT INTO "project_units" (${projectUnitColumns}) VALUES (${placeholders(11)})`, [
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
  ]);
}

export async function importProjectUnits(repo: Repository, projectId: string, units: ProjectUnit[]): Promise<void> {
  await repo.transaction(async (tx) => {
    if (units.length === 0) throw errEmptySlice;
    // 分批写入仍处于同一事务，避免两千章导入超过 SQLite/PostgreSQL 单语句参数上限。
    for (let index = 0; index < units.length; index += 100) {
      const batch = units.slice(index, index + 100);
      const values = batch.map(() => `(${placeholders(11)})`).join(", ");
      await tx.db.run(
        `INSERT INTO "project_units" (${projectUnitColumns}) VALUES ${values}`,
        batch.flatMap((unit) => [
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
        ]),
      );
    }
    await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [new Date().toISOString(), projectId]);
  });
}

export async function reorderProjectUnits(repo: Repository, projectId: string, unitIds: string[]): Promise<void> {
  await repo.transaction(async (tx) => {
    const now = new Date().toISOString();
    for (const [position, unitId] of unitIds.entries()) {
      const changes = await tx.db.run('UPDATE "project_units" SET "position" = ?, "updated_at" = ? WHERE "id" = ? AND "project_id" = ?', [
        position,
        now,
        unitId,
        projectId,
      ]);
      if (changes !== 1) throw recordNotFound;
    }
    await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [now, projectId]);
  });
}

export async function projectUnit(repo: Repository, projectId: string, id: string): Promise<ProjectUnit | null> {
  const rows = await repo.db.all<ProjectUnitRow>(`SELECT ${projectUnitColumns} FROM "project_units" WHERE "id" = ? AND "project_id" = ? LIMIT 1`, [
    id,
    projectId,
  ]);
  return rows.length ? mapProjectUnit(rows[0]) : null;
}

export async function updateProjectUnit(repo: Repository, unit: ProjectUnit, invalidateWorkflow: boolean): Promise<void> {
  await repo.transaction(async (tx) => {
    const changes = await tx.db.run(
      'UPDATE "project_units" SET "parent_id" = ?, "title" = ?, "source_text" = ?, "word_count" = ?, "status" = ?, "position" = ?, "updated_at" = ? WHERE "id" = ? AND "project_id" = ?',
      [unit.parentId ?? "", unit.title, unit.sourceText, unit.wordCount, unit.status, unit.position, unit.updatedAt, unit.id, unit.projectId],
    );
    if (changes !== 1) throw recordNotFound;
    if (invalidateWorkflow) {
      await tx.db.run(
        'UPDATE "shot_artifacts" SET "status" = ?, "selected" = ?, "updated_at" = ? WHERE "project_id" = ? AND "unit_id" = ? AND "status" NOT IN (?, ?)',
        ["stale", false, unit.updatedAt, unit.projectId, unit.id, "failed", "stale"],
      );
      await invalidateUnitWorkflowTx(tx, unit.projectId, unit.id, "story", unit.updatedAt);
    }
    await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [unit.updatedAt, unit.projectId]);
  });
}

export async function deleteProjectUnit(repo: Repository, projectId: string, id: string): Promise<void> {
  await repo.transaction(async (tx) => {
    await tx.db.run('DELETE FROM "canvas_unit_links" WHERE "project_id" = ? AND "unit_id" = ?', [projectId, id]);
    const shotIds = 'SELECT "id" FROM "shots" WHERE "project_id" = ? AND "unit_id" = ?';
    await tx.db.run('DELETE FROM "production_task_links" WHERE "project_id" = ? AND "unit_id" = ?', [projectId, id]);
    await tx.db.run('DELETE FROM "shot_artifacts" WHERE "project_id" = ? AND "unit_id" = ?', [projectId, id]);
    await tx.db.run(`DELETE FROM "shot_revisions" WHERE "shot_id" IN (${shotIds})`, [projectId, id]);
    await tx.db.run(`DELETE FROM "shot_asset_references" WHERE "shot_id" IN (${shotIds})`, [projectId, id]);
    await tx.db.run('DELETE FROM "shots" WHERE "project_id" = ? AND "unit_id" = ?', [projectId, id]);
    const instanceIds = 'SELECT "id" FROM "workflow_instances" WHERE "project_id" = ? AND "unit_id" = ?';
    const stepIds = `SELECT "id" FROM "workflow_step_instances" WHERE "workflow_instance_id" IN (${instanceIds})`;
    await tx.db.run(`DELETE FROM "workflow_step_tasks" WHERE "workflow_step_id" IN (${stepIds})`, [projectId, id]);
    await tx.db.run(`DELETE FROM "workflow_step_instances" WHERE "workflow_instance_id" IN (${instanceIds})`, [projectId, id]);
    await tx.db.run('DELETE FROM "workflow_instances" WHERE "project_id" = ? AND "unit_id" = ?', [projectId, id]);
    await tx.db.run('DELETE FROM "project_asset_candidates" WHERE "project_id" = ? AND "unit_id" = ?', [projectId, id]);
    const changes = await tx.db.run('DELETE FROM "project_units" WHERE "id" = ? AND "project_id" = ?', [id, projectId]);
    if (changes !== 1) throw recordNotFound;
    await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [new Date().toISOString(), projectId]);
  });
}

export async function canvasUnitLink(repo: Repository, projectId: string, canvasId: string, unitId: string): Promise<CanvasUnitLink | null> {
  const rows = await repo.db.all<CanvasUnitLinkRow>(
    `SELECT ${canvasUnitLinkColumns} FROM "canvas_unit_links" WHERE "project_id" = ? AND "canvas_id" = ? AND "unit_id" = ? LIMIT 1`,
    [projectId, canvasId, unitId],
  );
  return rows.length ? mapCanvasUnitLink(rows[0]) : null;
}

export async function upsertCanvasUnitLink(repo: Repository, link: CanvasUnitLink): Promise<void> {
  const changes = await repo.db.run('UPDATE "canvas_unit_links" SET "role" = ? WHERE "project_id" = ? AND "canvas_id" = ? AND "unit_id" = ?', [
    link.role,
    link.projectId,
    link.canvasId,
    link.unitId,
  ]);
  if (changes > 0) return;
  await repo.db.run(`INSERT INTO "canvas_unit_links" (${canvasUnitLinkColumns}) VALUES (${placeholders(6)})`, [
    link.id,
    link.projectId,
    link.canvasId,
    link.unitId,
    link.role,
    link.createdAt,
  ]);
}

export async function projectCanvasSummaries(repo: Repository, userId: string, projectId: string): Promise<CanvasProject[]> {
  const rows = await repo.db.all<{
    id: string;
    user_id: string;
    project_id: string | null;
    title: string;
    revision: number;
    created_at: string;
    updated_at: string;
  }>(
    'SELECT "id", "user_id", "project_id", "title", "revision", "created_at", "updated_at" FROM "canvas_projects" WHERE "user_id" = ? AND "project_id" = ? ORDER BY "updated_at" DESC',
    [userId, projectId],
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id ?? "",
    title: row.title,
    payloadJson: "",
    revision: Number(row.revision),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }));
}

export async function projectCanvasDocuments(repo: Repository, userId: string, projectId: string): Promise<CanvasProject[]> {
  const rows = await repo.db.all<{ id: string; title: string; payload_json: string; revision: number }>(
    'SELECT "id", "title", "payload_json", "revision" FROM "canvas_projects" WHERE "user_id" = ? AND "project_id" = ?',
    [userId, projectId],
  );
  return rows.map((row) => ({
    id: row.id,
    userId: "",
    projectId: "",
    title: row.title,
    payloadJson: row.payload_json,
    revision: Number(row.revision),
    createdAt: "",
    updatedAt: "",
  }));
}

export async function projectCanvasUnitLinks(repo: Repository, projectId: string): Promise<CanvasUnitLink[]> {
  const rows = await repo.db.all<CanvasUnitLinkRow>(
    `SELECT ${canvasUnitLinkColumns} FROM "canvas_unit_links" WHERE "project_id" = ? ORDER BY "created_at" ASC`,
    [projectId],
  );
  return rows.map(mapCanvasUnitLink);
}

export async function deleteCanvasUnitLink(repo: Repository, projectId: string, canvasId: string, unitId: string): Promise<void> {
  await repo.transaction(async (tx) => {
    const changes = await tx.db.run('DELETE FROM "canvas_unit_links" WHERE "project_id" = ? AND "canvas_id" = ? AND "unit_id" = ?', [
      projectId,
      canvasId,
      unitId,
    ]);
    if (changes !== 1) throw recordNotFound;
    await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [new Date().toISOString(), projectId]);
  });
}

export async function assignCanvasToProject(repo: Repository, userId: string, canvasId: string, projectId: string): Promise<void> {
  await repo.db.run('UPDATE "canvas_projects" SET "project_id" = ?, "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ? AND "user_id" = ?', [
    projectId,
    new Date().toISOString(),
    canvasId,
    userId,
  ]);
}

export async function unassignCanvasFromProject(
  repo: Repository,
  userId: string,
  projectId: string,
  canvasId: string,
  payloadJson: string,
  updatedAt: string,
  revision: number,
): Promise<void> {
  await repo.transaction(async (tx) => {
    await tx.db.run('DELETE FROM "canvas_unit_links" WHERE "project_id" = ? AND "canvas_id" = ?', [projectId, canvasId]);
    const changes = await tx.db.run(
      'UPDATE "canvas_projects" SET "project_id" = ?, "payload_json" = ?, "updated_at" = ?, "revision" = ? WHERE "id" = ? AND "user_id" = ? AND "project_id" = ? AND "revision" = ?',
      ["", payloadJson, updatedAt, revision + 1, canvasId, userId, projectId, revision],
    );
    if (changes !== 1) throw recordNotFound;
    await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [updatedAt, projectId]);
  });
}

export async function projectAssets(repo: Repository, userId: string, projectId: string): Promise<Asset[]> {
  const rows = await repo.db.all<AssetRow>(
    `SELECT ${assetColumns} FROM "assets" JOIN "project_asset_links" ON "project_asset_links"."asset_id" = "assets"."id" WHERE "assets"."user_id" = ? AND "project_asset_links"."project_id" = ? ORDER BY "assets"."updated_at" DESC`,
    [userId, projectId],
  );
  return rows.map(mapAsset);
}

export async function projectAssetLinks(repo: Repository, projectId: string): Promise<ProjectAssetLink[]> {
  const rows = await repo.db.all<ProjectAssetLinkRow>(
    `SELECT ${projectAssetLinkColumns} FROM "project_asset_links" WHERE "project_id" = ? ORDER BY "folder_id" ASC, "position" ASC, "created_at" ASC`,
    [projectId],
  );
  return rows.map(mapProjectAssetLink);
}

export async function projectAssetLink(repo: Repository, projectId: string, assetId: string): Promise<ProjectAssetLink | null> {
  const rows = await repo.db.all<ProjectAssetLinkRow>(
    `SELECT ${projectAssetLinkColumns} FROM "project_asset_links" WHERE "project_id" = ? AND "asset_id" = ? LIMIT 1`,
    [projectId, assetId],
  );
  return rows.length ? mapProjectAssetLink(rows[0]) : null;
}

export async function nextProjectAssetPosition(repo: Repository, projectId: string, folderId: string): Promise<number> {
  const rows = await repo.db.all<{ maximum: number }>(
    'SELECT COALESCE(MAX("position"), -1) AS "maximum" FROM "project_asset_links" WHERE "project_id" = ? AND "folder_id" = ?',
    [projectId, folderId],
  );
  return Number(rows[0]?.maximum ?? 0) + 1;
}

export async function moveProjectAsset(repo: Repository, projectId: string, assetId: string, folderId: string, position: number): Promise<void> {
  await repo.transaction(async (tx) => {
    const changes = await tx.db.run('UPDATE "project_asset_links" SET "folder_id" = ?, "position" = ? WHERE "project_id" = ? AND "asset_id" = ?', [
      folderId,
      position,
      projectId,
      assetId,
    ]);
    if (changes !== 1) throw recordNotFound;
    await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [new Date().toISOString(), projectId]);
  });
}

export async function projectAssetFolders(repo: Repository, projectId: string): Promise<ProjectAssetFolder[]> {
  const rows = await repo.db.all<ProjectAssetFolderRow>(
    `SELECT ${projectAssetFolderColumns} FROM "project_asset_folders" WHERE "project_id" = ? ORDER BY "parent_id" ASC, "position" ASC, "created_at" ASC`,
    [projectId],
  );
  return rows.map(mapProjectAssetFolder);
}

export async function projectAssetFolder(repo: Repository, projectId: string, folderId: string): Promise<ProjectAssetFolder | null> {
  const rows = await repo.db.all<ProjectAssetFolderRow>(
    `SELECT ${projectAssetFolderColumns} FROM "project_asset_folders" WHERE "id" = ? AND "project_id" = ? LIMIT 1`,
    [folderId, projectId],
  );
  return rows.length ? mapProjectAssetFolder(rows[0]) : null;
}

export async function createProjectAssetFolder(repo: Repository, folder: ProjectAssetFolder): Promise<void> {
  await repo.transaction(async (tx) => {
    await tx.db.run(`INSERT INTO "project_asset_folders" (${projectAssetFolderColumns}) VALUES (${placeholders(10)})`, [
      folder.id,
      folder.projectId,
      folder.parentId ?? "",
      folder.name,
      folder.nameKey ?? "",
      folder.style,
      folder.theme,
      folder.position,
      folder.createdAt,
      folder.updatedAt,
    ]);
    await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [folder.updatedAt, folder.projectId]);
  });
}

export async function updateProjectAssetFolder(repo: Repository, folder: ProjectAssetFolder): Promise<void> {
  await repo.transaction(async (tx) => {
    const changes = await tx.db.run(
      'UPDATE "project_asset_folders" SET "parent_id" = ?, "name" = ?, "name_key" = ?, "style" = ?, "theme" = ?, "position" = ?, "updated_at" = ? WHERE "id" = ? AND "project_id" = ?',
      [folder.parentId ?? "", folder.name, folder.nameKey ?? "", folder.style, folder.theme, folder.position, folder.updatedAt, folder.id, folder.projectId],
    );
    if (changes !== 1) throw recordNotFound;
    await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [folder.updatedAt, folder.projectId]);
  });
}

export async function deleteProjectAssetFolder(repo: Repository, projectId: string, folderId: string): Promise<void> {
  await repo.transaction(async (tx) => {
    const childRows = await tx.db.all<{ total: number }>(
      'SELECT COUNT(*) AS "total" FROM "project_asset_folders" WHERE "project_id" = ? AND "parent_id" = ?',
      [projectId, folderId],
    );
    const assetRows = await tx.db.all<{ total: number }>(
      'SELECT COUNT(*) AS "total" FROM "project_asset_links" WHERE "project_id" = ? AND "folder_id" = ?',
      [projectId, folderId],
    );
    if (Number(childRows[0]?.total ?? 0) > 0 || Number(assetRows[0]?.total ?? 0) > 0) throw errProjectAssetFolderNotEmpty;
    const changes = await tx.db.run('DELETE FROM "project_asset_folders" WHERE "id" = ? AND "project_id" = ?', [folderId, projectId]);
    if (changes !== 1) throw recordNotFound;
    await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [new Date().toISOString(), projectId]);
  });
}

// 将首版本、素材领域字段、项目引用和修订号原子提交，避免产生半关联资产。
export async function linkProjectAsset(
  repo: Repository,
  asset: Asset,
  version: AssetVersion | null,
  link: ProjectAssetLink,
): Promise<boolean> {
  let createdLink = false;
  await repo.transaction(async (tx) => {
    // 资产可能尚未落库（首次导入）或已存在（并发/重试），冲突幂等跳过。
    await tx.db.run(`INSERT INTO "assets" (${assetColumns}) VALUES (${placeholders(11)}) ON CONFLICT ("id") DO NOTHING`, [
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
    const created = await tx.db.run(
      `INSERT INTO "project_asset_links" (${projectAssetLinkColumns}) VALUES (${placeholders(6)}) ON CONFLICT ("project_id", "asset_id") DO NOTHING`,
      [link.id, link.projectId, link.assetId, link.folderId ?? "", link.position, link.createdAt],
    );
    if (created === 0) return;
    createdLink = true;
    if (version) {
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
    }
    const changes = await tx.db.run(
      'UPDATE "assets" SET "category" = ?, "status" = ?, "primary_version_id" = ?, "updated_at" = ? WHERE "id" = ? AND "user_id" = ?',
      [asset.category, asset.status, asset.primaryVersionId ?? "", asset.updatedAt, asset.id, asset.userId],
    );
    if (changes !== 1) throw recordNotFound;
    await tx.db.run('UPDATE "projects" SET "revision" = "revision" + 1, "updated_at" = ? WHERE "id" = ?', [new Date().toISOString(), link.projectId]);
  });
  return createdLink;
}

export async function deleteProjectAssetLink(repo: Repository, projectId: string, assetId: string): Promise<void> {
  await repo.db.run('DELETE FROM "project_asset_links" WHERE "project_id" = ? AND "asset_id" = ?', [projectId, assetId]);
}

export async function projectAssetShotReferenceCount(repo: Repository, projectId: string, assetId: string): Promise<number> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "shot_asset_references" JOIN "shots" ON "shots"."id" = "shot_asset_references"."shot_id" JOIN "asset_versions" ON "asset_versions"."id" = "shot_asset_references"."asset_version_id" WHERE "shots"."project_id" = ? AND "asset_versions"."asset_id" = ?',
    [projectId, assetId],
  );
  return Number(rows[0]?.total ?? 0);
}

export async function projectAssetLinked(repo: Repository, projectId: string, assetId: string): Promise<boolean> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "project_asset_links" WHERE "project_id" = ? AND "asset_id" = ?',
    [projectId, assetId],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

export async function assetReferenceCount(repo: Repository, assetId: string): Promise<number> {
  const projectRows = await repo.db.all<{ total: number }>('SELECT COUNT(*) AS "total" FROM "project_asset_links" WHERE "asset_id" = ?', [assetId]);
  const shotRows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "shot_asset_references" JOIN "asset_versions" ON "asset_versions"."id" = "shot_asset_references"."asset_version_id" WHERE "asset_versions"."asset_id" = ?',
    [assetId],
  );
  return Number(projectRows[0]?.total ?? 0) + Number(shotRows[0]?.total ?? 0);
}

export async function updateAssetDomain(repo: Repository, asset: Asset): Promise<void> {
  await repo.db.run(
    'UPDATE "assets" SET "category" = ?, "status" = ?, "primary_version_id" = ?, "updated_at" = ? WHERE "id" = ? AND "user_id" = ?',
    [asset.category, asset.status, asset.primaryVersionId ?? "", asset.updatedAt, asset.id, asset.userId],
  );
}

export async function assetVersions(repo: Repository, assetId: string): Promise<AssetVersion[]> {
  const rows = await repo.db.all<AssetVersionRow>(
    `SELECT ${assetVersionColumns} FROM "asset_versions" WHERE "asset_id" = ? ORDER BY "version" DESC`,
    [assetId],
  );
  return rows.map(mapAssetVersion);
}

export async function projectAssetUsageRoles(repo: Repository, projectId: string, assetId: string): Promise<string[]> {
  const shotRows = await repo.db.all<{ role: string }>(
    'SELECT DISTINCT "shot_asset_references"."role" FROM "shot_asset_references" JOIN "shots" ON "shots"."id" = "shot_asset_references"."shot_id" JOIN "asset_versions" ON "asset_versions"."id" = "shot_asset_references"."asset_version_id" WHERE "shots"."project_id" = ? AND "asset_versions"."asset_id" = ? ORDER BY "shot_asset_references"."role" ASC',
    [projectId, assetId],
  );
  const representationRows = await repo.db.all<{ role: string }>(
    'SELECT DISTINCT "asset_representations"."role" FROM "asset_representations" JOIN "asset_versions" ON "asset_versions"."id" = "asset_representations"."asset_version_id" JOIN "project_asset_links" ON "project_asset_links"."asset_id" = "asset_versions"."asset_id" WHERE "project_asset_links"."project_id" = ? AND "asset_versions"."asset_id" = ?',
    [projectId, assetId],
  );
  const seen = new Set<string>();
  for (const row of [...shotRows, ...representationRows]) {
    if (row.role !== "") seen.add(row.role);
  }
  return [...seen].sort();
}

export async function assetVersionForProject(repo: Repository, projectId: string, versionId: string): Promise<AssetVersion | null> {
  const rows = await repo.db.all<AssetVersionRow>(
    `SELECT ${assetVersionColumns} FROM "asset_versions" JOIN "project_asset_links" ON "project_asset_links"."asset_id" = "asset_versions"."asset_id" WHERE "project_asset_links"."project_id" = ? AND "asset_versions"."id" = ? LIMIT 1`,
    [projectId, versionId],
  );
  return rows.length ? mapAssetVersion(rows[0]) : null;
}

export async function createAssetVersion(repo: Repository, version: AssetVersion): Promise<void> {
  await repo.db.run(`INSERT INTO "asset_versions" (${assetVersionColumns}) VALUES (${placeholders(9)})`, [
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
}
