// 对应 backend/internal/emailtpl/layout.go
// 邮件客户端普遍不执行脚本、会剥离 <style> 和 SVG，版式全部使用表格 + 行内样式。

export const colorPage = "#f4f4f6";
export const colorCard = "#ffffff";
export const colorLine = "#e6e6eb";
export const colorText = "#16161a";
export const colorMuted = "#6e6e78";
export const colorFaint = "#9a9aa3";
export const colorSurface = "#f6f6f8";
export const colorAccent = "#3b5bfd";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface LayoutData {
  title: string;
  preheader: string;
  brand: string;
  width?: number;
  body: string;
  footerNote: string;
}

export function renderLayout(data: LayoutData): string {
  const width = data.width && data.width > 0 ? data.width : 560;
  const brand = escapeHtml(data.brand);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(data.title)}</title>
</head>
<body style="margin:0;padding:0;background:${colorPage};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(data.preheader)}&#8203;&#160;&#8203;&#160;&#8203;&#160;&#8203;&#160;&#8203;&#160;&#8203;&#160;&#8203;&#160;&#8203;&#160;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${colorPage}" style="background:${colorPage};">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="${width}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${width}px;">
<tr><td style="padding:0 4px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',Helvetica,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="28" height="28" align="center" valign="middle" bgcolor="${colorText}" style="width:28px;height:28px;border-radius:8px;color:#ffffff;font-size:14px;font-weight:700;line-height:28px;">${escapeHtml(brandInitial(data.brand))}</td>
<td style="padding-left:10px;font-size:15px;font-weight:600;color:${colorText};letter-spacing:0.2px;">${brand}</td>
</tr></table>
</td></tr>
<tr><td bgcolor="${colorCard}" style="background:${colorCard};border:1px solid ${colorLine};border-radius:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',Helvetica,Arial,sans-serif;color:${colorText};">
${data.body}
</td></tr>
<tr><td style="padding:24px 8px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Helvetica,Arial,sans-serif;font-size:12px;line-height:20px;color:${colorFaint};text-align:center;">
${escapeHtml(data.footerNote)}<br>此邮件由系统自动发送，请勿直接回复。<br>&copy; ${brand}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function brandInitial(brand: string): string {
  for (const char of brand.trim()) return char.toUpperCase();
  return "·";
}
