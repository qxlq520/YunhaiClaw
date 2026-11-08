// 对应 backend/internal/repository/repository_channels_settings.go
// 系统渠道、系统设置与方舟私有素材绑定。

import { channelScopeSystem } from "@/internal/model/models";
import type { ApiCallLog, ModelChannel } from "@/internal/model/modelsChannel";
import type { ArkPrivateAssetBinding, SystemSetting } from "@/internal/model/modelsPlatform";
import { Repository, recordNotFound, toBool, toIso } from "./repository";
import { setting } from "./setting";

interface ChannelRow {
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

function mapChannel(row: ChannelRow): ModelChannel {
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

interface ChannelReferenceRow {
  id: string;
  name: string;
  enabled?: unknown;
}

function mapChannelReference(row: ChannelReferenceRow): ModelChannel {
  return {
    id: row.id,
    userId: "",
    scope: "",
    enabled: toBool(row.enabled),
    name: row.name,
    publicAlias: "",
    sortOrder: 0,
    baseUrl: "",
    apiKey: "",
    secretKey: "",
    apiFormat: "",
    concurrencyLimit: 0,
    proxyUrl: "",
    modelsJson: "",
    retiredModelsJson: "",
    headersJson: "",
    catalogProviderId: "",
    createdAt: "",
    updatedAt: "",
    deletedAt: "",
  };
}

const channelColumns = `"id", "user_id", "scope", "enabled", "name", "public_alias", "sort_order", "base_url", "api_key", "secret_key", "api_format", "concurrency_limit", "proxy_url", "models_json", "retired_models_json", "headers_json", "catalog_provider_id", "created_at", "updated_at", "deleted_at"`;

export async function systemChannels(repo: Repository, includeDisabled: boolean): Promise<ModelChannel[]> {
  const conditions = ['"scope" = ?', '"deleted_at" IS NULL'];
  const values: (string | boolean)[] = [channelScopeSystem];
  if (!includeDisabled) {
    conditions.push('"enabled" = ?');
    values.push(true);
  }
  const rows = await repo.db.all<ChannelRow>(
    `SELECT ${channelColumns} FROM "model_channels" WHERE ${conditions.join(" AND ")} ORDER BY "sort_order" ASC, "created_at" ASC, "id" ASC`,
    values,
  );
  return rows.map(mapChannel);
}

export async function historicalSystemChannelReferences(repo: Repository): Promise<ModelChannel[]> {
  const rows = await repo.db.all<ChannelReferenceRow>(
    'SELECT "id", "name" FROM "model_channels" WHERE "scope" = ? ORDER BY "created_at" ASC',
    [channelScopeSystem],
  );
  return rows.map(mapChannelReference);
}

/** 统计每个目录服务商已接入的系统渠道数量。 */
export async function catalogProviderChannelCounts(repo: Repository): Promise<Record<string, number>> {
  const rows = await repo.db.all<{ catalog_provider_id: string; count: number }>(
    `SELECT "catalog_provider_id", COUNT(*) AS "count" FROM "model_channels" WHERE "scope" = ? AND "catalog_provider_id" <> '' AND "deleted_at" IS NULL GROUP BY "catalog_provider_id"`,
    [channelScopeSystem],
  );
  const result: Record<string, number> = {};
  for (const row of rows) result[row.catalog_provider_id] = Number(row.count ?? 0);
  return result;
}

export async function adminSystemChannels(
  repo: Repository,
  keyword: string,
  status: string,
  limit: number,
  offset: number,
): Promise<{ channels: ModelChannel[]; total: number }> {
  const conditions = ['"scope" = ?', '"deleted_at" IS NULL'];
  const values: (string | boolean)[] = [channelScopeSystem];
  const keywordValue = keyword.trim();
  if (keywordValue !== "") {
    const pattern = `%${keywordValue.toLowerCase()}%`;
    conditions.push('(lower("name") LIKE ? OR lower("base_url") LIKE ?)');
    values.push(pattern, pattern);
  }
  if (status === "enabled") {
    conditions.push('"enabled" = ?');
    values.push(true);
  } else if (status === "disabled") {
    conditions.push('"enabled" = ?');
    values.push(false);
  }
  const where = ` WHERE ${conditions.join(" AND ")}`;
  const totals = await repo.db.all<{ total: number }>(`SELECT COUNT(*) AS "total" FROM "model_channels"${where}`, values);
  const rows = await repo.db.all<ChannelRow>(
    `SELECT ${channelColumns} FROM "model_channels"${where} ORDER BY "sort_order" ASC, "created_at" ASC, "id" ASC LIMIT ? OFFSET ?`,
    [...values, limit, offset],
  );
  return { channels: rows.map(mapChannel), total: Number(totals[0]?.total ?? 0) };
}

export async function adminSystemChannelReferences(repo: Repository): Promise<ModelChannel[]> {
  const rows = await repo.db.all<ChannelReferenceRow>(
    'SELECT "id", "name", "enabled" FROM "model_channels" WHERE "scope" = ? AND "deleted_at" IS NULL ORDER BY "created_at" ASC',
    [channelScopeSystem],
  );
  return rows.map(mapChannelReference);
}

export async function systemChannel(repo: Repository, id: string): Promise<ModelChannel | null> {
  const rows = await repo.db.all<ChannelRow>(
    `SELECT ${channelColumns} FROM "model_channels" WHERE "id" = ? AND "scope" = ? AND "enabled" = ? AND "deleted_at" IS NULL LIMIT 1`,
    [id, channelScopeSystem, true],
  );
  return rows.length ? mapChannel(rows[0]) : null;
}

export async function adminSystemChannel(repo: Repository, id: string): Promise<ModelChannel | null> {
  const rows = await repo.db.all<ChannelRow>(
    `SELECT ${channelColumns} FROM "model_channels" WHERE "id" = ? AND "scope" = ? AND "deleted_at" IS NULL LIMIT 1`,
    [id, channelScopeSystem],
  );
  return rows.length ? mapChannel(rows[0]) : null;
}

export async function deleteSystemChannel(repo: Repository, id: string): Promise<void> {
  const now = new Date().toISOString();
  await repo.transaction(async (tx) => {
    const affected = await tx.db.run(
      'UPDATE "model_channels" SET "api_key" = ?, "secret_key" = ?, "enabled" = ?, "updated_at" = ? WHERE "id" = ? AND "scope" = ? AND "deleted_at" IS NULL',
      ["", "", false, now, id, channelScopeSystem],
    );
    if (affected !== 1) throw recordNotFound;
    await tx.db.run('UPDATE "channel_models" SET "enabled" = ?, "updated_at" = ? WHERE "channel_id" = ? AND "deleted_at" IS NULL', [false, now, id]);
    await tx.db.run('UPDATE "channel_models" SET "deleted_at" = ? WHERE "channel_id" = ? AND "deleted_at" IS NULL', [now, id]);
    await tx.db.run('UPDATE "model_channels" SET "deleted_at" = ? WHERE "id" = ? AND "scope" = ? AND "deleted_at" IS NULL', [now, id, channelScopeSystem]);
  });
}

interface ApiCallLogRow {
  id: string;
  user_id: string | null;
  trace_id: string | null;
  request_id: string | null;
  channel_id: string | null;
  task_id: string | null;
  billing_order_id: string | null;
  source: string | null;
  capability: string | null;
  operation: string | null;
  request_kind: string | null;
  billable: unknown;
  api_format: string | null;
  method: string | null;
  path: string | null;
  model: string | null;
  status: string | null;
  status_code: number;
  duration_ms: number;
  poll_count: number;
  provider_status: string | null;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
  usage_available: unknown;
  media_count: number;
  video_seconds: number;
  provider_request_id: string | null;
  estimated_cost_micros: number;
  cost_available: unknown;
  currency: string | null;
  error_code: string | null;
  error: string | null;
  concurrency_limit: number;
  upstream_url: string | null;
  request_content_type: string | null;
  started_at: string;
  created_at: string;
  created_at_epoch: number;
}

function mapApiCallLog(row: ApiCallLogRow): ApiCallLog {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    traceId: row.trace_id ?? "",
    requestId: row.request_id ?? "",
    channelId: row.channel_id ?? "",
    channelName: "",
    taskId: row.task_id ?? "",
    billingOrderId: row.billing_order_id ?? "",
    billingReservedMicrocredits: 0,
    billingSettledMicrocredits: null,
    billingAvailable: false,
    creditCostConfigured: false,
    creditCostMicrocredits: null,
    source: row.source ?? "",
    capability: row.capability ?? "",
    operation: row.operation ?? "",
    requestKind: row.request_kind ?? "",
    billable: toBool(row.billable),
    apiFormat: row.api_format ?? "",
    method: row.method ?? "",
    path: row.path ?? "",
    model: row.model ?? "",
    status: row.status ?? "",
    statusCode: Number(row.status_code ?? 0),
    durationMs: Number(row.duration_ms ?? 0),
    pollCount: Number(row.poll_count ?? 0),
    providerStatus: row.provider_status ?? "",
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    cachedTokens: Number(row.cached_tokens ?? 0),
    cacheWriteTokens: Number(row.cache_write_tokens ?? 0),
    usageAvailable: toBool(row.usage_available),
    mediaCount: Number(row.media_count ?? 0),
    videoSeconds: Number(row.video_seconds ?? 0),
    providerRequestId: row.provider_request_id ?? "",
    estimatedCostMicros: Number(row.estimated_cost_micros ?? 0),
    costAvailable: toBool(row.cost_available),
    currency: row.currency ?? "",
    errorCode: row.error_code ?? "",
    error: row.error ?? "",
    concurrencyLimit: Number(row.concurrency_limit ?? 0),
    upstreamUrl: row.upstream_url ?? "",
    requestContentType: row.request_content_type ?? "",
    startedAt: toIso(row.started_at),
    createdAt: toIso(row.created_at),
    createdAtEpoch: Number(row.created_at_epoch ?? 0),
  };
}

const apiCallLogColumns = `"id", "user_id", "trace_id", "request_id", "channel_id", "task_id", "billing_order_id", "source", "capability", "operation", "request_kind", "billable", "api_format", "method", "path", "model", "status", "status_code", "duration_ms", "poll_count", "provider_status", "input_tokens", "output_tokens", "cached_tokens", "cache_write_tokens", "usage_available", "media_count", "video_seconds", "provider_request_id", "estimated_cost_micros", "cost_available", "currency", "error_code", "error", "concurrency_limit", "upstream_url", "request_content_type", "started_at", "created_at", "created_at_epoch"`;

export async function apiCallLogs(repo: Repository, userId: string, admin: boolean, limit: number): Promise<ApiCallLog[]> {
  const size = limit <= 0 || limit > 200 ? 100 : limit;
  const conditions: string[] = [];
  const values: string[] = [];
  if (!admin) {
    conditions.push('"user_id" = ?');
    values.push(userId);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows = await repo.db.all<ApiCallLogRow>(
    `SELECT ${apiCallLogColumns} FROM "api_call_logs"${where} ORDER BY "created_at" DESC LIMIT ?`,
    [...values, size],
  );
  return rows.map(mapApiCallLog);
}

interface SystemSettingRow {
  key: string;
  value_json: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

function mapSystemSetting(row: SystemSettingRow): SystemSetting {
  return {
    key: row.key,
    valueJson: row.value_json ?? "",
    updatedBy: row.updated_by ?? "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function systemSetting(repo: Repository, key: string): Promise<SystemSetting | null> {
  return setting(repo, key);
}

export async function systemSettingOptional(repo: Repository, key: string): Promise<SystemSetting | null> {
  const value = await setting(repo, key);
  if (!value || value.key === "") return null;
  return value;
}

export async function saveSystemSetting(repo: Repository, value: SystemSetting): Promise<void> {
  // GORM Save：主键为零值时直接 Create，否则先 Update，未命中再 Create。
  if (value.key !== "") {
    const affected = await repo.db.run(
      'UPDATE "system_settings" SET "value_json" = ?, "updated_by" = ?, "created_at" = ?, "updated_at" = ? WHERE "key" = ?',
      [value.valueJson, value.updatedBy, value.createdAt, value.updatedAt, value.key],
    );
    if (affected > 0) return;
  }
  await repo.db.run(
    'INSERT INTO "system_settings" ("key", "value_json", "updated_by", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?)',
    [value.key, value.valueJson, value.updatedBy, value.createdAt, value.updatedAt],
  );
}

export async function systemSettingsWithPrefix(repo: Repository, prefix: string, limit: number): Promise<SystemSetting[]> {
  const escaped = prefix.replace(/[\\%_]/g, (value) => `\\${value}`);
  const rows = await repo.db.all<SystemSettingRow>(
    `SELECT "key", "value_json", "updated_by", "created_at", "updated_at" FROM "system_settings" WHERE "key" LIKE ? ESCAPE '\\' ORDER BY "updated_at" DESC LIMIT ?`,
    [`${escaped}%`, limit],
  );
  return rows.map(mapSystemSetting);
}

export async function saveSystemSettings(repo: Repository, ...settings: SystemSetting[]): Promise<void> {
  await repo.transaction(async (tx) => {
    for (const value of settings) await saveSystemSetting(tx, value);
  });
}

interface ArkPrivateAssetBindingRow {
  id: string;
  user_id: string | null;
  resource_id: string;
  project_name: string;
  asset_group_id: string | null;
  ark_asset_id: string | null;
  status: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function mapArkPrivateAssetBinding(row: ArkPrivateAssetBindingRow): ArkPrivateAssetBinding {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    resourceId: row.resource_id,
    projectName: row.project_name,
    assetGroupId: row.asset_group_id ?? "",
    arkAssetId: row.ark_asset_id ?? "",
    status: row.status ?? "",
    error: row.error ?? "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const arkPrivateAssetBindingColumns = `"id", "user_id", "resource_id", "project_name", "asset_group_id", "ark_asset_id", "status", "error", "created_at", "updated_at"`;

export async function arkPrivateAssetBinding(
  repo: Repository,
  resourceId: string,
  projectName: string,
): Promise<ArkPrivateAssetBinding | null> {
  const rows = await repo.db.all<ArkPrivateAssetBindingRow>(
    `SELECT ${arkPrivateAssetBindingColumns} FROM "ark_private_asset_bindings" WHERE "resource_id" = ? AND "project_name" = ? LIMIT 1`,
    [resourceId, projectName],
  );
  return rows.length ? mapArkPrivateAssetBinding(rows[0]) : null;
}

/** 同一资源与方舟 Project 只允许一个上传者，其他 worker 等待该绑定而不是重复上传。 */
export async function createArkPrivateAssetBinding(repo: Repository, binding: ArkPrivateAssetBinding): Promise<boolean> {
  const changes = await repo.db.run(
    `INSERT INTO "ark_private_asset_bindings" (${arkPrivateAssetBindingColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT ("resource_id", "project_name") DO NOTHING`,
    [
      binding.id,
      binding.userId,
      binding.resourceId,
      binding.projectName,
      binding.assetGroupId,
      binding.arkAssetId,
      binding.status,
      binding.error,
      binding.createdAt,
      binding.updatedAt,
    ],
  );
  return changes === 1;
}

export async function saveArkPrivateAssetBinding(repo: Repository, binding: ArkPrivateAssetBinding): Promise<void> {
  if (binding.id !== "") {
    const affected = await repo.db.run(
      'UPDATE "ark_private_asset_bindings" SET "user_id" = ?, "resource_id" = ?, "project_name" = ?, "asset_group_id" = ?, "ark_asset_id" = ?, "status" = ?, "error" = ?, "created_at" = ?, "updated_at" = ? WHERE "id" = ?',
      [
        binding.userId,
        binding.resourceId,
        binding.projectName,
        binding.assetGroupId,
        binding.arkAssetId,
        binding.status,
        binding.error,
        binding.createdAt,
        binding.updatedAt,
        binding.id,
      ],
    );
    if (affected > 0) return;
  }
  await repo.db.run(
    `INSERT INTO "ark_private_asset_bindings" (${arkPrivateAssetBindingColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      binding.id,
      binding.userId,
      binding.resourceId,
      binding.projectName,
      binding.assetGroupId,
      binding.arkAssetId,
      binding.status,
      binding.error,
      binding.createdAt,
      binding.updatedAt,
    ],
  );
}

export async function deleteSystemSetting(repo: Repository, key: string): Promise<void> {
  await repo.db.run('DELETE FROM "system_settings" WHERE "key" = ?', [key]);
}
