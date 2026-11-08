// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
import { BillingOrder } from "./modelsFinance";
// TokenPricingLocation 是分时 Token 价格的判定时区。固定东八区，不依赖宿主机 tzdata。


// MaxTokenPriceRules 是一个价格档最多配置的分时与上下文规则数。


// TokenPriceRule 是文本 Token 价格档上的一条分时与上下文规则。
// 时段按任务创建时的东八区时间判定，上下文档位按上游返回的真实输入 Token（含缓存命中与写入）判定；
// 规则按顺序取第一条同时命中的，全部未命中时使用价格档的基础 Token 单价。

export interface TokenPriceRule {
  enabled: boolean;
  /** Weekdays 取 1（周一）到 7（周日）。 */
  weekdays: number[];
  /** Start 含、End 不含，格式 HH:MM；End 可写 24:00 表示到当天结束。不支持跨零点，跨零点请拆成两条。 */
  start: string;
  end: string;
  /** MinInputTokens 含、MaxInputTokens 不含；MaxInputTokens 为 0 表示不限上限。 */
  minInputTokens: number;
  maxInputTokens: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
  cacheWriteTokenPriceMicrocredits: number;
}

// BillingTokenPriceRule 是订单固化的一条候选规则：时段已在下单时判定，
// 结算只按真实输入 Token 选档。单价已按分组与计价货币换算为微积分。

export interface BillingTokenPriceRule {
  /** Rule 是规则在价格档内的序号（从 1 起），用于账单回溯。 */
  rule: number;
  minInputTokens: number;
  maxInputTokens: number;
  input: number;
  output: number;
  cached: number;
  cacheWrite: number;
}

// TokenPriceSet 是一次结算实际使用的四类 Token 单价（微积分 / 百万 Token）。

export interface TokenPriceSet {
  input: number;
  output: number;
  cached: number;
  cacheWrite: number;
}

export const tokenPricingOffsetMinutes = 8 * 60;

export const maxTokenPriceRules = 48;

export function parseTokenPriceClock(value: string, allowEndOfDay: boolean): number {
  const parts = value.trim().split(":");
  if (parts.length !== 2 || parts[0].length !== 2 || parts[1].length !== 2) throw new Error(`时间 ${value} 必须是 HH:MM`);
  const hour = Number.parseInt(parts[0], 10);
  const minute = Number.parseInt(parts[1], 10);
  if (Number.isNaN(hour) || Number.isNaN(minute) || minute < 0 || minute > 59 || hour < 0) throw new Error(`时间 ${value} 必须是 HH:MM`);
  const total = hour * 60 + minute;
  if (total > 24 * 60 || (total === 24 * 60 && !allowEndOfDay) || (hour === 24 && minute !== 0)) throw new Error(`时间 ${value} 超出范围`);
  return total;
}

export function tokenPriceRuleMatchesTime(rule: TokenPriceRule, at: Date): boolean {
  const local = new Date(at.getTime() + tokenPricingOffsetMinutes * 60 * 1000);
  let weekday = local.getUTCDay();
  if (weekday === 0) weekday = 7;
  if (!rule.weekdays.includes(weekday)) return false;
  let start: number;
  let end: number;
  try {
    start = parseTokenPriceClock(rule.start, false);
    end = parseTokenPriceClock(rule.end, true);
  } catch {
    return false;
  }
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  return minute >= start && minute < end;
}

export function matchBillingTokenPriceRule(rules: BillingTokenPriceRule[], inputTokens: number): BillingTokenPriceRule | null {
  for (const rule of rules) {
    if (inputTokens >= rule.minInputTokens && (rule.maxInputTokens <= 0 || inputTokens < rule.maxInputTokens)) return rule;
  }
  return null;
}

export function encodeBillingTokenPriceRules(rules: BillingTokenPriceRule[]): string {
  return rules.length === 0 ? "" : JSON.stringify(rules);
}

export function billingOrderBillingTokenPriceRules(order: BillingOrder): BillingTokenPriceRule[] {
  const raw = (order.tokenPriceRulesJson ?? "").trim();
  if (!raw) return [];
  try {
    return JSON.parse(raw) as BillingTokenPriceRule[];
  } catch {
    throw new Error("订单分时 Token 价格快照无效");
  }
}

export function billingOrderTokenPrices(order: BillingOrder, inputTokens: number): { prices: TokenPriceSet; rule: number } {
  const base: TokenPriceSet = {
    input: order.inputTokenPriceMicrocredits,
    output: order.outputTokenPriceMicrocredits,
    cached: order.cachedTokenPriceMicrocredits,
    cacheWrite: order.cacheWriteTokenPriceMicrocredits,
  };
  const matched = matchBillingTokenPriceRule(billingOrderBillingTokenPriceRules(order), inputTokens);
  if (!matched) return { prices: base, rule: 0 };
  return {
    prices: { input: matched.input, output: matched.output, cached: matched.cached, cacheWrite: matched.cacheWrite },
    rule: matched.rule,
  };
}
