import type { CanvasMutationReceipt } from "@/internal/model/modelsCanvasSync";
import { Repository, toIso } from "./repository";

interface CanvasMutationReceiptRow {
  id: string;
  user_id: string;
  canvas_id: string;
  mutation_id: string;
  payload_digest: string;
  result_json: string;
  revision: number;
  created_at: string;
}

function mapReceipt(row: CanvasMutationReceiptRow): CanvasMutationReceipt {
  return {
    id: row.id,
    userId: row.user_id,
    canvasId: row.canvas_id,
    mutationId: row.mutation_id,
    payloadDigest: row.payload_digest,
    resultJson: row.result_json ?? "",
    revision: Number(row.revision),
    createdAt: toIso(row.created_at),
  };
}

const receiptColumns = '"id", "user_id", "canvas_id", "mutation_id", "payload_digest", "result_json", "revision", "created_at"';

// 序列化已有画布上的全部操作（含删除）。SQLite 下首次写也能避免延迟读事务把
// 过期快照升级为写锁。
export async function lockCanvasMutation(repo: Repository, userId: string, canvasId: string): Promise<void> {
  await repo.db.run('UPDATE "canvas_projects" SET "revision" = "revision" WHERE "id" = ? AND "user_id" = ?', [canvasId, userId]);
}

export async function canvasMutationReceiptForUser(
  repo: Repository,
  userId: string,
  canvasId: string,
  mutationId: string,
): Promise<CanvasMutationReceipt | null> {
  const rows = await repo.db.all<CanvasMutationReceiptRow>(
    `SELECT ${receiptColumns} FROM "canvas_mutation_receipts" WHERE "user_id" = ? AND "canvas_id" = ? AND "mutation_id" = ? LIMIT 1`,
    [userId, canvasId, mutationId],
  );
  return rows.length ? mapReceipt(rows[0]) : null;
}

export async function tryCreateCanvasMutationReceipt(repo: Repository, receipt: CanvasMutationReceipt): Promise<boolean> {
  if (!receipt.createdAt) receipt.createdAt = new Date().toISOString();
  const changes = await repo.db.run(
    `INSERT INTO "canvas_mutation_receipts" (${receiptColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT ("user_id", "canvas_id", "mutation_id") DO NOTHING`,
    [
      receipt.id,
      receipt.userId,
      receipt.canvasId,
      receipt.mutationId,
      receipt.payloadDigest,
      receipt.resultJson ?? "",
      receipt.revision,
      receipt.createdAt,
    ],
  );
  return changes === 1;
}

export async function finalizeCanvasMutationReceipt(repo: Repository, receipt: CanvasMutationReceipt): Promise<void> {
  if (!receipt.resultJson) throw new Error("canvas mutation receipt requires a committed result");
  const changes = await repo.db.run(
    'UPDATE "canvas_mutation_receipts" SET "result_json" = ?, "revision" = ? WHERE "id" = ? AND "payload_digest" = ?',
    [receipt.resultJson, receipt.revision, receipt.id, receipt.payloadDigest],
  );
  if (changes !== 1) throw new Error("canvas mutation receipt was not finalized");
}

// 分批删除过期回执，每批独立提交，避免首次清理积压数据时长时间持有锁。
// 回执只服务于响应丢失后的短期重放；过期后重放的请求按字段/对象基线校验。
export async function deleteCanvasMutationReceiptsBefore(repo: Repository, cutoff: string, batchSize: number): Promise<number> {
  const size = batchSize <= 0 ? 1000 : batchSize;
  let total = 0;
  for (;;) {
    const expired = await repo.db.all<{ id: string }>(
      'SELECT "id" FROM "canvas_mutation_receipts" WHERE "created_at" < ? ORDER BY "created_at" LIMIT ?',
      [cutoff, size],
    );
    if (!expired.length) return total;
    const placeholders = expired.map(() => "?").join(", ");
    const changes = await repo.db.run(
      `DELETE FROM "canvas_mutation_receipts" WHERE "id" IN (${placeholders})`,
      expired.map((row) => row.id),
    );
    total += changes;
    if (changes < size) return total;
  }
}
