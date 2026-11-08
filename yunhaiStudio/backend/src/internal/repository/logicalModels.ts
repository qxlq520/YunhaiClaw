// 对应 backend/internal/repository/logical_models.go
// 前台逻辑模型、revision、供应线路与路由尝试的持久化。

import type { BillingCostSnapshot } from "@/internal/model/creditCost";
import type { BillingOrder, CreditAccount } from "@/internal/model/modelsFinance";
import type { AdminAuditEvent } from "@/internal/model/models";
import {
  billingStatusReserved,
  billingStatusRunning,
  channelScopeSystem,
  creditLedgerRefund,
  creditLedgerReserve,
  taskStatusQueued,
  taskStatusRunning,
} from "@/internal/model/models";
import type { Task } from "@/internal/model/modelsTask";
import type { ChannelModel, ModelChannel } from "@/internal/model/modelsChannel";
import type {
  LogicalModel,
  LogicalModelRevision,
  LogicalModelRoute,
  RouteAttempt,
} from "@/internal/model/modelsLogicalModel";
import { validateBillingChargeLimit } from "./billingAuthorization";
import { errCreationConflict } from "./creation";
import { errBillingStateConflict, errInsufficientCredits, newRepositoryId } from "./finance";
import {
  channelModelColumns,
  mapChannelModelRow,
  mapModelChannelRow,
  modelChannelColumns,
  populateChannelModelPriceTier,
  populateChannelModelPriceTiers,
  type ChannelModelRow,
  type ModelChannelRow,
} from "./financeChannelModels";
import { recordNotFound, Repository, toBool, toIso, toNullableIso } from "./repository";
import { errTaskStateConflict } from "./repositoryTasks";

export interface LogicalModelGraph {
  model: LogicalModel;
  revision: LogicalModelRevision | null;
  routes: LogicalModelRoute[];
  channelModels: ChannelModel[];
}

export const errLogicalModelInUse = new Error("该模型正在被使用，无法删除或停用");
export const errLogicalModelUnavailable = new Error("所选模型已停用或不可用，请重新选择");

interface LogicalModelRow {
  id: string;
  code: string;
  name: string;
  icon: string;
  description: string;
  capability: string;
  enabled: unknown;
  sort_order: number;
  revision_sequence: number;
  active_revision_id: string;
  source_channel_model_id: string | null;
  price_policy: string;
  billing_mode: string;
  unit_price_microcredits: number;
  input_price_microcredits: number;
  output_price_microcredits: number;
  cached_price_microcredits: number;
  cache_write_price_microcredits: number;
  legacy_model_i_ds_json: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface LogicalModelRevisionRow {
  id: string;
  logical_model_id: string;
  version: number;
  capability_spec_json: string | null;
  default_options_json: string | null;
  created_by: string;
  created_at: string;
}

interface LogicalModelRouteRow {
  id: string;
  logical_model_revision_id: string;
  channel_model_id: string;
  enabled: unknown;
  priority: number;
  weight: number;
  created_at: string;
  updated_at: string;
}

interface RouteAttemptRow {
  id: string;
  task_id: string;
  route_run: number;
  attempt_number: number;
  logical_model_id: string;
  logical_model_revision_id: string;
  route_id: string;
  channel_model_id: string;
  channel_id: string;
  status: string;
  dispatch_state: string;
  provider_request_id: string;
  failure_code: string;
  failure_message: string;
  started_at: string;
  completed_at: string | null;
}

const logicalModelColumns = `"id", "code", "name", "icon", "description", "capability", "enabled", "sort_order", "revision_sequence", "active_revision_id", "source_channel_model_id", "price_policy", "billing_mode", "unit_price_microcredits", "input_price_microcredits", "output_price_microcredits", "cached_price_microcredits", "cache_write_price_microcredits", "legacy_model_i_ds_json", "archived_at", "created_at", "updated_at"`;

const logicalModelPlaceholders = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

const logicalModelRevisionColumns = `"id", "logical_model_id", "version", "capability_spec_json", "default_options_json", "created_by", "created_at"`;

const logicalModelRevisionPlaceholders = "(?, ?, ?, ?, ?, ?, ?)";

const logicalModelRouteColumns = `"id", "logical_model_revision_id", "channel_model_id", "enabled", "priority", "weight", "created_at", "updated_at"`;

const logicalModelRoutePlaceholders = "(?, ?, ?, ?, ?, ?, ?, ?)";

const routeAttemptColumns = `"id", "task_id", "route_run", "attempt_number", "logical_model_id", "logical_model_revision_id", "route_id", "channel_model_id", "channel_id", "status", "dispatch_state", "provider_request_id", "failure_code", "failure_message", "started_at", "completed_at"`;

const routeAttemptPlaceholders = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

function mapLogicalModelRow(row: LogicalModelRow): LogicalModel {
  return {
    id: row.id,
    code: row.code ?? "",
    name: row.name ?? "",
    icon: row.icon ?? "",
    description: row.description ?? "",
    capability: row.capability ?? "",
    enabled: toBool(row.enabled),
    sortOrder: Number(row.sort_order ?? 0),
    revisionSequence: Number(row.revision_sequence ?? 0),
    activeRevisionId: row.active_revision_id ?? "",
    sourceChannelModelId: row.source_channel_model_id ?? "",
    pricePolicy: row.price_policy ?? "",
    billingMode: row.billing_mode ?? "",
    unitPriceMicrocredits: Number(row.unit_price_microcredits ?? 0),
    inputPriceMicrocredits: Number(row.input_price_microcredits ?? 0),
    outputPriceMicrocredits: Number(row.output_price_microcredits ?? 0),
    cachedPriceMicrocredits: Number(row.cached_price_microcredits ?? 0),
    cacheWritePriceMicrocredits: Number(row.cache_write_price_microcredits ?? 0),
    legacyModelIDsJson: row.legacy_model_i_ds_json ?? "",
    archivedAt: toNullableIso(row.archived_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function logicalModelValues(item: LogicalModel): (string | number | boolean | null)[] {
  return [
    item.id,
    item.code,
    item.name,
    item.icon,
    item.description,
    item.capability,
    item.enabled,
    item.sortOrder,
    item.revisionSequence ?? 0,
    item.activeRevisionId,
    item.sourceChannelModelId ?? "",
    item.pricePolicy,
    item.billingMode,
    item.unitPriceMicrocredits,
    item.inputPriceMicrocredits,
    item.outputPriceMicrocredits,
    item.cachedPriceMicrocredits,
    item.cacheWritePriceMicrocredits,
    item.legacyModelIDsJson ?? "",
    item.archivedAt ? item.archivedAt : null,
    item.createdAt,
    item.updatedAt,
  ];
}

function mapLogicalModelRevisionRow(row: LogicalModelRevisionRow): LogicalModelRevision {
  return {
    id: row.id,
    logicalModelId: row.logical_model_id ?? "",
    version: Number(row.version ?? 0),
    capabilitySpecJson: row.capability_spec_json ?? "",
    defaultOptionsJson: row.default_options_json ?? "",
    createdBy: row.created_by ?? "",
    createdAt: toIso(row.created_at),
  };
}

function logicalModelRevisionValues(item: LogicalModelRevision): (string | number | boolean | null)[] {
  return [
    item.id,
    item.logicalModelId,
    item.version,
    item.capabilitySpecJson ?? "",
    item.defaultOptionsJson ?? "",
    item.createdBy,
    item.createdAt,
  ];
}

function mapLogicalModelRouteRow(row: LogicalModelRouteRow): LogicalModelRoute {
  return {
    id: row.id,
    logicalModelRevisionId: row.logical_model_revision_id ?? "",
    channelModelId: row.channel_model_id ?? "",
    enabled: toBool(row.enabled),
    priority: Number(row.priority ?? 0),
    weight: Number(row.weight ?? 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function logicalModelRouteValues(item: LogicalModelRoute): (string | number | boolean | null)[] {
  return [
    item.id,
    item.logicalModelRevisionId,
    item.channelModelId,
    item.enabled,
    item.priority,
    item.weight,
    item.createdAt,
    item.updatedAt,
  ];
}

function mapRouteAttemptRow(row: RouteAttemptRow): RouteAttempt {
  return {
    id: row.id,
    taskId: row.task_id ?? "",
    routeRun: Number(row.route_run ?? 0),
    attemptNumber: Number(row.attempt_number ?? 0),
    logicalModelId: row.logical_model_id ?? "",
    logicalModelRevisionId: row.logical_model_revision_id ?? "",
    routeId: row.route_id ?? "",
    channelModelId: row.channel_model_id ?? "",
    channelId: row.channel_id ?? "",
    status: row.status ?? "",
    dispatchState: row.dispatch_state ?? "",
    providerRequestId: row.provider_request_id ?? "",
    failureCode: row.failure_code ?? "",
    failureMessage: row.failure_message ?? "",
    startedAt: toIso(row.started_at),
    completedAt: toNullableIso(row.completed_at),
  };
}

function routeAttemptValues(item: RouteAttempt): (string | number | boolean | null)[] {
  return [
    item.id,
    item.taskId,
    item.routeRun,
    item.attemptNumber,
    item.logicalModelId,
    item.logicalModelRevisionId,
    item.routeId,
    item.channelModelId,
    item.channelId,
    item.status,
    item.dispatchState,
    item.providerRequestId,
    item.failureCode,
    item.failureMessage,
    item.startedAt,
    item.completedAt ? item.completedAt : null,
  ];
}

function inPlaceholders(count: number): string {
  return new Array(count).fill("?").join(", ");
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

export async function logicalModels(repo: Repository, includeDisabled: boolean): Promise<LogicalModel[]> {
  const conditions = ['"archived_at" IS NULL'];
  const values: boolean[] = [];
  if (!includeDisabled) {
    conditions.push('"enabled" = ?');
    values.push(true);
  }
  const rows = await repo.db.all<LogicalModelRow>(
    `SELECT ${logicalModelColumns} FROM "logical_models" WHERE ${conditions.join(" AND ")} ORDER BY "sort_order" ASC, "created_at" ASC`,
    values,
  );
  return rows.map(mapLogicalModelRow);
}

export async function logicalModel(repo: Repository, id: string): Promise<LogicalModel | null> {
  const rows = await repo.db.all<LogicalModelRow>(`SELECT ${logicalModelColumns} FROM "logical_models" WHERE "id" = ? LIMIT 1`, [id]);
  return rows.length ? mapLogicalModelRow(rows[0]) : null;
}

export async function logicalModelsBySourceChannelModelID(
  repo: Repository,
  channelModelID: string,
): Promise<LogicalModel[]> {
  const rows = await repo.db.all<LogicalModelRow>(
    `SELECT ${logicalModelColumns} FROM "logical_models" WHERE "source_channel_model_id" = ? AND "archived_at" IS NULL ORDER BY "sort_order" ASC, "created_at" ASC`,
    [channelModelID],
  );
  return rows.map(mapLogicalModelRow);
}

export async function logicalModelsByOnlyActiveChannelModelID(
  repo: Repository,
  channelModelID: string,
): Promise<LogicalModel[]> {
  const rows = await repo.db.all<LogicalModelRow>(
    `SELECT "logical_models".* FROM "logical_models" JOIN "logical_model_routes" AS "route" ON "route"."logical_model_revision_id" = "logical_models"."active_revision_id" WHERE "logical_models"."archived_at" IS NULL GROUP BY "logical_models"."id" HAVING COUNT("route"."id") = 1 AND MAX("route"."channel_model_id") = ? ORDER BY "logical_models"."sort_order" ASC, "logical_models"."created_at" ASC`,
    [channelModelID],
  );
  return rows.map(mapLogicalModelRow);
}

export async function logicalModelRevision(repo: Repository, id: string): Promise<LogicalModelRevision | null> {
  const rows = await repo.db.all<LogicalModelRevisionRow>(
    `SELECT ${logicalModelRevisionColumns} FROM "logical_model_revisions" WHERE "id" = ? LIMIT 1`,
    [id],
  );
  return rows.length ? mapLogicalModelRevisionRow(rows[0]) : null;
}

export async function logicalModelRevisions(repo: Repository, logicalModelID: string): Promise<LogicalModelRevision[]> {
  const rows = await repo.db.all<LogicalModelRevisionRow>(
    `SELECT ${logicalModelRevisionColumns} FROM "logical_model_revisions" WHERE "logical_model_id" = ? ORDER BY "version" DESC`,
    [logicalModelID],
  );
  return rows.map(mapLogicalModelRevisionRow);
}

export async function logicalModelRoutes(
  repo: Repository,
  revisionID: string,
  includeDisabled: boolean,
): Promise<LogicalModelRoute[]> {
  const conditions = ['"logical_model_revision_id" = ?'];
  const values: (string | boolean | number)[] = [revisionID];
  if (!includeDisabled) {
    conditions.push('"enabled" = ? AND "weight" > ?');
    values.push(true, 0);
  }
  const rows = await repo.db.all<LogicalModelRouteRow>(
    `SELECT ${logicalModelRouteColumns} FROM "logical_model_routes" WHERE ${conditions.join(" AND ")} ORDER BY "priority" DESC, "created_at" ASC`,
    values,
  );
  return rows.map(mapLogicalModelRouteRow);
}

export async function logicalModelRoute(repo: Repository, id: string): Promise<LogicalModelRoute | null> {
  const rows = await repo.db.all<LogicalModelRouteRow>(
    `SELECT ${logicalModelRouteColumns} FROM "logical_model_routes" WHERE "id" = ? LIMIT 1`,
    [id],
  );
  return rows.length ? mapLogicalModelRouteRow(rows[0]) : null;
}

export async function channelModelsByIDs(repo: Repository, ids: string[]): Promise<ChannelModel[]> {
  if (ids.length === 0) return [];
  const rows = await repo.db.all<ChannelModelRow>(
    `SELECT ${channelModelColumns} FROM "channel_models" WHERE "id" IN (${inPlaceholders(ids.length)}) AND "deleted_at" IS NULL`,
    ids,
  );
  const items = rows.map(mapChannelModelRow);
  await populateChannelModelPriceTiers(repo, items);
  return items;
}

export async function systemChannelsByIDs(
  repo: Repository,
  ids: string[],
  includeDisabled: boolean,
): Promise<ModelChannel[]> {
  if (ids.length === 0) return [];
  const targetIDs = uniqueStrings(ids);
  if (targetIDs.length === 0) return [];
  const conditions = [`"id" IN (${inPlaceholders(targetIDs.length)})`, '"scope" = ?', '"deleted_at" IS NULL'];
  const values: (string | boolean)[] = [...targetIDs, channelScopeSystem];
  if (!includeDisabled) {
    conditions.push('"enabled" = ?');
    values.push(true);
  }
  const rows = await repo.db.all<ModelChannelRow>(
    `SELECT ${modelChannelColumns} FROM "model_channels" WHERE ${conditions.join(" AND ")}`,
    values,
  );
  return rows.map(mapModelChannelRow);
}

export async function channelModel(repo: Repository, id: string): Promise<ChannelModel | null> {
  const rows = await repo.db.all<ChannelModelRow>(
    `SELECT ${channelModelColumns} FROM "channel_models" WHERE "id" = ? AND "deleted_at" IS NULL LIMIT 1`,
    [id],
  );
  if (!rows.length) return null;
  const item = mapChannelModelRow(rows[0]);
  await populateChannelModelPriceTier(repo, item);
  return item;
}

export async function logicalModelGraph(
  repo: Repository,
  id: string,
  includeDisabled: boolean,
): Promise<LogicalModelGraph | null> {
  const item = await logicalModel(repo, id);
  if (!item) throw recordNotFound;
  if (!includeDisabled && !item.enabled) throw recordNotFound;
  const graphs = await logicalModelGraphs(repo, [item], includeDisabled);
  return graphs.get(item.id) ?? null;
}

/** 批量加载前台模型的当前 revision、供应线路和渠道模型，避免逐模型 N+1。 */
export async function logicalModelGraphs(
  repo: Repository,
  items: LogicalModel[],
  includeDisabled: boolean,
): Promise<Map<string, LogicalModelGraph>> {
  const graphs = new Map<string, LogicalModelGraph>();
  if (items.length === 0) return graphs;
  const revisionIDs: string[] = [];
  for (const item of items) {
    graphs.set(item.id, { model: item, revision: null, routes: [], channelModels: [] });
    if (item.activeRevisionId !== "") revisionIDs.push(item.activeRevisionId);
  }
  if (revisionIDs.length === 0) return graphs;

  const revisionRows = await repo.db.all<LogicalModelRevisionRow>(
    `SELECT ${logicalModelRevisionColumns} FROM "logical_model_revisions" WHERE "id" IN (${inPlaceholders(uniqueStrings(revisionIDs).length)})`,
    uniqueStrings(revisionIDs),
  );
  const revisionByID = new Map<string, LogicalModelRevision>();
  for (const row of revisionRows) {
    const revision = mapLogicalModelRevisionRow(row);
    revisionByID.set(revision.id, revision);
  }

  const routeRevisionIDs: string[] = [];
  for (const item of items) {
    const graph = graphs.get(item.id);
    if (!graph) continue;
    const revision = revisionByID.get(item.activeRevisionId);
    if (!revision) continue;
    graph.revision = { ...revision };
    routeRevisionIDs.push(revision.id);
  }

  let routes: LogicalModelRoute[] = [];
  if (routeRevisionIDs.length > 0) {
    const conditions = [`"logical_model_revision_id" IN (${inPlaceholders(uniqueStrings(routeRevisionIDs).length)})`];
    const values: (string | boolean | number)[] = uniqueStrings(routeRevisionIDs);
    if (!includeDisabled) {
      conditions.push('"enabled" = ? AND "weight" > ?');
      values.push(true, 0);
    }
    const rows = await repo.db.all<LogicalModelRouteRow>(
      `SELECT ${logicalModelRouteColumns} FROM "logical_model_routes" WHERE ${conditions.join(" AND ")} ORDER BY "priority" DESC, "created_at" ASC`,
      values,
    );
    routes = rows.map(mapLogicalModelRouteRow);
  }
  const routesByRevision = new Map<string, LogicalModelRoute[]>();
  const channelModelIDs: string[] = [];
  for (const route of routes) {
    const group = routesByRevision.get(route.logicalModelRevisionId);
    if (group) group.push(route);
    else routesByRevision.set(route.logicalModelRevisionId, [route]);
    channelModelIDs.push(route.channelModelId);
  }

  const channelModels = await channelModelsByIDs(repo, uniqueStrings(channelModelIDs));
  const channelModelByID = new Map<string, ChannelModel>();
  for (const item of channelModels) channelModelByID.set(item.id, item);

  for (const item of items) {
    const graph = graphs.get(item.id);
    if (!graph || !graph.revision) continue;
    graph.routes = routesByRevision.get(graph.revision.id) ?? [];
    graph.channelModels = [];
    const seenChannelModels = new Set<string>();
    for (const route of graph.routes) {
      const channelModelItem = channelModelByID.get(route.channelModelId);
      if (!channelModelItem || seenChannelModels.has(channelModelItem.id)) continue;
      seenChannelModels.add(channelModelItem.id);
      graph.channelModels.push(channelModelItem);
    }
  }
  return graphs;
}

export async function saveLogicalModel(repo: Repository, item: LogicalModel): Promise<void> {
  await saveLogicalModelRow(repo, item);
}

export async function createLogicalModel(repo: Repository, item: LogicalModel): Promise<void> {
  await repo.db.run(
    `INSERT INTO "logical_models" (${logicalModelColumns}) VALUES ${logicalModelPlaceholders}`,
    logicalModelValues(item),
  );
}

export async function createLogicalModelRevision(repo: Repository, item: LogicalModelRevision): Promise<void> {
  await repo.db.run(
    `INSERT INTO "logical_model_revisions" (${logicalModelRevisionColumns}) VALUES ${logicalModelRevisionPlaceholders}`,
    logicalModelRevisionValues(item),
  );
}

export async function saveLogicalModelRevision(repo: Repository, item: LogicalModelRevision): Promise<void> {
  if (item.id !== "") {
    const values = logicalModelRevisionValues(item).slice(1);
    const affected = await repo.db.run(
      `UPDATE "logical_model_revisions" SET "logical_model_id" = ?, "version" = ?, "capability_spec_json" = ?, "default_options_json" = ?, "created_by" = ?, "created_at" = ? WHERE "id" = ?`,
      [...values, item.id],
    );
    if (affected > 0) return;
  }
  await createLogicalModelRevision(repo, item);
}

export async function createLogicalModelRoute(repo: Repository, item: LogicalModelRoute): Promise<void> {
  await repo.db.run(
    `INSERT INTO "logical_model_routes" (${logicalModelRouteColumns}) VALUES ${logicalModelRoutePlaceholders}`,
    logicalModelRouteValues(item),
  );
}

export async function saveLogicalModelRoute(repo: Repository, item: LogicalModelRoute): Promise<void> {
  if (item.id !== "") {
    const values = logicalModelRouteValues(item).slice(1);
    const affected = await repo.db.run(
      `UPDATE "logical_model_routes" SET "logical_model_revision_id" = ?, "channel_model_id" = ?, "enabled" = ?, "priority" = ?, "weight" = ?, "created_at" = ?, "updated_at" = ? WHERE "id" = ?`,
      [...values, item.id],
    );
    if (affected > 0) return;
  }
  await createLogicalModelRoute(repo, item);
}

export async function createRouteAttempt(repo: Repository, item: RouteAttempt): Promise<void> {
  await repo.db.run(
    `INSERT INTO "route_attempts" (${routeAttemptColumns}) VALUES ${routeAttemptPlaceholders}`,
    routeAttemptValues(item),
  );
}

export async function saveRouteAttempt(repo: Repository, item: RouteAttempt): Promise<void> {
  if (item.id !== "") {
    const values = routeAttemptValues(item).slice(1);
    const affected = await repo.db.run(
      `UPDATE "route_attempts" SET "task_id" = ?, "route_run" = ?, "attempt_number" = ?, "logical_model_id" = ?, "logical_model_revision_id" = ?, "route_id" = ?, "channel_model_id" = ?, "channel_id" = ?, "status" = ?, "dispatch_state" = ?, "provider_request_id" = ?, "failure_code" = ?, "failure_message" = ?, "started_at" = ?, "completed_at" = ? WHERE "id" = ?`,
      [...values, item.id],
    );
    if (affected > 0) return;
  }
  await createRouteAttempt(repo, item);
}

export async function markRouteAttemptDispatching(repo: Repository, id: string): Promise<void> {
  const affected = await repo.db.run(
    'UPDATE "route_attempts" SET "status" = ?, "dispatch_state" = ? WHERE "id" = ? AND "dispatch_state" = ?',
    ["dispatching", "submission_unknown", id, "not_sent"],
  );
  if (affected !== 1) throw errCreationConflict;
}

export async function latestRouteAttempt(repo: Repository, taskID: string): Promise<RouteAttempt | null> {
  const rows = await repo.db.all<RouteAttemptRow>(
    `SELECT ${routeAttemptColumns} FROM "route_attempts" WHERE "task_id" = ? ORDER BY "route_run" DESC, "attempt_number" DESC LIMIT 1`,
    [taskID],
  );
  return rows.length ? mapRouteAttemptRow(rows[0]) : null;
}

export async function routeAttempts(repo: Repository, taskID: string, routeRun: number): Promise<RouteAttempt[]> {
  const rows = await repo.db.all<RouteAttemptRow>(
    `SELECT ${routeAttemptColumns} FROM "route_attempts" WHERE "task_id" = ? AND "route_run" = ? ORDER BY "attempt_number" ASC`,
    [taskID, routeRun],
  );
  return rows.map(mapRouteAttemptRow);
}

interface BillingOrderLimitRow {
  id: string;
  user_id: string;
  task_id: string | null;
  model: string;
  scene: string;
  amount_microcredits: number;
  reserved_amount_microcredits: number;
  charge_limit_set: unknown;
  charge_limit_microcredits: number;
}

/**
 * 同时更新任务执行目标和账单。跟随供应价格时会原子调整预留积分，
 * 保证明确未创建上游任务后的故障切线不会沿用上一条线路的价格快照。
 */
export async function switchTaskLogicalRoute(
  repo: Repository,
  taskID: string,
  expectedRouteID: string,
  routeID: string,
  inputJSON: string,
  billingOrderID: string,
  channelID: string,
  channelModelID: string,
  replacement: BillingOrder | null,
  cost: BillingCostSnapshot,
): Promise<void> {
  void cost;
  await repo.transaction(async (tx) => {
    const now = new Date().toISOString();
    const updated = await tx.db.run(
      'UPDATE "tasks" SET "route_id" = ?, "channel_model_id" = ?, "input_json" = ?, "updated_at" = ? WHERE "id" = ? AND "status" = ? AND "route_id" = ?',
      [routeID, channelModelID, inputJSON, now, taskID, taskStatusRunning, expectedRouteID],
    );
    if (updated !== 1) throw errTaskStateConflict;
    if (billingOrderID === "") return;

    const lockSuffix = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    const orderRows = await tx.db.all<BillingOrderLimitRow>(
      `SELECT "id", "user_id", "task_id", "model", "scene", "amount_microcredits", "reserved_amount_microcredits", "charge_limit_set", "charge_limit_microcredits" FROM "billing_orders" WHERE "id" = ? AND "task_id" = ? AND "status" IN (?, ?) LIMIT 1${lockSuffix}`,
      [billingOrderID, taskID, billingStatusReserved, billingStatusRunning],
    );
    if (!orderRows.length) throw recordNotFound;
    const order = orderRows[0];

    const updates: Record<string, unknown> = {
      channel_id: channelID,
      channel_model_id: channelModelID,
      updated_at: now,
    };
    if (replacement) {
      if (replacement.userId !== order.user_id || (replacement.taskId ?? "") !== taskID || replacement.amountMicrocredits <= 0) {
        throw errBillingStateConflict;
      }
      // 新供应价格不能扩大用户原始授权，沿用既有上限。
      const limitOrder = {
        chargeLimitSet: toBool(order.charge_limit_set),
        chargeLimitMicrocredits: Number(order.charge_limit_microcredits ?? 0),
      } as BillingOrder;
      validateBillingChargeLimit(limitOrder, replacement.amountMicrocredits);

      let reserved = Number(order.reserved_amount_microcredits ?? 0);
      if (reserved <= 0) reserved = Number(order.amount_microcredits ?? 0);
      const delta = replacement.amountMicrocredits - reserved;
      if (delta !== 0) {
        let accountSql = 'UPDATE "credit_accounts" SET "version" = "version" + 1, "updated_at" = ?';
        const values: (string | number)[] = [now];
        if (delta > 0) {
          accountSql += ', "available_microcredits" = "available_microcredits" - ?, "reserved_microcredits" = "reserved_microcredits" + ?';
          values.push(delta, delta);
        } else {
          const release = -delta;
          accountSql += ', "available_microcredits" = "available_microcredits" + ?, "reserved_microcredits" = "reserved_microcredits" - ?';
          values.push(release, release);
        }
        accountSql += ' WHERE "user_id" = ?';
        values.push(order.user_id);
        if (delta > 0) {
          accountSql += ' AND "available_microcredits" >= ?';
          values.push(delta);
        } else {
          accountSql += ' AND "reserved_microcredits" >= ?';
          values.push(-delta);
        }
        const accountUpdated = await tx.db.run(accountSql, values);
        if (accountUpdated !== 1) {
          if (delta > 0) throw errInsufficientCredits;
          throw new Error("reserved credit balance is inconsistent");
        }
        const accountRows = await tx.db.all<{ available_microcredits: number; reserved_microcredits: number }>(
          'SELECT "available_microcredits", "reserved_microcredits" FROM "credit_accounts" WHERE "user_id" = ? LIMIT 1',
          [order.user_id],
        );
        if (!accountRows.length) throw recordNotFound;
        const account: Pick<CreditAccount, "availableMicrocredits" | "reservedMicrocredits"> = {
          availableMicrocredits: Number(accountRows[0].available_microcredits ?? 0),
          reservedMicrocredits: Number(accountRows[0].reserved_microcredits ?? 0),
        };
        await tx.db.run(
          'INSERT INTO "credit_ledger_entries" ("id", "user_id", "type", "amount_microcredits", "available_delta_microcredits", "reserved_delta_microcredits", "available_after_microcredits", "reserved_after_microcredits", "billing_order_id", "payment_order_id", "redeem_code_id", "actor_user_id", "model", "channel_id", "scene", "note", "reference_key", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            newRepositoryId(),
            order.user_id,
            delta < 0 ? creditLedgerRefund : creditLedgerReserve,
            0,
            -delta,
            delta,
            account.availableMicrocredits,
            account.reservedMicrocredits,
            order.id,
            "",
            "",
            "",
            order.model,
            channelID,
            order.scene,
            "备用供应线路价格调整",
            null,
            now,
          ],
        );
      }
      updates.billing_mode = replacement.billingMode;
      updates.price_version = replacement.priceVersion;
      updates.price_tier_id = replacement.priceTierId ?? "";
      updates.price_tier_version = replacement.priceTierVersion;
      updates.unit_price_microcredits = replacement.unitPriceMicrocredits;
      updates.multiplier_basis_points = replacement.multiplierBasisPoints;
      updates.quantity = replacement.quantity;
      updates.amount_microcredits = replacement.amountMicrocredits;
      updates.reserved_amount_microcredits = replacement.amountMicrocredits;
      updates.input_token_price_microcredits = replacement.inputTokenPriceMicrocredits;
      updates.output_token_price_microcredits = replacement.outputTokenPriceMicrocredits;
      updates.cached_token_price_microcredits = replacement.cachedTokenPriceMicrocredits;
      updates.cache_write_token_price_microcredits = replacement.cacheWriteTokenPriceMicrocredits;
      updates.token_price_rules_json = replacement.tokenPriceRulesJson ?? "";
      updates.video_formula_tokens = replacement.videoFormulaTokens;
      updates.reference_video_count = replacement.referenceVideoCount;
      updates.reference_video_millis = replacement.referenceVideoMillis;
      updates.reference_video_billed = replacement.referenceVideoBilled;
    }
    const entries = Object.entries(updates);
    const setSql = entries.map(([column]) => `"${column}" = ?`).join(", ");
    const billingUpdated = await tx.db.run(
      `UPDATE "billing_orders" SET ${setSql} WHERE "id" = ? AND "task_id" = ? AND "status" IN (?, ?)`,
      [
        ...(entries.map(([, value]) => value) as (string | number | boolean | null)[]),
        billingOrderID,
        taskID,
        billingStatusReserved,
        billingStatusRunning,
      ],
    );
    if (billingUpdated !== 1) throw errBillingStateConflict;
  });
}

export async function saveLogicalModelBundle(
  repo: Repository,
  item: LogicalModel,
  revision: LogicalModelRevision,
  routes: LogicalModelRoute[],
  creating: boolean,
): Promise<void> {
  await repo.transaction(async (tx) => {
    if (creating) {
      await createLogicalModel(tx, item);
    } else {
      const affected = await tx.db.run(
        'UPDATE "logical_models" SET "code" = ?, "name" = ?, "icon" = ?, "description" = ?, "capability" = ?, "enabled" = ?, "sort_order" = ?, "source_channel_model_id" = ?, "price_policy" = ?, "billing_mode" = ?, "unit_price_microcredits" = ?, "input_price_microcredits" = ?, "output_price_microcredits" = ?, "cached_price_microcredits" = ?, "cache_write_price_microcredits" = ?, "legacy_model_i_ds_json" = ?, "updated_at" = ? WHERE "id" = ?',
        [
          item.code,
          item.name,
          item.icon,
          item.description,
          item.capability,
          item.enabled,
          item.sortOrder,
          item.sourceChannelModelId ?? "",
          item.pricePolicy,
          item.billingMode,
          item.unitPriceMicrocredits,
          item.inputPriceMicrocredits,
          item.outputPriceMicrocredits,
          item.cachedPriceMicrocredits,
          item.cacheWritePriceMicrocredits,
          item.legacyModelIDsJson ?? "",
          item.updatedAt,
          item.id,
        ],
      );
      if (affected !== 1) throw recordNotFound;
    }

    // 版本号必须由模型行原子递增，避免并发事务分配同一版本。
    const incremented = await tx.db.run(
      'UPDATE "logical_models" SET "revision_sequence" = "revision_sequence" + ? WHERE "id" = ?',
      [1, item.id],
    );
    if (incremented !== 1) throw recordNotFound;
    const sequenceRows = await tx.db.all<{ revision_sequence: number }>(
      'SELECT "revision_sequence" FROM "logical_models" WHERE "id" = ? LIMIT 1',
      [item.id],
    );
    if (!sequenceRows.length) throw recordNotFound;
    revision.version = Number(sequenceRows[0].revision_sequence ?? 0);
    await createLogicalModelRevision(tx, revision);
    for (let index = 0; index < routes.length; index += 1) {
      routes[index].logicalModelRevisionId = revision.id;
      await createLogicalModelRoute(tx, routes[index]);
    }
    await tx.db.run('UPDATE "logical_models" SET "active_revision_id" = ?, "updated_at" = ? WHERE "id" = ?', [
      revision.id,
      item.updatedAt,
      item.id,
    ]);
    item.activeRevisionId = revision.id;
    item.revisionSequence = revision.version;
  });
}

export async function archiveLogicalModel(
  repo: Repository,
  id: string,
  audit: AdminAuditEvent | null,
  now: string,
): Promise<void> {
  await repo.transaction(async (tx) => {
    // PostgreSQL 下锁定主体，使任务创建与归档在同一行上串行。
    const lockSuffix = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    const rows = await tx.db.all<{ id: string }>(
      `SELECT "id" FROM "logical_models" WHERE "id" = ? AND "archived_at" IS NULL LIMIT 1${lockSuffix}`,
      [id],
    );
    if (!rows.length) throw recordNotFound;
    const taskRows = await tx.db.all<{ total: number }>(
      'SELECT COUNT(*) AS "total" FROM "tasks" WHERE "logical_model_id" = ? AND "status" IN (?, ?)',
      [id, taskStatusQueued, taskStatusRunning],
    );
    if (Number(taskRows[0]?.total ?? 0) > 0) throw errLogicalModelInUse;
    const archived = await tx.db.run(
      'UPDATE "logical_models" SET "enabled" = ?, "archived_at" = ?, "updated_at" = ? WHERE "id" = ? AND "archived_at" IS NULL',
      [false, now, now, id],
    );
    if (archived !== 1) throw recordNotFound;
    if (audit) await insertAdminAuditEvent(tx, audit);
  });
}

/** 与归档共用主体行锁，保证新任务只引用仍在目录中的当前 revision。 */
export async function requireActiveLogicalModelForTask(
  repo: Repository,
  tx: Repository,
  task: Task | null,
): Promise<void> {
  if (!task || !task.logicalModelId) return;
  const lockSuffix = repo.dialect() === "postgres" ? " FOR UPDATE" : "";
  const rows = await tx.db.all<{ id: string }>(
    `SELECT "id" FROM "logical_models" WHERE "id" = ? AND "enabled" = ? AND "archived_at" IS NULL AND "active_revision_id" = ? LIMIT 1${lockSuffix}`,
    [task.logicalModelId, true, task.logicalModelRevisionId ?? ""],
  );
  if (!rows.length) throw errLogicalModelUnavailable;
}

export async function deleteLogicalModelRoute(repo: Repository, id: string): Promise<void> {
  await repo.db.run(
    'UPDATE "logical_model_routes" SET "enabled" = ?, "weight" = ?, "updated_at" = ? WHERE "id" = ?',
    [false, 0, new Date().toISOString(), id],
  );
}

async function saveLogicalModelRow(repo: Repository, item: LogicalModel): Promise<void> {
  if (item.id !== "") {
    const values = logicalModelValues(item).slice(1);
    const affected = await repo.db.run(
      `UPDATE "logical_models" SET "code" = ?, "name" = ?, "icon" = ?, "description" = ?, "capability" = ?, "enabled" = ?, "sort_order" = ?, "revision_sequence" = ?, "active_revision_id" = ?, "source_channel_model_id" = ?, "price_policy" = ?, "billing_mode" = ?, "unit_price_microcredits" = ?, "input_price_microcredits" = ?, "output_price_microcredits" = ?, "cached_price_microcredits" = ?, "cache_write_price_microcredits" = ?, "legacy_model_i_ds_json" = ?, "archived_at" = ?, "created_at" = ?, "updated_at" = ? WHERE "id" = ?`,
      [...values, item.id],
    );
    if (affected > 0) return;
  }
  await createLogicalModel(repo, item);
}

async function insertAdminAuditEvent(repo: Repository, audit: AdminAuditEvent): Promise<void> {
  await repo.db.run(
    'INSERT INTO "admin_audit_events" ("id", "actor_user_id", "action", "target_type", "target_id", "summary", "metadata_json", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [audit.id, audit.actorUserId, audit.action, audit.targetType, audit.targetId, audit.summary, audit.metadataJson, audit.createdAt],
  );
}
