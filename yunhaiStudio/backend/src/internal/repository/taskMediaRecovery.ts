// 对应 backend/internal/repository/task_media_recovery.go
// 任务作品保存检查点：生成结果已上传但素材落库失败时，任务凭加密检查点可被重新入队恢复。

import { taskStatusFailed, taskStatusQueued, taskStatusRunning } from "@/internal/model/models";
import type { Task } from "@/internal/model/modelsTask";
import { Repository } from "./repository";
import { errTaskStateConflict, mapTask, taskLeaseWriter, type TaskRow } from "./repositoryTasks";

export async function saveTaskMediaCheckpoint(repo: Repository, taskItem: Task, encrypted: string, stage: string): Promise<void> {
  const now = new Date().toISOString();
  const lease = taskLeaseWriter(taskItem.leaseOwner ?? "", now);
  const changes = await repo.db.run(
    `UPDATE "tasks" SET "media_recovery_json" = ?, "media_stage" = ?, "stage" = ?, "updated_at" = ? WHERE "id" = ? AND "user_id" = ? AND "status" = ? AND "route_run" = ? AND ${lease.condition}`,
    [encrypted, stage, "作品已生成，正在保存", now, taskItem.id, taskItem.userId, taskStatusRunning, taskItem.routeRun ?? 0, ...lease.values],
  );
  if (changes !== 1) throw errTaskStateConflict;
  taskItem.mediaRecoveryJson = encrypted;
  taskItem.mediaStage = stage;
}

// 只有仍持有同一检查点的执行者可以重新入队，避免旧恢复流程覆盖新的保存进度。
export async function requeueTaskMediaRecovery(repo: Repository, taskItem: Task, encrypted: string): Promise<void> {
  const now = new Date().toISOString();
  const changes = await repo.db.run(
    'UPDATE "tasks" SET "status" = ?, "stage" = ?, "error" = ?, "completed_at" = NULL, "next_poll_at" = NULL, "lease_owner" = ?, "lease_expires_at" = NULL, "media_recovery_json" = ?, "updated_at" = ? WHERE "id" = ? AND "user_id" = ? AND "status" = ? AND "media_recovery_json" = ? AND ("lease_expires_at" IS NULL OR "lease_expires_at" <= ?)',
    [
      taskStatusQueued,
      "等待恢复作品保存",
      "",
      "",
      encrypted,
      now,
      taskItem.id,
      taskItem.userId,
      taskStatusFailed,
      taskItem.mediaRecoveryJson ?? "",
      now,
    ],
  );
  if (changes !== 1) throw errTaskStateConflict;
}

export async function tasksWithPendingMediaCheckpoint(
  repo: Repository,
  updatedSince: string,
  afterId: string,
  limit: number,
): Promise<Task[]> {
  const effectiveLimit = limit <= 0 || limit > 1000 ? 500 : limit;
  const conditions = [
    'COALESCE("media_recovery_json", \'\') <> \'\'',
    '"status" IN (?, ?, ?)',
    '"updated_at" >= ?',
  ];
  const values: (string | number)[] = [taskStatusQueued, taskStatusRunning, taskStatusFailed, updatedSince];
  if (afterId !== "") {
    conditions.push('"id" > ?');
    values.push(afterId);
  }
  const rows = await repo.db.all<TaskRow>(
    `SELECT "id", "user_id", "media_recovery_json" FROM "tasks" WHERE ${conditions.join(" AND ")} ORDER BY "id" ASC LIMIT ?`,
    [...values, effectiveLimit],
  );
  return rows.map(mapTask);
}
