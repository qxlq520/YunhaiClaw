// 对应 backend/internal/repository/finance_channel_models.go
// 渠道模型与价格档的持久化。
//
// 修改渠道下的模型前先锁定渠道行（lockSystemChannelForModelMutation），避免并发编辑
// 产生重复价格档或遗漏名称同步。

import type { CreditCostPricing } from "@/internal/model/creditCost";
import { canonicalSkuSelector, decodeSkuSelector } from "@/internal/model/modelSku";
import { channelScopeSystem, taskStatusQueued, taskStatusRunning } from "@/internal/model/models";
import type { ChannelModel, ChannelModelPriceTier, ChannelModelTag, ModelChannel } from "@/internal/model/modelsChannel";
import type { TokenPriceRule } from "@/internal/model/tokenPriceRules";
import { errChannelModelInUse } from "./finance";
import { recordNotFound, Repository, toBool, toIso } from "./repository";

export interface ModelChannelRow {
  id: string;
  user_id: string | null;
  scope: string;
  enabled: unknown;
  name: string;
  public_alias: string | null;
  sort_order: number;
  base_url: string | null;
  api_key: string | null;
  secret_key: string | null;
  api_format: string | null;
  concurrency_limit: number;
  proxy_url: string | null;
  models_json: string | null;
  retired_models_json: string | null;
  headers_json: string | null;
  catalog_provider_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const modelChannelColumns = `"id", "user_id", "scope", "enabled", "name", "public_alias", "sort_order", "base_url", "api_key", "secret_key", "api_format", "concurrency_limit", "proxy_url", "models_json", "retired_models_json", "headers_json", "catalog_provider_id", "created_at", "updated_at", "deleted_at"`;

export function mapModelChannelRow(row: ModelChannelRow): ModelChannel {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    scope: row.scope,
    enabled: toBool(row.enabled),
    name: row.name,
    publicAlias: row.public_alias ?? "",
    sortOrder: Number(row.sort_order ?? 0),
    baseUrl: row.base_url ?? "",
    apiKey: row.api_key ?? "",
    secretKey: row.secret_key ?? "",
    apiFormat: row.api_format ?? "",
    concurrencyLimit: Number(row.concurrency_limit ?? 0),
    proxyUrl: row.proxy_url ?? "",
    modelsJson: row.models_json ?? "",
    retiredModelsJson: row.retired_models_json ?? "",
    headersJson: row.headers_json ?? "",
    catalogProviderId: row.catalog_provider_id ?? "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: row.deleted_at ?? "",
  };
}

export function modelChannelValues(channel: ModelChannel): (string | number | boolean | null)[] {
  return [
    channel.id,
    channel.userId,
    channel.scope,
    channel.enabled,
    channel.name,
    channel.publicAlias ?? "",
    channel.sortOrder,
    channel.baseUrl,
    channel.apiKey ?? "",
    channel.secretKey ?? "",
    channel.apiFormat,
    channel.concurrencyLimit,
    channel.proxyUrl,
    channel.modelsJson,
    channel.retiredModelsJson ?? "",
    channel.headersJson ?? "",
    channel.catalogProviderId,
    channel.createdAt,
    channel.updatedAt,
    channel.deletedAt ? channel.deletedAt : null,
  ];
}

const modelChannelPlaceholders = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

export interface ChannelModelRow {
  id: string;
  channel_id: string | null;
  model_key: string | null;
  provider_model_key: string | null;
  display_name: string | null;
  channel_label: string | null;
  tags: string | null;
  description: string | null;
  sort_order: number;
  icon: string | null;
  capability: string | null;
  protocol: string | null;
  billing_mode: string | null;
  unit_price_microcredits: number;
  input_token_price_microcredits: number;
  output_token_price_microcredits: number;
  cached_token_price_microcredits: number;
  cache_write_token_price_microcredits: number;
  price_configured: unknown;
  enabled: unknown;
  price_version: number;
  price_currency: string | null;
  capability_config_json: string | null;
  capability_version: number;
  catalog_model_key: string | null;
  reference_video_billing: unknown;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ChannelModelReferenceRow {
  id: string;
  channel_id: string | null;
  model_key: string | null;
  display_name: string | null;
  sort_order: number;
  enabled: unknown;
}

export const channelModelColumns = `"id", "channel_id", "model_key", "provider_model_key", "display_name", "channel_label", "tags", "description", "sort_order", "icon", "capability", "protocol", "billing_mode", "unit_price_microcredits", "input_token_price_microcredits", "output_token_price_microcredits", "cached_token_price_microcredits", "cache_write_token_price_microcredits", "price_configured", "enabled", "price_version", "price_currency", "capability_config_json", "capability_version", "catalog_model_key", "reference_video_billing", "created_at", "updated_at", "deleted_at"`;

const channelModelPlaceholders =
  "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

function parseTags(raw: string | null): ChannelModelTag[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ChannelModelTag[]) : [];
  } catch {
    return [];
  }
}

function parseCostPricing(raw: string | null): CreditCostPricing | undefined {
  if (!raw || !raw.trim()) return undefined;
  try {
    return JSON.parse(raw) as CreditCostPricing;
  } catch {
    return undefined;
  }
}

function parseTokenPriceRules(raw: string | null): TokenPriceRule[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as TokenPriceRule[]) : [];
  } catch {
    return [];
  }
}

export function mapChannelModelRow(row: ChannelModelRow): ChannelModel {
  return {
    id: row.id,
    channelId: row.channel_id ?? "",
    modelKey: row.model_key ?? "",
    providerModelKey: row.provider_model_key ?? "",
    displayName: row.display_name ?? "",
    channelLabel: row.channel_label ?? "",
    tags: parseTags(row.tags),
    description: row.description ?? "",
    sortOrder: Number(row.sort_order ?? 0),
    icon: row.icon ?? "",
    capability: row.capability ?? "",
    protocol: row.protocol ?? "",
    billingMode: row.billing_mode ?? "",
    unitPriceMicrocredits: Number(row.unit_price_microcredits ?? 0),
    inputTokenPriceMicrocredits: Number(row.input_token_price_microcredits ?? 0),
    outputTokenPriceMicrocredits: Number(row.output_token_price_microcredits ?? 0),
    cachedTokenPriceMicrocredits: Number(row.cached_token_price_microcredits ?? 0),
    cacheWriteTokenPriceMicrocredits: Number(row.cache_write_token_price_microcredits ?? 0),
    priceConfigured: toBool(row.price_configured),
    enabled: toBool(row.enabled),
    priceVersion: Number(row.price_version ?? 0),
    priceCurrency: row.price_currency ?? "",
    capabilityConfigJson: row.capability_config_json ?? "",
    capabilityVersion: Number(row.capability_version ?? 0),
    catalogModelKey: row.catalog_model_key ?? "",
    referenceVideoBilling: toBool(row.reference_video_billing),
    priceTiers: [],
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: row.deleted_at ?? "",
  };
}

function mapChannelModelReference(row: ChannelModelReferenceRow): ChannelModel {
  return {
    id: row.id,
    channelId: row.channel_id ?? "",
    modelKey: row.model_key ?? "",
    providerModelKey: "",
    displayName: row.display_name ?? "",
    channelLabel: "",
    tags: [],
    description: "",
    sortOrder: Number(row.sort_order ?? 0),
    icon: "",
    capability: "",
    protocol: "",
    billingMode: "",
    unitPriceMicrocredits: 0,
    inputTokenPriceMicrocredits: 0,
    outputTokenPriceMicrocredits: 0,
    cachedTokenPriceMicrocredits: 0,
    cacheWriteTokenPriceMicrocredits: 0,
    priceConfigured: false,
    enabled: toBool(row.enabled),
    priceVersion: 0,
    priceCurrency: "",
    capabilityConfigJson: "",
    capabilityVersion: 0,
    catalogModelKey: "",
    referenceVideoBilling: false,
    priceTiers: [],
    createdAt: "",
    updatedAt: "",
    deletedAt: "",
  };
}

export function channelModelValues(item: ChannelModel): (string | number | boolean | null)[] {
  return [
    item.id,
    item.channelId,
    item.modelKey,
    item.providerModelKey,
    item.displayName,
    item.channelLabel,
    JSON.stringify(item.tags ?? []),
    item.description,
    item.sortOrder,
    item.icon,
    item.capability,
    item.protocol,
    item.billingMode,
    item.unitPriceMicrocredits,
    item.inputTokenPriceMicrocredits,
    item.outputTokenPriceMicrocredits,
    item.cachedTokenPriceMicrocredits,
    item.cacheWriteTokenPriceMicrocredits,
    item.priceConfigured,
    item.enabled,
    item.priceVersion,
    item.priceCurrency,
    item.capabilityConfigJson ?? "",
    item.capabilityVersion,
    item.catalogModelKey,
    item.referenceVideoBilling,
    item.createdAt,
    item.updatedAt,
    item.deletedAt ? item.deletedAt : null,
  ];
}

interface ChannelModelPriceTierRow {
  cost_pricing: string | null;
  id: string;
  channel_model_id: string | null;
  selector_key: string;
  selector_json: string | null;
  resolution: string;
  video_seconds: number;
  provider_model_key: string | null;
  billing_mode: string | null;
  unit_price_microcredits: number;
  input_token_price_microcredits: number;
  output_token_price_microcredits: number;
  cached_token_price_microcredits: number;
  cache_write_token_price_microcredits: number;
  token_price_rules_enabled: unknown;
  token_price_rules: string | null;
  reference_video_unit_price_microcredits: number;
  reference_video_output_token_price_microcredits: number;
  price_configured: unknown;
  enabled: unknown;
  price_version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const channelModelPriceTierColumns = `"cost_pricing", "id", "channel_model_id", "selector_key", "selector_json", "resolution", "video_seconds", "provider_model_key", "billing_mode", "unit_price_microcredits", "input_token_price_microcredits", "output_token_price_microcredits", "cached_token_price_microcredits", "cache_write_token_price_microcredits", "token_price_rules_enabled", "token_price_rules", "reference_video_unit_price_microcredits", "reference_video_output_token_price_microcredits", "price_configured", "enabled", "price_version", "created_at", "updated_at", "deleted_at"`;

const channelModelPriceTierPlaceholders = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

function mapChannelModelPriceTierRow(row: ChannelModelPriceTierRow): ChannelModelPriceTier {
  return {
    costPricing: parseCostPricing(row.cost_pricing),
    id: row.id,
    channelModelId: row.channel_model_id ?? "",
    selectorKey: row.selector_key ?? "",
    selectorJson: row.selector_json ?? "",
    selector: decodeSkuSelector(row.selector_json ?? ""),
    resolution: row.resolution ?? "",
    videoSeconds: Number(row.video_seconds ?? 0),
    providerModelKey: row.provider_model_key ?? "",
    billingMode: row.billing_mode ?? "",
    unitPriceMicrocredits: Number(row.unit_price_microcredits ?? 0),
    inputTokenPriceMicrocredits: Number(row.input_token_price_microcredits ?? 0),
    outputTokenPriceMicrocredits: Number(row.output_token_price_microcredits ?? 0),
    cachedTokenPriceMicrocredits: Number(row.cached_token_price_microcredits ?? 0),
    cacheWriteTokenPriceMicrocredits: Number(row.cache_write_token_price_microcredits ?? 0),
    tokenPriceRulesEnabled: toBool(row.token_price_rules_enabled),
    tokenPriceRules: parseTokenPriceRules(row.token_price_rules),
    referenceVideoUnitPriceMicrocredits: Number(row.reference_video_unit_price_microcredits ?? 0),
    referenceVideoOutputTokenPriceMicrocredits: Number(row.reference_video_output_token_price_microcredits ?? 0),
    priceConfigured: toBool(row.price_configured),
    enabled: toBool(row.enabled),
    priceVersion: Number(row.price_version ?? 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: row.deleted_at ?? "",
  };
}

function channelModelPriceTierValues(tier: ChannelModelPriceTier): (string | number | boolean | null)[] {
  return [
    tier.costPricing ? JSON.stringify(tier.costPricing) : null,
    tier.id,
    tier.channelModelId,
    tier.selectorKey,
    tier.selectorJson ?? "{}",
    tier.resolution,
    tier.videoSeconds,
    tier.providerModelKey,
    tier.billingMode,
    tier.unitPriceMicrocredits,
    tier.inputTokenPriceMicrocredits,
    tier.outputTokenPriceMicrocredits,
    tier.cachedTokenPriceMicrocredits,
    tier.cacheWriteTokenPriceMicrocredits,
    tier.tokenPriceRulesEnabled,
    JSON.stringify(tier.tokenPriceRules ?? []),
    tier.referenceVideoUnitPriceMicrocredits,
    tier.referenceVideoOutputTokenPriceMicrocredits,
    tier.priceConfigured,
    tier.enabled,
    tier.priceVersion,
    tier.createdAt,
    tier.updatedAt,
    tier.deletedAt ? tier.deletedAt : null,
  ];
}

async function insertModelChannel(repo: Repository, channel: ModelChannel): Promise<void> {
  await repo.db.run(
    `INSERT INTO "model_channels" (${modelChannelColumns}) VALUES ${modelChannelPlaceholders}`,
    modelChannelValues(channel),
  );
}

async function insertChannelModel(repo: Repository, item: ChannelModel): Promise<void> {
  await repo.db.run(
    `INSERT INTO "channel_models" (${channelModelColumns}) VALUES ${channelModelPlaceholders}`,
    channelModelValues(item),
  );
}

async function insertChannelModelPriceTier(repo: Repository, tier: ChannelModelPriceTier): Promise<void> {
  await repo.db.run(
    `INSERT INTO "channel_model_price_tiers" (${channelModelPriceTierColumns}) VALUES ${channelModelPriceTierPlaceholders}`,
    channelModelPriceTierValues(tier),
  );
}

/** GORM Save：主键非空时先整行更新，未命中再插入。 */
async function saveChannelModelRow(repo: Repository, item: ChannelModel): Promise<void> {
  if (item.id !== "") {
    const values = channelModelValues(item).slice(1);
    const affected = await repo.db.run(
      `UPDATE "channel_models" SET "channel_id" = ?, "model_key" = ?, "provider_model_key" = ?, "display_name" = ?, "channel_label" = ?, "tags" = ?, "description" = ?, "sort_order" = ?, "icon" = ?, "capability" = ?, "protocol" = ?, "billing_mode" = ?, "unit_price_microcredits" = ?, "input_token_price_microcredits" = ?, "output_token_price_microcredits" = ?, "cached_token_price_microcredits" = ?, "cache_write_token_price_microcredits" = ?, "price_configured" = ?, "enabled" = ?, "price_version" = ?, "price_currency" = ?, "capability_config_json" = ?, "capability_version" = ?, "catalog_model_key" = ?, "reference_video_billing" = ?, "created_at" = ?, "updated_at" = ?, "deleted_at" = ? WHERE "id" = ? AND "deleted_at" IS NULL`,
      [...values, item.id],
    );
    if (affected > 0) return;
  }
  await insertChannelModel(repo, item);
}

/** GORM Save：价格档同样先更新后插入，已软删除的旧档不会被复活。 */
async function saveChannelModelPriceTierRow(repo: Repository, tier: ChannelModelPriceTier): Promise<void> {
  if (tier.id !== "") {
    const values = channelModelPriceTierValues(tier).slice(1);
    const affected = await repo.db.run(
      `UPDATE "channel_model_price_tiers" SET "channel_model_id" = ?, "selector_key" = ?, "selector_json" = ?, "resolution" = ?, "video_seconds" = ?, "provider_model_key" = ?, "billing_mode" = ?, "unit_price_microcredits" = ?, "input_token_price_microcredits" = ?, "output_token_price_microcredits" = ?, "cached_token_price_microcredits" = ?, "cache_write_token_price_microcredits" = ?, "token_price_rules_enabled" = ?, "token_price_rules" = ?, "reference_video_unit_price_microcredits" = ?, "reference_video_output_token_price_microcredits" = ?, "price_configured" = ?, "enabled" = ?, "price_version" = ?, "created_at" = ?, "updated_at" = ?, "deleted_at" = ?, "cost_pricing" = ? WHERE "id" = ? AND "deleted_at" IS NULL`,
      [...values.slice(1), values[0], tier.id],
    );
    if (affected > 0) return;
  }
  await insertChannelModelPriceTier(repo, tier);
}

async function tableExists(repo: Repository, table: string): Promise<boolean> {
  if (repo.dialect() === "sqlite") {
    const rows = await repo.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table]);
    return rows.length > 0;
  }
  const rows = await repo.db.all<{ tablename: string }>(
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = current_schema() AND tablename = ?",
    [table],
  );
  return rows.length > 0;
}

function inPlaceholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}

export async function channelModels(repo: Repository, channelID: string, includeDisabled: boolean): Promise<ChannelModel[]> {
  const conditions = ['"channel_id" = ?', '"deleted_at" IS NULL'];
  const values: (string | boolean)[] = [channelID];
  if (!includeDisabled) {
    conditions.push('"enabled" = ?');
    values.push(true);
  }
  const rows = await repo.db.all<ChannelModelRow>(
    `SELECT ${channelModelColumns} FROM "channel_models" WHERE ${conditions.join(" AND ")} ORDER BY "sort_order" ASC, "created_at" ASC, "id" ASC`,
    values,
  );
  const items = rows.map(mapChannelModelRow);
  await attachChannelModelPriceTiers(repo, items);
  return items;
}

export async function channelModelReferences(repo: Repository, channelIDs: string[]): Promise<ChannelModel[]> {
  if (channelIDs.length === 0) return [];
  const rows = await repo.db.all<ChannelModelReferenceRow>(
    `SELECT "id", "channel_id", "model_key", "display_name", "sort_order", "enabled" FROM "channel_models" WHERE "channel_id" IN (${inPlaceholders(channelIDs.length)}) AND "deleted_at" IS NULL ORDER BY "channel_id" ASC, "sort_order" ASC, "created_at" ASC, "id" ASC`,
    channelIDs,
  );
  return rows.map(mapChannelModelReference);
}

export async function createDuplicatedSystemChannel(
  repo: Repository,
  channel: ModelChannel,
  channelModels: ChannelModel[],
  priceTiers: ChannelModelPriceTier[],
): Promise<void> {
  await repo.transaction(async (tx) => {
    await insertModelChannel(tx, channel);
    if (channelModels.length > 0) {
      for (const item of channelModels) await insertChannelModel(tx, item);
    }
    if (priceTiers.length > 0) {
      for (const tier of priceTiers) await insertChannelModelPriceTier(tx, tier);
    }
  });
}

export async function channelModelByID(repo: Repository, channelID: string, id: string): Promise<ChannelModel | null> {
  const rows = await repo.db.all<ChannelModelRow>(
    `SELECT ${channelModelColumns} FROM "channel_models" WHERE "id" = ? AND "channel_id" = ? AND "deleted_at" IS NULL LIMIT 1`,
    [id, channelID],
  );
  if (!rows.length) return null;
  const item = mapChannelModelRow(rows[0]);
  await attachChannelModelPriceTiers(repo, [item]);
  return item;
}

/** 只更新启停与更新时间，不触碰价格档和价格版本。 */
export async function setChannelModelEnabled(repo: Repository, channelID: string, id: string, enabled: boolean): Promise<void> {
  const affected = await repo.db.run(
    'UPDATE "channel_models" SET "enabled" = ?, "updated_at" = ? WHERE "id" = ? AND "channel_id" = ? AND "deleted_at" IS NULL',
    [enabled, new Date().toISOString(), id, channelID],
  );
  if (affected === 0) throw recordNotFound;
}

export async function channelModelByKey(repo: Repository, channelID: string, modelKey: string): Promise<ChannelModel | null> {
  const rows = await repo.db.all<ChannelModelRow>(
    `SELECT ${channelModelColumns} FROM "channel_models" WHERE "channel_id" = ? AND "model_key" = ? AND "enabled" = ? AND "deleted_at" IS NULL ORDER BY "id" ASC LIMIT 1`,
    [channelID, modelKey, true],
  );
  if (!rows.length) return null;
  const item = mapChannelModelRow(rows[0]);
  await attachChannelModelPriceTiers(repo, [item]);
  return item;
}

export async function channelModelByKeyIncludingDisabled(
  repo: Repository,
  channelID: string,
  modelKey: string,
): Promise<ChannelModel | null> {
  const rows = await repo.db.all<ChannelModelRow>(
    `SELECT ${channelModelColumns} FROM "channel_models" WHERE "channel_id" = ? AND "model_key" = ? AND "deleted_at" IS NULL ORDER BY "id" ASC LIMIT 1`,
    [channelID, modelKey],
  );
  if (!rows.length) return null;
  const item = mapChannelModelRow(rows[0]);
  await attachChannelModelPriceTiers(repo, [item]);
  return item;
}

export async function saveChannelModel(repo: Repository, item: ChannelModel): Promise<void> {
  await saveChannelModelRow(repo, item);
}

/** 原子保存系统模型与其活动价格档。移除价格档采用软删除，让已结算订单的 PriceTierID 仍能回溯到原始配置版本。 */
export async function saveChannelModelWithPriceTiers(
  repo: Repository,
  item: ChannelModel,
  tiers: ChannelModelPriceTier[],
): Promise<void> {
  await repo.transaction(async (tx) => {
    const existingRows = await tx.db.all<ChannelModelPriceTierRow>(
      `SELECT ${channelModelPriceTierColumns} FROM "channel_model_price_tiers" WHERE "channel_model_id" = ? AND "deleted_at" IS NULL`,
      [item.id],
    );
    const existing = existingRows.map(mapChannelModelPriceTierRow);
    const existingByKey = new Map<string, ChannelModelPriceTier>();
    for (const tier of existing) existingByKey.set(channelModelPriceTierKey(tier), tier);
    const selected = new Set<string>();
    for (const tier of tiers) {
      tier.channelModelId = item.id;
      const key = channelModelPriceTierKey(tier);
      const existingTier = existingByKey.get(key);
      if (existingTier) {
        tier.id = existingTier.id;
        tier.priceVersion = existingTier.priceVersion + 1;
        await saveChannelModelPriceTierRow(tx, tier);
      } else {
        await insertChannelModelPriceTier(tx, tier);
      }
      selected.add(tier.id);
    }
    for (const tier of existing) {
      if (selected.has(tier.id)) continue;
      await tx.db.run('UPDATE "channel_model_price_tiers" SET "deleted_at" = ? WHERE "id" = ?', [
        new Date().toISOString(),
        tier.id,
      ]);
    }
    await saveChannelModelRow(tx, item);
  });
}

function channelModelPriceTierKey(tier: ChannelModelPriceTier): string {
  if (tier.selectorKey.trim() !== "") return tier.selectorKey;
  const { encoded } = canonicalSkuSelector({
    vquality: tier.resolution.trim(),
    videoSeconds: String(tier.videoSeconds),
  });
  return encoded === "" ? "{}" : encoded;
}

async function attachChannelModelPriceTiers(repo: Repository, items: ChannelModel[]): Promise<void> {
  if (items.length === 0) return;
  const ids = items.map((item) => item.id);
  let tiers: ChannelModelPriceTier[] = [];
  if (await tableExists(repo, "channel_model_price_tiers")) {
    const rows = await repo.db.all<ChannelModelPriceTierRow>(
      `SELECT ${channelModelPriceTierColumns} FROM "channel_model_price_tiers" WHERE "channel_model_id" IN (${inPlaceholders(ids.length)}) AND "deleted_at" IS NULL ORDER BY "selector_key" ASC, "created_at" ASC`,
      ids,
    );
    tiers = rows.map((row) => {
      const tier = mapChannelModelPriceTierRow(row);
      tier.selector = decodeSkuSelector(tier.selectorJson ?? "");
      return tier;
    });
  }
  const tiersByModelID = new Map<string, ChannelModelPriceTier[]>();
  for (const tier of tiers) {
    const group = tiersByModelID.get(tier.channelModelId);
    if (group) group.push(tier);
    else tiersByModelID.set(tier.channelModelId, [tier]);
  }
  for (const item of items) {
    item.priceTiers = tiersByModelID.get(item.id) ?? [];
    // 兼容尚未执行价格档回填的旧数据库；正式迁移会将同一数据持久化为默认档。
    if (item.priceTiers.length === 0 && item.priceConfigured) {
      item.priceTiers = [
        {
          channelModelId: item.id,
          selectorKey: "{}",
          selectorJson: "{}",
          resolution: "*",
          videoSeconds: 0,
          id: "",
          providerModelKey: item.providerModelKey,
          billingMode: item.billingMode,
          unitPriceMicrocredits: item.unitPriceMicrocredits,
          inputTokenPriceMicrocredits: item.inputTokenPriceMicrocredits,
          outputTokenPriceMicrocredits: item.outputTokenPriceMicrocredits,
          cachedTokenPriceMicrocredits: item.cachedTokenPriceMicrocredits,
          cacheWriteTokenPriceMicrocredits: item.cacheWriteTokenPriceMicrocredits,
          tokenPriceRulesEnabled: false,
          tokenPriceRules: [],
          referenceVideoUnitPriceMicrocredits: 0,
          referenceVideoOutputTokenPriceMicrocredits: 0,
          priceConfigured: item.priceConfigured,
          enabled: item.enabled,
          priceVersion: item.priceVersion,
          createdAt: "",
          updatedAt: "",
        },
      ];
    }
  }
}

/** 将价格档附着到已经查询出的渠道模型，供路由关系图批量加载使用。 */
export async function populateChannelModelPriceTiers(repo: Repository, items: ChannelModel[]): Promise<void> {
  await attachChannelModelPriceTiers(repo, items);
}

export async function populateChannelModelPriceTier(repo: Repository, item: ChannelModel | null): Promise<void> {
  if (!item) return;
  await attachChannelModelPriceTiers(repo, [item]);
}

export async function deleteChannelModel(repo: Repository, channelID: string, id: string, now: string): Promise<void> {
  const deleted = await deleteChannelModels(repo, channelID, [id], now);
  if (deleted !== 1) throw recordNotFound;
}

/**
 * 原子删除所选模型并刷新渠道的兼容模型列表。任何活动路由或任务引用都会中止整个事务，
 * 避免批量操作留下部分结果。
 */
export async function deleteChannelModels(
  repo: Repository,
  channelID: string,
  ids: string[],
  now: string,
): Promise<number> {
  const targetIDs = uniqueStrings(ids);
  if (targetIDs.length === 0) throw recordNotFound;
  let deleted = 0;
  await repo.transaction(async (tx) => {
    await lockSystemChannelForModelMutation(tx, channelID);
    const existingRows = await tx.db.all<{ total: number }>(
      `SELECT COUNT(*) AS "total" FROM "channel_models" WHERE "channel_id" = ? AND "id" IN (${inPlaceholders(targetIDs.length)}) AND "deleted_at" IS NULL`,
      [channelID, ...targetIDs],
    );
    if (Number(existingRows[0]?.total ?? 0) !== targetIDs.length) throw recordNotFound;
    const referenceRows = await tx.db.all<{ total: number }>(
      `SELECT COUNT(*) AS "total" FROM "logical_model_routes" AS "route" JOIN "logical_models" AS "logical_model" ON "logical_model"."active_revision_id" = "route"."logical_model_revision_id" WHERE "route"."channel_model_id" IN (${inPlaceholders(targetIDs.length)})`,
      targetIDs,
    );
    if (Number(referenceRows[0]?.total ?? 0) > 0) throw errChannelModelInUse;
    const taskRows = await tx.db.all<{ total: number }>(
      `SELECT COUNT(*) AS "total" FROM "tasks" WHERE "channel_model_id" IN (${inPlaceholders(targetIDs.length)}) AND "status" IN (?, ?)`,
      [...targetIDs, taskStatusQueued, taskStatusRunning],
    );
    if (Number(taskRows[0]?.total ?? 0) > 0) throw errChannelModelInUse;
    const affected = await tx.db.run(
      `UPDATE "channel_models" SET "enabled" = ?, "price_version" = "price_version" + 1, "updated_at" = ? WHERE "id" IN (${inPlaceholders(targetIDs.length)}) AND "channel_id" = ? AND "deleted_at" IS NULL`,
      [false, now, ...targetIDs, channelID],
    );
    if (affected !== targetIDs.length) throw recordNotFound;
    await tx.db.run(
      `UPDATE "channel_models" SET "deleted_at" = ? WHERE "id" IN (${inPlaceholders(targetIDs.length)}) AND "channel_id" = ? AND "deleted_at" IS NULL`,
      [now, ...targetIDs, channelID],
    );
    await refreshChannelModelNames(tx, channelID, now);
    deleted = affected;
  });
  return deleted;
}

/**
 * 串行化系统渠道的兼容列表刷新，并从已提交的 channel_models 行推导列表。
 * 调用方不得传入此前读取的快照，否则并发管理员写入会覆盖更新的目录。
 */
export async function syncChannelModelNames(repo: Repository, channelID: string, now: string): Promise<void> {
  await repo.transaction(async (tx) => {
    await lockSystemChannelForModelMutation(tx, channelID);
    await refreshChannelModelNames(tx, channelID, now);
  });
}

export async function lockSystemChannelForModelMutation(tx: Repository, channelID: string): Promise<void> {
  const suffix = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
  const rows = await tx.db.all<{ id: string }>(
    `SELECT "id" FROM "model_channels" WHERE "id" = ? AND "scope" = ? AND "deleted_at" IS NULL LIMIT 1${suffix}`,
    [channelID, channelScopeSystem],
  );
  if (!rows.length) throw recordNotFound;
}

export async function refreshChannelModelNames(tx: Repository, channelID: string, now: string): Promise<void> {
  const names = await tx.db.all<{ model_key: string }>(
    'SELECT "model_key" FROM "channel_models" WHERE "channel_id" = ? AND "enabled" = ? AND "deleted_at" IS NULL ORDER BY "sort_order" ASC, "created_at" ASC, "id" ASC',
    [channelID, true],
  );
  const encoded = JSON.stringify(names.map((row) => row.model_key));
  await tx.db.run(
    'UPDATE "model_channels" SET "models_json" = ?, "updated_at" = ? WHERE "id" = ? AND "scope" = ? AND "deleted_at" IS NULL',
    [encoded, now, channelID, channelScopeSystem],
  );
}

export async function createMissingChannelModels(repo: Repository, items: ChannelModel[]): Promise<number> {
  if (items.length === 0) return 0;
  // 拉取目录可能与其他管理员操作并发，唯一键冲突时保留已有定价配置。
  const values: (string | number | boolean | null)[] = [];
  for (const item of items) values.push(...channelModelValues(item));
  return repo.db.run(
    `INSERT INTO "channel_models" (${channelModelColumns}) VALUES ${items.map(() => channelModelPlaceholders).join(", ")} ON CONFLICT DO NOTHING`,
    values,
  );
}

function uniqueStrings(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
