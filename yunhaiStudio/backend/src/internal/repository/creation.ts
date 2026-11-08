// 对应 backend/internal/repository/creation.go
// 创作会话：运行记录、提交单、存储用量与价格签名。

import type { CanvasProject } from "@/internal/model/modelsProject";
import type { CreationRun, CreationSubmission } from "@/internal/model/modelsCreation";
import type { Task } from "@/internal/model/modelsTask";
import { recordNotFound, Repository, toBool, toIso, toNullableIso } from "./repository";
import { upsertCanvasProject } from "./repositoryAssetsCanvases";

export const errCreationConflict = new Error("数据已被更新，请刷新后重试");

interface CreationRunRow {
  id: string;
  user_id: string | null;
  client_key: string | null;
  create_hash: string | null;
  canvas_id: string | null;
  revision: number | null;
  execution_epoch: number | null;
  execution_owner: string | null;
  lease_expires_at: string | null;
  status: string | null;
  state_json: string | null;
  approved_proposal_version: number | null;
  approved_proposal_hash: string | null;
  approved_operations_json: string | null;
  approved_canvas_json: string | null;
  approved_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface CreationSubmissionRow {
  id: string;
  user_id: string | null;
  run_id: string | null;
  item_key: string | null;
  proposal_version: number | null;
  proposal_hash: string | null;
  request_json: string | null;
  request_hash: string | null;
  quote_json: string | null;
  price_signature: string | null;
  expires_at: string | null;
  approved_at: string | null;
  revoked_at: string | null;
  task_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function mapCreationRun(row: CreationRunRow): CreationRun {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    clientKey: row.client_key ?? "",
    createHash: row.create_hash ?? "",
    canvasId: row.canvas_id ?? "",
    revision: Number(row.revision ?? 0),
    executionEpoch: Number(row.execution_epoch ?? 0),
    executionOwner: row.execution_owner ?? "",
    leaseExpiresAt: toNullableIso(row.lease_expires_at),
    status: row.status ?? "",
    stateJson: row.state_json ?? "",
    approvedProposalVersion: Number(row.approved_proposal_version ?? 0),
    approvedProposalHash: row.approved_proposal_hash ?? "",
    approvedOperationsJson: row.approved_operations_json ?? "",
    approvedCanvasJson: row.approved_canvas_json ?? "",
    approvedAt: toNullableIso(row.approved_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapCreationSubmission(row: CreationSubmissionRow): CreationSubmission {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    runId: row.run_id ?? "",
    itemKey: row.item_key ?? "",
    proposalVersion: Number(row.proposal_version ?? 0),
    proposalHash: row.proposal_hash ?? "",
    requestJson: row.request_json ?? "",
    requestHash: row.request_hash ?? "",
    quoteJson: row.quote_json ?? "",
    priceSignature: row.price_signature ?? "",
    expiresAt: toIso(row.expires_at),
    approvedAt: toNullableIso(row.approved_at),
    revokedAt: toNullableIso(row.revoked_at),
    taskId: row.task_id ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function creationStorageUsage(
  repo: Repository,
  userId: string,
): Promise<{ count: number; bytes: number }> {
  let query = `SELECT (SELECT COUNT(*) FROM creation_runs WHERE user_id = ?) AS count,
	(SELECT COALESCE(SUM(length(CAST(COALESCE(state_json,'') AS BLOB))+length(CAST(COALESCE(approved_operations_json,'') AS BLOB))+length(CAST(COALESCE(approved_canvas_json,'') AS BLOB))),0) FROM creation_runs WHERE user_id = ?)
	+ (SELECT COALESCE(SUM(length(CAST(COALESCE(request_json,'') AS BLOB))+length(CAST(COALESCE(quote_json,'') AS BLOB))+length(CAST(COALESCE(price_signature,'') AS BLOB))),0) FROM creation_submissions WHERE user_id = ?) AS bytes`;
  if (repo.dialect() === "postgres") {
    query = query.split("length(CAST(COALESCE(").join("octet_length(COALESCE(");
    query = query.split(",'') AS BLOB))").join(",''))");
  }
  const rows = await repo.db.all<{ count: number; bytes: number }>(query, [userId, userId, userId]);
  return {
    count: Number(rows[0]?.count ?? 0),
    bytes: Number(rows[0]?.bytes ?? 0),
  };
}

export async function creationRun(repo: Repository, userId: string, id: string): Promise<CreationRun | null> {
  const rows = await repo.db.all<CreationRunRow>(
    'SELECT * FROM "creation_runs" WHERE "id" = ? AND "user_id" = ? LIMIT 1',
    [id, userId],
  );
  return rows.length ? mapCreationRun(rows[0]) : null;
}

export async function creationRunByClientKey(repo: Repository, userId: string, key: string): Promise<CreationRun | null> {
  const rows = await repo.db.all<CreationRunRow>(
    'SELECT * FROM "creation_runs" WHERE "user_id" = ? AND "client_key" = ? LIMIT 1',
    [userId, key],
  );
  return rows.length ? mapCreationRun(rows[0]) : null;
}

export async function creationRuns(repo: Repository, userId: string): Promise<CreationRun[]> {
  const rows = await repo.db.all<CreationRunRow>(
    'SELECT * FROM "creation_runs" WHERE "user_id" = ? ORDER BY "updated_at" DESC LIMIT 100',
    [userId],
  );
  return rows.map(mapCreationRun);
}

export async function createCreationRun(repo: Repository, run: CreationRun): Promise<void> {
  const existing = await creationRunByClientKey(repo, run.userId, run.clientKey ?? "");
  if (existing) {
    if (existing.createHash !== (run.createHash ?? "")) throw errCreationConflict;
    Object.assign(run, existing);
    return;
  }
  try {
    await insertCreationRun(repo, run);
  } catch (error) {
    const retried = await creationRunByClientKey(repo, run.userId, run.clientKey ?? "");
    if (retried && retried.createHash === (run.createHash ?? "")) {
      Object.assign(run, retried);
      return;
    }
    throw error;
  }
}

async function insertCreationRun(repo: Repository, run: CreationRun): Promise<void> {
  await repo.db.run(
    'INSERT INTO "creation_runs" ("id", "user_id", "client_key", "create_hash", "canvas_id", "revision", "execution_epoch", "execution_owner", "lease_expires_at", "status", "state_json", "approved_proposal_version", "approved_proposal_hash", "approved_operations_json", "approved_canvas_json", "approved_at", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      run.id,
      run.userId,
      run.clientKey ?? "",
      run.createHash ?? "",
      run.canvasId ?? "",
      run.revision ?? 0,
      run.executionEpoch ?? 0,
      run.executionOwner ?? "",
      run.leaseExpiresAt ?? null,
      run.status,
      run.stateJson ?? "",
      run.approvedProposalVersion ?? 0,
      run.approvedProposalHash ?? "",
      run.approvedOperationsJson ?? "",
      run.approvedCanvasJson ?? "",
      run.approvedAt ?? null,
      run.createdAt,
      run.updatedAt,
    ],
  );
}

// 条件写入先取得运行行的写锁（SQLite 与 PostgreSQL 同样适用）。
// 所有提交单消耗与任务预占都使用返回的事务仓储，保证快照一致。
export async function mutateCreationRun(
  repo: Repository,
  userId: string,
  id: string,
  fn: (run: CreationRun, tx: Repository) => Promise<void> | void,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const changes = await tx.db.run('UPDATE "creation_runs" SET "revision" = "revision" WHERE "id" = ? AND "user_id" = ?', [
      id,
      userId,
    ]);
    if (changes !== 1) throw recordNotFound;
    const run = await creationRun(tx, userId, id);
    if (!run) throw recordNotFound;
    await fn(run, tx);
    await tx.db.run(
      'UPDATE "creation_runs" SET "user_id" = ?, "client_key" = ?, "create_hash" = ?, "canvas_id" = ?, "revision" = ?, "execution_epoch" = ?, "execution_owner" = ?, "lease_expires_at" = ?, "status" = ?, "state_json" = ?, "approved_proposal_version" = ?, "approved_proposal_hash" = ?, "approved_operations_json" = ?, "approved_canvas_json" = ?, "approved_at" = ?, "created_at" = ?, "updated_at" = ? WHERE "id" = ?',
      [
        run.userId,
        run.clientKey ?? "",
        run.createHash ?? "",
        run.canvasId ?? "",
        run.revision ?? 0,
        run.executionEpoch ?? 0,
        run.executionOwner ?? "",
        run.leaseExpiresAt ?? null,
        run.status,
        run.stateJson ?? "",
        run.approvedProposalVersion ?? 0,
        run.approvedProposalHash ?? "",
        run.approvedOperationsJson ?? "",
        run.approvedCanvasJson ?? "",
        run.approvedAt ?? null,
        run.createdAt,
        run.updatedAt,
        id,
      ],
    );
  });
}

export async function creationSubmissions(
  repo: Repository,
  userId: string,
  runId: string,
): Promise<CreationSubmission[]> {
  const rows = await repo.db.all<CreationSubmissionRow>(
    'SELECT * FROM "creation_submissions" WHERE "user_id" = ? AND "run_id" = ? ORDER BY "created_at" ASC',
    [userId, runId],
  );
  return rows.map(mapCreationSubmission);
}

export async function creationSubmission(
  repo: Repository,
  userId: string,
  runId: string,
  id: string,
): Promise<CreationSubmission | null> {
  const rows = await repo.db.all<CreationSubmissionRow>(
    'SELECT * FROM "creation_submissions" WHERE "id" = ? AND "user_id" = ? AND "run_id" = ? LIMIT 1',
    [id, userId, runId],
  );
  return rows.length ? mapCreationSubmission(rows[0]) : null;
}

// GORM Save 语义：先整行更新，主键不存在时再插入。
export async function saveCreationSubmission(repo: Repository, item: CreationSubmission): Promise<void> {
  const values: (string | number | null)[] = [
    item.userId ?? "",
    item.runId,
    item.itemKey,
    item.proposalVersion ?? 0,
    item.proposalHash ?? "",
    item.requestJson ?? "",
    item.requestHash,
    item.quoteJson ?? "",
    item.priceSignature ?? "",
    item.expiresAt ?? "",
    item.approvedAt ?? null,
    item.revokedAt ?? null,
    item.taskId ?? null,
    item.createdAt ?? "",
    item.updatedAt ?? "",
  ];
  if (item.id !== "") {
    const affected = await repo.db.run(
      'UPDATE "creation_submissions" SET "user_id" = ?, "run_id" = ?, "item_key" = ?, "proposal_version" = ?, "proposal_hash" = ?, "request_json" = ?, "request_hash" = ?, "quote_json" = ?, "price_signature" = ?, "expires_at" = ?, "approved_at" = ?, "revoked_at" = ?, "task_id" = ?, "created_at" = ?, "updated_at" = ? WHERE "id" = ?',
      [...values, item.id],
    );
    if (affected > 0) return;
  }
  await repo.db.run(
    'INSERT INTO "creation_submissions" ("id", "user_id", "run_id", "item_key", "proposal_version", "proposal_hash", "request_json", "request_hash", "quote_json", "price_signature", "expires_at", "approved_at", "revoked_at", "task_id", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [item.id, ...values],
  );
}

export async function revokeCreationSubmissions(repo: Repository, runId: string): Promise<void> {
  await repo.db.run(
    'UPDATE "creation_submissions" SET "revoked_at" = ? WHERE "run_id" = ? AND "task_id" IS NULL AND "revoked_at" IS NULL',
    [new Date().toISOString(), runId],
  );
}

export async function createCreationCanvas(repo: Repository, canvas: CanvasProject): Promise<void> {
  await upsertCanvasProject(repo, canvas);
}

// 捕获服务端配置版本，绝不包含渠道凭据。
export async function creationPriceSignature(
  repo: Repository,
  task: Task,
  channelId: string,
  modelKey: string,
): Promise<string> {
  const locking = repo.dialect() === "postgres" ? " FOR SHARE" : "";
  const channelModelId = task.channelModelId ?? "";
  let channelModelRows: Record<string, unknown>[];
  if (channelModelId !== "") {
    channelModelRows = await repo.db.all<Record<string, unknown>>(
      `SELECT * FROM "channel_models" WHERE "id" = ? ORDER BY "id" LIMIT 1${locking}`,
      [channelModelId],
    );
  } else {
    channelModelRows = await repo.db.all<Record<string, unknown>>(
      `SELECT * FROM "channel_models" WHERE "channel_id" = ? AND "model_key" = ? ORDER BY "id" LIMIT 1${locking}`,
      [channelId, modelKey],
    );
  }
  if (!channelModelRows.length) throw recordNotFound;
  const channelModelRow = channelModelRows[0];
  const channelModelSnapshot = camelizeRow(channelModelRow);
  delete channelModelSnapshot.capabilityConfigJson;
  delete channelModelSnapshot.deletedAt;
  channelModelSnapshot.tags = parseJsonArray(channelModelRow.tags);

  const channelRows = await repo.db.all<Record<string, unknown>>(
    `SELECT "id", "enabled", "updated_at" FROM "model_channels" WHERE "id" = ? ORDER BY "id" LIMIT 1${locking}`,
    [String(channelModelRow.channel_id ?? "")],
  );
  if (!channelRows.length) throw recordNotFound;
  const channelRow = channelRows[0];

  const tierRows = await repo.db.all<Record<string, unknown>>(
    `SELECT * FROM "channel_model_price_tiers" WHERE "channel_model_id" = ? ORDER BY "id"${locking}`,
    [String(channelModelRow.id ?? "")],
  );
  const tiers = tierRows.map((row) => {
    const snapshot = camelizeRow(row);
    delete snapshot.costPricing;
    delete snapshot.selectorJson;
    delete snapshot.deletedAt;
    snapshot.tokenPriceRules = parseJsonArray(row.token_price_rules);
    return snapshot;
  });

  const values: Record<string, unknown> = {
    channelModel: channelModelSnapshot,
    capabilityConfig: channelModelRow.capability_config_json ?? "",
    channel: {
      id: channelRow.id,
      enabled: toBool(channelRow.enabled),
      updatedAt: channelRow.updated_at,
    },
    tiers,
  };

  if ((task.logicalModelId ?? "") !== "") {
    const logicalRows = await repo.db.all<Record<string, unknown>>(
      `SELECT * FROM "logical_models" WHERE "id" = ? ORDER BY "id" LIMIT 1${locking}`,
      [task.logicalModelId ?? ""],
    );
    if (!logicalRows.length) throw recordNotFound;
    const logicalSnapshot = camelizeRow(logicalRows[0]);
    delete logicalSnapshot.revisionSequence;
    delete logicalSnapshot.legacyModelIdsJson;
    delete logicalSnapshot.archivedAt;
    values.logical = logicalSnapshot;

    const routeRows = await repo.db.all<Record<string, unknown>>(
      `SELECT * FROM "logical_model_routes" WHERE "id" = ? ORDER BY "id" LIMIT 1${locking}`,
      [task.routeId ?? ""],
    );
    if (!routeRows.length) throw recordNotFound;
    values.route = camelizeRow(routeRows[0]);
  }

  const settingRows = await repo.db.all<Record<string, unknown>>(
    `SELECT * FROM "system_settings" WHERE "key" IN (?, ?) ORDER BY "key"${locking}`,
    ["credit_policy", "feature_availability"],
  );
  values.pricingSettings = settingRows.map(camelizeRow);

  return JSON.stringify(values);
}

function camelizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    result[key.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase())] = value;
  }
  return result;
}

function parseJsonArray(value: unknown): unknown[] {
  if (typeof value !== "string" || value === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
