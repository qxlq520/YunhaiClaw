// 对应 backend/internal/repository/channel_presentation.go
// 系统渠道的展示字段与模型排序。

import { channelScopeSystem } from "@/internal/model/models";
import { lockSystemChannelForModelMutation, refreshChannelModelNames } from "./financeChannelModels";
import { recordNotFound, Repository } from "./repository";

export async function updateSystemChannelPresentation(
  repo: Repository,
  channelID: string,
  sortOrder: number | null,
  now: string,
): Promise<void> {
  const setSql = sortOrder === null ? '"updated_at" = ?' : '"sort_order" = ?, "updated_at" = ?';
  const values: (string | number | null)[] = sortOrder === null ? [now] : [sortOrder, now];
  const affected = await repo.db.run(
    `UPDATE "model_channels" SET ${setSql} WHERE "id" = ? AND "scope" = ? AND "deleted_at" IS NULL`,
    [...values, channelID, channelScopeSystem],
  );
  if (affected === 0) throw recordNotFound;
}

/** 只回填渠道来源标记，用于导入时保留目录服务商来源展示。 */
export async function updateSystemChannelCatalogProvider(
  repo: Repository,
  channelID: string,
  providerID: string,
  now: string,
): Promise<void> {
  await repo.db.run(
    'UPDATE "model_channels" SET "catalog_provider_id" = ?, "updated_at" = ? WHERE "id" = ? AND "scope" = ? AND "deleted_at" IS NULL',
    [providerID, now, channelID, channelScopeSystem],
  );
}

/** 排序是展示配置，不重写价格、能力版本或模型标识。 */
export async function updateChannelModelSort(
  repo: Repository,
  channelID: string,
  modelID: string,
  sortOrder: number,
  now: string,
): Promise<void> {
  await repo.transaction(async (tx) => {
    await lockSystemChannelForModelMutation(tx, channelID);
    const affected = await tx.db.run(
      'UPDATE "channel_models" SET "sort_order" = ?, "updated_at" = ? WHERE "channel_id" = ? AND "id" = ? AND "deleted_at" IS NULL',
      [sortOrder, now, channelID, modelID],
    );
    if (affected === 0) throw recordNotFound;
    await refreshChannelModelNames(tx, channelID, now);
  });
}
