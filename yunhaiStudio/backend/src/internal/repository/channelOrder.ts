// 对应 backend/internal/repository/channel_order.go
// 系统渠道与其模型的展示排序。

import { channelScopeSystem } from "@/internal/model/models";
import { lockSystemChannelForModelMutation, refreshChannelModelNames } from "./financeChannelModels";
import { Repository } from "./repository";

export const errChannelOrderChanged = new Error("列表已发生变化，请重新打开排序后再保存");

function sameOrder(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * 全量顺序在事务中保存；拒绝过期快照，避免覆盖另一管理员的调整。
 */
export async function saveChannelOrder(
  repo: Repository,
  channelID: string,
  ids: string[],
  expected: string[],
): Promise<void> {
  await repo.transaction(async (tx) => {
    const isModelOrder = channelID !== "";
    if (isModelOrder) await lockSystemChannelForModelMutation(tx, channelID);
    const table = isModelOrder ? "channel_models" : "model_channels";
    const condition = isModelOrder ? '"channel_id" = ?' : '"scope" = ?';
    const conditionValue = isModelOrder ? channelID : channelScopeSystem;
    const suffix = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    if (tx.dialect() === "postgres") {
      // 先按稳定顺序加锁，等待后再读取全新的有序快照。
      await tx.db.all<{ id: string }>(
        `SELECT "id" FROM "${table}" WHERE ${condition} AND "deleted_at" IS NULL ORDER BY "id" ASC${suffix}`,
        [conditionValue],
      );
    }
    const rows = await tx.db.all<{ id: string }>(
      `SELECT "id" FROM "${table}" WHERE ${condition} AND "deleted_at" IS NULL ORDER BY "sort_order" ASC, "created_at" ASC, "id" ASC`,
      [conditionValue],
    );
    const current = rows.map((row) => row.id);
    if (!sameOrder(current, expected) || ids.length !== current.length) throw errChannelOrderChanged;
    const allowed = new Set(current);
    for (const id of ids) {
      if (!allowed.has(id)) throw errChannelOrderChanged;
      allowed.delete(id);
    }
    const now = new Date().toISOString();
    for (let index = 0; index < ids.length; index += 1) {
      await tx.db.run(
        `UPDATE "${table}" SET "sort_order" = ?, "updated_at" = ? WHERE "id" = ? AND "deleted_at" IS NULL`,
        [index, now, ids[index]],
      );
    }
    if (isModelOrder) await refreshChannelModelNames(tx, channelID, now);
  });
}
