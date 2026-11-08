import type { Task } from "@/internal/model/modelsTask";
import type { TaskStatus } from "@/internal/model/models";
import { Repository } from "./repository";

const booleanColumns = new Set(["agent_execution_ready", "can_recover_media"]);

function camelize(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_match, character: string) => character.toUpperCase());
}

function mapRow(row: Record<string, unknown>): Task {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (booleanColumns.has(key)) result[camelize(key)] = value === 1 || value === true || value === "1";
    else result[camelize(key)] = value;
  }
  return result as unknown as Task;
}

export interface TaskQuery {
  projectId?: string;
  status?: TaskStatus;
  limit?: number;
}

export async function listTasks(repo: Repository, userId: string, query: TaskQuery = {}): Promise<Task[]> {
  const conditions = ['"user_id" = ?'];
  const params: (string | number)[] = [userId];
  if (query.projectId) {
    conditions.push('"project_id" = ?');
    params.push(query.projectId);
  }
  if (query.status) {
    conditions.push('"status" = ?');
    params.push(query.status);
  }
  params.push(Math.min(Math.max(query.limit ?? 100, 1), 500));
  const rows = await repo.db.all<Record<string, unknown>>(
    `SELECT * FROM "tasks" WHERE ${conditions.join(" AND ")} ORDER BY COALESCE("created_at_epoch", 0) DESC LIMIT ?`,
    params,
  );
  return rows.map(mapRow);
}

export async function taskById(repo: Repository, userId: string, id: string): Promise<Task | null> {
  const rows = await repo.db.all<Record<string, unknown>>('SELECT * FROM "tasks" WHERE "id" = ? AND "user_id" = ? LIMIT 1', [id, userId]);
  return rows.length ? mapRow(rows[0]) : null;
}

export async function deleteTask(repo: Repository, userId: string, id: string): Promise<boolean> {
  const changes = await repo.db.run('DELETE FROM "tasks" WHERE "id" = ? AND "user_id" = ?', [id, userId]);
  return changes > 0;
}
