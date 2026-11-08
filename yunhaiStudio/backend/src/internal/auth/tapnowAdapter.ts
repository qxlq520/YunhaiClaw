// 对应 backend/internal/auth/tapnow_adapter.go
// TapNow 分享画布转换为宿主画布节点/连接。

import { randomUUID } from "node:crypto";
import { firstNonEmpty } from "@/internal/kernel/errors";
import { badAuthRequest } from "@/internal/kernel/errors";
import {
  isTapNowShareId,
  tapNowMaxConnections,
  tapNowMaxNodes,
  type TapNowCanvasNode,
  type TapNowDetail,
  type TapNowImportResult,
  type TapNowNodeData,
} from "./tapnow";

export function adaptTapNowDetail(detail: TapNowDetail | null, shareIdInput: string): TapNowImportResult {
  if (!detail) throw new Error("TapNow 画布数据为空");
  const shareId = shareIdInput.trim();
  if (!isTapNowShareId(shareId)) throw badAuthRequest("TapNow 分享 ID 格式无效");
  if ((detail.nodes?.length ?? 0) > tapNowMaxNodes) {
    throw new Error(`TapNow 画布节点过多（最多支持 ${tapNowMaxNodes} 个）`);
  }

  const now = new Date();
  const batchId = `tapnow-${now.getTime().toString(36)}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const result: TapNowImportResult = {
    batchId,
    batchCreatedAt: now.toISOString(),
    shareId,
    projectName: (detail.name ?? "").trim(),
    nodes: [],
    connections: [],
    importedNodeCount: 0,
    importedConnectionCount: 0,
    skippedNodes: [],
    skippedConnections: [],
    warnings: [],
    multiResultNodeCount: 0,
    reusedFailedNodeCount: 0,
    placeholderNodeCount: 0,
  };
  if (result.projectName === "") result.projectName = "TapNow 画布";

  const mapping = new Map<string, string>();
  const seenNodeIds = new Set<string>();
  for (const raw of detail.nodes ?? []) {
    if ((raw.deleted_at ?? "").trim() !== "") continue;
    let nodeId = (raw.id ?? "").trim();
    if (nodeId === "" && raw.short_id) nodeId = String(raw.short_id);
    if (nodeId === "") {
      result.skippedNodes.push({ reason: "节点缺少 ID" });
      continue;
    }
    if (nodeId.length > 128) {
      result.skippedNodes.push({ id: nodeId.slice(0, 128), reason: "节点 ID 过长" });
      continue;
    }
    if (seenNodeIds.has(nodeId)) {
      result.skippedNodes.push({ id: nodeId, reason: "节点 ID 重复" });
      continue;
    }
    seenNodeIds.add(nodeId);

    let data: TapNowNodeData;
    try {
      data = decodeTapNowNodeData(raw.data);
    } catch {
      result.skippedNodes.push({ id: nodeId, reason: "节点数据格式无效" });
      continue;
    }
    data.options ??= [];
    data.params ??= {};
    data.taskInfo ??= {};
    data.metadata ??= { url: "", width: 0, height: 0, duration: 0 };
    let kind = (raw.type ?? "").trim().toLowerCase();
    if (kind === "") kind = (data.type ?? "").trim().toLowerCase();
    if (kind !== "image" && kind !== "video" && kind !== "audio" && kind !== "text") {
      result.skippedNodes.push({ id: nodeId, name: (data.title ?? "").trim(), reason: "暂不支持的节点类型" });
      continue;
    }
    if (!finiteNumber(raw.position?.x) || !finiteNumber(raw.position?.y)) {
      result.skippedNodes.push({ id: nodeId, name: (data.title ?? "").trim(), reason: "节点坐标无效" });
      continue;
    }

    let [content, mediaIndex] = firstTapNowMediaUrl(data);
    if (kind === "text") {
      content = (data.text ?? "").trim() || (data.prompt ?? "").trim();
      mediaIndex = -1;
    }
    let width = raw.measured?.width;
    let height = raw.measured?.height;
    const invalidSize = !positiveFiniteNumber(width) || !positiveFiniteNumber(height);
    if (!positiveFiniteNumber(width)) width = 480;
    if (!positiveFiniteNumber(height)) height = 300;
    const item: TapNowCanvasNode = {
      id: `tapnow-${batchId}-${nodeId}`,
      type: kind,
      title: (data.title ?? "").trim(),
      x: raw.position.x,
      y: raw.position.y,
      width,
      height,
      content,
      prompt: firstNonEmpty((data.prompt ?? "").trim(), firstTapNowParam(data.params, "prompt")),
      model: tapNowMapString(data.params, "model"),
      size: firstTapNowParam(data.params, "aspectRatio", "size"),
      quality: tapNowImageQuality(data.params),
      seconds: firstTapNowParam(data.params, "duration", "seconds"),
      vquality: firstTapNowParam(data.params, "resolution", "vquality"),
      generateAudio: tapNowBoolParam(data.params, "generateAudio"),
      metadata: {
        provider: "tapnow",
        shareId,
        nodeId,
        batchId,
        sourceType: (data.type ?? "").trim(),
      },
    };
    if (item.title === "") item.title = `${kind} 节点`;
    item.naturalWidth = data.metadata.width;
    item.naturalHeight = data.metadata.height;
    if (data.metadata.duration > 0 && Number.isFinite(data.metadata.duration)) {
      item.durationMs = Math.round(data.metadata.duration * 1000);
    }
    item.mimeType = inferTapNowMime(kind, content, firstNonEmpty(data.prompt, data.title));
    const taskStatus = tapNowTaskStatus(data.taskInfo);
    const hasContent = content.trim() !== "";
    if (hasContent) {
      item.status = "success";
      if (tapNowTaskFailed(taskStatus)) result.reusedFailedNodeCount += 1;
    } else if (tapNowTaskFailed(taskStatus)) {
      item.status = "error";
      item.errorDetails = tapNowErrorDetails(data);
      if (item.errorDetails === "") item.errorDetails = "TapNow 生成任务失败";
      result.placeholderNodeCount += 1;
    } else {
      item.status = "idle";
      result.placeholderNodeCount += 1;
    }
    mapping.set(nodeId, item.id);
    if (raw.short_id) mapping.set(String(raw.short_id), item.id);
    result.nodes.push(item);
    if (invalidSize) {
      result.warnings.push({ id: nodeId, message: `节点“${item.title}”尺寸无效，已使用默认尺寸。` });
    }
    if (mediaIndex >= 0 && data.options.length > 1) {
      result.multiResultNodeCount += 1;
      result.warnings.push({ id: nodeId, message: `节点“${item.title}”包含多个结果，已导入首个结果。` });
    }
  }

  const rawConnections = detail.connections ?? [];
  if (rawConnections.length > tapNowMaxConnections) {
    result.warnings.push({
      message: `连接超过 ${tapNowMaxConnections} 条，仅处理前 ${tapNowMaxConnections} 条。`,
    });
  }
  const seenConnectionIds = new Set<string>();
  for (let index = 0; index < rawConnections.length; index += 1) {
    if (index >= tapNowMaxConnections) break;
    const raw = rawConnections[index];
    if ((raw.deleted_at ?? "").trim() !== "") continue;
    const connectionId = (raw.id ?? "").trim();
    if (connectionId === "") {
      result.skippedConnections.push({ reason: "连接缺少 ID" });
      continue;
    }
    if (seenConnectionIds.has(connectionId)) {
      result.skippedConnections.push({ id: connectionId, reason: "连接 ID 重复" });
      continue;
    }
    seenConnectionIds.add(connectionId);
    const from = mapping.get((raw.source ?? "").trim());
    const to = mapping.get((raw.target ?? "").trim());
    if (!from || !to) {
      result.skippedConnections.push({ id: connectionId, reason: "连接端点节点未导入" });
      continue;
    }
    let toHandleId = (raw.targetHandle ?? "").trim();
    if (toHandleId === "") {
      // TapNow 将图片输入句柄放在边 data.valueKey，而不是 targetHandle。
      toHandleId = tapNowMapString(raw.data ?? {}, "valueKey");
    }
    result.connections.push({
      id: `tapnow-${batchId}-${connectionId}`,
      fromNodeId: from,
      toNodeId: to,
      fromHandleId: (raw.sourceHandle ?? "").trim(),
      toHandleId,
    });
  }
  result.importedNodeCount = result.nodes.length;
  result.importedConnectionCount = result.connections.length;
  if (result.importedNodeCount === 0) throw new Error("TapNow 画布没有可导入的有效节点");
  return result;
}

function decodeTapNowNodeData(raw: unknown): TapNowNodeData {
  let value = raw;
  if (typeof value === "string") value = JSON.parse(value);
  if (!value || typeof value !== "object") throw new Error("invalid node data");
  return value as TapNowNodeData;
}

function firstTapNowMediaUrl(data: TapNowNodeData): [string, number] {
  const values: string[] = [(data.src ?? "").trim(), ...(data.options ?? []).map((item) => (item ?? "").trim())];
  if ((data.metadata?.url ?? "").trim() !== "") values.push(data.metadata.url.trim());
  for (let index = 0; index < values.length; index += 1) {
    let parsed: URL;
    try {
      parsed = new URL(values[index]);
    } catch {
      continue;
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname === "" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      !isTapNowMediaHost(parsed.hostname)
    ) {
      continue;
    }
    return [parsed.toString(), index];
  }
  return ["", -1];
}

function isTapNowMediaHost(hostInput: string): boolean {
  const host = hostInput.trim().toLowerCase().replace(/\.$/, "");
  // 导入后的媒体还可能作为后续生成的参考素材，只接受已核验的官方文件域名。
  return host === "files.tapnow.media";
}

export function inferTapNowMime(kind: string, rawUrl: string, hint: string): string {
  const lower = `${rawUrl} ${hint}`.toLowerCase();
  switch (kind) {
    case "image":
      if (lower.includes(".png")) return "image/png";
      if (lower.includes(".jpg") || lower.includes(".jpeg")) return "image/jpeg";
      if (lower.includes(".webp")) return "image/webp";
      if (lower.includes(".gif")) return "image/gif";
      return "image/*";
    case "video":
      if (lower.includes(".webm")) return "video/webm";
      if (lower.includes(".mov")) return "video/quicktime";
      return "video/mp4";
    case "audio":
      if (lower.includes(".wav")) return "audio/wav";
      if (lower.includes(".flac")) return "audio/flac";
      if (lower.includes(".ogg") || lower.includes(".oga")) return "audio/ogg";
      if (lower.includes(".m4a")) return "audio/mp4";
      return "audio/mpeg";
    case "text":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function tapNowMapString(values: Record<string, unknown>, key: string): string {
  if (!values) return "";
  const value = values[key];
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  return String(value).trim();
}

function firstTapNowParam(values: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = tapNowMapString(values, key);
    if (value !== "") return value;
  }
  return "";
}

// TapNow 部分渠道用 imageSize（例如 "2K"），画布合同则使用小写质量档位。
function tapNowImageQuality(values: Record<string, unknown>): string {
  let value = firstTapNowParam(values, "quality");
  if (value === "") value = firstTapNowParam(values, "imageSize");
  const normalized = value.trim().toLowerCase();
  if (["1k", "2k", "4k", "auto", "low", "medium", "high"].includes(normalized)) return normalized;
  return "";
}

function tapNowBoolParam(values: Record<string, unknown>, key: string): string {
  const value = values[key];
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return tapNowMapString(values, key);
}

function tapNowTaskStatus(values: Record<string, unknown>): string {
  return tapNowMapString(values, "status").toLowerCase();
}

function tapNowTaskFailed(status: string): boolean {
  return ["failed", "error", "failure"].includes(status.trim().toLowerCase());
}

function tapNowErrorDetails(data: TapNowNodeData): string {
  if ((data.error ?? "").trim() !== "") return data.error.trim();
  if ((data.failedReason ?? "").trim() !== "") return data.failedReason.trim();
  for (const key of ["error", "failedReason", "message"]) {
    const value = tapNowMapString(data.taskInfo ?? {}, key);
    if (value !== "") return value;
  }
  return "";
}

function finiteNumber(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveFiniteNumber(value: number | undefined): boolean {
  return finiteNumber(value) && (value as number) > 0;
}
