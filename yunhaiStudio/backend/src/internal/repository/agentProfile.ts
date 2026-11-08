// 对应 backend/internal/repository/agent_profile.go
// Agent 偏好文档的读取与按修订号保存。

import type { AgentProfile } from "@/internal/model/modelsAgentProfile";
import { Repository, toIso } from "./repository";
import { errTaskStateConflict } from "./repositoryTasks";

interface AgentProfileRow {
  id: string;
  user_id: string;
  scope: string;
  project_id: string | null;
  canvas_id: string | null;
  content: string | null;
  revision: number | null;
  hash: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const agentProfileColumns =
  '"id", "user_id", "scope", "project_id", "canvas_id", "content", "revision", "hash", "created_at", "updated_at"';

function mapAgentProfile(row: AgentProfileRow): AgentProfile {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    scope: row.scope ?? "",
    projectId: row.project_id ?? "",
    canvasId: row.canvas_id ?? "",
    content: row.content ?? "",
    revision: Number(row.revision ?? 0),
    hash: row.hash ?? "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function agentProfile(
  repo: Repository,
  userId: string,
  scope: string,
  projectId: string,
  canvasId: string,
): Promise<AgentProfile | null> {
  const rows = await repo.db.all<AgentProfileRow>(
    `SELECT ${agentProfileColumns} FROM "agent_profiles" WHERE "user_id" = ? AND "scope" = ? AND "project_id" = ? AND "canvas_id" = ? LIMIT 1`,
    [userId, scope, projectId, canvasId],
  );
  return rows.length ? mapAgentProfile(rows[0]) : null;
}

export async function saveAgentProfile(repo: Repository, profile: AgentProfile | null, expectedRevision: number): Promise<void> {
  if (!profile) throw new Error("invalid data");
  await repo.transaction(async (tx) => {
    const rows = await tx.db.all<AgentProfileRow>(
      `SELECT ${agentProfileColumns} FROM "agent_profiles" WHERE "user_id" = ? AND "scope" = ? AND "project_id" = ? AND "canvas_id" = ? LIMIT 1`,
      [profile.userId, profile.scope, profile.projectId ?? "", profile.canvasId ?? ""],
    );
    if (!rows.length) {
      if (expectedRevision !== 0) throw errTaskStateConflict;
      await tx.db.run(
        `INSERT INTO "agent_profiles" (${agentProfileColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          profile.id,
          profile.userId,
          profile.scope,
          profile.projectId ?? "",
          profile.canvasId ?? "",
          profile.content,
          profile.revision,
          profile.hash,
          profile.createdAt,
          profile.updatedAt,
        ],
      );
      return;
    }
    const current = mapAgentProfile(rows[0]);
    if (expectedRevision !== current.revision) throw errTaskStateConflict;
    profile.id = current.id;
    profile.revision = current.revision + 1;
    profile.createdAt = current.createdAt;
    const changes = await tx.db.run(
      'UPDATE "agent_profiles" SET "content" = ?, "revision" = ?, "hash" = ?, "updated_at" = ? WHERE "id" = ? AND "revision" = ?',
      [profile.content, profile.revision, profile.hash, profile.updatedAt, current.id, current.revision],
    );
    if (changes !== 1) throw errTaskStateConflict;
  });
}
