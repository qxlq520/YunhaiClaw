// 对应 backend/internal/repository/payment_export.go
// 支付订单与对账结果的导出（只读快照）。

import type { User } from "@/internal/model/modelsIdentity";
import { paymentReconciliationRunning } from "@/internal/model/modelsPayment";
import type { PaymentOrder, PaymentReconciliationItem, PaymentReconciliationRun } from "@/internal/model/modelsPayment";
import { usersByIds } from "./adminStorage";
import {
  mapPaymentOrder,
  mapPaymentReconciliationItem,
  mapPaymentReconciliationRun,
  paymentOrderColumns,
  paymentOrderQuery,
  paymentReconciliationItemColumns,
  paymentReconciliationItemsQuery,
  paymentReconciliationRun,
  paymentReconciliationRunColumns,
  paymentReconciliationQuery,
} from "./payment";
import type {
  PaymentOrderFilter,
  PaymentOrderRow,
  PaymentReconciliationFilter,
  PaymentReconciliationItemRow,
  PaymentReconciliationRunRow,
} from "./payment";
import { recordNotFound, Repository } from "./repository";

export type { PaymentOrderFilter, PaymentReconciliationFilter } from "./payment";

export const errPaymentReconciliationRunning = new Error("正在对账，请稍后再试");

export async function exportPaymentOrders(
  repo: Repository,
  filter: PaymentOrderFilter,
  limit: number,
): Promise<{ orders: PaymentOrder[]; users: Map<string, User> }> {
  return repo.transaction(async (tx) => {
    if (tx.dialect() === "postgres") await tx.db.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { where, values } = paymentOrderQuery(tx, filter);
    const whereClause = where ? ` ${where}` : "";
    const rows = await tx.db.all<PaymentOrderRow>(
      `SELECT ${paymentOrderColumns} FROM "payment_orders"${whereClause} ORDER BY "created_at" DESC, "id" DESC LIMIT ?`,
      [...values, limit],
    );
    const orders = rows.map(mapPaymentOrder);
    const users = new Map<string, User>();
    // 分批绑定 IN 参数，SQLite 与 PostgreSQL 都受限。
    for (let start = 0; start < orders.length; start += 500) {
      const ids = orders.slice(start, start + 500).map((order) => order.userId);
      const batch = await usersByIds(tx, ids);
      for (const [id, user] of batch) users.set(id, user);
    }
    return { orders, users };
  });
}

export async function exportPaymentReconciliations(
  repo: Repository,
  filter: PaymentReconciliationFilter,
  limit: number,
): Promise<PaymentReconciliationRun[]> {
  const { where, values } = paymentReconciliationQuery(repo, filter);
  const whereClause = where ? ` ${where}` : "";
  const rows = await repo.db.all<PaymentReconciliationRunRow>(
    `SELECT ${paymentReconciliationRunColumns} FROM "payment_reconciliation_runs"${whereClause} ORDER BY "bill_date" DESC, "started_at" DESC, "id" DESC LIMIT ?`,
    [...values, limit],
  );
  return rows.map(mapPaymentReconciliationRun);
}

export async function exportPaymentReconciliationItems(
  repo: Repository,
  runId: string,
  result: string,
  limit: number,
): Promise<{ run: PaymentReconciliationRun; items: PaymentReconciliationItem[] }> {
  // 重跑会删除旧明细并复用任务 ID，两次读取必须基于同一快照。
  return repo.transaction(async (tx) => {
    if (tx.dialect() === "postgres") await tx.db.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const run = await paymentReconciliationRun(tx, runId);
    if (!run) throw recordNotFound;
    if (run.status === paymentReconciliationRunning) throw errPaymentReconciliationRunning;
    const { where, values } = paymentReconciliationItemsQuery(tx, run.id, result);
    const whereClause = where ? ` ${where}` : "";
    const rows = await tx.db.all<PaymentReconciliationItemRow>(
      `SELECT ${paymentReconciliationItemColumns} FROM "payment_reconciliation_items"${whereClause} ORDER BY "resolved" ASC, "created_at" ASC, "id" ASC LIMIT ?`,
      [...values, limit],
    );
    return { run, items: rows.map(mapPaymentReconciliationItem) };
  });
}
