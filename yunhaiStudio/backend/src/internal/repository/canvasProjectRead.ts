import type { CanvasProject } from "@/internal/model/modelsProject";
import { Repository, toIso } from "./repository";

interface CanvasProjectRow {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

function mapProject(row: CanvasProjectRow): CanvasProject {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id ?? "",
    title: row.title,
    payloadJson: "",
    revision: Number(row.revision),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

// 只读取校验缓存画布所需的字段，ETag 命中时避免加载大体积 JSON。
export async function canvasProjectMetadataForUser(repo: Repository, userId: string, id: string): Promise<CanvasProject | null> {
  const rows = await repo.db.all<CanvasProjectRow>(
    'SELECT "id", "user_id", "project_id", "title", "revision", "created_at", "updated_at" FROM "canvas_projects" WHERE "id" = ? AND "user_id" = ? LIMIT 1',
    [id, userId],
  );
  return rows.length ? mapProject(rows[0]) : null;
}
