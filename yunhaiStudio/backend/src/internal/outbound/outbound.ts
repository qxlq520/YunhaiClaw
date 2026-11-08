// 对应 backend/internal/outbound/outbound.go
// 统一出网校验：协议白名单、URL 凭据禁止、私网/保留地址拦截、重定向复核。

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError, badAuthRequest } from "@/internal/kernel/errors";

export const maxOutboundRedirects = 5;
export const maxOutboundHeaderCount = 32;
export const maxOutboundHeaderBytes = 16 << 10;
export const maxProxyUrlBytes = 512;
export const customRelayHeadersHeader = "X-Canvas-Upstream-Headers";
export const defaultOutboundUserAgent = "CanvasViewport/1.0 (+https://github.com/ddcat-ai/open-ai-canvas)";

export interface OutboundHeader {
  name: string;
  value: string;
}

export function validateOutboundUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw badAuthRequest("外部服务地址无效");
  }
  if (parsed.hostname === "") throw badAuthRequest("外部服务地址无效");
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw badAuthRequest("外部服务地址只支持 http/https");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw badAuthRequest("外部服务地址不允许包含认证信息");
  }
  validateOutboundHostSync(parsed.hostname);
  return parsed;
}

export function validateCustomRelayUrl(rawUrl: string): URL {
  if (rawUrl.trim().length > 4096) throw badAuthRequest("自定义渠道地址过长");
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw badAuthRequest("自定义渠道地址无效");
  }
  if (parsed.hostname === "") throw badAuthRequest("自定义渠道地址无效");
  const scheme = parsed.protocol.toLowerCase();
  if (scheme !== "https:" && scheme !== "http:") throw badAuthRequest("自定义渠道地址只支持 http/https");
  if (scheme === "http:" && !allowedPrivateUpstreamHost(parsed.hostname)) {
    throw badAuthRequest("自定义渠道 HTTP 仅允许访问已配置的可信上游主机");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw badAuthRequest("自定义渠道地址不允许包含认证信息");
  }
  if (parsed.hash !== "") throw badAuthRequest("自定义渠道地址不允许包含片段");
  if (blockedHostLiteral(parsed.hostname) && !allowedPrivateUpstreamHost(parsed.hostname)) {
    throw badAuthRequest("不允许访问本机或内网地址");
  }
  return parsed;
}

export function validateProxyUrl(rawUrl: string): URL | null {
  const value = rawUrl.trim();
  if (value === "") return null;
  if (value.length > maxProxyUrlBytes) throw badAuthRequest("渠道代理地址过长");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw badAuthRequest("渠道代理地址无效");
  }
  if (parsed.hostname === "") throw badAuthRequest("渠道代理地址无效");
  const scheme = parsed.protocol.toLowerCase();
  if (!["socks5:", "socks5h:", "http:", "https:"].includes(scheme)) {
    throw badAuthRequest("渠道代理只支持 socks5/socks5h/http/https");
  }
  if (parsed.hash !== "") throw badAuthRequest("渠道代理地址不允许包含片段");
  return parsed;
}

export interface OutboundRequestInit extends Omit<RequestInit, "redirect"> {
  timeoutMs?: number;
  /** 允许的最大重定向次数；传 0 表示禁止重定向。 */
  maxRedirects?: number;
}

/** 带 SSRF 校验与重定向复核的出站请求；返回 fetch Response。 */
export async function outboundFetch(url: string, init: OutboundRequestInit = {}): Promise<Response> {
  const { timeoutMs = 30_000, maxRedirects = maxOutboundRedirects, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = validateOutboundUrl(url);
    for (let redirects = 0; ; redirects += 1) {
      const headers = new Headers(rest.headers ?? {});
      if (!headers.has("user-agent")) headers.set("user-agent", defaultOutboundUserAgent);
      const response = await fetch(current.toString(), { ...rest, headers, redirect: "manual", signal: controller.signal });
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) return response;
      if (redirects >= maxRedirects) throw new AppError({ status: 502, message: "外部服务重定向次数过多" });
      current = validateOutboundUrl(new URL(location, current).toString());
    }
  } finally {
    clearTimeout(timer);
  }
}

export function applyDefaultOutboundHeaders(headers: Headers): Headers {
  if (!headers.get("user-agent")?.trim()) headers.set("user-agent", defaultOutboundUserAgent);
  return headers;
}

export function normalizeOutboundHeaders(input: OutboundHeader[]): OutboundHeader[] {
  if (input.length > maxOutboundHeaderCount) {
    throw badAuthRequest(`自定义请求头最多支持 ${maxOutboundHeaderCount} 项`);
  }
  const seen = new Set<string>();
  const normalized: OutboundHeader[] = [];
  let totalBytes = 0;
  for (const item of input) {
    const name = item.name.trim();
    const value = item.value.trim();
    if (name === "" && value === "") continue;
    if (name === "" || !validOutboundHeaderName(name)) {
      throw badAuthRequest("自定义请求头名称无效，请使用标准 HTTP Header 名称");
    }
    const lowerName = name.toLowerCase();
    if (blockedOutboundHeader(lowerName)) throw badAuthRequest(`请求头 ${name} 由系统管理，不允许自定义`);
    if (seen.has(lowerName)) throw badAuthRequest(`自定义请求头不能重复：${name}`);
    if (!validOutboundHeaderValue(value)) throw badAuthRequest(`请求头 ${name} 的值包含非法控制字符`);
    if (name.length > 128 || value.length > 4096) throw badAuthRequest("单个自定义请求头名称或值过长");
    totalBytes += name.length + value.length;
    if (totalBytes > maxOutboundHeaderBytes) throw badAuthRequest("自定义请求头总大小不能超过 16KB");
    seen.add(lowerName);
    normalized.push({ name, value });
  }
  return normalized;
}

export function applyOutboundHeaders(headers: Headers, items: OutboundHeader[]): Headers {
  for (const item of items) headers.set(item.name, item.value);
  return headers;
}

export function encodeOutboundHeadersJson(headers: OutboundHeader[]): string {
  return JSON.stringify(normalizeOutboundHeaders(headers));
}

export function parseOutboundHeadersJson(raw: string): OutboundHeader[] {
  if (raw.trim() === "") return [];
  let parsed: OutboundHeader[];
  try {
    parsed = JSON.parse(raw) as OutboundHeader[];
  } catch {
    throw new Error("渠道自定义请求头配置损坏");
  }
  return normalizeOutboundHeaders(parsed);
}

export function decodeRelayOutboundHeaders(encoded: string): OutboundHeader[] {
  if (encoded.trim() === "") return [];
  if (encoded.length > maxOutboundHeaderBytes * 2 + 1024) throw badAuthRequest("自定义请求头配置过大");
  let parsed: OutboundHeader[];
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as OutboundHeader[];
  } catch {
    throw badAuthRequest("自定义请求头格式无效");
  }
  return normalizeOutboundHeaders(parsed);
}

function validOutboundHeaderName(name: string): boolean {
  // RFC 7230 token 字符集。
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name);
}

function validOutboundHeaderValue(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code === 9 || (code >= 32 && code !== 127)) continue;
    return false;
  }
  return true;
}

function blockedOutboundHeader(name: string): boolean {
  const blocked = new Set([
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "host",
    "content-length",
    "content-type",
    "accept",
    "connection",
    "proxy-connection",
    "keep-alive",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
    "forwarded",
    "x-goog-api-key",
  ]);
  return blocked.has(name) || name.startsWith("x-canvas-") || name.startsWith("x-forwarded-");
}

export function validateOutboundHost(host: string): Promise<void> {
  return resolveOutboundHost(host).then(() => undefined);
}

function validateOutboundHostSync(host: string): void {
  const normalized = normalizeOutboundHost(host);
  if (normalized === "") throw badAuthRequest("外部服务域名无效");
  const allowPrivate = allowPrivateUpstreams() || allowedPrivateUpstreamHost(normalized);
  if (!allowPrivate && (normalized === "localhost" || normalized.endsWith(".localhost"))) {
    throw badAuthRequest("不允许访问本机或内网地址");
  }
  if (!allowPrivate && blockedHostLiteral(normalized)) {
    throw badAuthRequest("不允许访问本机、内网或链路本地地址");
  }
}

/**
 * ACT: Node 无法像 Go 的 DialContext 一样把连接固定到已校验 IP；
 * 这里在请求前解析并校验全部地址，重定向再复核，保留同等的 SSRF 边界。
 */
export async function resolveOutboundHost(host: string): Promise<string[]> {
  const normalized = normalizeOutboundHost(host);
  if (normalized === "") throw badAuthRequest("外部服务域名无效");
  const allowPrivate = allowPrivateUpstreams() || allowedPrivateUpstreamHost(normalized);
  if (!allowPrivate && (normalized === "localhost" || normalized.endsWith(".localhost"))) {
    throw badAuthRequest("不允许访问本机或内网地址");
  }
  if (isIP(normalized) !== 0) {
    if (!allowPrivate && blockedIp(normalized)) throw badAuthRequest("不允许访问本机、内网或链路本地地址");
    return [normalized];
  }
  let addresses;
  try {
    addresses = await lookup(normalized, { all: true, verbatim: true });
  } catch (error) {
    const failure = new AppError({
      status: 502,
      message: "外部服务域名解析失败，请检查渠道域名和后端 DNS 配置",
      reason: "upstream_dns_failed",
      cause: error,
    });
    throw failure;
  }
  if (addresses.length === 0) {
    throw new AppError({
      status: 502,
      message: "外部服务域名没有可用地址，请检查渠道域名和后端 DNS 配置",
      reason: "upstream_dns_failed",
    });
  }
  if (!allowPrivate) {
    for (const item of addresses) {
      if (blockedIp(item.address)) throw badAuthRequest("不允许访问本机、内网或链路本地地址");
    }
  }
  return addresses.map((item) => item.address);
}

function blockedHostLiteral(host: string): boolean {
  return isIP(host) !== 0 && blockedIp(host);
}

export function blockedIp(addressInput: string): boolean {
  const address = addressInput.trim().toLowerCase();
  if (address === "" || address === "::" || address === "::1") return true;
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 192 && b === 0) return true;
    if (a === 192 && b === 2) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 198 && b === 51 && parts[2] === 100) return true;
    if (a === 203 && b === 0 && parts[2] === 113) return true;
    if (a >= 224) return true;
    return false;
  }
  if (isIP(address) === 6) {
    if (address.startsWith("fc") || address.startsWith("fd")) return true;
    if (address.startsWith("fe8") || address.startsWith("fe9") || address.startsWith("fea") || address.startsWith("feb")) return true;
    if (address.startsWith("ff")) return true;
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return blockedIp(mapped[1]);
    return false;
  }
  return true;
}

export function blockedCustomRelayIp(address: string): boolean {
  if (blockedIp(address)) return true;
  if (address.startsWith("100::") || address.startsWith("2001:db8:")) return true;
  return false;
}

export function allowPrivateUpstreams(): boolean {
  const value = (process.env.CANVAS_ALLOW_PRIVATE_UPSTREAMS ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function allowedPrivateUpstreamHost(host: string): boolean {
  const normalized = normalizeOutboundHost(host);
  if (normalized === "") return false;
  return (process.env.CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS ?? "")
    .split(",")
    .some((item) => normalizeOutboundHost(item) === normalized);
}

export function normalizeOutboundHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}
