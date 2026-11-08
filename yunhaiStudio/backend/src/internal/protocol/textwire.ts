// 对应 backend/internal/protocol/textwire.go

import type { Capability } from "./types";

export const TextWireChatCompletion = "chat-completion";
export const TextWireResponses = "responses";
export const TextWireClaude = "claude-api";

/** 按声明路径的末段端点识别文本线格式，识别不出时返回空字符串。 */
export function textWireForPath(path: string): string {
  let normalized = path.trim().toLowerCase();
  const index = normalized.search(/[?#]/);
  if (index >= 0) normalized = normalized.slice(0, index);
  normalized = normalized.replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) return TextWireChatCompletion;
  if (normalized.endsWith("/responses")) return TextWireResponses;
  if (normalized.endsWith("/messages")) return TextWireClaude;
  return "";
}

/** 解析 "METHOD /path" 形式的操作摘要；文本请求只认 POST。 */
export function textWireForOperation(summary: string): string {
  const [method, ...rest] = summary.trim().split(" ");
  const path = rest.join(" ");
  if (!path || method.trim().toLowerCase() !== "post") return "";
  return textWireForPath(path);
}

/** 返回操作摘要里的路径部分；摘要缺少方法或路径时返回空字符串。 */
export function operationPath(summary: string): string {
  const index = summary.trim().indexOf(" ");
  if (index < 0) return "";
  return summary.trim().slice(index + 1).trim();
}

/** 判断文本上游的 Base URL 是否走 Anthropic Messages 线。 */
export function anthropicWireForBaseUrl(baseUrl: string): boolean {
  const normalized = baseUrl.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes("api.anthropic.com")) return true;
  return normalized.includes("/anthropic") || normalized.includes("/claude");
}

export function hasCapability(capabilities: Capability[], capability: Capability): boolean {
  return capabilities.includes(capability);
}
