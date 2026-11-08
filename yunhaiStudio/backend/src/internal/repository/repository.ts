import type { Database } from "@/internal/database/database";

export class Repository {
  readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  withContext(): Repository {
    return this;
  }

  async transaction<T>(fn: (tx: Repository) => Promise<T>): Promise<T> {
    return this.db.transaction((db) => fn(new Repository(db)));
  }
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
