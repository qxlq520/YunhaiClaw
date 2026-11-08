// 对应 backend/internal/repository/ecommerce_agent.go
// 电商 Agent 运行状态机、页面落库、画布版本与积分结算。

import {
  billingStatusReserved,
  billingStatusRunning,
  billingStatusSettled,
  creditLedgerConsume,
  creditLedgerRefund,
} from "@/internal/model/models";
import type { EcommerceProject } from "@/internal/model/modelsEcommerce";
import type {
  EcommerceAgentAnalysis,
  EcommerceAgentCanvasVersion,
  EcommerceAgentPage,
  EcommerceAgentRun,
} from "@/internal/model/modelsEcommerceAgent";
import type { BillingOrder } from "@/internal/model/modelsFinance";
import { charge } from "@/internal/ecommerceagent/charge";
import { recordNotFound, Repository, toBool, toIso, toNullableIso } from "./repository";
import { createEcommerceProject } from "./ecommerce";
import { insertCreditLedgerEntry, newRepositoryId, errBillingStateConflict } from "./finance";
import {
  billingOrderColumns,
  mapBillingOrder,
  refundBillingOrder,
  reserveBillingOrder,
  type BillingOrderRow,
} from "./financeBilling";
import { errTaskStateConflict } from "./repositoryTasks";

interface EcommerceAgentRunRow {
  id: string;
  user_id: string | null;
  idempotency_key: string | null;
  project_id: string | null;
  billing_order_id: string | null;
  status: string | null;
  mode: string | null;
  platform: string | null;
  language: string | null;
  generate_type: number | null;
  page_count: number | null;
  success_pages: number | null;
  cancel_requested: unknown;
  unit_microcredits: number | null;
  brief_json: string | null;
  copy_json: string | null;
  canvas_json: string | null;
  error_code: string | null;
  created_at: string | null;
  updated_at: string | null;
  finished_at: string | null;
}

function mapEcommerceAgentRun(row: EcommerceAgentRunRow): EcommerceAgentRun {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    idempotencyKey: row.idempotency_key ?? "",
    projectId: row.project_id ?? "",
    billingOrderId: row.billing_order_id ?? "",
    status: row.status ?? "",
    mode: row.mode ?? "",
    platform: row.platform ?? "",
    language: row.language ?? "",
    generateType: Number(row.generate_type ?? 0),
    pageCount: Number(row.page_count ?? 0),
    successPages: Number(row.success_pages ?? 0),
    cancelRequested: toBool(row.cancel_requested),
    unitMicrocredits: Number(row.unit_microcredits ?? 0),
    briefJson: row.brief_json ?? "",
    copyJson: row.copy_json ?? "",
    canvasJson: row.canvas_json ?? "",
    errorCode: row.error_code ?? "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    finishedAt: toNullableIso(row.finished_at),
  };
}

const ecommerceAgentRunColumns =
  '"id", "user_id", "idempotency_key", "project_id", "billing_order_id", "status", "mode", "platform", "language", "generate_type", "page_count", "success_pages", "cancel_requested", "unit_microcredits", "brief_json", "copy_json", "canvas_json", "error_code", "created_at", "updated_at", "finished_at"';

interface EcommerceAgentPageRow {
  id: string;
  run_id: string;
  index: number;
  role: string;
  title: string;
  headline: string;
  prompt: string;
  url: string;
  status: string;
  error: string | null;
  ratio: string;
  need_text: unknown;
  latency_ms: number;
  created_at: string | null;
  updated_at: string | null;
}

function mapEcommerceAgentPage(row: EcommerceAgentPageRow): EcommerceAgentPage {
  return {
    id: row.id,
    runId: row.run_id,
    index: Number(row.index),
    role: row.role,
    title: row.title,
    headline: row.headline,
    prompt: row.prompt,
    url: row.url,
    status: row.status,
    error: row.error ?? "",
    aspectRatio: row.ratio,
    needText: toBool(row.need_text),
    latencyMs: Number(row.latency_ms),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const ecommerceAgentPageColumns =
  '"id", "run_id", "index", "role", "title", "headline", "prompt", "url", "status", "error", "ratio", "need_text", "latency_ms", "created_at", "updated_at"';

interface EcommerceAgentCanvasVersionRow {
  id: string;
  user_id: string;
  project_id: string;
  version: number;
  canvas_json: string;
  created_at: string;
}

function mapEcommerceAgentCanvasVersion(row: EcommerceAgentCanvasVersionRow): EcommerceAgentCanvasVersion {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    version: Number(row.version),
    canvasJson: row.canvas_json,
    createdAt: toIso(row.created_at),
  };
}

const ecommerceAgentCanvasVersionColumns = '"id", "user_id", "project_id", "version", "canvas_json", "created_at"';

function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}

export async function ecommerceAgentRunByKey(repo: Repository, userId: string, key: string): Promise<EcommerceAgentRun | null> {
  const rows = await repo.db.all<EcommerceAgentRunRow>(
    `SELECT ${ecommerceAgentRunColumns} FROM "ecommerce_agent_runs" WHERE "user_id" = ? AND "idempotency_key" = ? LIMIT 1`,
    [userId, key],
  );
  return rows.length ? mapEcommerceAgentRun(rows[0]) : null;
}

export async function ecommerceAgentAnalysis(
  repo: Repository,
  userId: string,
  signature: string,
): Promise<EcommerceAgentAnalysis | null> {
  const rows = await repo.db.all<{
    id: string;
    user_id: string;
    signature: string;
    payload_json: string;
    created_at: string;
  }>('SELECT "id", "user_id", "signature", "payload_json", "created_at" FROM "ecommerce_agent_analysises" WHERE "user_id" = ? AND "signature" = ? LIMIT 1', [
    userId,
    signature,
  ]);
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    signature: row.signature,
    payloadJson: row.payload_json,
    createdAt: toIso(row.created_at),
  };
}

export async function saveEcommerceAgentAnalysis(repo: Repository, row: EcommerceAgentAnalysis): Promise<void> {
  await repo.db.run(
    `INSERT INTO "ecommerce_agent_analysises" ("id", "user_id", "signature", "payload_json", "created_at") VALUES (?, ?, ?, ?, ?) ON CONFLICT ("user_id", "signature") DO UPDATE SET "payload_json" = excluded."payload_json", "created_at" = excluded."created_at"`,
    [row.id, row.userId ?? "", row.signature ?? "", row.payloadJson ?? "", row.createdAt],
  );
}

export async function ecommerceAgentRun(repo: Repository, userId: string, id: string): Promise<EcommerceAgentRun | null> {
  const rows = await repo.db.all<EcommerceAgentRunRow>(
    `SELECT ${ecommerceAgentRunColumns} FROM "ecommerce_agent_runs" WHERE "user_id" = ? AND "id" = ? LIMIT 1`,
    [userId, id],
  );
  return rows.length ? mapEcommerceAgentRun(rows[0]) : null;
}

export async function latestEcommerceAgentRunByProject(
  repo: Repository,
  userId: string,
  projectId: string,
): Promise<EcommerceAgentRun | null> {
  const rows = await repo.db.all<EcommerceAgentRunRow>(
    `SELECT ${ecommerceAgentRunColumns} FROM "ecommerce_agent_runs" WHERE "user_id" = ? AND "project_id" = ? ORDER BY "created_at" DESC, "id" DESC LIMIT 1`,
    [userId, projectId],
  );
  return rows.length ? mapEcommerceAgentRun(rows[0]) : null;
}

export async function requestEcommerceAgentCancel(repo: Repository, userId: string, id: string): Promise<void> {
  await repo.db.run(
    'UPDATE "ecommerce_agent_runs" SET "cancel_requested" = ?, "updated_at" = ? WHERE "user_id" = ? AND "id" = ? AND "status" = ?',
    [true, new Date().toISOString(), userId, id, "running"],
  );
}

export async function createEcommerceAgentRun(
  repo: Repository,
  run: EcommerceAgentRun,
  project: EcommerceProject | null,
  order: BillingOrder | null,
): Promise<void> {
  if ((run.canvasJson ?? "").trim() === "") run.canvasJson = "{}";
  await repo.transaction(async (tx) => {
    if (project) {
      await createEcommerceProject(tx, project);
    } else {
      const counts = await tx.db.all<{ total: number }>(
        'SELECT COUNT(*) AS "total" FROM "ecommerce_projects" WHERE "id" = ? AND "user_id" = ?',
        [run.projectId, run.userId ?? ""],
      );
      if (Number(counts[0]?.total ?? 0) !== 1) throw recordNotFound;
    }
    await tx.db.run(
      `INSERT INTO "ecommerce_agent_runs" (${ecommerceAgentRunColumns}) VALUES (${placeholders(21)})`,
      [
        run.id,
        run.userId ?? "",
        run.idempotencyKey ?? "",
        run.projectId,
        run.billingOrderId ?? "",
        run.status,
        run.mode,
        run.platform,
        run.language,
        run.generateType,
        run.pageCount,
        run.successPages,
        run.cancelRequested,
        run.unitMicrocredits,
        run.briefJson ?? "",
        run.copyJson ?? "",
        run.canvasJson ?? "",
        run.errorCode ?? "",
        run.createdAt,
        run.updatedAt,
        run.finishedAt ?? null,
      ],
    );
    if (order) await reserveBillingOrder(tx, order);
  });
}

export async function saveEcommerceAgentPage(repo: Repository, userId: string, page: EcommerceAgentPage): Promise<void> {
  await repo.transaction(async (tx) => {
    const rows = await tx.db.all<{ status: string | null }>(
      'SELECT "status" FROM "ecommerce_agent_runs" WHERE "user_id" = ? AND "id" = ? LIMIT 1',
      [userId, page.runId ?? ""],
    );
    if (!rows.length) throw recordNotFound;
    if ((rows[0].status ?? "") !== "running") throw errTaskStateConflict;
    const now = new Date().toISOString();
    await tx.db.run(
      `INSERT INTO "ecommerce_agent_pages" (${ecommerceAgentPageColumns}) VALUES (${placeholders(15)}) ON CONFLICT ("run_id", "index") DO UPDATE SET "role" = excluded."role", "title" = excluded."title", "headline" = excluded."headline", "prompt" = excluded."prompt", "url" = excluded."url", "status" = excluded."status", "error" = excluded."error", "ratio" = excluded."ratio", "need_text" = excluded."need_text", "latency_ms" = excluded."latency_ms", "updated_at" = excluded."updated_at"`,
      [
        page.id ?? "",
        page.runId ?? "",
        page.index,
        page.role,
        page.title,
        page.headline,
        page.prompt,
        page.url,
        page.status,
        page.error ?? "",
        page.aspectRatio,
        page.needText,
        page.latencyMs,
        page.createdAt ?? now,
        page.updatedAt ?? now,
      ],
    );
  });
}

export async function ecommerceAgentPages(
  repo: Repository,
  userId: string,
  runId: string,
): Promise<EcommerceAgentPage[]> {
  const run = await ecommerceAgentRun(repo, userId, runId);
  if (!run) throw recordNotFound;
  const rows = await repo.db.all<EcommerceAgentPageRow>(
    `SELECT ${ecommerceAgentPageColumns} FROM "ecommerce_agent_pages" WHERE "run_id" = ? ORDER BY "index" ASC`,
    [runId],
  );
  return rows.map(mapEcommerceAgentPage);
}

export async function saveEcommerceAgentResult(
  repo: Repository,
  userId: string,
  runId: string,
  briefJSON: string,
  copyJSON: string,
  canvasJSON: string,
): Promise<void> {
  const changes = await repo.db.run(
    'UPDATE "ecommerce_agent_runs" SET "brief_json" = ?, "copy_json" = ?, "canvas_json" = ?, "updated_at" = ? WHERE "user_id" = ? AND "id" = ? AND "status" = ?',
    [briefJSON, copyJSON, canvasJSON, new Date().toISOString(), userId, runId, "running"],
  );
  if (changes !== 1) throw errTaskStateConflict;
}

// 结算只对已成功落库的页面计费，并保证同一笔积分预占只关闭一次。
export async function finishEcommerceAgentRun(
  repo: Repository,
  userId: string,
  runId: string,
  status: string,
  errorCode: string,
): Promise<EcommerceAgentRun> {
  return repo.transaction(async (tx) => {
    const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    const rows = await tx.db.all<EcommerceAgentRunRow>(
      `SELECT ${ecommerceAgentRunColumns} FROM "ecommerce_agent_runs" WHERE "user_id" = ? AND "id" = ? LIMIT 1${locking}`,
      [userId, runId],
    );
    if (!rows.length) throw recordNotFound;
    const finished = mapEcommerceAgentRun(rows[0]);
    if (finished.status === "completed" || finished.status === "failed" || finished.status === "cancelled") {
      return finished;
    }
    const counts = await tx.db.all<{ total: number }>(
      'SELECT COUNT(*) AS "total" FROM "ecommerce_agent_pages" WHERE "run_id" = ? AND "status" = ?',
      [runId, "completed"],
    );
    const successes = Number(counts[0]?.total ?? 0);
    if (successes > finished.pageCount) throw new Error("ecommerce page count exceeds reservation");
    if ((finished.billingOrderId ?? "") !== "") {
      if (successes === 0) {
        const orderRows = await tx.db.all<BillingOrderRow>(
          `SELECT ${billingOrderColumns} FROM "billing_orders" WHERE "id" = ? LIMIT 1${locking}`,
          [finished.billingOrderId ?? ""],
        );
        if (!orderRows.length) throw recordNotFound;
        await refundBillingOrder(tx, mapBillingOrder(orderRows[0]), status);
      } else {
        await settleEcommerceAgentOrder(tx, finished, successes);
      }
    }
    const now = new Date().toISOString();
    await tx.db.run(
      'UPDATE "ecommerce_agent_runs" SET "status" = ?, "error_code" = ?, "success_pages" = ?, "finished_at" = ?, "updated_at" = ? WHERE "id" = ?',
      [status, errorCode, successes, now, now, finished.id],
    );
    finished.status = status;
    finished.errorCode = errorCode;
    finished.successPages = successes;
    finished.finishedAt = now;
    finished.updatedAt = now;
    return finished;
  });
}

async function settleEcommerceAgentOrder(repo: Repository, run: EcommerceAgentRun, successes: number): Promise<void> {
  const locking = repo.dialect() === "postgres" ? " FOR UPDATE" : "";
  const orderRows = await repo.db.all<BillingOrderRow>(
    `SELECT ${billingOrderColumns} FROM "billing_orders" WHERE "id" = ? AND "user_id" = ? LIMIT 1${locking}`,
    [run.billingOrderId ?? "", run.userId ?? ""],
  );
  if (!orderRows.length) throw recordNotFound;
  const order = mapBillingOrder(orderRows[0]);
  if (order.scene !== "ecommerce_agent" || (order.status !== billingStatusRunning && order.status !== billingStatusReserved)) {
    throw errBillingStateConflict;
  }
  const { reserved, actual, refund } = charge(run.unitMicrocredits, run.pageCount, successes);
  if (order.amountMicrocredits !== reserved) throw new Error("ecommerce billing snapshot mismatch");
  const now = new Date().toISOString();
  const accountChanges = await repo.db.run(
    'UPDATE "credit_accounts" SET "available_microcredits" = "available_microcredits" + ?, "reserved_microcredits" = "reserved_microcredits" - ?, "version" = "version" + 1, "updated_at" = ? WHERE "user_id" = ? AND "reserved_microcredits" >= ?',
    [refund, order.amountMicrocredits, now, run.userId ?? "", order.amountMicrocredits],
  );
  if (accountChanges !== 1) throw new Error("reserved credit balance is inconsistent");
  const accountRows = await repo.db.all<{ available_microcredits: number; reserved_microcredits: number }>(
    'SELECT "available_microcredits", "reserved_microcredits" FROM "credit_accounts" WHERE "user_id" = ? LIMIT 1',
    [run.userId ?? ""],
  );
  if (!accountRows.length) throw recordNotFound;
  const account = accountRows[0];
  await repo.db.run(
    'UPDATE "billing_orders" SET "status" = ?, "quantity" = ?, "actual_amount_microcredits" = ?, "refunded_amount_microcredits" = ?, "settled_at" = ?, "updated_at" = ? WHERE "id" = ?',
    [billingStatusSettled, successes, actual, refund, now, now, order.id],
  );
  await insertCreditLedgerEntry(
    repo,
    {
      id: newRepositoryId(),
      userId: run.userId ?? "",
      type: creditLedgerConsume,
      amountMicrocredits: -actual,
      reservedDeltaMicrocredits: -order.amountMicrocredits,
      availableAfterMicrocredits: Number(account.available_microcredits ?? 0),
      reservedAfterMicrocredits: Number(account.reserved_microcredits ?? 0),
      billingOrderId: order.id,
      model: order.model,
      channelId: order.channelId,
      scene: order.scene,
      note: `电商出图成功 ${successes}/${run.pageCount} 页`,
    },
    now,
  );
  if (refund > 0) {
    await insertCreditLedgerEntry(
      repo,
      {
        id: newRepositoryId(),
        userId: run.userId ?? "",
        type: creditLedgerRefund,
        amountMicrocredits: refund,
        availableDeltaMicrocredits: refund,
        availableAfterMicrocredits: Number(account.available_microcredits ?? 0),
        reservedAfterMicrocredits: Number(account.reserved_microcredits ?? 0),
        billingOrderId: order.id,
        model: order.model,
        channelId: order.channelId,
        scene: order.scene,
        note: "电商出图未成功页面退回",
      },
      now,
    );
  }
}

export async function saveEcommerceAgentCanvas(
  repo: Repository,
  userId: string,
  projectId: string,
  canvasJSON: string,
): Promise<EcommerceAgentCanvasVersion> {
  return repo.transaction(async (tx) => {
    const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    const projects = await tx.db.all<{ id: string }>(
      `SELECT "id" FROM "ecommerce_projects" WHERE "id" = ? AND "user_id" = ? LIMIT 1${locking}`,
      [projectId, userId],
    );
    if (!projects.length) throw recordNotFound;
    const latestRows = await tx.db.all<{ latest: number | null }>(
      'SELECT COALESCE(MAX("version"), 0) AS "latest" FROM "ecommerce_agent_canvas_versions" WHERE "project_id" = ? AND "user_id" = ?',
      [projectId, userId],
    );
    const now = new Date().toISOString();
    const saved: EcommerceAgentCanvasVersion = {
      id: newRepositoryId(),
      userId,
      projectId,
      version: Number(latestRows[0]?.latest ?? 0) + 1,
      canvasJson: canvasJSON,
      createdAt: now,
    };
    await tx.db.run(
      `INSERT INTO "ecommerce_agent_canvas_versions" (${ecommerceAgentCanvasVersionColumns}) VALUES (${placeholders(6)})`,
      [saved.id, userId, projectId, saved.version, canvasJSON, now],
    );
    return saved;
  });
}

export async function ecommerceAgentCanvas(
  repo: Repository,
  userId: string,
  projectId: string,
): Promise<EcommerceAgentCanvasVersion[]> {
  const counts = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "ecommerce_projects" WHERE "id" = ? AND "user_id" = ?',
    [projectId, userId],
  );
  if (Number(counts[0]?.total ?? 0) !== 1) throw recordNotFound;
  const rows = await repo.db.all<EcommerceAgentCanvasVersionRow>(
    `SELECT ${ecommerceAgentCanvasVersionColumns} FROM "ecommerce_agent_canvas_versions" WHERE "project_id" = ? AND "user_id" = ? ORDER BY "version" DESC LIMIT 20`,
    [projectId, userId],
  );
  return rows.map(mapEcommerceAgentCanvasVersion);
}
