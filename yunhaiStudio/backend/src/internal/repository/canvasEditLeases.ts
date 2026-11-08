import type { CanvasEditLease, CanvasEditProof } from "@/internal/model/modelsCanvasSync";
import type { CanvasProject } from "@/internal/model/modelsProject";
import { Repository, toIso } from "./repository";

export const errCanvasEditLease = new Error("节点正在其他窗口编辑，或编辑权限已过期；本地草稿已保留");

interface CanvasEditLeaseRow {
  user_id: string;
  canvas_id: string;
  node_id: string;
  session_id: string | null;
  token: string | null;
  expires_at: string;
}

function mapLease(row: CanvasEditLeaseRow): CanvasEditLease {
  return {
    userId: row.user_id,
    canvasId: row.canvas_id,
    nodeId: row.node_id,
    sessionId: row.session_id ?? "",
    token: row.token ?? "",
    expiresAt: toIso(row.expires_at),
  };
}

export async function canvasEditLeases(repo: Repository, userId: string, canvasId: string, now: string): Promise<CanvasEditLease[]> {
  const rows = await repo.db.all<CanvasEditLeaseRow>(
    'SELECT "user_id", "canvas_id", "node_id", "session_id", "token", "expires_at" FROM "canvas_edit_leases" WHERE "user_id" = ? AND "canvas_id" = ? AND "expires_at" > ?',
    [userId, canvasId, now],
  );
  return rows.map(mapLease);
}

// 必须在锁定父画布的事务内调用，续约与释放同样如此。
export async function changeCanvasEditLease(
  repo: Repository,
  userId: string,
  canvasId: string,
  proof: CanvasEditProof,
  action: string,
  newToken: string,
  now: string,
): Promise<CanvasEditLease | null> {
  const rows = await repo.db.all<CanvasEditLeaseRow>(
    'SELECT "user_id", "canvas_id", "node_id", "session_id", "token", "expires_at" FROM "canvas_edit_leases" WHERE "user_id" = ? AND "canvas_id" = ? AND "node_id" = ? LIMIT 1',
    [userId, canvasId, proof.nodeId],
  );
  const stored = rows.length ? mapLease(rows[0]) : null;
  const active = stored !== null && new Date(stored.expiresAt).getTime() > new Date(now).getTime();
  const matches = stored !== null && active && stored.sessionId === proof.sessionId && stored.token === proof.token;
  if (action === "release") {
    if (!matches) throw errCanvasEditLease;
    await repo.db.run('DELETE FROM "canvas_edit_leases" WHERE "user_id" = ? AND "canvas_id" = ? AND "node_id" = ?', [
      userId,
      canvasId,
      proof.nodeId,
    ]);
    repo.canvasChanged(userId, canvasId);
    return null;
  }
  if (action === "renew" && !matches) throw errCanvasEditLease;
  if (action === "acquire" && active && !matches) throw errCanvasEditLease;
  const expiresAt = new Date(new Date(now).getTime() + 30_000).toISOString();
  if (!rows.length) {
    const lease: CanvasEditLease = {
      userId,
      canvasId,
      nodeId: proof.nodeId,
      sessionId: proof.sessionId,
      token: newToken,
      expiresAt,
    };
    await repo.db.run(
      'INSERT INTO "canvas_edit_leases" ("user_id", "canvas_id", "node_id", "session_id", "token", "expires_at") VALUES (?, ?, ?, ?, ?, ?)',
      [lease.userId ?? "", lease.canvasId ?? "", lease.nodeId, lease.sessionId, lease.token ?? "", lease.expiresAt],
    );
    repo.canvasChanged(userId, canvasId);
    return lease;
  }
  // GORM Save 按复合主键更新全部字段；过期的旧租约同样被这次写入接管。
  const lease: CanvasEditLease = {
    userId,
    canvasId,
    nodeId: proof.nodeId,
    sessionId: active && stored ? stored.sessionId : proof.sessionId,
    token: active && stored ? stored.token : newToken,
    expiresAt,
  };
  await repo.db.run(
    'UPDATE "canvas_edit_leases" SET "session_id" = ?, "token" = ?, "expires_at" = ? WHERE "user_id" = ? AND "canvas_id" = ? AND "node_id" = ?',
    [lease.sessionId, lease.token ?? "", lease.expiresAt, userId, canvasId, proof.nodeId],
  );
  repo.canvasChanged(userId, canvasId);
  return lease;
}

// 授权与 revision CAS 在同一事务内校验。比较作者字段可以让结果/进度写入通过，
// 但不会授予文本所有权。
export async function checkCanvasEditLeases(repo: Repository, before: CanvasProject, after: CanvasProject | null): Promise<void> {
  const leases = await canvasEditLeases(repo, before.userId, before.id, new Date().toISOString());
  const oldNodes = canvasLeaseNodes(before.payloadJson ?? "");
  const newNodes = after ? canvasLeaseNodes(after.payloadJson ?? "") : {};
  const byNode = new Map<string, CanvasEditLease>();
  for (const lease of leases) byNode.set(lease.nodeId, lease);
  for (const proof of repo.canvasEditProofs) {
    if (!canvasLeaseTextChanged(oldNodes[proof.nodeId], newNodes[proof.nodeId])) continue;
    const lease = byNode.get(proof.nodeId);
    if (!lease || lease.token !== proof.token || lease.sessionId !== proof.sessionId) throw errCanvasEditLease;
  }
  for (const lease of leases) {
    if (after !== null && !canvasLeaseTextChanged(oldNodes[lease.nodeId], newNodes[lease.nodeId])) continue;
    const matched = repo.canvasEditProofs.some(
      (proof) => proof.nodeId === lease.nodeId && proof.sessionId === lease.sessionId && proof.token === lease.token,
    );
    if (!matched) throw errCanvasEditLease;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function canvasLeaseNodes(raw: string): Record<string, Record<string, unknown>> {
  const document: unknown = JSON.parse(raw);
  if (document === null) return {};
  if (typeof document !== "object" || Array.isArray(document)) throw new TypeError("canvas payload must be an object");
  const list = (document as { nodes?: unknown }).nodes ?? [];
  if (!Array.isArray(list)) throw new TypeError("canvas nodes must be an array");
  const nodes: Record<string, Record<string, unknown>> = {};
  for (const node of list) {
    if (node === null) continue;
    if (typeof node !== "object" || Array.isArray(node)) throw new TypeError("canvas node must be an object");
    const id = (node as Record<string, unknown>).id;
    if (typeof id === "string") nodes[id] = node as Record<string, unknown>;
  }
  return nodes;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => valuesEqual(item, right[index]));
  }
  const leftObject = left as Record<string, unknown>;
  const rightObject = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftObject);
  if (leftKeys.length !== Object.keys(rightObject).length) return false;
  return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(rightObject, key) && valuesEqual(leftObject[key], rightObject[key]));
}

function canvasLeaseTextChanged(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): boolean {
  if (before === undefined || after === undefined) return !valuesEqual(before, after);
  if (!valuesEqual(before.title, after.title)) return true;
  const beforeMetadata = asRecord(before.metadata);
  const afterMetadata = asRecord(after.metadata);
  for (const field of ["content", "richText", "prompt", "composerContent"]) {
    if ((field === "content" || field === "richText") && before.type !== "text" && before.type !== "markdown" && before.type !== "script") {
      continue;
    }
    if (!valuesEqual(beforeMetadata?.[field], afterMetadata?.[field])) return true;
  }
  const beforeGenerationSpec = asRecord(beforeMetadata?.generationSpec);
  const afterGenerationSpec = asRecord(afterMetadata?.generationSpec);
  return !valuesEqual(beforeGenerationSpec?.prompt, afterGenerationSpec?.prompt);
}
