import fs from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import pg from "pg";
import { columnSqlType, currentSchemaVersion, tableDefinitions, type TableDefinition } from "./schema";

export type Dialect = "sqlite" | "postgres";

export type SqlValue = string | number | boolean | null | Uint8Array | Date;

export interface Config {
  driver?: string;
  dsn?: string;
  dataDir: string;
}

export interface SchemaStatus {
  current: number;
  expected: number;
  ready: boolean;
}

const baselineChecksum = "sha256:open-ai-canvas-schema-v1-20260830";

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function normalizeValue(value: SqlValue): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function normalizeSqliteValue(value: SqlValue): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function toPostgresPlaceholders(sql: string): string {
  let result = "";
  let index = 0;
  let parameter = 0;
  let inSingle = false;
  while (index < sql.length) {
    const character = sql[index];
    if (character === "'") inSingle = !inSingle;
    if (character === "?" && !inSingle) {
      parameter += 1;
      result += `$${parameter}`;
    } else {
      result += character;
    }
    index += 1;
  }
  return result;
}

export class Database {
  readonly dialect: Dialect;
  private readonly sqlite: BetterSqlite3.Database | null;
  private readonly pool: pg.Pool | null;
  private readonly client: pg.PoolClient | null;
  private readonly bypassQueue: boolean;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(dialect: Dialect, owner: BetterSqlite3.Database | pg.Pool | pg.PoolClient, bypassQueue = false) {
    this.dialect = dialect;
    this.bypassQueue = bypassQueue;
    if (dialect === "sqlite") {
      this.sqlite = owner as BetterSqlite3.Database;
      this.pool = null;
      this.client = null;
    } else if (owner instanceof pg.Pool) {
      this.sqlite = null;
      this.pool = owner;
      this.client = null;
    } else {
      this.sqlite = null;
      this.pool = (owner as pg.PoolClient & { pool?: pg.Pool }).pool ?? null;
      this.client = owner as pg.PoolClient;
    }
  }

  static async open(config: Config): Promise<Database> {
    const driver = (config.driver ?? "sqlite").trim().toLowerCase() || "sqlite";
    if (driver === "sqlite") {
      let dsn = (config.dsn ?? "").trim();
      if (!dsn) {
        fs.mkdirSync(config.dataDir, { recursive: true });
        dsn = path.join(config.dataDir, "open_ai_canvas.db");
      }
      const sqlite = new BetterSqlite3(dsn);
      sqlite.pragma("busy_timeout = 5000");
      sqlite.pragma("journal_mode = WAL");
      sqlite.pragma("foreign_keys = ON");
      sqlite.pragma("synchronous = NORMAL");
      return new Database("sqlite", sqlite);
    }
    if (driver === "postgres" || driver === "postgresql") {
      const dsn = (config.dsn ?? "").trim();
      if (!dsn) throw new Error("PostgreSQL 模式必须配置 DATABASE_URL");
      const pool = new pg.Pool({ connectionString: dsn, max: 30, idleTimeoutMillis: 10000 });
      return new Database("postgres", pool);
    }
    throw new Error(`不支持的数据库驱动：${driver}`);
  }

  async close(): Promise<void> {
    if (this.sqlite) {
      this.sqlite.close();
      return;
    }
    if (this.pool) await this.pool.end();
  }

  private exclusive<T>(operation: () => Promise<T> | T): Promise<T> {
    if (this.bypassQueue) return Promise.resolve().then(operation);
    const next = this.queue.then(operation, operation);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return this.exclusive(async () => {
      if (this.sqlite) {
        const statement = this.sqlite.prepare(sql);
        return statement.all(...params.map(normalizeSqliteValue)) as T[];
      }
      const executor = this.client ?? this.pool;
      if (!executor) throw new Error("数据库连接已关闭");
      const result = await executor.query(toPostgresPlaceholders(sql), params.map(normalizeValue));
      return result.rows as T[];
    });
  }

  async run(sql: string, params: SqlValue[] = []): Promise<number> {
    return this.exclusive(async () => {
      if (this.sqlite) {
        const statement = this.sqlite.prepare(sql);
        return statement.run(...params.map(normalizeSqliteValue)).changes;
      }
      const executor = this.client ?? this.pool;
      if (!executor) throw new Error("数据库连接已关闭");
      const result = await executor.query(toPostgresPlaceholders(sql), params.map(normalizeValue));
      return result.rowCount ?? 0;
    });
  }

  async exec(sql: string): Promise<void> {
    await this.exclusive(async () => {
      if (this.sqlite) {
        this.sqlite.exec(sql);
        return;
      }
      const executor = this.client ?? this.pool;
      if (!executor) throw new Error("数据库连接已关闭");
      await executor.query(sql);
    });
  }

  async transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
    if (this.dialect === "sqlite") {
      const sqlite = this.sqlite as BetterSqlite3.Database;
      const tx = new Database("sqlite", sqlite, true);
      return this.exclusive(async () => {
        sqlite.exec("BEGIN");
        try {
          const result = await fn(tx);
          sqlite.exec("COMMIT");
          return result;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      });
    }
    if (!this.pool) throw new Error("数据库连接已关闭");
    const client = await this.pool.connect();
    const tx = new Database("postgres", client, true);
    try {
      await client.query("BEGIN");
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function defaultClause(column: TableDefinition["columns"][number], dialect: Dialect): string {
  if (column.default === null) return "";
  const raw = column.default;
  if (column.kind === "boolean") {
    const enabled = raw === "true" || raw === "1";
    return ` DEFAULT ${dialect === "postgres" ? (enabled ? "TRUE" : "FALSE") : enabled ? "1" : "0"}`;
  }
  if (column.kind === "integer" || column.kind === "real") return ` DEFAULT ${Number(raw) || 0}`;
  if (raw === "null" || raw === "NULL") return " DEFAULT NULL";
  return ` DEFAULT '${raw.replace(/'/g, "''")}'`;
}

function createTableSql(table: TableDefinition, dialect: Dialect): string {
  const primaryKeys = table.columns.filter((column) => column.primaryKey);
  const compositePrimaryKey = primaryKeys.length > 1;
  const columns = table.columns.map((column) => {
    let definition = `${quoteIdentifier(column.name)} ${columnSqlType(column.kind, dialect)}`;
    if (column.primaryKey && !compositePrimaryKey) definition += " PRIMARY KEY";
    if (column.notNull || column.primaryKey) definition += " NOT NULL";
    definition += defaultClause(column, dialect);
    return definition;
  });
  if (compositePrimaryKey) {
    columns.push(`PRIMARY KEY (${primaryKeys.map((column) => quoteIdentifier(column.name)).join(", ")})`);
  }
  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(table.name)} (${columns.join(", ")})`;
}

function indexStatements(table: TableDefinition): string[] {
  const grouped = new Map<string, { unique: boolean; columns: { column: string; priority: number }[] }>();
  for (const index of table.indexes) {
    const entry = grouped.get(index.name) ?? { unique: index.unique, columns: [] };
    entry.columns.push({ column: index.column, priority: index.priority });
    entry.unique = entry.unique || index.unique;
    grouped.set(index.name, entry);
  }
  const statements: string[] = [];
  for (const [name, entry] of grouped) {
    const columns = entry.columns.sort((left, right) => left.priority - right.priority).map((item) => quoteIdentifier(item.column));
    statements.push(
      `CREATE ${entry.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${quoteIdentifier(name)} ON ${quoteIdentifier(table.name)} (${columns.join(", ")})`,
    );
  }
  return statements;
}

export async function migrateSchema(db: Database): Promise<void> {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS "schema_migrations" ("version" BIGINT PRIMARY KEY, "name" TEXT NOT NULL, "checksum" TEXT NOT NULL, "applied_at" TEXT NOT NULL)',
  );
  const rows = await db.all<{ version: number }>('SELECT "version" FROM "schema_migrations" ORDER BY "version" DESC LIMIT 1');
  const current = Number(rows[0]?.version ?? 0);
  if (current >= currentSchemaVersion) return;
  for (const table of tableDefinitions) {
    await db.exec(createTableSql(table, db.dialect));
    for (const statement of indexStatements(table)) await db.exec(statement);
  }
  await db.run('DELETE FROM "schema_migrations" WHERE "version" = ?', [currentSchemaVersion]);
  await db.run('INSERT INTO "schema_migrations" ("version", "name", "checksum", "applied_at") VALUES (?, ?, ?, ?)', [
    currentSchemaVersion,
    "baseline_schema",
    baselineChecksum,
    new Date().toISOString(),
  ]);
}

export async function requireSchemaVersion(db: Database): Promise<void> {
  const status = await schemaStatus(db);
  if (!status.ready) throw new Error(`数据库结构版本过旧：当前 ${status.current}，需要 ${status.expected}`);
}

export async function schemaStatus(db: Database): Promise<SchemaStatus> {
  try {
    const rows = await db.all<{ version: number }>('SELECT "version" FROM "schema_migrations" ORDER BY "version" DESC LIMIT 1');
    const current = Number(rows[0]?.version ?? 0);
    return { current, expected: currentSchemaVersion, ready: current >= currentSchemaVersion };
  } catch {
    return { current: 0, expected: currentSchemaVersion, ready: false };
  }
}
