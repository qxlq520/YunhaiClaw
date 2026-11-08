// 对应 backend/internal/auth/libtv_adapter.go
// LibTV 画布详情转换为宿主画布节点/连接。

import { randomUUID } from "node:crypto";
import { firstNonEmpty } from "@/internal/kernel/errors";
import type { LibTVCanvasNode, LibTVDetail, LibTVImportResult, LibTVNodeData } from "./libtv";

export function adaptLibTVDetail(detail: LibTVDetail | null): LibTVImportResult {
  if (!detail) throw new Error("LibTV 画布数据为空");
  const now = new Date();
  const batchId = `${now.getTime().toString(36)}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const result: LibTVImportResult = {
    batchId,
    batchCreatedAt: now.toISOString(),
    projectUuid: detail.projectMeta.uuid,
    projectName: detail.projectMeta.name,
    nodes: [],
    connections: [],
    importedNodeCount: 0,
    importedConnectionCount: 0,
    skippedNodes: [],
    skippedConnections: [],
    warnings: [],
    multiResultNodeCount: 0,
    staleNodeCount: 0,
    reusedFailedNodeCount: 0,
    placeholderNodeCount: 0,
    convertedSpecialCount: 0,
  };
  const mapping = new Map<string, string>();
  const seenNodeKeys = new Set<string>();
  for (const raw of detail.nodeList) {
    const nodeKey = (raw.nodeKey ?? "").trim();
    if (nodeKey === "") {
      result.skippedNodes.push({ name: raw.name ?? "", reason: "节点缺少 nodeKey" });
      continue;
    }
    if (seenNodeKeys.has(nodeKey)) {
      result.skippedNodes.push({ id: nodeKey, name: raw.name ?? "", reason: "节点 nodeKey 重复" });
      continue;
    }
    seenNodeKeys.add(nodeKey);

    let data: LibTVNodeData;
    try {
      data = JSON.parse(raw.data ?? "") as LibTVNodeData;
    } catch {
      result.skippedNodes.push({ id: nodeKey, name: raw.name ?? "", reason: "节点数据格式无效" });
      continue;
    }
    data.taskInfo ??= { status: 0, failedReason: "" };
    data.resourceMeta ??= { items: [] };
    data.params ??= {};
    const taskStatus = data.taskInfo.status !== 0 ? data.taskInfo.status : raw.taskInfo?.status ?? 0;
    const sourceType = (data.type ?? "").trim().toLowerCase();
    let kind = sourceType;
    if (sourceType === "material-style") {
      // 风格素材没有普通生成 URL，但有可复用封面时可以降级为宿主图片参考节点。
      kind = "image";
    } else if (kind !== "image" && kind !== "video") {
      result.skippedNodes.push({ id: nodeKey, name: raw.name ?? "", reason: "暂不支持的节点类型" });
      continue;
    }
    let [mediaUrl, mediaIndex] = firstLibTVMediaUrl(data.url ?? []);
    if (mediaUrl === "" && sourceType === "material-style") {
      [mediaUrl, mediaIndex] = firstLibTVMediaUrl([data.coverUrl ?? ""]);
    }

    const x = finiteFloat(raw.position?.positionX ?? "");
    const y = finiteFloat(raw.position?.positionY ?? "");
    if (x === null || y === null) {
      result.skippedNodes.push({ id: nodeKey, name: raw.name ?? "", reason: "节点坐标无效" });
      continue;
    }
    let width = positiveFiniteFloat(raw.measured?.width ?? "");
    let height = positiveFiniteFloat(raw.measured?.height ?? "");
    const invalidSize = width === null || height === null;
    if (width === null) width = 480;
    if (height === null) height = 300;
    const item: LibTVCanvasNode = {
      id: `libtv-${batchId}-${nodeKey}`,
      type: kind,
      title: (raw.name ?? "").trim(),
      x,
      y,
      width,
      height,
      content: mediaUrl,
      prompt: mapString(data.params, "prompt"),
      model: mapString(data.params, "model"),
      metadata: {
        provider: "libtv",
        projectUuid: result.projectUuid,
        nodeKey,
        batchId,
        sourceType,
        styleAssetUuid: (data.styleAssetUuid ?? "").trim(),
        styleVersionUuid: (data.styleVersionUuid ?? "").trim(),
        styleName: (data.styleName ?? "").trim(),
      },
    };
    if (item.title === "") item.title = `${kind} 节点`;
    if (mediaIndex >= 0 && mediaIndex < (data.resourceMeta.items?.length ?? 0)) {
      const resource = data.resourceMeta.items[mediaIndex];
      item.naturalWidth = resource.width;
      item.naturalHeight = resource.height;
      if (resource.durationSec > 0 && Number.isFinite(resource.durationSec)) {
        item.durationMs = Math.round(resource.durationSec * 1000);
      }
    }
    item.mimeType = inferMediaMime(kind, mediaUrl);
    if (mediaUrl === "") {
      result.placeholderNodeCount += 1;
      if (taskStatus === 3) {
        // 没有历史结果的失败节点仍保留拓扑，并以失败占位状态呈现。
        item.status = "error";
        item.errorDetails = firstNonEmpty(
          data.taskInfo.failedReason,
          raw.taskInfo?.failedReason ?? "",
          "LibTV 生成任务失败",
        );
      } else {
        item.status = "idle";
      }
    } else {
      item.status = "success";
      if (taskStatus === 3) {
        // 最近一次任务失败不应覆盖节点中仍可用的历史资源。
        result.reusedFailedNodeCount += 1;
      }
    }
    mapping.set(nodeKey, item.id);
    result.nodes.push(item);
    if (sourceType === "material-style") result.convertedSpecialCount += 1;
    if (invalidSize) {
      result.warnings.push({ id: nodeKey, message: `节点“${item.title}”尺寸无效，已使用默认尺寸。` });
    }
    if ((data.url?.length ?? 0) > 1 && mediaUrl !== "") {
      result.multiResultNodeCount += 1;
      result.warnings.push({
        id: nodeKey,
        message: `节点“${item.title}”包含 ${data.url.length} 个结果，已导入第 ${mediaIndex + 1} 个。`,
      });
    }
    if (data.isStale || raw.isStale) {
      result.staleNodeCount += 1;
      result.warnings.push({ id: nodeKey, message: `节点“${item.title}”已标记为过期，但现有资源仍已导入。` });
    }
  }

  const seenConnectionIds = new Set<string>();
  for (const raw of detail.connectionList) {
    const connectionId = (raw.connectionId ?? "").trim();
    if (connectionId === "") {
      result.skippedConnections.push({ reason: "连接缺少 connectionId" });
      continue;
    }
    if (seenConnectionIds.has(connectionId)) {
      result.skippedConnections.push({ id: connectionId, reason: "连接 connectionId 重复" });
      continue;
    }
    seenConnectionIds.add(connectionId);
    const from = mapping.get((raw.source ?? "").trim());
    const to = mapping.get((raw.target ?? "").trim());
    if (!from || !to) {
      result.skippedConnections.push({ id: connectionId, reason: "连接端点节点未导入" });
      continue;
    }
    result.connections.push({ id: `libtv-${batchId}-${connectionId}`, fromNodeId: from, toNodeId: to });
  }
  result.importedNodeCount = result.nodes.length;
  result.importedConnectionCount = result.connections.length;
  if (result.importedNodeCount === 0) throw new Error("LibTV 画布没有可导入的有效节点");
  return result;
}

function mapString(values: Record<string, unknown>, key: string): string {
  const value = values[key];
  return typeof value === "string" ? value.trim() : "";
}

export function firstLibTVMediaUrl(values: string[]): [string, number] {
  for (let index = 0; index < values.length; index += 1) {
    let parsed: URL;
    try {
      parsed = new URL((values[index] ?? "").trim());
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" || parsed.hostname === "" || parsed.username !== "" || parsed.password !== "") {
      continue;
    }
    return [parsed.toString(), index];
  }
  return ["", -1];
}

function finiteFloat(value: string): number | null {
  const text = value.trim();
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveFiniteFloat(value: string): number | null {
  const parsed = finiteFloat(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

export function inferMediaMime(kind: string, rawUrl: string): string {
  const lower = rawUrl.toLowerCase();
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".jpg") || lower.includes(".jpeg")) return "image/jpeg";
  if (lower.includes(".webp")) return "image/webp";
  if (kind === "video") return "video/mp4";
  return "image/*";
}
