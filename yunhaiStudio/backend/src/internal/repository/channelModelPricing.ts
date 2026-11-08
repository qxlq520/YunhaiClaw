// 对应 backend/internal/repository/channel_model_pricing.go
// 管理员批量改价与改协议的乐观锁写入。

import type { ChannelModel } from "@/internal/model/modelsChannel";
import { Repository } from "./repository";

export const errChannelModelPriceConflict = new Error("模型价格已变化，请刷新后重试");

/**
 * 整批提交或全部回滚。只写价格列，版本与更新时间校验保护应用侧的成本快照。
 */
export async function updateChannelModelSalePrices(repo: Repository, items: ChannelModel[]): Promise<void> {
  await repo.transaction(async (tx) => {
    for (const item of items) {
      const affected = await tx.db.run(
        'UPDATE "channel_models" SET "unit_price_microcredits" = ?, "input_token_price_microcredits" = ?, "output_token_price_microcredits" = ?, "cached_token_price_microcredits" = ?, "cache_write_token_price_microcredits" = ?, "price_version" = ? WHERE "id" = ? AND "channel_id" = ? AND "price_version" = ? AND "updated_at" = ? AND "deleted_at" IS NULL',
        [
          item.unitPriceMicrocredits,
          item.inputTokenPriceMicrocredits,
          item.outputTokenPriceMicrocredits,
          item.cachedTokenPriceMicrocredits,
          item.cacheWriteTokenPriceMicrocredits,
          item.priceVersion + 1,
          item.id,
          item.channelId,
          item.priceVersion,
          item.updatedAt,
        ],
      );
      if (affected !== 1) throw errChannelModelPriceConflict;
      for (const tier of item.priceTiers) {
        if (!tier.enabled) continue;
        const tierAffected = await tx.db.run(
          'UPDATE "channel_model_price_tiers" SET "unit_price_microcredits" = ?, "input_token_price_microcredits" = ?, "output_token_price_microcredits" = ?, "cached_token_price_microcredits" = ?, "cache_write_token_price_microcredits" = ?, "price_version" = ? WHERE "id" = ? AND "channel_model_id" = ? AND "price_version" = ? AND "updated_at" = ? AND "deleted_at" IS NULL',
          [
            tier.unitPriceMicrocredits,
            tier.inputTokenPriceMicrocredits,
            tier.outputTokenPriceMicrocredits,
            tier.cachedTokenPriceMicrocredits,
            tier.cacheWriteTokenPriceMicrocredits,
            tier.priceVersion + 1,
            tier.id,
            item.id,
            tier.priceVersion,
            tier.updatedAt,
          ],
        );
        if (tierAffected !== 1) throw errChannelModelPriceConflict;
      }
    }
  });
}

/**
 * 整批写入协议与重新规范化后的能力配置；updated_at 用作乐观锁，防止覆盖并发编辑。
 * 价格档不在这里改写。
 */
export async function updateChannelModelProtocols(repo: Repository, items: ChannelModel[]): Promise<void> {
  await repo.transaction(async (tx) => {
    for (const item of items) {
      const affected = await tx.db.run(
        'UPDATE "channel_models" SET "protocol" = ?, "capability_config_json" = ?, "capability_version" = ? WHERE "id" = ? AND "channel_id" = ? AND "updated_at" = ? AND "deleted_at" IS NULL',
        [
          item.protocol,
          item.capabilityConfigJson ?? "",
          item.capabilityVersion,
          item.id,
          item.channelId,
          item.updatedAt,
        ],
      );
      if (affected !== 1) throw errChannelModelPriceConflict;
    }
  });
}
