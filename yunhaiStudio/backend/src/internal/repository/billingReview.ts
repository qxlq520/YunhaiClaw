// 对应 backend/internal/repository/billing_review.go
// 长期未闭合计费订单的巡检统计。

import { billingStatusReserved, billingStatusRunning, billingStatusUncertain, type BillingStatus } from "@/internal/model/models";
import { Repository, toIso } from "./repository";

// BillingReviewStats 记录需要人工关注的长期未闭合订单数量。
// 巡检只读数据库，不改变订单状态或积分余额。
export interface BillingReviewStats {
  reserved: number;
  running: number;
  uncertain: number;
  oldest?: string | null;
}

export function billingReviewStatsTotal(stats: BillingReviewStats): number {
  return stats.reserved + stats.running + stats.uncertain;
}

/** 查询超过 age 未更新、仍处于未闭合状态的订单。 */
export async function staleBillingReviewStats(repo: Repository, now: string, ageMs: number): Promise<BillingReviewStats> {
  const cutoff = new Date(new Date(now).getTime() - ageMs).toISOString();
  const openStatuses: BillingStatus[] = [billingStatusReserved, billingStatusRunning, billingStatusUncertain];
  const stats: BillingReviewStats = { reserved: 0, running: 0, uncertain: 0, oldest: null };
  const rows = await repo.db.all<{ status: BillingStatus; count: number }>(
    'SELECT "status", COUNT(*) AS "count" FROM "billing_orders" WHERE "status" IN (?, ?, ?) AND "updated_at" < ? GROUP BY "status"',
    [...openStatuses, cutoff],
  );
  for (const row of rows) {
    if (row.status === billingStatusReserved) stats.reserved = Number(row.count ?? 0);
    else if (row.status === billingStatusRunning) stats.running = Number(row.count ?? 0);
    else if (row.status === billingStatusUncertain) stats.uncertain = Number(row.count ?? 0);
  }
  if (billingReviewStatsTotal(stats) === 0) return stats;
  const oldest = await repo.db.all<{ created_at: string }>(
    'SELECT "created_at" FROM "billing_orders" WHERE "status" IN (?, ?, ?) AND "updated_at" < ? ORDER BY "created_at" ASC LIMIT 1',
    [...openStatuses, cutoff],
  );
  stats.oldest = toIso(oldest[0]?.created_at);
  return stats;
}
