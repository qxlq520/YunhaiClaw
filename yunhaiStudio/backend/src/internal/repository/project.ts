import type { CanvasProject } from "@/internal/model/modelsProject";
import { Repository, toIso } from "./repository";

interface ProjectRow {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  payload_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

function mapProject(row: ProjectRow): CanvasProject {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id ?? "",
    title: row.title,
    payloadJson: row.payload_json,
    revision: Number(row.revision),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const projectColumns = '"id", "user_id", "project_id", "title", "payload_json", "revision", "created_at", "updated_at"';

export async function listCanvasProjects(repo: Repository, userId: string): Promise<CanvasProject[]> {
  const rows = await repo.db.all<ProjectRow>(
    `SELECT ${projectColumns} FROM "canvas_projects" WHERE "user_id" = ? ORDER BY "updated_at" DESC`,
    [userId],
  );
  return rows.map(mapProject);
}

export async function canvasProject(repo: Repository, userId: string, id: string): Promise<CanvasProject | null> {
  const rows = await repo.db.all<ProjectRow>(
    `SELECT ${projectColumns} FROM "canvas_projects" WHERE "id" = ? AND "user_id" = ? LIMIT 1`,
    [id, userId],
  );
  return rows.length ? mapProject(rows[0]) : null;
}

export async function saveCanvasProject(repo: Repository, project: CanvasProject): Promise<void> {
  const existing = await canvasProject(repo, project.userId, project.id);
  if (existing) {
    await repo.db.run(
      'UPDATE "canvas_projects" SET "project_id" = ?, "title" = ?, "payload_json" = ?, "revision" = ?, "updated_at" = ? WHERE "id" = ? AND "user_id" = ?',
      [project.projectId ?? "", project.title, project.payloadJson, project.revision, project.updatedAt, project.id, project.userId],
    );
    return;
  }
  await repo.db.run(
    `INSERT INTO "canvas_projects" (${projectColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      project.id,
      project.userId,
      project.projectId ?? "",
      project.title,
      project.payloadJson,
      project.revision,
      project.createdAt,
      project.updatedAt,
    ],
  );
}

export async function deleteCanvasProject(repo: Repository, userId: string, id: string): Promise<boolean> {
  const changes = await repo.db.run('DELETE FROM "canvas_projects" WHERE "id" = ? AND "user_id" = ?', [id, userId]);
  return changes > 0;
}
