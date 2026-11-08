// 对应 backend/internal/repository/billing_authorization.go
// 计费授权的硬上限判定。

import type { BillingOrder } from "@/internal/model/modelsFinance";
import { errBillingChargeLimit } from "./finance";

export function billingChargeLimitApplies(order: BillingOrder): boolean {
  return Boolean(order.chargeLimitSet) || (order.chargeLimitMicrocredits ?? 0) > 0;
}

export function validateBillingChargeLimit(order: BillingOrder, amount: number): void {
  const limit = order.chargeLimitMicrocredits ?? 0;
  if (amount < 0 || (billingChargeLimitApplies(order) && (limit < 0 || amount > limit))) {
    throw errBillingChargeLimit;
  }
}
