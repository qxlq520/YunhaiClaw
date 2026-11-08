// 对应 backend/internal/repository/repository_prompts_shares.go
// 画布分享与提示词模板。

import type {
  CanvasShare,
  PromptTemplate,
  UserPromptCustomization,
} from "@/internal/model/modelsProject";
import { Repository, toBool, toIso, toNullableIso } from "./repository";

interface CanvasShareRow {
  id: string;
  user_id: string;
  project_id: string;
  token_hash: string | null;
  token_cipher: string | null;
  enabled: unknown;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapCanvasShare(row: CanvasShareRow): CanvasShare {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    tokenHash: row.token_hash ?? "",
    tokenCipher: row.token_cipher ?? "",
    enabled: toBool(row.enabled),
    expiresAt: toNullableIso(row.expires_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const canvasShareColumns =
  '"id", "user_id", "project_id", "token_hash", "token_cipher", "enabled", "expires_at", "created_at", "updated_at"';

export async function canvasShareForProject(
  repo: Repository,
  userId: string,
  projectId: string,
): Promise<CanvasShare | null> {
  const rows = await repo.db.all<CanvasShareRow>(
    `SELECT ${canvasShareColumns} FROM "canvas_shares" WHERE "user_id" = ? AND "project_id" = ? LIMIT 1`,
    [userId, projectId],
  );
  return rows.length ? mapCanvasShare(rows[0]) : null;
}

export async function canvasShareByTokenHash(
  repo: Repository,
  tokenHash: string,
): Promise<CanvasShare | null> {
  const rows = await repo.db.all<CanvasShareRow>(
    `SELECT ${canvasShareColumns} FROM "canvas_shares" WHERE "token_hash" = ? AND "enabled" = ? LIMIT 1`,
    [tokenHash, true],
  );
  return rows.length ? mapCanvasShare(rows[0]) : null;
}

export async function deleteCanvasShare(
  repo: Repository,
  userId: string,
  projectId: string,
): Promise<void> {
  await repo.db.run('DELETE FROM "canvas_shares" WHERE "user_id" = ? AND "project_id" = ?', [userId, projectId]);
}

interface PromptTemplateRow {
  id: string;
  operation: string;
  name: string;
  version: number;
  content: string;
  output_type: string;
  enabled: unknown;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function mapPromptTemplate(row: PromptTemplateRow): PromptTemplate {
  return {
    id: row.id,
    operation: row.operation,
    name: row.name,
    version: Number(row.version ?? 0),
    content: row.content,
    outputType: row.output_type,
    enabled: toBool(row.enabled),
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const promptTemplateColumns =
  '"id", "operation", "name", "version", "content", "output_type", "enabled", "created_by", "created_at", "updated_at"';

export async function promptTemplates(repo: Repository): Promise<PromptTemplate[]> {
  const rows = await repo.db.all<PromptTemplateRow>(
    `SELECT ${promptTemplateColumns} FROM "prompt_templates" ORDER BY "operation" ASC, "version" DESC`,
  );
  return rows.map(mapPromptTemplate);
}

export async function promptTemplate(repo: Repository, id: string): Promise<PromptTemplate | null> {
  const rows = await repo.db.all<PromptTemplateRow>(
    `SELECT ${promptTemplateColumns} FROM "prompt_templates" WHERE "id" = ? LIMIT 1`,
    [id],
  );
  return rows.length ? mapPromptTemplate(rows[0]) : null;
}

export async function activePromptTemplate(
  repo: Repository,
  operation: string,
): Promise<PromptTemplate | null> {
  const rows = await repo.db.all<PromptTemplateRow>(
    `SELECT ${promptTemplateColumns} FROM "prompt_templates" WHERE "operation" = ? AND "enabled" = ? ORDER BY "version" DESC LIMIT 1`,
    [operation, true],
  );
  return rows.length ? mapPromptTemplate(rows[0]) : null;
}

export async function promptTemplateCount(repo: Repository, operation: string): Promise<number> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "prompt_templates" WHERE "operation" = ?',
    [operation],
  );
  return Number(rows[0]?.total ?? 0);
}

export async function nextPromptTemplateVersion(repo: Repository, operation: string): Promise<number> {
  const rows = await repo.db.all<{ version: number }>(
    'SELECT COALESCE(MAX("version"), 0) AS "version" FROM "prompt_templates" WHERE "operation" = ?',
    [operation],
  );
  return Number(rows[0]?.version ?? 0) + 1;
}

function promptTemplateValues(template: PromptTemplate): (string | number | boolean)[] {
  return [
    template.id,
    template.operation,
    template.name,
    template.version,
    template.content,
    template.outputType,
    template.enabled,
    template.createdBy,
    template.createdAt,
    template.updatedAt,
  ];
}

async function savePromptTemplateRow(repo: Repository, template: PromptTemplate): Promise<void> {
  const changes = await repo.db.run(
    'UPDATE "prompt_templates" SET "operation" = ?, "name" = ?, "version" = ?, "content" = ?, "output_type" = ?, "enabled" = ?, "created_by" = ?, "created_at" = ?, "updated_at" = ? WHERE "id" = ?',
    [
      template.operation,
      template.name,
      template.version,
      template.content,
      template.outputType,
      template.enabled,
      template.createdBy,
      template.createdAt,
      template.updatedAt,
      template.id,
    ],
  );
  if (changes > 0) return;
  await repo.db.run(
    `INSERT INTO "prompt_templates" (${promptTemplateColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    promptTemplateValues(template),
  );
}

export async function savePromptTemplate(repo: Repository, template: PromptTemplate): Promise<void> {
  await repo.transaction(async (tx) => {
    if (template.enabled) {
      await tx.db.run('UPDATE "prompt_templates" SET "enabled" = ? WHERE "operation" = ? AND "id" <> ?', [
        false,
        template.operation,
        template.id,
      ]);
    }
    await savePromptTemplateRow(tx, template);
  });
}

export async function deletePromptTemplate(repo: Repository, id: string): Promise<void> {
  await repo.db.run('DELETE FROM "prompt_templates" WHERE "id" = ?', [id]);
}

interface UserPromptCustomizationRow {
  id: string;
  user_id: string;
  operation: string;
  mode: string;
  content: string;
  base_template_id: string;
  created_at: string;
  updated_at: string;
}

function mapUserPromptCustomization(row: UserPromptCustomizationRow): UserPromptCustomization {
  return {
    id: row.id,
    userId: row.user_id,
    operation: row.operation,
    mode: row.mode,
    content: row.content,
    baseTemplateId: row.base_template_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const userPromptCustomizationColumns =
  '"id", "user_id", "operation", "mode", "content", "base_template_id", "created_at", "updated_at"';

export async function userPromptCustomizations(
  repo: Repository,
  userId: string,
): Promise<UserPromptCustomization[]> {
  const rows = await repo.db.all<UserPromptCustomizationRow>(
    `SELECT ${userPromptCustomizationColumns} FROM "user_prompt_customizations" WHERE "user_id" = ? ORDER BY "operation" ASC`,
    [userId],
  );
  return rows.map(mapUserPromptCustomization);
}

export async function userPromptCustomization(
  repo: Repository,
  userId: string,
  operation: string,
): Promise<UserPromptCustomization | null> {
  const rows = await repo.db.all<UserPromptCustomizationRow>(
    `SELECT ${userPromptCustomizationColumns} FROM "user_prompt_customizations" WHERE "user_id" = ? AND "operation" = ? LIMIT 1`,
    [userId, operation],
  );
  return rows.length ? mapUserPromptCustomization(rows[0]) : null;
}

function userPromptCustomizationValues(
  customization: UserPromptCustomization,
): (string | number | boolean)[] {
  return [
    customization.id,
    customization.userId,
    customization.operation,
    customization.mode,
    customization.content,
    customization.baseTemplateId,
    customization.createdAt,
    customization.updatedAt,
  ];
}

export async function saveUserPromptCustomization(
  repo: Repository,
  customization: UserPromptCustomization,
): Promise<void> {
  const changes = await repo.db.run(
    'UPDATE "user_prompt_customizations" SET "user_id" = ?, "operation" = ?, "mode" = ?, "content" = ?, "base_template_id" = ?, "created_at" = ?, "updated_at" = ? WHERE "id" = ?',
    [
      customization.userId,
      customization.operation,
      customization.mode,
      customization.content,
      customization.baseTemplateId,
      customization.createdAt,
      customization.updatedAt,
      customization.id,
    ],
  );
  if (changes > 0) return;
  await repo.db.run(
    `INSERT INTO "user_prompt_customizations" (${userPromptCustomizationColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    userPromptCustomizationValues(customization),
  );
}

export async function deleteUserPromptCustomization(
  repo: Repository,
  userId: string,
  operation: string,
): Promise<void> {
  await repo.db.run('DELETE FROM "user_prompt_customizations" WHERE "user_id" = ? AND "operation" = ?', [
    userId,
    operation,
  ]);
}
