// 对应 backend/internal/emailtpl/code.go

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

/** 一次性验证码邮件。Code 只出现在正文与标题里，调用方不得写入日志。 */
export interface CodeEmail {
  brand: string;
  /** 正文标题，如“重置密码”。 */
  heading: string;
  /** 标题里的验证码名称，如“密码重置验证码”；留空时为 heading + “验证码”。 */
  subjectLabel?: string;
  /** 说明用途，如“你正在重置…账号密码，请在页面中输入以下验证码。” */
  intro: string;
  code: string;
  ttlMinutes?: number;
  recipient?: string;
  securityTip?: string;
}

/** 一封邮件的两种正文。 */
export interface Rendered {
  subject: string;
  text: string;
  html: string;
}

/** 不含验证码的账号通知，如邮箱变更提醒、测试邮件。 */
export interface NoticeEmail {
  brand: string;
  subject: string;
  heading: string;
  lines: string[];
  tip: string;
}

function codeBody(mail: CodeEmail): string {
  const ttl = mail.ttlMinutes ?? 0;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:40px 40px 8px;">
<div style="font-size:24px;line-height:32px;font-weight:700;color:${colorText};letter-spacing:-0.2px;">${escapeHtml(mail.heading)}</div>
<div style="padding-top:12px;font-size:15px;line-height:24px;color:${colorMuted};">${escapeHtml(mail.intro)}</div>
</td></tr>
<tr><td style="padding:24px 40px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${colorSurface}" style="background:${colorSurface};border:1px solid ${colorLine};border-radius:12px;">
<tr><td align="center" style="padding:28px 16px 10px;">
<span style="display:inline-block;font-family:'SF Mono',SFMono-Regular,Menlo,Consolas,'Roboto Mono','Courier New',monospace;font-size:38px;line-height:44px;font-weight:700;letter-spacing:10px;color:${colorText};-webkit-user-select:all;user-select:all;padding-left:10px;">${escapeHtml(mail.code)}</span>
</td></tr>
<tr><td align="center" style="padding:0 16px 22px;font-size:12px;line-height:18px;color:${colorFaint};">双击或长按验证码即可选中复制</td></tr>
</table>
</td></tr>
<tr><td style="padding:16px 40px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:4px 0;font-size:13px;line-height:20px;color:${colorMuted};"><span style="color:${colorAccent};">●</span>&nbsp;&nbsp;${ttl} 分钟内有效，只能使用一次</td></tr>
${mail.recipient ? `<tr><td style="padding:4px 0;font-size:13px;line-height:20px;color:${colorMuted};"><span style="color:${colorAccent};">●</span>&nbsp;&nbsp;发送至 ${escapeHtml(mail.recipient)}</td></tr>` : ""}
<tr><td style="padding:4px 0;font-size:13px;line-height:20px;color:${colorMuted};"><span style="color:${colorAccent};">●</span>&nbsp;&nbsp;${escapeHtml(mail.brand)} 的工作人员不会向你索要验证码</td></tr>
</table>
</td></tr>
<tr><td style="padding:28px 40px 36px;">
<div style="border-top:1px solid ${colorLine};padding-top:20px;font-size:13px;line-height:21px;color:${colorFaint};">${escapeHtml(mail.securityTip ?? "")}</div>
</td></tr>
</table>`;
}

/** 生成验证码邮件。标题把验证码放在最前，通知栏和收件箱列表无需打开邮件即可看到。 */
export function renderCode(input: CodeEmail): Rendered {
  const mail: CodeEmail = { ...input };
  if (!mail.ttlMinutes || mail.ttlMinutes <= 0) mail.ttlMinutes = 10;
  if (!(mail.securityTip ?? "").trim()) {
    mail.securityTip = "如果这不是你本人的操作，请忽略本邮件，你的账号不会有任何变化。";
  }
  const html = renderLayout({
    title: mail.heading,
    preheader: `${mail.code} 是你的验证码，${mail.ttlMinutes} 分钟内有效。`,
    brand: mail.brand,
    body: codeBody(mail),
    footerNote: `你收到这封邮件，是因为有人在 ${mail.brand} 使用了这个邮箱地址。`,
  });
  const text =
    `${mail.intro}\n\n验证码：${mail.code}\n\n${mail.ttlMinutes} 分钟内有效，只能使用一次。请勿向任何人透露验证码。\n` +
    `${mail.securityTip}\n\n— ${mail.brand}`;
  const label = (mail.subjectLabel ?? "").trim() || `${mail.heading}验证码`;
  return { subject: `${mail.code} 是你的${mail.brand}${label}`, text, html };
}

function noticeBody(mail: NoticeEmail): string {
  const lines = mail.lines
    .map((line) => `<tr><td style="padding:12px 40px 0;font-size:15px;line-height:24px;color:${colorMuted};">${escapeHtml(line)}</td></tr>`)
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:40px 40px 4px;">
<div style="font-size:24px;line-height:32px;font-weight:700;color:${colorText};letter-spacing:-0.2px;">${escapeHtml(mail.heading)}</div>
</td></tr>
${lines}
<tr><td style="padding:28px 40px 36px;">
<div style="border-top:1px solid ${colorLine};padding-top:20px;font-size:13px;line-height:21px;color:${colorFaint};">${escapeHtml(mail.tip)}</div>
</td></tr>
</table>`;
}

export function renderNotice(mail: NoticeEmail): Rendered {
  const html = renderLayout({
    title: mail.heading,
    preheader: mail.lines.length > 0 ? mail.lines[0] : mail.heading,
    brand: mail.brand,
    body: noticeBody(mail),
    footerNote: `这是一封来自 ${mail.brand} 的账号通知。`,
  });
  const text = `${mail.heading}\n\n${mail.lines.join("\n")}\n\n${mail.tip}\n\n— ${mail.brand}`;
  return { subject: mail.subject, text, html };
}
