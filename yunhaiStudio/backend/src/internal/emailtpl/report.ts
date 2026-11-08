// 对应 backend/internal/emailtpl/report.go

import type { Rendered } from "./code";
import {
  colorAccent,
  colorFaint,
  colorLine,
  colorMuted,
  colorSurface,
  colorText,
  escapeHtml,
  renderLayout,
} from "./layout";

export interface DayAmount {
  /** 如 11-06。 */
  label: string;
  micro: number;
}

export interface Slice {
  label: string;
  micro: number;
  count: number;
}

export interface OrderLine {
  time: string;
  model: string;
  kind: string;
  micro: number;
}

/** 用户当日消费日报；金额单位为微积分（1 积分 = 1,000,000）。 */
export interface ConsumptionReport {
  brand: string;
  userName: string;
  /** YYYY-MM-DD，东八区。 */
  date: string;
  weekdayName: string;
  /** 当日净消费 = 消费 - 当日退回。 */
  totalMicro: number;
  consumeMicro: number;
  refundMicro: number;
  orderCount: number;
  availableMicro: number;
  /** 昨日净消费；last7 为截至今日（含）的 7 天净消费，最早的一天在前。 */
  previousDayMicro: number;
  last7: DayAmount[];
  hourly: number[];
  capabilities: Slice[];
  models: Slice[];
  topOrders: OrderLine[];
  walletUrl: string;
  settingsUrl: string;
}

const sliceColors = ["#3b5bfd", "#7c5cff", "#16a3a3", "#f59e0b", "#ef5b7b", "#9a9aa3"];

interface Bar {
  label: string;
  height: number;
  color: string;
  title: string;
  value: string;
  strong: boolean;
}

interface SliceRow {
  label: string;
  value: string;
  count: number;
  percent: string;
  width: number;
  rest: number;
  color: string;
}

interface StackCell {
  width: number;
  color: string;
}

interface OrderRow {
  time: string;
  model: string;
  kind: string;
  value: string;
}

interface ReportView extends ConsumptionReport {
  total: string;
  consume: string;
  refund: string;
  available: string;
  delta: string;
  deltaTone: string;
  avgLabel: string;
  runway: string;
  peakHourLabel: string;
  hourBars: Bar[];
  dayBars: Bar[];
  capRows: SliceRow[];
  modelRows: SliceRow[];
  orders: OrderRow[];
  insights: string[];
  stackCells: StackCell[];
}

function barRow(bar: Bar): string {
  return `<td valign="bottom" align="center" height="96" style="height:96px;padding:0 1px;" title="${escapeHtml(bar.title)}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="${bar.height}" bgcolor="${bar.color}" style="height:${bar.height}px;line-height:${bar.height}px;font-size:0;background:${bar.color};border-radius:3px 3px 0 0;">&nbsp;</td></tr></table></td>`;
}

function capRow(row: SliceRow): string {
  return `<tr>
<td width="14" style="padding:7px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="8" height="8" bgcolor="${row.color}" style="width:8px;height:8px;font-size:0;line-height:8px;border-radius:2px;background:${row.color};">&nbsp;</td></tr></table></td>
<td style="padding:7px 0;font-size:14px;line-height:20px;color:${colorText};">${escapeHtml(row.label)} <span style="color:${colorFaint};font-size:12px;">· ${row.count} 次</span></td>
<td align="right" style="padding:7px 0;font-size:14px;line-height:20px;color:${colorText};font-weight:600;">${escapeHtml(row.value)}</td>
<td align="right" width="56" style="padding:7px 0;font-size:12px;line-height:20px;color:${colorFaint};">${escapeHtml(row.percent)}</td>
</tr>`;
}

function modelRow(row: SliceRow, index: number): string {
  return `<tr><td style="padding:10px 0 4px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="font-size:13px;line-height:20px;color:${colorText};"><span style="display:inline-block;width:18px;color:${colorFaint};">${index + 1}</span>${escapeHtml(row.label)} <span style="color:${colorFaint};font-size:12px;">· ${row.count} 次</span></td>
<td align="right" style="font-size:13px;line-height:20px;color:${colorText};font-weight:600;">${escapeHtml(row.value)} <span style="color:${colorFaint};font-weight:400;">${escapeHtml(row.percent)}</span></td>
</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;"><tr>
<td width="${row.width}%" height="6" bgcolor="${row.color}" style="height:6px;font-size:0;line-height:6px;background:${row.color};border-radius:3px;">&nbsp;</td>
${row.rest ? `<td width="${row.rest}%" height="6" bgcolor="${colorSurface}" style="height:6px;font-size:0;line-height:6px;background:${colorSurface};">&nbsp;</td>` : ""}
</tr></table>
</td></tr>`;
}

function dayBar(row: Bar): string {
  const color = row.strong ? colorText : colorFaint;
  const weight = row.strong ? 700 : 400;
  return `<td width="14%" valign="bottom" align="center" height="110" style="height:110px;padding:0 6px;">
<div style="font-size:11px;line-height:16px;color:${color};font-weight:${weight};padding-bottom:4px;">${escapeHtml(row.value)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="${row.height}" bgcolor="${row.color}" style="height:${row.height}px;font-size:0;line-height:${row.height}px;background:${row.color};border-radius:4px 4px 0 0;">&nbsp;</td></tr></table>
</td>`;
}

function dayLabel(row: Bar): string {
  const color = row.strong ? colorText : colorFaint;
  const weight = row.strong ? 600 : 400;
  return `<td align="center" style="padding-top:8px;border-top:1px solid ${colorLine};font-size:11px;line-height:16px;color:${color};font-weight:${weight};">${escapeHtml(row.label)}</td>`;
}

function orderRow(row: OrderRow): string {
  return `<tr>
<td width="52" style="padding:10px 0;border-bottom:1px solid ${colorLine};font-size:12px;line-height:18px;color:${colorFaint};font-family:'SF Mono',Menlo,Consolas,monospace;">${escapeHtml(row.time)}</td>
<td style="padding:10px 8px;border-bottom:1px solid ${colorLine};font-size:13px;line-height:18px;color:${colorText};">${escapeHtml(row.model)} <span style="color:${colorFaint};font-size:12px;">· ${escapeHtml(row.kind)}</span></td>
<td align="right" style="padding:10px 0;border-bottom:1px solid ${colorLine};font-size:13px;line-height:18px;color:${colorText};font-weight:600;">${escapeHtml(row.value)}</td>
</tr>`;
}

function reportBody(view: ReportView): string {
  const insights = view.insights.length
    ? `<tr><td style="padding:24px 36px 0;">
<div style="font-size:15px;line-height:22px;font-weight:600;color:${colorText};">今日洞察</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;">
${view.insights
  .map((line) => `<tr><td width="18" valign="top" style="padding:7px 0 0;font-size:13px;line-height:20px;color:${colorAccent};">◆</td><td style="padding:6px 0;font-size:14px;line-height:22px;color:${colorMuted};">${escapeHtml(line)}</td></tr>`)
  .join("")}
</table>
</td></tr>`
    : "";
  const capRows = view.capRows.length
    ? `<tr><td style="padding:28px 36px 0;">
<div style="font-size:15px;line-height:22px;font-weight:600;color:${colorText};">消费构成</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;border-radius:6px;overflow:hidden;"><tr>${view.stackCells
        .map((cell) => `<td width="${cell.width}%" height="10" bgcolor="${cell.color}" style="height:10px;font-size:0;line-height:10px;background:${cell.color};">&nbsp;</td>`)
        .join("")}</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
${view.capRows.map(capRow).join("")}
</table>
</td></tr>`
    : "";
  const modelRows = view.modelRows.length
    ? `<tr><td style="padding:24px 36px 0;">
<div style="font-size:15px;line-height:22px;font-weight:600;color:${colorText};">模型消费排行</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;">
${view.modelRows.map(modelRow).join("")}
</table>
</td></tr>`
    : "";
  const orders = view.orders.length
    ? `<tr><td style="padding:28px 36px 0;">
<div style="font-size:15px;line-height:22px;font-weight:600;color:${colorText};">单笔消费 Top ${view.orders.length}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">
${view.orders.map(orderRow).join("")}
</table>
</td></tr>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:36px 36px 0;">
<div style="font-size:12px;line-height:18px;font-weight:600;letter-spacing:1.2px;color:${colorAccent};">DAILY SPEND REPORT · 消费日报</div>
<div style="padding-top:8px;font-size:24px;line-height:32px;font-weight:700;color:${colorText};letter-spacing:-0.2px;">${escapeHtml(view.userName)}，这是你 ${escapeHtml(view.date)} 的消费报告</div>
<div style="padding-top:6px;font-size:14px;line-height:22px;color:${colorMuted};">${escapeHtml(view.weekdayName)} · 统计时段 00:00–23:59（北京时间）</div>
</td></tr>

<tr><td style="padding:24px 36px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${colorText}" style="background:${colorText};border-radius:14px;">
<tr><td style="padding:24px 24px 20px;">
<div style="font-size:13px;line-height:20px;color:#a8a8b3;">今日净消费（积分）</div>
<div style="padding-top:4px;font-family:'SF Pro Display',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:40px;line-height:48px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">${escapeHtml(view.total)}</div>
<div style="padding-top:8px;font-size:13px;line-height:20px;color:#a8a8b3;"><span style="color:${view.deltaTone};font-weight:600;">${escapeHtml(view.delta)}</span>&nbsp;&nbsp;·&nbsp;&nbsp;近 7 日日均 ${escapeHtml(view.avgLabel)}</div>
</td></tr>
<tr><td style="padding:0 24px 22px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="33%" valign="top" style="border-top:1px solid #2c2c33;padding-top:14px;"><div style="font-size:12px;line-height:18px;color:#8a8a94;">生成次数</div><div style="font-size:17px;line-height:26px;font-weight:600;color:#ffffff;">${view.orderCount}</div></td>
<td width="34%" valign="top" style="border-top:1px solid #2c2c33;padding-top:14px;"><div style="font-size:12px;line-height:18px;color:#8a8a94;">失败退回</div><div style="font-size:17px;line-height:26px;font-weight:600;color:#ffffff;">${escapeHtml(view.refund)}</div></td>
<td width="33%" valign="top" style="border-top:1px solid #2c2c33;padding-top:14px;"><div style="font-size:12px;line-height:18px;color:#8a8a94;">当前余额</div><div style="font-size:17px;line-height:26px;font-weight:600;color:#ffffff;">${escapeHtml(view.available)}</div></td>
</tr></table>
</td></tr>
</table>
</td></tr>

${insights}

<tr><td style="padding:28px 36px 0;">
<div style="font-size:15px;line-height:22px;font-weight:600;color:${colorText};">消费时段分布</div>
<div style="padding-top:2px;font-size:12px;line-height:18px;color:${colorFaint};">按小时汇总${view.peakHourLabel ? ` · 高峰 ${escapeHtml(view.peakHourLabel)}` : ""}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;border-bottom:1px solid ${colorLine};">
<tr>${view.hourBars.map(barRow).join("")}</tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="25%" style="padding-top:6px;font-size:11px;color:${colorFaint};">0 时</td>
<td width="25%" style="padding-top:6px;font-size:11px;color:${colorFaint};">6 时</td>
<td width="25%" style="padding-top:6px;font-size:11px;color:${colorFaint};">12 时</td>
<td width="25%" style="padding-top:6px;font-size:11px;color:${colorFaint};">18 时</td>
</tr></table>
</td></tr>

${capRows}

${modelRows}

<tr><td style="padding:28px 36px 0;">
<div style="font-size:15px;line-height:22px;font-weight:600;color:${colorText};">近 7 日趋势</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;">
<tr>${view.dayBars.map(dayBar).join("")}</tr>
<tr>${view.dayBars.map(dayLabel).join("")}</tr>
</table>
</td></tr>

${orders}

<tr><td style="padding:28px 36px 36px;">
${view.walletUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${colorText}" style="border-radius:10px;background:${colorText};"><a href="${escapeHtml(view.walletUrl)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">查看完整消费明细 →</a></td></tr></table>` : ""}
<div style="padding-top:20px;border-top:1px solid ${colorLine};margin-top:24px;font-size:12px;line-height:20px;color:${colorFaint};">你订阅了每日消费报告，仅在当天有消费时发送。${view.settingsUrl ? `不想再收到？前往 <a href="${escapeHtml(view.settingsUrl)}" style="color:${colorMuted};">账号设置</a> 关闭。` : "可在账号设置中关闭。"}</div>
</td></tr>
</table>`;
}

/** 把微积分转成最多两位小数的积分文本，例如 1,234.5。 */
export function formatCredits(microInput: number): string {
  const negative = microInput < 0;
  let micro = negative ? -microInput : microInput;
  const cents = Math.trunc((micro + 5000) / 10000);
  const whole = Math.trunc(cents / 100);
  const frac = cents % 100;
  const digits = String(whole);
  let grouped = "";
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) grouped += ",";
    grouped += digits[index];
  }
  let text = grouped;
  if (frac !== 0) text += `.${String(frac).padStart(2, "0")}`.replace(/0+$/, "");
  return negative ? `-${text}` : text;
}

export function renderConsumptionReport(report: ConsumptionReport): Rendered {
  const view = buildReportView(report);
  const html = renderLayout({
    title: "消费日报",
    preheader: `今日消费 ${view.total} 积分，共 ${report.orderCount} 次生成。${view.insights[0] ?? ""}`,
    brand: report.brand,
    width: 600,
    body: reportBody(view),
    footerNote: "数据来自你的积分账单，以账单页为准。",
  });
  let text = `${report.brand} 消费日报（${report.date}）\n\n今日净消费：${view.total} 积分（${view.delta}）\n生成次数：${report.orderCount}\n失败退回：${view.refund} 积分\n当前余额：${view.available} 积分\n`;
  if (view.capRows.length > 0) {
    text += "\n消费构成：\n";
    for (const row of view.capRows) text += `- ${row.label}：${row.value} 积分（${row.percent}，${row.count} 次）\n`;
  }
  if (view.insights.length > 0) {
    text += "\n今日洞察：\n";
    for (const line of view.insights) text += `- ${line}\n`;
  }
  if (report.walletUrl) text += `\n完整明细：${report.walletUrl}\n`;
  text += "\n你订阅了每日消费报告，可在账号设置中关闭。";
  return {
    subject: `${report.brand} 消费日报 · ${shortDate(report.date)} · 今日消费 ${view.total} 积分`,
    text,
    html,
  };
}

function buildReportView(report: ConsumptionReport): ReportView {
  const view: ReportView = {
    ...report,
    total: formatCredits(report.totalMicro),
    consume: formatCredits(report.consumeMicro),
    refund: formatCredits(report.refundMicro),
    available: formatCredits(report.availableMicro),
    delta: "",
    deltaTone: "",
    avgLabel: "",
    runway: "",
    peakHourLabel: "",
    hourBars: [],
    dayBars: [],
    capRows: [],
    modelRows: [],
    orders: [],
    insights: [],
    stackCells: [],
  };

  let weekSum = 0;
  let activeDays = 0;
  for (const day of report.last7) {
    weekSum += day.micro;
    if (day.micro > 0) activeDays += 1;
  }
  const avg = report.last7.length > 0 ? Math.trunc(weekSum / report.last7.length) : 0;
  view.avgLabel = formatCredits(avg);
  if (report.previousDayMicro <= 0) {
    view.delta = "昨日无消费";
    view.deltaTone = "#c7c7d1";
  } else {
    const change = ((report.totalMicro - report.previousDayMicro) / report.previousDayMicro) * 100;
    if (change >= 0) {
      view.delta = `较昨日 ↑ ${change.toFixed(0)}%`;
      view.deltaTone = "#ff9d7a";
    } else {
      view.delta = `较昨日 ↓ ${(-change).toFixed(0)}%`;
      view.deltaTone = "#5ee0a7";
    }
  }

  let hourMax = 0;
  let peak = -1;
  report.hourly.forEach((value, hour) => {
    if (value > hourMax) {
      hourMax = value;
      peak = hour;
    }
  });
  report.hourly.forEach((value, hour) => {
    let height = 2;
    let color = colorLine;
    if (value > 0 && hourMax > 0) {
      height = Math.max(4, Math.round((value / hourMax) * 88));
      color = "#b9c4ff";
      if (hour === peak) color = colorAccent;
    }
    view.hourBars.push({
      label: "",
      height,
      color,
      title: `${String(hour).padStart(2, "0")}:00 ${formatCredits(value)} 积分`,
      value: "",
      strong: false,
    });
  });
  if (peak >= 0) {
    const padded = String(peak).padStart(2, "0");
    view.peakHourLabel = `${padded}:00–${padded}:59`;
  }

  let dayMax = 0;
  for (const day of report.last7) dayMax = Math.max(dayMax, day.micro);
  report.last7.forEach((day, index) => {
    const last = index === report.last7.length - 1;
    let height = 3;
    let color = colorLine;
    if (day.micro > 0 && dayMax > 0) {
      height = Math.max(4, Math.round((day.micro / dayMax) * 80));
      color = "#d5dbff";
      if (last) color = colorAccent;
    }
    view.dayBars.push({
      label: last ? "今天" : day.label,
      height,
      color,
      title: "",
      value: day.micro === 0 ? "—" : formatCredits(day.micro),
      strong: last,
    });
  });

  const consume = Math.max(report.consumeMicro, 1);
  view.capRows = sliceRows(report.capabilities, consume, 6);
  view.modelRows = sliceRows(report.models, consume, 5);
  let remaining = 100;
  view.capRows.forEach((row, index) => {
    let width = row.width;
    if (index === view.capRows.length - 1) width = remaining;
    if (width <= 0) return;
    remaining -= width;
    view.stackCells.push({ width, color: row.color });
  });
  for (const order of report.topOrders) {
    view.orders.push({ time: order.time, model: order.model, kind: order.kind, value: formatCredits(order.micro) });
  }

  if (avg > 0 && report.availableMicro > 0) {
    const days = report.availableMicro / avg;
    if (days < 1000) view.runway = `${Math.floor(days)}`;
  }
  view.insights = reportInsights(report, view, avg, activeDays, peak);
  return view;
}

function sliceRows(items: Slice[], total: number, limit: number): SliceRow[] {
  const rows: SliceRow[] = [];
  let otherMicro = 0;
  let otherCount = 0;
  items.forEach((item, index) => {
    if (index >= limit - 1 && items.length > limit) {
      otherMicro += item.micro;
      otherCount += item.count;
      return;
    }
    rows.push(newSliceRow(item.label, item.micro, item.count, total, rows.length));
  });
  if (otherMicro > 0) rows.push(newSliceRow("其他", otherMicro, otherCount, total, sliceColors.length - 1));
  return rows;
}

function newSliceRow(label: string, micro: number, count: number, total: number, colorIndex: number): SliceRow {
  const share = (micro / total) * 100;
  const width = Math.min(Math.max(Math.round(share), 1), 100);
  return {
    label,
    value: formatCredits(micro),
    count,
    percent: `${share.toFixed(1)}%`,
    width,
    rest: 100 - width,
    color: sliceColors[Math.min(colorIndex, sliceColors.length - 1)],
  };
}

function reportInsights(report: ConsumptionReport, view: ReportView, avg: number, activeDays: number, peak: number): string[] {
  const lines: string[] = [];
  if (report.capabilities.length > 0) {
    const top = view.capRows[0];
    lines.push(`${top.label} 是今天的主要开销，占 ${top.percent}，共 ${top.count} 次。`);
  }
  if (report.models.length > 0 && report.models[0].count > 0) {
    const top = report.models[0];
    lines.push(`用得最多的是 ${top.label}，平均每次 ${formatCredits(Math.trunc(top.micro / top.count))} 积分。`);
  }
  if (avg > 0) {
    const ratio = report.totalMicro / avg;
    if (ratio >= 1.5) lines.push(`今日消费是近 7 日日均的 ${ratio.toFixed(1)} 倍，明显高于平时。`);
    else if (ratio <= 0.5) lines.push("今日消费不到近 7 日日均的一半，用量较轻。");
  }
  if (report.refundMicro > 0) {
    lines.push(`有 ${view.refund} 积分因生成失败或按实际用量结算已自动退回，未计入净消费。`);
  }
  if (peak >= 0 && report.totalMicro > 0) {
    const share = (report.hourly[peak] / Math.max(report.consumeMicro, 1)) * 100;
    if (share >= 40) lines.push(`${String(peak).padStart(2, "0")} 点是消费高峰，集中了 ${share.toFixed(0)}% 的开销。`);
  }
  if (view.runway) {
    lines.push(`按近 7 日日均估算，当前余额约可使用 ${view.runway} 天。`);
  } else if (report.availableMicro <= 0) {
    lines.push("当前可用余额已用完，充值后可继续生成。");
  }
  if (activeDays >= 7) lines.push("你已连续 7 天保持创作。");
  return lines.length > 5 ? lines.slice(0, 5) : lines;
}

function shortDate(date: string): string {
  if (date.length === 10) {
    return `${date.slice(5, 7).replace(/^0+/, "")} 月 ${date.slice(8, 10).replace(/^0+/, "")} 日`;
  }
  return date;
}
