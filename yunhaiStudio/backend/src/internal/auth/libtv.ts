// 对应 backend/internal/auth/libtv.go
// LibTV 配置与画布详情拉取。

import { badAuthRequest, unauthorized } from "@/internal/kernel/errors";
import type { User } from "@/internal/model/modelsIdentity";
import type { SystemSetting } from "@/internal/model/modelsPlatform";
import { outboundFetch, validateOutboundUrl } from "@/internal/outbound/outbound";
import { canvasProject } from "@/internal/repository/project";
import { recordNotFound } from "@/internal/repository/repository";
import { saveSetting, setting as readSetting } from "@/internal/repository/setting";
import type { Service } from "./authService";
import { adaptLibTVDetail } from "./libtvAdapter";

export const libTVSettingKey = "libtv";
export const libTVDetailUrl = "https://api.liblib.tv/api/canvas/project/detail";
export const libTVMaxResponseBytes = 8 << 20;

export interface LibTVSettingRequest {
  enabled: boolean;
  token: string;
  clearToken: boolean;
}

export interface PublicLibTVSetting {
  enabled: boolean;
  hasToken: boolean;
  updatedAt?: string;
}

export interface LibTVSettingValue {
  enabled: boolean;
  token: string;
}

export interface LibTVImportRequest {
  uuid: string;
}

export interface LibTVImportResult {
  batchId: string;
  batchCreatedAt: string;
  projectUuid: string;
  projectName: string;
  nodes: LibTVCanvasNode[];
  connections: LibTVCanvasConnection[];
  importedNodeCount: number;
  importedConnectionCount: number;
  skippedNodes: LibTVImportIssue[];
  skippedConnections: LibTVImportIssue[];
  warnings: LibTVImportWarning[];
  multiResultNodeCount: number;
  staleNodeCount: number;
  reusedFailedNodeCount: number;
  placeholderNodeCount: number;
  convertedSpecialCount: number;
}

export interface LibTVCanvasNode {
  id: string;
  type: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  prompt?: string;
  model?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  durationMs?: number;
  mimeType?: string;
  status?: string;
  errorDetails?: string;
  metadata: LibTVImportMetadata;
}

export interface LibTVImportMetadata {
  provider: string;
  projectUuid: string;
  nodeKey: string;
  batchId: string;
  sourceType?: string;
  styleAssetUuid?: string;
  styleVersionUuid?: string;
  styleName?: string;
}

export interface LibTVCanvasConnection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
}

export interface LibTVImportIssue {
  id?: string;
  name?: string;
  reason: string;
}

export interface LibTVImportWarning {
  id?: string;
  message: string;
}

interface LibTVEnvelope {
  code: number;
  data: unknown;
  msg: string;
}

export interface LibTVDetail {
  projectMeta: {
    uuid: string;
    name: string;
    effective: { canRead: boolean; canCopy: boolean };
  };
  nodeList: LibTVRawNode[];
  connectionList: LibTVRawConnection[];
}

export interface LibTVRawNode {
  nodeKey: string;
  name: string;
  data: string;
  position: { positionX: string; positionY: string };
  measured: { width: string; height: string };
  taskInfo: { status: number; failedReason: string };
  isStale: boolean;
}

export interface LibTVRawConnection {
  connectionId: string;
  source: string;
  target: string;
}

export interface LibTVNodeData {
  type: string;
  url: string[];
  coverUrl: string;
  styleAssetUuid: string;
  styleVersionUuid: string;
  styleName: string;
  params: Record<string, unknown>;
  taskInfo: { status: number; failedReason: string };
  isStale: boolean;
  resourceMeta: {
    items: { width: number; height: number; durationSec: number }[];
  };
}

export async function adminLibTVSetting(service: Service, actor: User | null): Promise<PublicLibTVSetting> {
  await service.host.requireAdmin(actor);
  const read = await readLibTVSetting(service);
  return publicLibTVSetting(read.setting, read.value);
}

export async function updateLibTVSetting(
  service: Service,
  actor: User | null,
  req: LibTVSettingRequest,
): Promise<PublicLibTVSetting> {
  await service.host.requireAdmin(actor);
  const current = await readLibTVSetting(service);
  let token = req.token.trim();
  if (req.clearToken) token = "";
  else if (token === "") token = current.value.token;
  if (req.enabled && token === "") throw badAuthRequest("启用 LibTV 前请先配置 Token");
  const stored: LibTVSettingValue = { enabled: req.enabled, token: await service.host.encryptSecret(token) };
  await saveSetting(service.repo, libTVSettingKey, JSON.stringify(stored), actor ? actor.id : "");
  const saved = await readSetting(service.repo, libTVSettingKey);
  return publicLibTVSetting(saved, { enabled: req.enabled, token });
}

export async function testLibTV(service: Service, actor: User | null, projectUuid: string): Promise<void> {
  if (!actor) throw unauthorized("请先登录");
  await service.host.requireAdmin(actor);
  const read = await readLibTVSetting(service);
  if (read.value.token === "") throw badAuthRequest("尚未配置 LibTV Token");
  await fetchLibTVDetail(projectUuid.trim(), read.value.token);
}

export async function importLibTV(
  service: Service,
  userId: string,
  canvasProjectId: string,
  projectUuid: string,
): Promise<LibTVImportResult> {
  const owner = userId.trim();
  const project = canvasProjectId.trim();
  if (owner === "" || project === "") {
    throw unauthorized(`请先打开已同步的${service.host.brandName()}画布`);
  }
  if (!(await canvasProject(service.repo, owner, project))) throw recordNotFound;
  const read = await readLibTVSetting(service);
  if (!read.value.enabled || read.value.token === "") {
    throw badAuthRequest("LibTV 尚未启用或未配置 Token");
  }
  const detail = await fetchLibTVDetail(projectUuid.trim(), read.value.token);
  return adaptLibTVDetail(detail);
}

export async function readLibTVSetting(
  service: Service,
): Promise<{ setting: SystemSetting | null; value: LibTVSettingValue }> {
  const saved = await readSetting(service.repo, libTVSettingKey);
  if (!saved) return { setting: null, value: { enabled: false, token: "" } };
  let value: LibTVSettingValue;
  try {
    value = JSON.parse(saved.valueJson) as LibTVSettingValue;
  } catch {
    throw new Error("LibTV 配置格式无效");
  }
  if (value.token !== "") value.token = await service.host.decryptSecret(value.token);
  return { setting: saved, value: { enabled: value.enabled === true, token: value.token ?? "" } };
}

export function publicLibTVSetting(setting: SystemSetting | null, value: LibTVSettingValue): PublicLibTVSetting {
  const result: PublicLibTVSetting = { enabled: value.enabled, hasToken: value.token.trim() !== "" };
  if (setting) result.updatedAt = setting.updatedAt;
  return result;
}

export async function fetchLibTVDetail(projectUuid: string, token: string): Promise<LibTVDetail> {
  const uuid = projectUuid.trim();
  if (!isLibTVProjectUuid(uuid)) throw badAuthRequest("LibTV 画布 UUID 格式无效");
  const endpoint = new URL(libTVDetailUrl);
  endpoint.searchParams.set("uuid", uuid);
  validateOutboundUrl(endpoint.toString());
  let response: Response;
  try {
    // Token 是 LibTV 专用凭证，禁止重定向，避免自定义请求头被带到其他主机。
    response = await outboundFetch(endpoint.toString(), {
      method: "GET",
      headers: { accept: "application/json", token },
      timeoutMs: 20_000,
      maxRedirects: 0,
    });
  } catch {
    throw new Error("LibTV 请求失败，请检查网络或 Token");
  }
  const body = await readLimitedText(response, libTVMaxResponseBytes);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`LibTV 请求失败（HTTP ${response.status}）`);
  }
  let envelope: LibTVEnvelope;
  try {
    envelope = JSON.parse(body) as LibTVEnvelope;
  } catch {
    throw new Error("LibTV 响应格式无效");
  }
  if (envelope.code !== 0) {
    throw new Error(envelope.msg.trim() || "LibTV 返回业务错误");
  }
  let detail = envelope.data as LibTVDetail;
  if (!detail || typeof detail !== "object") throw new Error("LibTV 画布数据格式无效");
  detail.projectMeta ??= { uuid: "", name: "", effective: { canRead: false, canCopy: false } };
  detail.nodeList ??= [];
  detail.connectionList ??= [];
  if ((detail.projectMeta.uuid ?? "").trim() === "") detail.projectMeta.uuid = uuid;
  if (!detail.projectMeta.effective?.canRead || !detail.projectMeta.effective?.canCopy) {
    throw new Error("当前 LibTV 画布不允许复制");
  }
  return detail;
}

async function readLimitedText(response: Response, limit: number): Promise<string> {
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > limit) throw new Error("LibTV 响应过大");
  return buffer.toString("utf8");
}

export function isLibTVProjectUuid(value: string): boolean {
  if (value.length !== 32) return false;
  return /^[0-9a-fA-F]{32}$/.test(value);
}
