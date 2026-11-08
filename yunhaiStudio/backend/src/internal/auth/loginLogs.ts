// 对应 backend/internal/auth/login_logs.go
// 登录日志构造、脱敏与失败记录。

import { AppError, newId, wrapAppError } from "@/internal/kernel/errors";
import type { LoginLog } from "@/internal/model/modelsLoginLog";
import type { User } from "@/internal/model/modelsIdentity";
import { appendLoginLog } from "@/internal/repository/loginLogs";
import type { Service } from "./authService";

export interface LoginContext {
  ip: string;
  userAgent: string;
}

export function loginLogText(value: string, max: number): string {
  const filtered = Array.from(value).filter((char) => {
    const code = char.charCodeAt(0);
    return !(code <= 0x1f || (code >= 0x7f && code <= 0x9f));
  });
  const trimmed = filtered.join("").trim();
  const runes = Array.from(trimmed);
  return runes.length > max ? runes.slice(0, max).join("") : trimmed;
}

export function maskLoginAccount(accountInput: string): string {
  const account = loginLogText(accountInput, 160);
  const at = account.lastIndexOf("@");
  if (at >= 0) {
    if (at === 0) return `***${account.slice(at)}`;
    return `${Array.from(account.slice(0, at))[0]}***${account.slice(at)}`;
  }
  const digits = account.startsWith("+") ? account.slice(1) : account;
  if (digits.length >= 8 && /^[0-9]+$/.test(digits)) {
    return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
  }
  if (digits.length >= 4 && /^[0-9]+$/.test(digits)) {
    return `${digits.slice(0, 1)}****${digits.slice(-1)}`;
  }
  return account;
}

export function newLoginLog(method: string, source: string, context: LoginContext): LoginLog {
  return {
    id: newId(),
    userId: null,
    username: "",
    displayName: "",
    account: "",
    event: "login",
    method,
    source,
    result: "success",
    ip: loginLogText(context.ip, 64),
    userAgent: loginLogText(context.userAgent, 512),
    sessionRef: "",
    reason: "",
    message: "",
    createdAt: new Date().toISOString(),
  };
}

export function loginLogUser(event: LoginLog, user: User): void {
  event.userId = user.id;
  event.username = user.username;
  event.displayName = user.displayName;
  event.account = user.username;
}

/** 对外错误文案已由 AppError 约束；内部错误仅记固定分类，避免写入 SQL/上游密钥。 */
export function setLoginFailure(event: LoginLog, original: unknown): void {
  event.result = "failed";
  event.reason = "internal_error";
  event.message = "系统处理失败";
  if (event.event === "login" || event.userId === null) event.sessionRef = "";
  if (original instanceof AppError) {
    event.reason = original.reason;
    event.message = loginLogText(original.message, 500);
  }
}

export async function recordLoginFailure(service: Service, event: LoginLog, original: unknown): Promise<unknown> {
  setLoginFailure(event, original);
  try {
    await appendLoginLog(service.repo, event);
  } catch (error) {
    throw wrapAppError(500, "登录日志写入失败，请稍后重试", { original, error });
  }
  return original;
}

export async function recordRejectedLogin(
  service: Service,
  method: string,
  context: LoginContext,
  status: number,
): Promise<void> {
  const event = newLoginLog(method, "login", context);
  let message = "登录请求被拒绝";
  if (status === 400) message = "登录请求参数无效";
  if (status === 429) message = "登录请求过于频繁";
  if (status >= 500) message = "登录服务暂时不可用";
  setLoginFailure(event, new AppError({ status, message }));
  try {
    await appendLoginLog(service.repo, event);
  } catch (error) {
    throw wrapAppError(500, "登录日志写入失败", error);
  }
}
