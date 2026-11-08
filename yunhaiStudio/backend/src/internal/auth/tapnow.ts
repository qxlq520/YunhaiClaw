// 对应 backend/internal/auth/tapnow.go
// TapNow 公开分享画布拉取。

import { badAuthRequest, unauthorized } from "@/internal/kernel/errors";
import { outboundFetch } from "@/internal/outbound/outbound";
import { canvasProject } from "@/internal/repository/project";
import { recordNotFound } from "@/internal/repository/repository";
import type { Service } from "./authService";
import { adaptTapNowDetail } from "./tapnowAdapter";

export const tapNowShareUrlPrefix = "https://app.tapnow.media/api/conversation/v1/canvas-share/";
export const tapNowMaxResponseBytes = 16 << 20;
export const tapNowMaxNodes = 1000;
export const tapNowMaxConnections = 5000;

export interface TapNowImportRequest {
  shareId: string;
}

export interface TapNowImportResult {
  batchId: string;
  batchCreatedAt: string;
  shareId: string;
  projectName: string;
  nodes: TapNowCanvasNode[];
  connections: TapNowCanvasConnection[];
  importedNodeCount: number;
  importedConnectionCount: number;
  skippedNodes: TapNowImportIssue[];
  skippedConnections: TapNowImportIssue[];
  warnings: TapNowImportWarning[];
  multiResultNodeCount: number;
  reusedFailedNodeCount: number;
  placeholderNodeCount: number;
}

export interface TapNowCanvasNode {
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
  size?: string;
  quality?: string;
  seconds?: string;
  vquality?: string;
  generateAudio?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  durationMs?: number;
  mimeType?: string;
  status?: string;
  errorDetails?: string;
  metadata: TapNowImportMetadata;
}

export interface TapNowImportMetadata {
  provider: string;
  shareId: string;
  nodeId: string;
  batchId: string;
  sourceType?: string;
}

export interface TapNowCanvasConnection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  fromHandleId?: string;
  toHandleId?: string;
}

export interface TapNowImportIssue {
  id?: string;
  name?: string;
  reason: string;
}

export interface TapNowImportWarning {
  id?: string;
  message: string;
}

interface TapNowEnvelope {
  code: number;
  data: unknown;
  msg: string;
  message: string;
}

export interface TapNowDetail {
  id: string;
  name: string;
  nodes: TapNowRawNode[];
  connections: TapNowRawConnection[];
}

export interface TapNowRawNode {
  id: string;
  short_id: number;
  type: string;
  data: unknown;
  deleted_at: string;
  position: { x: number; y: number };
  measured: { width: number; height: number };
}

export interface TapNowRawConnection {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  data: Record<string, unknown>;
  deleted_at: string;
}

export interface TapNowNodeData {
  title: string;
  prompt: string;
  text: string;
  src: string;
  options: string[];
  type: string;
  params: Record<string, unknown>;
  taskInfo: Record<string, unknown>;
  metadata: { url: string; width: number; height: number; duration: number };
  error: string;
  failedReason: string;
}

// 读取公开分享前先校验目标画布归属，避免把导入结果写入他人画布。
export async function importTapNow(
  service: Service,
  userId: string,
  canvasProjectId: string,
  shareId: string,
): Promise<TapNowImportResult> {
  const owner = userId.trim();
  const project = canvasProjectId.trim();
  if (owner === "" || project === "") {
    throw unauthorized("请先打开已同步的故事创作画布");
  }
  if (!(await canvasProject(service.repo, owner, project))) throw recordNotFound;
  const { detail, normalizedShareId } = await fetchTapNowDetail(shareId.trim());
  return adaptTapNowDetail(detail, normalizedShareId);
}

export async function fetchTapNowDetail(
  shareId: string,
): Promise<{ detail: TapNowDetail; normalizedShareId: string }> {
  if (!isTapNowShareId(shareId)) throw badAuthRequest("TapNow 分享 ID 格式无效");
  const endpoint = `${tapNowShareUrlPrefix}${encodeURIComponent(shareId)}`;
  let response: Response;
  try {
    response = await outboundFetch(endpoint, {
      method: "GET",
      headers: { accept: "application/json" },
      timeoutMs: 20_000,
      maxRedirects: 0,
    });
  } catch {
    throw new Error("TapNow 请求失败，请检查网络或分享链接");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > tapNowMaxResponseBytes) throw new Error("TapNow 画布响应过大");
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`TapNow 请求失败（HTTP ${response.status}）`);
  }
  let envelope: TapNowEnvelope;
  try {
    envelope = JSON.parse(buffer.toString("utf8")) as TapNowEnvelope;
  } catch {
    throw new Error("TapNow 响应格式无效");
  }
  if (envelope.code !== 0) {
    throw new Error(envelope.msg.trim() || envelope.message.trim() || "TapNow 返回业务错误");
  }
  const detail = envelope.data as TapNowDetail;
  if (!detail || typeof detail !== "object") throw new Error("TapNow 画布数据格式无效");
  return { detail, normalizedShareId: shareId };
}

export function isTapNowShareId(value: string): boolean {
  const shareId = value.trim();
  if (shareId === "" || shareId.length > 64) return false;
  return /^[a-zA-Z0-9_-]+$/.test(shareId);
}
