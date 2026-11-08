import type { Database } from "@/internal/database/database";
import { allocatePrefixedId } from "@/internal/database/prefixedIds";
import { taskStatusRunning } from "@/internal/model/models";
import type { CanvasEditProof } from "@/internal/model/modelsCanvasSync";
import type { Asset, CanvasProject } from "@/internal/model/modelsProject";
import type { Task } from "@/internal/model/modelsTask";

export interface RepositoryOptions {
  canvasEditProofs?: CanvasEditProof[];
  canvasChangeNotifier?: ((userId: string, canvasId: string) => void) | null;
  canvasChanges?: Set<string> | null;
}

export class Repository {
  readonly db: Database;
  canvasEditProofs: CanvasEditProof[];
  canvasChangeNotifier: ((userId: string, canvasId: string) => void) | null;
  canvasChanges: Set<string> | null;

  constructor(db: Database, options: RepositoryOptions = {}) {
    this.db = db;
    this.canvasEditProofs = options.canvasEditProofs ?? [];
    this.canvasChangeNotifier = options.canvasChangeNotifier ?? null;
    this.canvasChanges = options.canvasChanges ?? null;
  }

  withContext(): Repository {
    return this;
  }

  dialect(): "sqlite" | "postgres" {
    return this.db.dialect;
  }

  withCanvasChangeNotifier(notify: (userId: string, canvasId: string) => void): Repository {
    return new Repository(this.db, {
      canvasEditProofs: this.canvasEditProofs,
      canvasChangeNotifier: notify,
      canvasChanges: this.canvasChanges,
    });
  }

  withCanvasEditProofs(proofs: CanvasEditProof[]): Repository {
    return new Repository(this.db, {
      canvasEditProofs: proofs,
      canvasChangeNotifier: this.canvasChangeNotifier,
      canvasChanges: this.canvasChanges,
    });
  }

  canvasChanged(userId: string, canvasId: string): void {
    if (!this.canvasChangeNotifier) return;
    if (this.canvasChanges) {
      this.canvasChanges.add(`${userId}\u0000${canvasId}`);
      return;
    }
    this.canvasChangeNotifier(userId, canvasId);
  }

  async transaction<T>(fn: (tx: Repository) => Promise<T>): Promise<T> {
    const changes = new Set<string>();
    const result = await this.db.transaction((db) =>
      fn(
        new Repository(db, {
          canvasEditProofs: this.canvasEditProofs,
          canvasChangeNotifier: this.canvasChangeNotifier,
          canvasChanges: changes,
        }),
      ),
    );
    if (this.canvasChangeNotifier) {
      for (const key of changes) {
        const [userId, canvasId] = key.split("\u0000");
        this.canvasChangeNotifier(userId, canvasId);
      }
    }
    return result;
  }

  async releaseTaskLease(id: string, owner: string): Promise<void> {
    await this.db.run(
      'UPDATE "tasks" SET "lease_owner" = ?, "lease_expires_at" = NULL, "updated_at" = ? WHERE "id" = ? AND "status" = ? AND "lease_owner" = ?',
      ["", new Date().toISOString(), id, taskStatusRunning, owner],
    );
  }

  async nextPrefixedId(prefix: string): Promise<string> {
    return allocatePrefixedId(this.db, prefix);
  }

  async userStorageUsage(userId: string): Promise<UserStorageUsage> {
    const usage = await this.storageUsageQuery(userId, true);
    return usage;
  }

  async userStructuredStorageUsage(userId: string): Promise<UserStorageUsage> {
    return this.storageUsageQuery(userId, false);
  }

  private async storageUsageQuery(userId: string, includeTasks: boolean): Promise<UserStorageUsage> {
    let query = `
      SELECT
        (SELECT COUNT(*) FROM assets WHERE user_id = ?) AS asset_count,
        (SELECT COALESCE(SUM(length(CAST(COALESCE(payload_json, '') AS BLOB))), 0) FROM assets WHERE user_id = ?) AS asset_bytes,
        (SELECT COUNT(*) FROM canvas_projects WHERE user_id = ?) AS canvas_count,
        (SELECT COALESCE(SUM(length(CAST(COALESCE(payload_json, '') AS BLOB))), 0) FROM canvas_projects WHERE user_id = ?) AS canvas_bytes`;
    if (includeTasks) {
      query += `,
        (SELECT COUNT(*) FROM tasks WHERE user_id = ?) AS task_count,
        (SELECT COALESCE(SUM(length(CAST(COALESCE(prompt, '') AS BLOB)) + length(CAST(COALESCE(input_json, '') AS BLOB)) + length(CAST(COALESCE(result_json, '') AS BLOB)) + length(CAST(COALESCE(media_recovery_json, '') AS BLOB)) + length(CAST(COALESCE(text_draft, '') AS BLOB)) + length(CAST(COALESCE(error, '') AS BLOB))), 0) FROM tasks WHERE user_id = ?)
        + (SELECT COALESCE(SUM(length(CAST(COALESCE(message, '') AS BLOB)) + length(CAST(COALESCE(payload, '') AS BLOB))), 0) FROM task_logs WHERE user_id = ?)
        + (SELECT COALESCE(SUM(length(CAST(COALESCE(url, '') AS BLOB)) + length(CAST(COALESCE(payload, '') AS BLOB))), 0) FROM results WHERE user_id = ?)
        + (SELECT COALESCE(SUM(byte_count), 0) FROM task_text_delta WHERE user_id = ?)
        + (SELECT COALESCE(SUM(length(CAST(COALESCE(path, '') AS BLOB)) + length(CAST(COALESCE(model, '') AS BLOB)) + length(CAST(COALESCE(provider_request_id, '') AS BLOB)) + length(CAST(COALESCE(error_code, '') AS BLOB)) + length(CAST(COALESCE(error, '') AS BLOB)) + length(CAST(COALESCE(upstream_url, '') AS BLOB)) + length(CAST(COALESCE(request_body, '') AS BLOB)) + length(CAST(COALESCE(response_body, '') AS BLOB))), 0) FROM api_call_logs WHERE user_id = ?) AS task_bytes,
        (SELECT COUNT(*) FROM api_call_logs WHERE user_id = ?) AS api_call_count`;
    } else {
      query += `, 0 AS task_count, 0 AS task_bytes, 0 AS api_call_count`;
    }
    if (this.dialect() === "postgres") {
      query = query.split("length(CAST(COALESCE(").join("octet_length(COALESCE(");
      query = query.split(", '') AS BLOB))").join(", ''))");
    }
    const params: string[] = includeTasks ? new Array(11).fill(userId) : new Array(4).fill(userId);
    const rows = await this.db.all<{
      asset_count: number;
      asset_bytes: number;
      canvas_count: number;
      canvas_bytes: number;
      task_count: number;
      task_bytes: number;
      api_call_count: number;
    }>(query, params);
    const row = rows[0];
    return {
      assetCount: Number(row?.asset_count ?? 0),
      assetBytes: Number(row?.asset_bytes ?? 0),
      canvasCount: Number(row?.canvas_count ?? 0),
      canvasBytes: Number(row?.canvas_bytes ?? 0),
      taskCount: Number(row?.task_count ?? 0),
      taskBytes: Number(row?.task_bytes ?? 0),
      apiCallCount: Number(row?.api_call_count ?? 0),
    };
  }

  async allTasks(): Promise<Task[]> {
    return this.db.all<Task>('SELECT * FROM "tasks"');
  }

  async allAssets(): Promise<Asset[]> {
    return this.db.all<Asset>('SELECT * FROM "assets"');
  }

  async allCanvasProjects(): Promise<CanvasProject[]> {
    return this.db.all<CanvasProject>('SELECT * FROM "canvas_projects"');
  }

  async cleanupDuplicateTaskPayloads(): Promise<void> {
    await this.db.run('UPDATE "task_logs" SET "payload" = ? WHERE length("payload") > ?', ["", 4000]);
  }

  async backupSqlite(path: string): Promise<void> {
    if (this.dialect() !== "sqlite") throw new Error("当前数据库不是 SQLite，不能执行 SQLite 备份");
    const escaped = path.replace(/'/g, "''");
    await this.db.exec(`VACUUM INTO '${escaped}'`);
  }

  async vacuum(): Promise<void> {
    if (this.dialect() !== "sqlite") return;
    await this.db.exec("VACUUM");
  }
}

export interface UserStorageUsage {
  assetCount: number;
  assetBytes: number;
  canvasCount: number;
  canvasBytes: number;
  taskCount: number;
  taskBytes: number;
  apiCallCount: number;
}

export const recordNotFound = new Error("record not found");

export function toIso(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  const parsed = new Date(text.includes("T") ? text : `${text.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

export function toNullableIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return toIso(value) || null;
}

export function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}
