import type { SystemSetting } from "@/internal/model/modelsPlatform";
import { Repository, toIso } from "./repository";

interface SettingRow {
  key: string;
  value_json: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

function mapSetting(row: SettingRow): SystemSetting {
  return {
    key: row.key,
    valueJson: row.value_json,
    updatedBy: row.updated_by,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function setting(repo: Repository, key: string): Promise<SystemSetting | null> {
  const rows = await repo.db.all<SettingRow>(
    'SELECT "key", "value_json", "updated_by", "created_at", "updated_at" FROM "system_settings" WHERE "key" = ? LIMIT 1',
    [key],
  );
  return rows.length ? mapSetting(rows[0]) : null;
}

export async function settingsByPrefix(repo: Repository, prefix: string): Promise<SystemSetting[]> {
  const rows = await repo.db.all<SettingRow>(
    'SELECT "key", "value_json", "updated_by", "created_at", "updated_at" FROM "system_settings" WHERE "key" LIKE ? ORDER BY "key"',
    [`${prefix}%`],
  );
  return rows.map(mapSetting);
}

export async function saveSetting(repo: Repository, key: string, valueJson: string, updatedBy: string): Promise<void> {
  const now = new Date().toISOString();
  const existing = await setting(repo, key);
  if (existing) {
    await repo.db.run('UPDATE "system_settings" SET "value_json" = ?, "updated_by" = ?, "updated_at" = ? WHERE "key" = ?', [
      valueJson,
      updatedBy,
      now,
      key,
    ]);
    return;
  }
  await repo.db.run('INSERT INTO "system_settings" ("key", "value_json", "updated_by", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?)', [
    key,
    valueJson,
    updatedBy,
    now,
    now,
  ]);
}
