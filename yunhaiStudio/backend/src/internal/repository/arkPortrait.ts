// 对应 backend/internal/repository/ark_portrait.go
// 方舟真人认证会话、素材组、组授权与素材状态流转。

import {
  billingStatusRefunded,
  billingStatusReserved,
  billingStatusRunning,
  billingStatusSettled,
  creditLedgerConsume,
  creditLedgerRefund,
} from "@/internal/model/models";
import type { BillingOrder } from "@/internal/model/modelsFinance";
import type { Asset } from "@/internal/model/modelsProject";
import type { ArkPortraitAsset, ArkPortraitGroup, ArkPortraitGroupGrant, ArkPortraitSession } from "@/internal/model/modelsPlatform";
import { billingSceneArkAssetGroup } from "@/internal/model/modelsPlatform";
import type { SqlValue } from "@/internal/database/database";
import { recordNotFound, Repository, toBool, toIso, toNullableIso } from "./repository";
import { errBillingStateConflict, insertCreditLedgerEntry, newRepositoryId } from "./finance";
import { billingOrderColumns, mapBillingOrder, reserveBillingOrder, type BillingOrderRow } from "./financeBilling";
import { assetForUser } from "./repositoryAssetsCanvases";

export const errArkPortraitSessionClosed = new Error("认证会话已结束");
export const errArkPortraitGroupTaken = new Error("该素材组已被其他账号登记");

const arkPortraitSessionPending = "pending";
const arkPortraitSessionDone = "verified";

const arkPortraitExpiringWindowMs = 30 * 24 * 60 * 60 * 1000;

interface ArkPortraitSessionRow {
  id: string;
  user_id: string;
  scope: string;
  state: string | null;
  name: string | null;
  description: string | null;
  site: string | null;
  region: string | null;
  project_name: string | null;
  byted_token_cipher: string | null;
  status: string | null;
  result_code: string | null;
  group_id: string | null;
  error: string | null;
  billing_order_id: string | null;
  expires_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const arkPortraitSessionColumns =
  '"id", "user_id", "scope", "state", "name", "description", "site", "region", "project_name", "byted_token_cipher", "status", "result_code", "group_id", "error", "billing_order_id", "expires_at", "created_at", "updated_at"';

function mapArkPortraitSession(row: ArkPortraitSessionRow): ArkPortraitSession {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    scope: row.scope ?? "",
    state: row.state ?? "",
    name: row.name ?? "",
    description: row.description ?? "",
    site: row.site ?? "",
    region: row.region ?? "",
    projectName: row.project_name ?? "",
    bytedTokenCipher: row.byted_token_cipher ?? "",
    status: row.status ?? "",
    resultCode: row.result_code ?? "",
    groupId: row.group_id ?? "",
    error: row.error ?? "",
    billingOrderId: row.billing_order_id ?? "",
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

interface ArkPortraitGroupRow {
  id: string;
  user_id: string;
  kind: string;
  scope: string;
  name: string | null;
  description: string | null;
  site: string | null;
  region: string | null;
  project_name: string | null;
  group_id: string | null;
  source: string | null;
  grant_all: unknown;
  authorized_at: string | null;
  expires_at: string | null;
  billing_order_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const arkPortraitGroupColumns =
  '"id", "user_id", "kind", "scope", "name", "description", "site", "region", "project_name", "group_id", "source", "grant_all", "authorized_at", "expires_at", "billing_order_id", "created_at", "updated_at"';

function mapArkPortraitGroup(row: ArkPortraitGroupRow): ArkPortraitGroup {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    kind: row.kind ?? "",
    scope: row.scope ?? "",
    name: row.name ?? "",
    description: row.description ?? "",
    site: row.site ?? "",
    region: row.region ?? "",
    projectName: row.project_name ?? "",
    groupId: row.group_id ?? "",
    source: row.source ?? "",
    grantAll: toBool(row.grant_all),
    authorizedAt: toNullableIso(row.authorized_at),
    expiresAt: toNullableIso(row.expires_at),
    billingOrderId: row.billing_order_id ?? "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

interface ArkPortraitAssetRow {
  id: string;
  user_id: string;
  group_id: string | null;
  resource_id: string | null;
  ark_asset_id: string | null;
  asset_type: string | null;
  name: string | null;
  status: string | null;
  error: string | null;
  library_asset_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const arkPortraitAssetColumns =
  '"id", "user_id", "group_id", "resource_id", "ark_asset_id", "asset_type", "name", "status", "error", "library_asset_id", "reviewed_by", "reviewed_at", "created_at", "updated_at"';

function mapArkPortraitAsset(row: ArkPortraitAssetRow): ArkPortraitAsset {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    groupId: row.group_id ?? "",
    resourceId: row.resource_id ?? "",
    arkAssetId: row.ark_asset_id ?? "",
    assetType: row.asset_type ?? "",
    name: row.name ?? "",
    status: row.status ?? "",
    error: row.error ?? "",
    libraryAssetId: row.library_asset_id ?? "",
    reviewedBy: row.reviewed_by ?? "",
    reviewedAt: toNullableIso(row.reviewed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

interface ArkPortraitGroupGrantRow {
  id: string;
  group_id: string;
  user_id: string;
  created_by: string | null;
  created_at: string | null;
}

const arkPortraitGroupGrantColumns = '"id", "group_id", "user_id", "created_by", "created_at"';

function mapArkPortraitGroupGrant(row: ArkPortraitGroupGrantRow): ArkPortraitGroupGrant {
  return {
    id: row.id,
    groupId: row.group_id,
    userId: row.user_id,
    createdBy: row.created_by ?? "",
    createdAt: toIso(row.created_at),
  };
}

// 在同一事务中冻结素材组费用并登记认证会话；余额不足时两者都不写入。
export async function createArkPortraitSessionWithReservation(
  repo: Repository,
  session: ArkPortraitSession,
  order: BillingOrder | null,
): Promise<void> {
  await repo.transaction(async (tx) => {
    if (order) await reserveBillingOrder(tx, order);
    await tx.db.run(
      `INSERT INTO "ark_portrait_sessions" (${arkPortraitSessionColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.userId,
        session.scope,
        session.state ?? "",
        session.name,
        session.description,
        session.site,
        session.region,
        session.projectName,
        session.bytedTokenCipher ?? "",
        session.status,
        session.resultCode ?? "",
        session.groupId ?? "",
        session.error ?? "",
        session.billingOrderId ?? "",
        session.expiresAt,
        session.createdAt,
        session.updatedAt,
      ],
    );
  });
}

export async function setArkPortraitSessionToken(repo: Repository, id: string, cipher: string): Promise<void> {
  const now = new Date().toISOString();
  await repo.db.run(
    'UPDATE "ark_portrait_sessions" SET "byted_token_cipher" = ?, "updated_at" = ? WHERE "id" = ? AND "status" = ?',
    [cipher, now, id, arkPortraitSessionPending],
  );
}

export async function arkPortraitSessionByState(repo: Repository, state: string): Promise<ArkPortraitSession | null> {
  const rows = await repo.db.all<ArkPortraitSessionRow>(
    `SELECT ${arkPortraitSessionColumns} FROM "ark_portrait_sessions" WHERE "state" = ? LIMIT 1`,
    [state],
  );
  return rows.length ? mapArkPortraitSession(rows[0]) : null;
}

export async function arkPortraitSessionForUser(repo: Repository, userId: string, id: string): Promise<ArkPortraitSession | null> {
  const rows = await repo.db.all<ArkPortraitSessionRow>(
    `SELECT ${arkPortraitSessionColumns} FROM "ark_portrait_sessions" WHERE "id" = ? AND "user_id" = ? LIMIT 1`,
    [id, userId],
  );
  return rows.length ? mapArkPortraitSession(rows[0]) : null;
}

// 返回用户在指定范围内尚未过期的待认证会话，按创建时间倒序。
export async function pendingArkPortraitSessions(
  repo: Repository,
  userId: string,
  scope: string,
  now: string,
  limit: number,
): Promise<ArkPortraitSession[]> {
  const rows = await repo.db.all<ArkPortraitSessionRow>(
    `SELECT ${arkPortraitSessionColumns} FROM "ark_portrait_sessions" WHERE "user_id" = ? AND "scope" = ? AND "status" = ? AND "expires_at" > ? ORDER BY "created_at" DESC LIMIT ?`,
    [userId, scope, arkPortraitSessionPending, now, limit],
  );
  return rows.map(mapArkPortraitSession);
}

export async function countRecentArkPortraitSessions(repo: Repository, userId: string, since: string): Promise<number> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "ark_portrait_sessions" WHERE "user_id" = ? AND "created_at" > ?',
    [userId, since],
  );
  return Number(rows[0]?.total ?? 0);
}

// 统计用户自建、仍在有效期内的待认证会话；它们占用真人素材组额度。
export async function countActiveArkPortraitUserSessions(repo: Repository, userId: string, now: string): Promise<number> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "ark_portrait_sessions" WHERE "user_id" = ? AND "scope" = ? AND "status" = ? AND "expires_at" > ?',
    [userId, "user", arkPortraitSessionPending, now],
  );
  return Number(rows[0]?.total ?? 0);
}

export async function expiredPendingArkPortraitSessions(repo: Repository, now: string, limit: number): Promise<ArkPortraitSession[]> {
  const rows = await repo.db.all<ArkPortraitSessionRow>(
    `SELECT ${arkPortraitSessionColumns} FROM "ark_portrait_sessions" WHERE "status" = ? AND "expires_at" <= ? ORDER BY "expires_at" ASC LIMIT ?`,
    [arkPortraitSessionPending, now, limit],
  );
  return rows.map(mapArkPortraitSession);
}

// 只结束仍为 pending 的会话，并在同一事务里退回冻结的素材组费用；
// 回调、轮询、取消与过期清理并发时只有一方生效，返回值表示本次调用是否生效。
export async function finishArkPortraitSession(
  repo: Repository,
  id: string,
  status: string,
  resultCode: string,
  message: string,
  refundNote: string,
): Promise<boolean> {
  let finished = false;
  await repo.transaction(async (tx) => {
    const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    const rows = await tx.db.all<ArkPortraitSessionRow>(
      `SELECT ${arkPortraitSessionColumns} FROM "ark_portrait_sessions" WHERE "id" = ? LIMIT 1${locking}`,
      [id],
    );
    if (!rows.length) throw recordNotFound;
    const session = mapArkPortraitSession(rows[0]);
    if (session.status !== arkPortraitSessionPending) return;
    const now = new Date().toISOString();
    const changes = await tx.db.run(
      'UPDATE "ark_portrait_sessions" SET "status" = ?, "result_code" = ?, "error" = ?, "updated_at" = ? WHERE "id" = ? AND "status" = ?',
      [status, resultCode, message, now, id, arkPortraitSessionPending],
    );
    if (changes !== 1) return;
    finished = true;
    if ((session.billingOrderId ?? "") === "") return;
    await refundArkGroupOrder(tx, session.billingOrderId ?? "", refundNote);
  });
  return finished;
}

// 把认证成功的会话登记为素材组并结算冻结费用，三者在同一事务里完成。
// 会话已由并发调用完成时返回已登记的素材组；已失败、过期或取消时返回 ErrArkPortraitSessionClosed。
export async function completeArkPortraitSession(
  repo: Repository,
  sessionId: string,
  group: ArkPortraitGroup,
  settleNote: string,
): Promise<ArkPortraitGroup | null> {
  let registered: ArkPortraitGroup | null = null;
  await repo.transaction(async (tx) => {
    const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    const rows = await tx.db.all<ArkPortraitSessionRow>(
      `SELECT ${arkPortraitSessionColumns} FROM "ark_portrait_sessions" WHERE "id" = ? LIMIT 1${locking}`,
      [sessionId],
    );
    if (!rows.length) throw recordNotFound;
    const session = mapArkPortraitSession(rows[0]);
    if (session.status === arkPortraitSessionDone) {
      const existing = await tx.db.all<ArkPortraitGroupRow>(
        `SELECT ${arkPortraitGroupColumns} FROM "ark_portrait_groups" WHERE "project_name" = ? AND "group_id" = ? LIMIT 1`,
        [session.projectName, session.groupId ?? ""],
      );
      if (!existing.length) throw recordNotFound;
      registered = mapArkPortraitGroup(existing[0]);
      return;
    }
    if (session.status !== arkPortraitSessionPending) throw errArkPortraitSessionClosed;
    registered = await createArkPortraitGroup(tx, group);
    const now = new Date().toISOString();
    await tx.db.run(
      'UPDATE "ark_portrait_sessions" SET "status" = ?, "result_code" = ?, "group_id" = ?, "error" = ?, "updated_at" = ? WHERE "id" = ?',
      [arkPortraitSessionDone, "10000", group.groupId, "", now, sessionId],
    );
    if ((session.billingOrderId ?? "") === "") return;
    await settleArkGroupOrder(tx, session.billingOrderId ?? "", settleNote);
  });
  return registered;
}

// 登记已在方舟创建的素材组，并结算创建前冻结的费用。
export async function createArkPortraitGroupWithCharge(
  repo: Repository,
  group: ArkPortraitGroup,
  settleNote: string,
): Promise<ArkPortraitGroup | null> {
  let registered: ArkPortraitGroup | null = null;
  await repo.transaction(async (tx) => {
    registered = await createArkPortraitGroup(tx, group);
    if ((group.billingOrderId ?? "") === "") return;
    await settleArkGroupOrder(tx, group.billingOrderId ?? "", settleNote);
  });
  return registered;
}

// 以 (ProjectName, GroupID) 去重；同一账号重复登记返回已有记录，其他账号已登记时拒绝。
async function createArkPortraitGroup(tx: Repository, group: ArkPortraitGroup): Promise<ArkPortraitGroup> {
  const changes = await tx.db.run(
    `INSERT INTO "ark_portrait_groups" (${arkPortraitGroupColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT ("project_name", "group_id") DO NOTHING`,
    [
      group.id,
      group.userId,
      group.kind,
      group.scope,
      group.name,
      group.description,
      group.site,
      group.region,
      group.projectName,
      group.groupId,
      group.source,
      group.grantAll,
      group.authorizedAt,
      group.expiresAt,
      group.billingOrderId ?? "",
      group.createdAt,
      group.updatedAt,
    ],
  );
  if (changes === 1) return group;
  const rows = await tx.db.all<ArkPortraitGroupRow>(
    `SELECT ${arkPortraitGroupColumns} FROM "ark_portrait_groups" WHERE "project_name" = ? AND "group_id" = ? LIMIT 1`,
    [group.projectName, group.groupId],
  );
  if (!rows.length) throw recordNotFound;
  const existing = mapArkPortraitGroup(rows[0]);
  if (existing.userId !== group.userId || existing.scope !== group.scope) throw errArkPortraitGroupTaken;
  return existing;
}

// 退回未完成的素材组费用；订单已结算或已退回时不重复处理。
export async function refundArkGroupBillingOrder(repo: Repository, orderId: string, note: string): Promise<void> {
  await repo.transaction(async (tx) => {
    await refundArkGroupOrder(tx, orderId, note);
  });
}

// 返回长时间仍处于冻结状态、且没有待认证会话引用的素材组订单
// （例如创建虚拟组时进程中断）。真人认证会话由过期清理负责退回，不在这里重复处理。
export async function staleArkGroupBillingOrders(repo: Repository, before: string, limit: number): Promise<BillingOrder[]> {
  const rows = await repo.db.all<BillingOrderRow>(
    `SELECT ${billingOrderColumns} FROM "billing_orders" WHERE "scene" = ? AND "status" = ? AND "created_at" < ? AND "id" NOT IN (SELECT "billing_order_id" FROM "ark_portrait_sessions" WHERE "status" = ? AND "billing_order_id" <> '') ORDER BY "created_at" ASC LIMIT ?`,
    [billingSceneArkAssetGroup, billingStatusReserved, before, arkPortraitSessionPending, limit],
  );
  return rows.map(mapBillingOrder);
}

async function settleArkGroupOrder(tx: Repository, orderId: string, note: string): Promise<void> {
  const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
  const orderRows = await tx.db.all<BillingOrderRow>(
    `SELECT ${billingOrderColumns} FROM "billing_orders" WHERE "id" = ? LIMIT 1${locking}`,
    [orderId],
  );
  if (!orderRows.length) throw recordNotFound;
  const order = mapBillingOrder(orderRows[0]);
  if (order.status === billingStatusSettled) return;
  if (order.scene !== billingSceneArkAssetGroup || (order.status !== billingStatusReserved && order.status !== billingStatusRunning)) {
    throw errBillingStateConflict;
  }
  const now = new Date().toISOString();
  const updated = await tx.db.run(
    'UPDATE "credit_accounts" SET "reserved_microcredits" = "reserved_microcredits" - ?, "version" = "version" + 1, "updated_at" = ? WHERE "user_id" = ? AND "reserved_microcredits" >= ?',
    [order.amountMicrocredits, now, order.userId, order.amountMicrocredits],
  );
  if (updated !== 1) throw new Error("reserved credit balance is inconsistent");
  const accountRows = await tx.db.all<{ available_microcredits: number | null; reserved_microcredits: number | null }>(
    'SELECT "available_microcredits", "reserved_microcredits" FROM "credit_accounts" WHERE "user_id" = ? LIMIT 1',
    [order.userId],
  );
  if (!accountRows.length) throw recordNotFound;
  await tx.db.run(
    'UPDATE "billing_orders" SET "status" = ?, "actual_amount_microcredits" = ?, "settled_at" = ?, "updated_at" = ? WHERE "id" = ?',
    [billingStatusSettled, order.amountMicrocredits, now, now, order.id],
  );
  await insertCreditLedgerEntry(
    tx,
    {
      id: newRepositoryId(),
      userId: order.userId,
      type: creditLedgerConsume,
      amountMicrocredits: -order.amountMicrocredits,
      reservedDeltaMicrocredits: -order.amountMicrocredits,
      availableAfterMicrocredits: Number(accountRows[0].available_microcredits ?? 0),
      reservedAfterMicrocredits: Number(accountRows[0].reserved_microcredits ?? 0),
      billingOrderId: order.id,
      model: order.model,
      scene: order.scene,
      note: truncateArkNote(note),
    },
    now,
  );
}

async function refundArkGroupOrder(tx: Repository, orderId: string, note: string): Promise<void> {
  const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
  const orderRows = await tx.db.all<BillingOrderRow>(
    `SELECT ${billingOrderColumns} FROM "billing_orders" WHERE "id" = ? LIMIT 1${locking}`,
    [orderId],
  );
  if (!orderRows.length) throw recordNotFound;
  const order = mapBillingOrder(orderRows[0]);
  if (order.status === billingStatusRefunded || order.status === billingStatusSettled) return;
  if (order.scene !== billingSceneArkAssetGroup) throw errBillingStateConflict;
  const now = new Date().toISOString();
  const updated = await tx.db.run(
    'UPDATE "credit_accounts" SET "available_microcredits" = "available_microcredits" + ?, "reserved_microcredits" = "reserved_microcredits" - ?, "version" = "version" + 1, "updated_at" = ? WHERE "user_id" = ? AND "reserved_microcredits" >= ?',
    [order.amountMicrocredits, order.amountMicrocredits, now, order.userId, order.amountMicrocredits],
  );
  if (updated !== 1) throw new Error("reserved credit balance is inconsistent");
  const accountRows = await tx.db.all<{ available_microcredits: number | null; reserved_microcredits: number | null }>(
    'SELECT "available_microcredits", "reserved_microcredits" FROM "credit_accounts" WHERE "user_id" = ? LIMIT 1',
    [order.userId],
  );
  if (!accountRows.length) throw recordNotFound;
  const truncatedNote = truncateArkNote(note);
  await tx.db.run(
    'UPDATE "billing_orders" SET "status" = ?, "error" = ?, "refunded_amount_microcredits" = ?, "refunded_at" = ?, "updated_at" = ? WHERE "id" = ?',
    [billingStatusRefunded, truncatedNote, order.amountMicrocredits, now, now, order.id],
  );
  await insertCreditLedgerEntry(
    tx,
    {
      id: newRepositoryId(),
      userId: order.userId,
      type: creditLedgerRefund,
      amountMicrocredits: order.amountMicrocredits,
      availableDeltaMicrocredits: order.amountMicrocredits,
      reservedDeltaMicrocredits: -order.amountMicrocredits,
      availableAfterMicrocredits: Number(accountRows[0].available_microcredits ?? 0),
      reservedAfterMicrocredits: Number(accountRows[0].reserved_microcredits ?? 0),
      billingOrderId: order.id,
      model: order.model,
      scene: order.scene,
      note: truncatedNote,
    },
    now,
  );
}

function truncateArkNote(note: string): string {
  const runes = [...note.trim()];
  return runes.length > 200 ? runes.slice(0, 200).join("") : runes.join("");
}

// 返回用户自建的素材组。
export async function arkPortraitUserGroups(repo: Repository, userId: string): Promise<ArkPortraitGroup[]> {
  const rows = await repo.db.all<ArkPortraitGroupRow>(
    `SELECT ${arkPortraitGroupColumns} FROM "ark_portrait_groups" WHERE "user_id" = ? AND "scope" = ? ORDER BY "created_at" ASC`,
    [userId, "user"],
  );
  return rows.map(mapArkPortraitGroup);
}

// 返回授权给用户的平台素材组（全部用户或逐个授权）。
export async function arkPortraitGrantedGroups(repo: Repository, userId: string): Promise<ArkPortraitGroup[]> {
  const rows = await repo.db.all<ArkPortraitGroupRow>(
    `SELECT ${arkPortraitGroupColumns} FROM "ark_portrait_groups" WHERE "scope" = ? AND ("grant_all" = ? OR "id" IN (SELECT "group_id" FROM "ark_portrait_group_grants" WHERE "user_id" = ?)) ORDER BY "created_at" ASC`,
    ["platform", true, userId],
  );
  return rows.map(mapArkPortraitGroup);
}

export async function countArkPortraitUserGroups(repo: Repository, userId: string, kind: string): Promise<number> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "ark_portrait_groups" WHERE "user_id" = ? AND "scope" = ? AND "kind" = ?',
    [userId, "user", kind],
  );
  return Number(rows[0]?.total ?? 0);
}

export async function arkPortraitGroup(repo: Repository, id: string): Promise<ArkPortraitGroup | null> {
  const rows = await repo.db.all<ArkPortraitGroupRow>(
    `SELECT ${arkPortraitGroupColumns} FROM "ark_portrait_groups" WHERE "id" = ? LIMIT 1`,
    [id],
  );
  return rows.length ? mapArkPortraitGroup(rows[0]) : null;
}

export async function arkPortraitGroupsByIds(repo: Repository, ids: string[]): Promise<Map<string, ArkPortraitGroup>> {
  const result = new Map<string, ArkPortraitGroup>();
  if (ids.length === 0) return result;
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await repo.db.all<ArkPortraitGroupRow>(
    `SELECT ${arkPortraitGroupColumns} FROM "ark_portrait_groups" WHERE "id" IN (${placeholders})`,
    ids,
  );
  for (const group of rows.map(mapArkPortraitGroup)) result.set(group.id, group);
  return result;
}

// 只返回用户自建的素材组；平台素材组的写操作走管理员接口。
export async function arkPortraitUserGroupForUser(
  repo: Repository,
  userId: string,
  id: string,
): Promise<ArkPortraitGroup | null> {
  const rows = await repo.db.all<ArkPortraitGroupRow>(
    `SELECT ${arkPortraitGroupColumns} FROM "ark_portrait_groups" WHERE "id" = ? AND "user_id" = ? AND "scope" = ? LIMIT 1`,
    [id, userId, "user"],
  );
  return rows.length ? mapArkPortraitGroup(rows[0]) : null;
}

export async function saveArkPortraitGroup(repo: Repository, group: ArkPortraitGroup): Promise<void> {
  const changes = await repo.db.run(
    'UPDATE "ark_portrait_groups" SET "user_id" = ?, "kind" = ?, "scope" = ?, "name" = ?, "description" = ?, "site" = ?, "region" = ?, "project_name" = ?, "group_id" = ?, "source" = ?, "grant_all" = ?, "authorized_at" = ?, "expires_at" = ?, "billing_order_id" = ?, "created_at" = ?, "updated_at" = ? WHERE "id" = ?',
    [
      group.userId,
      group.kind,
      group.scope,
      group.name,
      group.description,
      group.site,
      group.region,
      group.projectName,
      group.groupId,
      group.source,
      group.grantAll,
      group.authorizedAt,
      group.expiresAt,
      group.billingOrderId ?? "",
      group.createdAt,
      group.updatedAt,
      group.id,
    ],
  );
  if (changes > 0) return;
  await repo.db.run(
    `INSERT INTO "ark_portrait_groups" (${arkPortraitGroupColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      group.id,
      group.userId,
      group.kind,
      group.scope,
      group.name,
      group.description,
      group.site,
      group.region,
      group.projectName,
      group.groupId,
      group.source,
      group.grantAll,
      group.authorizedAt,
      group.expiresAt,
      group.billingOrderId ?? "",
      group.createdAt,
      group.updatedAt,
    ],
  );
}

// 删除组及其素材记录和授权；调用方须已在方舟侧删除成功。
export async function deleteArkPortraitGroupCascade(repo: Repository, id: string): Promise<void> {
  await repo.transaction(async (tx) => {
    await tx.db.run('DELETE FROM "ark_portrait_assets" WHERE "group_id" = ?', [id]);
    await tx.db.run('DELETE FROM "ark_portrait_group_grants" WHERE "group_id" = ?', [id]);
    await tx.db.run('DELETE FROM "ark_portrait_groups" WHERE "id" = ?', [id]);
  });
}

// 判断平台素材组是否授权给用户。
export async function arkPortraitGroupGranted(repo: Repository, groupId: string, userId: string): Promise<boolean> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "ark_portrait_group_grants" WHERE "group_id" = ? AND "user_id" = ?',
    [groupId, userId],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

// 返回 groupIDs 中逐个授权给用户的组。
export async function arkPortraitGrantedGroupIds(
  repo: Repository,
  userId: string,
  groupIds: string[],
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (groupIds.length === 0) return result;
  const placeholders = groupIds.map(() => "?").join(", ");
  const rows = await repo.db.all<{ group_id: string }>(
    `SELECT "group_id" FROM "ark_portrait_group_grants" WHERE "user_id" = ? AND "group_id" IN (${placeholders})`,
    [userId, ...groupIds],
  );
  for (const row of rows) result.set(row.group_id, true);
  return result;
}

// 返回各平台素材组逐个授权的用户 ID。
export async function arkPortraitGroupGrantUsers(repo: Repository, groupIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (groupIds.length === 0) return result;
  const placeholders = groupIds.map(() => "?").join(", ");
  const rows = await repo.db.all<ArkPortraitGroupGrantRow>(
    `SELECT ${arkPortraitGroupGrantColumns} FROM "ark_portrait_group_grants" WHERE "group_id" IN (${placeholders}) ORDER BY "created_at" ASC`,
    groupIds,
  );
  for (const grant of rows.map(mapArkPortraitGroupGrant)) {
    const users = result.get(grant.groupId) ?? [];
    users.push(grant.userId);
    result.set(grant.groupId, users);
  }
  return result;
}

// 以完整列表替换平台素材组的授权范围。
export async function replaceArkPortraitGroupGrants(
  repo: Repository,
  groupId: string,
  grantAll: boolean,
  userIds: string[],
  actorId: string,
): Promise<void> {
  await repo.transaction(async (tx) => {
    const now = new Date().toISOString();
    await tx.db.run('UPDATE "ark_portrait_groups" SET "grant_all" = ?, "updated_at" = ? WHERE "id" = ? AND "scope" = ?', [
      grantAll,
      now,
      groupId,
      "platform",
    ]);
    await tx.db.run('DELETE FROM "ark_portrait_group_grants" WHERE "group_id" = ?', [groupId]);
    for (const userId of userIds) {
      await tx.db.run(
        `INSERT INTO "ark_portrait_group_grants" (${arkPortraitGroupGrantColumns}) VALUES (?, ?, ?, ?, ?)`,
        [newRepositoryId(), groupId, userId, actorId, now],
      );
    }
  });
}

export interface AdminArkPortraitGroupFilter {
  kind: string;
  scope: string;
  expiry: string;
  keyword: string;
  now: string;
  limit: number;
  offset: number;
}

function addArkPortraitExpiryFilter(conditions: string[], values: string[], expiry: string, now: string): void {
  const soon = new Date(new Date(now).getTime() + arkPortraitExpiringWindowMs).toISOString();
  if (expiry === "valid") {
    conditions.push('("ark_portrait_groups"."expires_at" IS NULL OR "ark_portrait_groups"."expires_at" > ?)');
    values.push(soon);
  } else if (expiry === "expiring") {
    conditions.push('"ark_portrait_groups"."expires_at" > ? AND "ark_portrait_groups"."expires_at" <= ?');
    values.push(now, soon);
  } else if (expiry === "expired") {
    conditions.push('"ark_portrait_groups"."expires_at" <= ?');
    values.push(now);
  }
}

export async function adminArkPortraitGroups(
  repo: Repository,
  filter: AdminArkPortraitGroupFilter,
): Promise<{ groups: ArkPortraitGroup[]; total: number }> {
  const conditions: string[] = [];
  const conditionValues: string[] = [];
  if (filter.kind !== "") {
    conditions.push('"ark_portrait_groups"."kind" = ?');
    conditionValues.push(filter.kind);
  }
  if (filter.scope !== "") {
    conditions.push('"ark_portrait_groups"."scope" = ?');
    conditionValues.push(filter.scope);
  }
  addArkPortraitExpiryFilter(conditions, conditionValues, filter.expiry, filter.now);
  const keyword = filter.keyword.trim().toLowerCase();
  if (keyword !== "") {
    const pattern = `%${keyword}%`;
    conditions.push(
      '(lower("ark_portrait_groups"."name") LIKE ? OR lower("ark_portrait_groups"."group_id") LIKE ? OR "ark_portrait_groups"."user_id" IN (SELECT "id" FROM "users" WHERE lower("username") LIKE ? OR lower("display_name") LIKE ? OR lower("email") LIKE ?))',
    );
    conditionValues.push(pattern, pattern, pattern, pattern, pattern);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const totals = await repo.db.all<{ total: number }>(
    `SELECT COUNT(*) AS "total" FROM "ark_portrait_groups"${where}`,
    conditionValues,
  );
  const rows = await repo.db.all<ArkPortraitGroupRow>(
    `SELECT ${arkPortraitGroupColumns} FROM "ark_portrait_groups"${where} ORDER BY "ark_portrait_groups"."created_at" DESC, "ark_portrait_groups"."id" DESC LIMIT ? OFFSET ?`,
    [...conditionValues, filter.limit, filter.offset],
  );
  return { groups: rows.map(mapArkPortraitGroup), total: Number(totals[0]?.total ?? 0) };
}

export interface ArkPortraitGroupStats {
  real: number;
  virtual: number;
  ip: number;
  expiring: number;
  expired: number;
}

export async function arkPortraitGroupStats(repo: Repository, now: string): Promise<ArkPortraitGroupStats> {
  const stats: ArkPortraitGroupStats = { real: 0, virtual: 0, ip: 0, expiring: 0, expired: 0 };
  const rows = await repo.db.all<{ kind: string | null; count: number | null }>(
    'SELECT "kind", COUNT(*) AS "count" FROM "ark_portrait_groups" GROUP BY "kind"',
  );
  for (const row of rows) {
    if (row.kind === "real") stats.real = Number(row.count ?? 0);
    else if (row.kind === "virtual") stats.virtual = Number(row.count ?? 0);
    else if (row.kind === "ip") stats.ip = Number(row.count ?? 0);
  }
  const expiringConditions: string[] = [];
  const expiringValues: string[] = [];
  addArkPortraitExpiryFilter(expiringConditions, expiringValues, "expiring", now);
  const expiringRows = await repo.db.all<{ total: number }>(
    `SELECT COUNT(*) AS "total" FROM "ark_portrait_groups" WHERE ${expiringConditions.join(" AND ")}`,
    expiringValues,
  );
  stats.expiring = Number(expiringRows[0]?.total ?? 0);
  const expiredConditions: string[] = [];
  const expiredValues: string[] = [];
  addArkPortraitExpiryFilter(expiredConditions, expiredValues, "expired", now);
  const expiredRows = await repo.db.all<{ total: number }>(
    `SELECT COUNT(*) AS "total" FROM "ark_portrait_groups" WHERE ${expiredConditions.join(" AND ")}`,
    expiredValues,
  );
  stats.expired = Number(expiredRows[0]?.total ?? 0);
  return stats;
}

// 按素材组统计各状态的素材数。
export async function arkPortraitAssetStatusCounts(
  repo: Repository,
  groupIds: string[],
): Promise<Map<string, Map<string, number>>> {
  const result = new Map<string, Map<string, number>>();
  if (groupIds.length === 0) return result;
  const placeholders = groupIds.map(() => "?").join(", ");
  const rows = await repo.db.all<{ group_id: string | null; status: string | null; count: number | null }>(
    `SELECT "group_id", "status", COUNT(*) AS "count" FROM "ark_portrait_assets" WHERE "group_id" IN (${placeholders}) GROUP BY "group_id", "status"`,
    groupIds,
  );
  for (const row of rows) {
    const groupId = row.group_id ?? "";
    const counts = result.get(groupId) ?? new Map<string, number>();
    counts.set(row.status ?? "", Number(row.count ?? 0));
    result.set(groupId, counts);
  }
  return result;
}

export async function createArkPortraitAsset(repo: Repository, asset: ArkPortraitAsset): Promise<void> {
  await repo.db.run(
    `INSERT INTO "ark_portrait_assets" (${arkPortraitAssetColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      asset.id,
      asset.userId,
      asset.groupId,
      asset.resourceId,
      asset.arkAssetId,
      asset.assetType,
      asset.name,
      asset.status,
      asset.error ?? "",
      asset.libraryAssetId ?? "",
      asset.reviewedBy ?? "",
      asset.reviewedAt ?? null,
      asset.createdAt,
      asset.updatedAt,
    ],
  );
}

export async function saveArkPortraitAsset(repo: Repository, asset: ArkPortraitAsset): Promise<void> {
  const changes = await repo.db.run(
    'UPDATE "ark_portrait_assets" SET "user_id" = ?, "group_id" = ?, "resource_id" = ?, "ark_asset_id" = ?, "asset_type" = ?, "name" = ?, "status" = ?, "error" = ?, "library_asset_id" = ?, "reviewed_by" = ?, "reviewed_at" = ?, "created_at" = ?, "updated_at" = ? WHERE "id" = ?',
    [
      asset.userId,
      asset.groupId,
      asset.resourceId,
      asset.arkAssetId,
      asset.assetType,
      asset.name,
      asset.status,
      asset.error ?? "",
      asset.libraryAssetId ?? "",
      asset.reviewedBy ?? "",
      asset.reviewedAt ?? null,
      asset.createdAt,
      asset.updatedAt,
      asset.id,
    ],
  );
  if (changes > 0) return;
  await createArkPortraitAsset(repo, asset);
}

export async function arkPortraitAsset(repo: Repository, id: string): Promise<ArkPortraitAsset | null> {
  const rows = await repo.db.all<ArkPortraitAssetRow>(
    `SELECT ${arkPortraitAssetColumns} FROM "ark_portrait_assets" WHERE "id" = ? LIMIT 1`,
    [id],
  );
  return rows.length ? mapArkPortraitAsset(rows[0]) : null;
}

// 返回素材组内的素材；statuses 为空时不过滤状态。
export async function arkPortraitAssetsForGroups(
  repo: Repository,
  groupIds: string[],
  statuses: string[],
): Promise<ArkPortraitAsset[]> {
  if (groupIds.length === 0) return [];
  const values: string[] = [...groupIds];
  let where = `"group_id" IN (${groupIds.map(() => "?").join(", ")})`;
  if (statuses.length > 0) {
    where += ` AND "status" IN (${statuses.map(() => "?").join(", ")})`;
    values.push(...statuses);
  }
  const rows = await repo.db.all<ArkPortraitAssetRow>(
    `SELECT ${arkPortraitAssetColumns} FROM "ark_portrait_assets" WHERE ${where} ORDER BY "created_at" ASC`,
    values,
  );
  return rows.map(mapArkPortraitAsset);
}

export async function countArkPortraitGroupAssets(repo: Repository, groupId: string): Promise<number> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "ark_portrait_assets" WHERE "group_id" = ?',
    [groupId],
  );
  return Number(rows[0]?.total ?? 0);
}

export async function deleteArkPortraitAsset(repo: Repository, id: string): Promise<void> {
  await repo.db.run('DELETE FROM "ark_portrait_assets" WHERE "id" = ?', [id]);
}

// 返回素材库素材仍在审核、处理中或已通过的认证记录。
export async function arkPortraitSubmissionForLibraryAsset(
  repo: Repository,
  userId: string,
  libraryAssetId: string,
): Promise<ArkPortraitAsset | null> {
  const rows = await repo.db.all<ArkPortraitAssetRow>(
    `SELECT ${arkPortraitAssetColumns} FROM "ark_portrait_assets" WHERE "user_id" = ? AND "library_asset_id" = ? AND "status" IN (?, ?, ?) ORDER BY "created_at" DESC LIMIT 1`,
    [userId, libraryAssetId, "pending_review", "processing", "active"],
  );
  return rows.length ? mapArkPortraitAsset(rows[0]) : null;
}

export async function setArkPortraitAssetLibraryAsset(
  repo: Repository,
  id: string,
  libraryAssetId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await repo.db.run('UPDATE "ark_portrait_assets" SET "library_asset_id" = ?, "updated_at" = ? WHERE "id" = ?', [
    libraryAssetId,
    now,
    id,
  ]);
}

// 返回已提交方舟、等待审核结果的素材，最久未检查的排在前面。
export async function processingArkPortraitAssets(repo: Repository, limit: number): Promise<ArkPortraitAsset[]> {
  const rows = await repo.db.all<ArkPortraitAssetRow>(
    `SELECT ${arkPortraitAssetColumns} FROM "ark_portrait_assets" WHERE "status" = ? AND "ark_asset_id" <> '' ORDER BY "updated_at" ASC LIMIT ?`,
    ["processing", limit],
  );
  return rows.map(mapArkPortraitAsset);
}

// 记录一次状态检查，让后台轮询轮转到其他素材。
export async function touchArkPortraitAsset(repo: Repository, id: string): Promise<void> {
  await repo.db.run('UPDATE "ark_portrait_assets" SET "updated_at" = ? WHERE "id" = ?', [new Date().toISOString(), id]);
}

export async function arkPortraitReviewQueue(
  repo: Repository,
  status: string,
  limit: number,
  offset: number,
): Promise<{ assets: ArkPortraitAsset[]; total: number }> {
  const totals = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "ark_portrait_assets" WHERE "status" = ?',
    [status],
  );
  const order = status === "pending_review" ? '"created_at" ASC' : '"updated_at" DESC';
  const rows = await repo.db.all<ArkPortraitAssetRow>(
    `SELECT ${arkPortraitAssetColumns} FROM "ark_portrait_assets" WHERE "status" = ? ORDER BY ${order} LIMIT ? OFFSET ?`,
    [status, limit, offset],
  );
  return { assets: rows.map(mapArkPortraitAsset), total: Number(totals[0]?.total ?? 0) };
}

export async function countArkPortraitAssetsByStatus(repo: Repository, status: string): Promise<number> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "ark_portrait_assets" WHERE "status" = ?',
    [status],
  );
  return Number(rows[0]?.total ?? 0);
}

export async function arkPortraitAssetsByIds(repo: Repository, ids: string[]): Promise<ArkPortraitAsset[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await repo.db.all<ArkPortraitAssetRow>(
    `SELECT ${arkPortraitAssetColumns} FROM "ark_portrait_assets" WHERE "id" IN (${placeholders})`,
    ids,
  );
  return rows.map(mapArkPortraitAsset);
}

// 是生成前校验方舟素材 ID 所需的归属与授权字段。
export interface ArkPortraitAssetAccess {
  arkAssetId: string;
  groupId: string;
  groupUserId: string;
  scope: string;
  grantAll: boolean;
  expiresAt: string | null;
}

interface ArkPortraitAssetAccessRow {
  ark_asset_id: string | null;
  group_id: string;
  group_user_id: string | null;
  scope: string | null;
  grant_all: unknown;
  expires_at: string | null;
}

// 返回已登记方舟素材 ID 所在素材组的归属与授权。未登记的 ID（例如方舟
// 公共虚拟人像）不在结果中。可信素材同步的绑定按共享资源建立，不参与这里的判断。
export async function arkPortraitAssetAccessRows(
  repo: Repository,
  arkAssetIds: string[],
): Promise<ArkPortraitAssetAccess[]> {
  if (arkAssetIds.length === 0) return [];
  const placeholders = arkAssetIds.map(() => "?").join(", ");
  const rows = await repo.db.all<ArkPortraitAssetAccessRow>(
    `SELECT "ark_portrait_assets"."ark_asset_id" AS "ark_asset_id", "ark_portrait_groups"."id" AS "group_id", "ark_portrait_groups"."user_id" AS "group_user_id", "ark_portrait_groups"."scope" AS "scope", "ark_portrait_groups"."grant_all" AS "grant_all", "ark_portrait_groups"."expires_at" AS "expires_at" FROM "ark_portrait_assets" JOIN "ark_portrait_groups" ON "ark_portrait_groups"."id" = "ark_portrait_assets"."group_id" WHERE "ark_portrait_assets"."ark_asset_id" IN (${placeholders})`,
    arkAssetIds,
  );
  return rows.map((row) => ({
    arkAssetId: row.ark_asset_id ?? "",
    groupId: row.group_id,
    groupUserId: row.group_user_id ?? "",
    scope: row.scope ?? "",
    grantAll: toBool(row.grant_all),
    expiresAt: toNullableIso(row.expires_at),
  }));
}

function formatRfc3339Nano(value: Date): string {
  return value.toISOString().replace(/\.?0+Z$/, "Z");
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJson((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

// 在事务中读取并改写用户素材的 payload，同步分类列与 updatedAt，
// 供服务端写入方舟认证结果。mutate 返回 false 表示无需修改；素材不存在时返回 false。
export async function updateUserAssetPayload(
  repo: Repository,
  userId: string,
  assetId: string,
  mutate: (asset: Asset, payload: Record<string, unknown>) => Promise<boolean> | boolean,
): Promise<boolean> {
  let changed = false;
  await repo.transaction(async (tx) => {
    const asset = await assetForUser(tx, userId, assetId);
    if (!asset) return;
    let payload: unknown;
    try {
      payload = JSON.parse(asset.payloadJson);
    } catch {
      return;
    }
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return;
    const record = payload as Record<string, unknown>;
    if (!(await mutate(asset, record))) return;
    const now = new Date();
    record.category = asset.category;
    if (asset.status !== "") record.status = asset.status;
    record.updatedAt = formatRfc3339Nano(now);
    const encoded = JSON.stringify(sortJson(record));
    await tx.db.run(
      'UPDATE "assets" SET "category" = ?, "status" = ?, "payload_json" = ?, "updated_at" = ? WHERE "id" = ? AND "user_id" = ?',
      [asset.category, asset.status, encoded, now.toISOString(), asset.id, userId],
    );
    changed = true;
  });
  return changed;
}

// 返回 ID 以 prefix 开头的素材（跨用户），用于找到平台素材加入各用户素材库的副本。
export async function assetRefsByIdPrefix(repo: Repository, prefix: string): Promise<Asset[]> {
  const escaped = prefix.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  const rows = await repo.db.all<{ id: string; user_id: string | null }>(
    "SELECT \"id\", \"user_id\" FROM \"assets\" WHERE \"id\" LIKE ? ESCAPE '\\'",
    [`${escaped}%`],
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id ?? "",
    folderId: "",
    kind: "",
    category: "",
    status: "",
    primaryVersionId: "",
    title: "",
    payloadJson: "",
    createdAt: "",
    updatedAt: "",
  }));
}
