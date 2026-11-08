// 对应 backend/internal/repository/skill_packages.go
// 技能版本包写入与整行保存。

import type { Skill, SkillFile, SkillVersion, UserSkillState } from "@/internal/model/modelsPlatform";
import { Repository, toIso } from "./repository";
import { insertSkillRow, insertUserSkillState, mapSkillRow, saveSkillRow, skillColumns, type SkillRow } from "./skills";

const skillVersionColumns = `"id", "skill_id", "version_label", "content_hash", "entry_path", "package_key", "file_count", "total_bytes", "source_commit", "created_at"`;

const skillFileColumns = `"id", "skill_version_id", "path", "kind", "mime_type", "size", "sha256", "created_at"`;

interface SkillVersionRow {
  id: string;
  skill_id: string | null;
  version_label: string | null;
  content_hash: string | null;
  entry_path: string | null;
  package_key: string | null;
  file_count: number | null;
  total_bytes: number | null;
  source_commit: string | null;
  created_at: string | null;
}

interface SkillFileRow {
  id: string;
  skill_version_id: string | null;
  path: string | null;
  kind: string | null;
  mime_type: string | null;
  size: number | null;
  sha256: string | null;
  created_at: string | null;
}

function mapSkillVersion(row: SkillVersionRow): SkillVersion {
  return {
    id: row.id,
    skillId: row.skill_id ?? "",
    versionLabel: row.version_label ?? "",
    contentHash: row.content_hash ?? "",
    entryPath: row.entry_path ?? "",
    packageKey: row.package_key ?? "",
    fileCount: Number(row.file_count ?? 0),
    totalBytes: Number(row.total_bytes ?? 0),
    sourceCommit: row.source_commit ?? "",
    createdAt: toIso(row.created_at),
  };
}

function mapSkillFile(row: SkillFileRow): SkillFile {
  return {
    id: row.id,
    skillVersionId: row.skill_version_id ?? "",
    path: row.path ?? "",
    kind: row.kind ?? "",
    mimeType: row.mime_type ?? "",
    size: Number(row.size ?? 0),
    sha256: row.sha256 ?? "",
    createdAt: toIso(row.created_at),
  };
}

async function insertSkillVersion(repo: Repository, version: SkillVersion): Promise<void> {
  await repo.db.run(
    `INSERT INTO "skill_versions" (${skillVersionColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      version.id,
      version.skillId,
      version.versionLabel,
      version.contentHash,
      version.entryPath,
      version.packageKey,
      version.fileCount,
      version.totalBytes,
      version.sourceCommit,
      version.createdAt,
    ],
  );
}

async function insertSkillFile(repo: Repository, file: SkillFile): Promise<void> {
  await repo.db.run(
    `INSERT INTO "skill_files" (${skillFileColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [file.id, file.skillVersionId, file.path, file.kind, file.mimeType, file.size, file.sha256, file.createdAt],
  );
}

async function insertSkillFiles(repo: Repository, files: SkillFile[]): Promise<void> {
  for (const file of files) await insertSkillFile(repo, file);
}

export async function createSkillWithPackage(
  repo: Repository,
  skill: Skill,
  version: SkillVersion,
  files: SkillFile[],
  ownerState: UserSkillState,
): Promise<void> {
  await repo.transaction(async (tx) => {
    await insertSkillRow(tx, skill);
    await insertSkillVersion(tx, version);
    if (files.length > 0) await insertSkillFiles(tx, files);
    await insertUserSkillState(tx, ownerState);
  });
}

export async function addSkillVersion(
  repo: Repository,
  skill: Skill,
  version: SkillVersion,
  files: SkillFile[],
): Promise<void> {
  await repo.transaction(async (tx) => {
    await insertSkillVersion(tx, version);
    if (files.length > 0) await insertSkillFiles(tx, files);
    await saveSkillRow(tx, skill);
  });
}

// AddSkillVersionIfCurrent 以 current_version_id 做乐观锁：只有技能当前版本仍是 baseVersionId 时
// 才写入新版本、文件清单和技能行；返回 false 表示已被并发修改，事务内不做任何写入。
export async function addSkillVersionIfCurrent(
  repo: Repository,
  skill: Skill,
  version: SkillVersion,
  files: SkillFile[],
  baseVersionId: string,
): Promise<boolean> {
  let applied = false;
  await repo.transaction(async (tx) => {
    const affected = await tx.db.run(
      'UPDATE "skills" SET "current_version_id" = ?, "updated_at" = ? WHERE "id" = ? AND "current_version_id" = ?',
      [version.id, new Date().toISOString(), skill.id, baseVersionId],
    );
    if (affected === 0) return;
    await insertSkillVersion(tx, version);
    if (files.length > 0) await insertSkillFiles(tx, files);
    await saveSkillRow(tx, skill);
    applied = true;
  });
  return applied;
}

export async function skillVersion(repo: Repository, id: string): Promise<SkillVersion | null> {
  const rows = await repo.db.all<SkillVersionRow>(
    `SELECT ${skillVersionColumns} FROM "skill_versions" WHERE "id" = ? LIMIT 1`,
    [id],
  );
  return rows.length ? mapSkillVersion(rows[0]) : null;
}

export async function skillFiles(repo: Repository, versionId: string): Promise<SkillFile[]> {
  const rows = await repo.db.all<SkillFileRow>(
    `SELECT ${skillFileColumns} FROM "skill_files" WHERE "skill_version_id" = ? ORDER BY "path" asc`,
    [versionId],
  );
  return rows.map(mapSkillFile);
}

export async function skillsForPackageEnsure(repo: Repository): Promise<Skill[]> {
  const rows = await repo.db.all<SkillRow>(`SELECT ${skillColumns} FROM "skills" WHERE "status" = ?`, [1]);
  return rows.map(mapSkillRow);
}

export async function autoUpdatingGitHubSkills(repo: Repository): Promise<Skill[]> {
  const rows = await repo.db.all<SkillRow>(
    `SELECT ${skillColumns} FROM "skills" WHERE "status" = ? AND "source_type" = ? AND "auto_update" = ?`,
    [1, "github", true],
  );
  return rows.map(mapSkillRow);
}

export async function saveSkill(repo: Repository, skill: Skill): Promise<void> {
  await saveSkillRow(repo, skill);
}
