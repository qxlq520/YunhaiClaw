// 对应 backend/internal/repository/cloud_agent_resource_lease.go
// 资源租约在准备动作等待审批期间钉住不可变输入。

import type { CloudAgentCanvasMutation } from "@/internal/model/cloudAgent";
import { mapCloudAgentCanvasMutation } from "./cloudAgent";
import { Repository } from "./repository";

const cloudAgentResourceLeaseColumns = `"user_id", "run_id", "owner_id", "resource_id", "expires_at"`;

const cloudAgentCanvasMutationColumns = `"id", "run_id", "user_id", "canvas_id", "step_id", "operation", "before_snapshot_hash", "after_snapshot_hash", "before_json", "has_submitted_task", "status", "created_at", "undone_at"`;

const cloudAgentResourceLeaseUpsert = `ON CONFLICT ("user_id", "owner_id", "resource_id") DO UPDATE SET "run_id" = excluded."run_id", "expires_at" = excluded."expires_at"`;

async function insertCloudAgentResourceLease(
  repo: Repository,
  userId: string,
  runId: string,
  ownerId: string,
  resourceId: string,
  expiresAt: string,
): Promise<void> {
  await repo.db.run(
    `INSERT INTO "cloud_agent_resource_leases" (${cloudAgentResourceLeaseColumns}) VALUES (?, ?, ?, ?, ?) ${cloudAgentResourceLeaseUpsert}`,
    [userId, runId, ownerId, resourceId, expiresAt],
  );
}

export async function upsertCloudAgentResourceLeases(
  repo: Repository,
  userId: string,
  runId: string,
  ownerId: string,
  resourceIds: string[],
  expiresAt: string,
): Promise<void> {
  for (const id of uniqueSortedStrings(resourceIds)) {
    await insertCloudAgentResourceLease(repo, userId, runId, ownerId, id, expiresAt);
  }
}

// 用户修改生成设置后，审批所有者的资源集合成为权威集合。
export async function replaceCloudAgentResourceLeases(
  repo: Repository,
  userId: string,
  runId: string,
  ownerId: string,
  resourceIds: string[],
  expiresAt: string,
): Promise<void> {
  await repo.transaction(async (tx) => {
    await tx.db.run('DELETE FROM "cloud_agent_resource_leases" WHERE "user_id" = ? AND "owner_id" = ?', [userId, ownerId]);
    for (const id of uniqueSortedStrings(resourceIds)) {
      await insertCloudAgentResourceLease(tx, userId, runId, ownerId, id, expiresAt);
    }
  });
}

export async function releaseCloudAgentResourceLeases(repo: Repository, userId: string, ownerId: string): Promise<void> {
  await repo.db.run('DELETE FROM "cloud_agent_resource_leases" WHERE "user_id" = ? AND "owner_id" = ?', [userId, ownerId]);
}

export async function releaseCloudAgentResourceLeasesByRun(repo: Repository, userId: string, runId: string): Promise<void> {
  await repo.db.run('DELETE FROM "cloud_agent_resource_leases" WHERE "user_id" = ? AND "run_id" = ?', [userId, runId]);
}

export async function transferCloudAgentResourceLeases(
  repo: Repository,
  userId: string,
  fromOwner: string,
  toOwner: string,
  runId: string,
  expiresAt: string,
): Promise<void> {
  if (fromOwner === "" || toOwner === "" || fromOwner === toOwner) return;
  await repo.transaction(async (tx) => {
    const rows = await tx.db.all<{
      user_id: string;
      run_id: string | null;
      owner_id: string;
      resource_id: string;
      expires_at: string | null;
    }>(
      `SELECT ${cloudAgentResourceLeaseColumns} FROM "cloud_agent_resource_leases" WHERE "user_id" = ? AND "owner_id" = ?`,
      [userId, fromOwner],
    );
    await tx.db.run('DELETE FROM "cloud_agent_resource_leases" WHERE "user_id" = ? AND "owner_id" = ?', [userId, toOwner]);
    for (const lease of rows) {
      await insertCloudAgentResourceLease(tx, userId, runId, toOwner, lease.resource_id, expiresAt);
    }
    await tx.db.run('DELETE FROM "cloud_agent_resource_leases" WHERE "user_id" = ? AND "owner_id" = ?', [userId, fromOwner]);
  });
}

export async function releaseExpiredCloudAgentResourceLeases(repo: Repository, now: string): Promise<void> {
  await repo.db.run('DELETE FROM "cloud_agent_resource_leases" WHERE "expires_at" <= ?', [now]);
}

function uniqueSortedStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  result.sort();
  return result;
}

export async function cloudAgentCanvasMutationChain(
  repo: Repository,
  userId: string,
  runId: string,
  canvasId: string,
): Promise<CloudAgentCanvasMutation[]> {
  const rows = await repo.db.all<Parameters<typeof mapCloudAgentCanvasMutation>[0]>(
    `SELECT ${cloudAgentCanvasMutationColumns} FROM "cloud_agent_canvas_mutations" WHERE "user_id" = ? AND "run_id" = ? AND "canvas_id" = ? AND "status" IN (?, ?) ORDER BY "created_at", "id"`,
    [userId, runId, canvasId, "applied", "not_undoable"],
  );
  return rows.map(mapCloudAgentCanvasMutation);
}

// 区分本次运行写入与后续 Agent 运行写入。手动画布编辑没有变更行；
// 把行的 after hash 与实时文档比较也会拒绝它们。
export async function latestCloudAgentCanvasMutationForCanvas(
  repo: Repository,
  userId: string,
  canvasId: string,
): Promise<CloudAgentCanvasMutation | null> {
  const rows = await repo.db.all<Parameters<typeof mapCloudAgentCanvasMutation>[0]>(
    `SELECT ${cloudAgentCanvasMutationColumns} FROM "cloud_agent_canvas_mutations" WHERE "user_id" = ? AND "canvas_id" = ? AND "status" IN (?, ?) ORDER BY "created_at" DESC, "id" DESC LIMIT 1`,
    [userId, canvasId, "applied", "not_undoable"],
  );
  return rows.length ? mapCloudAgentCanvasMutation(rows[0]) : null;
}
