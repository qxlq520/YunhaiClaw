// 对应 backend/internal/repository/cloud_agent_canvas.go
// 画布级 Agent 互斥：根任务在检查点出现前就预留画布。

import type { Task } from "@/internal/model/modelsTask";
import { canvasProjectMetadata } from "./canvasHistory";
import { lockCanvasMutation } from "./canvasMutationReceipts";
import { recordNotFound, Repository, toBool } from "./repository";

export const errCanvasAgentBusy = new Error("当前画布已有 Agent 正在执行，请等待结束后再发送");

export interface CanvasAgentActivity {
  runId: string;
  status: string;
  cleanupPending: boolean;
}

// 保留准入事务当时的观察结果：事后再读可能看到另一次运行或释放，
// 无法解释这次请求为何被拒绝。
export class CanvasAgentBusyError extends Error {
  readonly activity: CanvasAgentActivity;

  constructor(activity: CanvasAgentActivity) {
    super(errCanvasAgentBusy.message);
    this.name = "CanvasAgentBusyError";
    this.cause = errCanvasAgentBusy;
    this.activity = activity;
  }
}

// 把已有检查点的执行与尚未落检查点的预留拆成两个分支，各自命中部分索引，
// 而不是连接所有已完成的历史运行。谓词保持字面量以匹配索引。
const canvasAgentActivitySQL = `
SELECT "run_id", "status", "cleanup_pending" FROM (
    SELECT t."id" AS "run_id", COALESCE(e."status", 'queued') AS "status", COALESCE(e."cleanup_pending", false) AS "cleanup_pending", t."created_at"
    FROM "cloud_agent_executions" e
    JOIN "tasks" t ON t."id" = e."id" AND t."user_id" = e."user_id"
    WHERE e."user_id" = ? AND t."project_id" = ? AND t."operation" = 'cloud_agent'
      AND (e."status" NOT IN ('completed', 'failed', 'cancelled', 'rejected') OR e."cleanup_pending" = true)
    UNION ALL
    SELECT t."id" AS "run_id", 'queued' AS "status", false AS "cleanup_pending", t."created_at"
    FROM "tasks" t
    WHERE t."user_id" = ? AND t."project_id" = ? AND t."operation" = 'cloud_agent'
      AND t."agent_execution_ready" = false
      AND t."status" NOT IN ('succeeded', 'failed', 'cancelled')
      AND NOT EXISTS (SELECT 1 FROM "cloud_agent_executions" e WHERE e."id" = t."id" AND e."user_id" = t."user_id")
) AS activity
ORDER BY "created_at" ASC, "run_id" ASC LIMIT 1`;

interface CanvasAgentActivityRow {
  run_id: string;
  status: string | null;
  cleanup_pending: unknown;
}

// 根任务在检查点存在前就预留画布；一旦出现，执行行（含清理）具有权威性。
// 只读控制字段，轮询不载入 transcript 或完整画布负载。
export async function canvasAgentActivity(repo: Repository, userId: string, canvasId: string): Promise<CanvasAgentActivity | null> {
  const rows = await repo.db.all<CanvasAgentActivityRow>(canvasAgentActivitySQL, [userId, canvasId, userId, canvasId]);
  if (!rows.length) return null;
  const row = rows[0];
  return { runId: row.run_id, status: row.status ?? "", cleanupPending: toBool(row.cleanup_pending) };
}

// 必须在任务创建事务中最先执行，早于读取与积分写入。
// 画布行在跨进程、跨浏览器上串行化准入。
export async function requireExclusiveCanvasAgent(repo: Repository, task: Task): Promise<void> {
  // 未绑定画布的平台级对话不占画布，也不需要画布行锁。
  if (task.operation !== "cloud_agent" || task.projectId === "") return;
  await lockCanvasMutation(repo, task.userId, task.projectId);
  if ((await canvasProjectMetadata(repo, task.userId, task.projectId)) === null) throw recordNotFound;
  const activity = await canvasAgentActivity(repo, task.userId, task.projectId);
  if (activity !== null && activity.runId !== task.id) throw new CanvasAgentBusyError(activity);
}
