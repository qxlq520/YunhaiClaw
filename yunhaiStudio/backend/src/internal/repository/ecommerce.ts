// 对应 backend/internal/repository/ecommerce.go
// 电商项目、定向任务回执与版本化保存。

import type { Task } from "@/internal/model/modelsTask";
import type { EcommerceProject } from "@/internal/model/modelsEcommerce";
import { recordNotFound, Repository, toIso } from "./repository";
import { mapTask, type TaskRow } from "./repositoryTasks";

export const errEcommerceProjectSelectionChanged = new Error("ecommerce project selection changed");

interface EcommerceProjectRow {
  id: string;
  user_id: string;
  name: string;
  status: string;
  draft_json: string;
  plan_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

function mapEcommerceProject(row: EcommerceProjectRow): EcommerceProject {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    status: row.status,
    draftJson: row.draft_json,
    planJson: row.plan_json,
    revision: Number(row.revision),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const ecommerceProjectColumns =
  '"id", "user_id", "name", "status", "draft_json", "plan_json", "revision", "created_at", "updated_at"';

function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}

// Recover the durable receipt even if the browser left before saving the task ID.
// 定向任务总是在项目创建之后写入，created_at 下界让数据库先跳过更早的任务。
export async function ecommerceDirectionsTask(
  repo: Repository,
  userId: string,
  projectId: string,
  since: string,
): Promise<Task | null> {
  const conditions = ['"user_id" = ?', '"type" = ?'];
  const values: (string | number)[] = [userId, "canvas_text"];
  if (since !== "") {
    const sinceTime = new Date(since);
    if (!Number.isNaN(sinceTime.getTime())) {
      conditions.push('"created_at" >= ?');
      values.push(new Date(sinceTime.getTime() - 60 * 1000).toISOString());
    }
  }
  conditions.push('"input_json" LIKE ?', '"input_json" LIKE ?');
  values.push('%"stage":"creative-directions"%', `%"ecommerceProjectId":"${projectId}"%`);
  const rows = await repo.db.all<TaskRow>(
    `SELECT * FROM "tasks" WHERE ${conditions.join(" AND ")} ORDER BY "created_at" DESC, "id" DESC LIMIT 10`,
    values,
  );
  for (const row of rows) {
    let input: {
      metadata?: { ecommerceProjectId?: string; stage?: string; source?: string };
    };
    try {
      input = JSON.parse(row.input_json ?? "");
    } catch {
      continue;
    }
    const metadata = input?.metadata;
    if (
      metadata?.ecommerceProjectId === projectId &&
      metadata?.stage === "creative-directions" &&
      metadata?.source === "ecommerce-agent"
    ) {
      return mapTask(row);
    }
  }
  return null;
}

export async function createEcommerceProject(repo: Repository, project: EcommerceProject): Promise<void> {
  await repo.db.run(
    `INSERT INTO "ecommerce_projects" (${ecommerceProjectColumns}) VALUES (${placeholders(9)})`,
    [
      project.id,
      project.userId,
      project.name,
      project.status,
      project.draftJson,
      project.planJson,
      project.revision,
      project.createdAt,
      project.updatedAt,
    ],
  );
}

export async function ecommerceProject(repo: Repository, userId: string, id: string): Promise<EcommerceProject | null> {
  const rows = await repo.db.all<EcommerceProjectRow>(
    `SELECT ${ecommerceProjectColumns} FROM "ecommerce_projects" WHERE "user_id" = ? AND "id" = ? LIMIT 1`,
    [userId, id],
  );
  return rows.length ? mapEcommerceProject(rows[0]) : null;
}

export async function ecommerceProjects(repo: Repository, userId: string): Promise<EcommerceProject[]> {
  const result = await ecommerceProjectPage(repo, userId, 1, 100);
  return result.projects;
}

export async function ecommerceProjectPage(
  repo: Repository,
  userId: string,
  page: number,
  pageSize: number,
): Promise<{ projects: EcommerceProject[]; total: number }> {
  const totals = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "ecommerce_projects" WHERE "user_id" = ?',
    [userId],
  );
  const rows = await repo.db.all<EcommerceProjectRow>(
    `SELECT ${ecommerceProjectColumns} FROM "ecommerce_projects" WHERE "user_id" = ? ORDER BY "updated_at" DESC, "id" DESC LIMIT ? OFFSET ?`,
    [userId, pageSize, (page - 1) * pageSize],
  );
  return { projects: rows.map(mapEcommerceProject), total: Number(totals[0]?.total ?? 0) };
}

// 只删除项目记录；被引用的资源和生成任务有各自的生命周期。
export async function deleteEcommerceProjects(
  repo: Repository,
  userId: string,
  ids: string[],
  all: boolean,
  expectedTotal: number,
): Promise<number> {
  if (!all && ids.length === 0) {
    if (expectedTotal !== 0) throw errEcommerceProjectSelectionChanged;
    return 0;
  }
  return repo.transaction(async (tx) => {
    const conditions = ['"user_id" = ?'];
    const values: (string | number)[] = [userId];
    if (!all) {
      conditions.push(`"id" IN (${placeholders(ids.length)})`);
      values.push(...ids);
    }
    const matched = await tx.db.all<{ id: string }>(
      `SELECT "id" FROM "ecommerce_projects" WHERE ${conditions.join(" AND ")}`,
      values,
    );
    const matchedIds = matched.map((row) => row.id);
    if (matchedIds.length !== expectedTotal) throw errEcommerceProjectSelectionChanged;
    if (matchedIds.length === 0) return 0;
    const deleted = await tx.db.run(
      `DELETE FROM "ecommerce_projects" WHERE "user_id" = ? AND "id" IN (${placeholders(matchedIds.length)})`,
      [userId, ...matchedIds],
    );
    if (deleted !== expectedTotal) throw errEcommerceProjectSelectionChanged;
    return deleted;
  });
}

export async function saveEcommerceProject(
  repo: Repository,
  project: EcommerceProject,
  expectedRevision: number,
): Promise<void> {
  const changes = await repo.db.run(
    'UPDATE "ecommerce_projects" SET "name" = ?, "status" = ?, "draft_json" = ?, "plan_json" = ?, "revision" = ?, "updated_at" = ? WHERE "id" = ? AND "user_id" = ? AND "revision" = ?',
    [
      project.name,
      project.status,
      project.draftJson,
      project.planJson,
      expectedRevision + 1,
      new Date().toISOString(),
      project.id,
      project.userId,
      expectedRevision,
    ],
  );
  if (changes !== 1) throw recordNotFound;
  project.revision = expectedRevision + 1;
}
