import { Database } from "./database";

interface PrefixedIdDefinition {
  prefix: string;
  table: string;
}

const prefixedIdDefinitions: PrefixedIdDefinition[] = [
  { prefix: "CHANNEL", table: "model_channels" },
  { prefix: "MODEL", table: "channel_models" },
  { prefix: "PTIER", table: "channel_model_price_tiers" },
  { prefix: "ATTEMPT", table: "route_attempts" },
  { prefix: "LMODEL", table: "logical_models" },
  { prefix: "REVISION", table: "logical_model_revisions" },
  { prefix: "ROUTE", table: "logical_model_routes" },
];

const maxInt64 = 9_223_372_036_854_775_807;

function normalizeIdPrefix(raw: string): string {
  return raw.trim().toUpperCase();
}

function prefixedIdDefinitionFor(prefix: string): PrefixedIdDefinition | null {
  return prefixedIdDefinitions.find((definition) => definition.prefix === prefix) ?? null;
}

async function tableExists(db: Database, table: string): Promise<boolean> {
  if (db.dialect === "sqlite") {
    const rows = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table]);
    return rows.length > 0;
  }
  const rows = await db.all<{ name: string }>("SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = ?", [table]);
  return rows.length > 0;
}

async function ensureSequenceRow(db: Database, prefix: string): Promise<void> {
  const existing = await db.all<{ name: string }>('SELECT "name" FROM "id_sequences" WHERE "name" = ?', [`id:${prefix}`]);
  if (existing.length > 0) return;
  await db.run('INSERT INTO "id_sequences" ("name", "value", "updated_at") VALUES (?, ?, ?)', [`id:${prefix}`, 0, new Date().toISOString()]);
}

async function lockedSequence(db: Database, prefix: string): Promise<{ name: string; value: number }> {
  const suffix = db.dialect === "postgres" ? " FOR UPDATE" : "";
  const rows = await db.all<{ name: string; value: number }>(
    `SELECT "name", "value" FROM "id_sequences" WHERE "name" = ?${suffix}`,
    [`id:${prefix}`],
  );
  if (!rows.length) throw new Error(`ID 序列 id:${prefix} 不存在`);
  return { name: rows[0].name, value: Number(rows[0].value) };
}

async function updateSequence(db: Database, name: string, value: number): Promise<void> {
  await db.run('UPDATE "id_sequences" SET "value" = ?, "updated_at" = ? WHERE "name" = ?', [value, new Date().toISOString(), name]);
}

async function maxPrefixedBusinessId(db: Database, definition: PrefixedIdDefinition): Promise<number> {
  const rows = await db.all<{ id: string }>(`SELECT "id" FROM "${definition.table}"`);
  const prefix = `${definition.prefix}_`;
  let maximum = 0;
  for (const row of rows) {
    if (!row.id.startsWith(prefix)) continue;
    const digits = row.id.slice(prefix.length);
    if (!digits || !/^\d+$/.test(digits)) continue;
    const value = Number.parseInt(digits, 10);
    if (Number.isFinite(value) && value > maximum) maximum = value;
  }
  return maximum;
}

async function reconcileWithin(db: Database): Promise<void> {
  for (const definition of prefixedIdDefinitions) {
    if (!(await tableExists(db, definition.table))) continue;
    const maximum = await maxPrefixedBusinessId(db, definition);
    await ensureSequenceRow(db, definition.prefix);
    const item = await lockedSequence(db, definition.prefix);
    if (item.value >= maximum) continue;
    await updateSequence(db, item.name, maximum);
  }
}

export async function reconcilePrefixedIdSequences(db: Database): Promise<void> {
  await db.transaction((tx) => reconcileWithin(tx));
}

async function allocatePrefixedIdWithin(db: Database, rawPrefix: string): Promise<string> {
  const prefix = normalizeIdPrefix(rawPrefix);
  if (!prefix || prefix.length > 16) throw new Error("invalid id prefix");
  await ensureSequenceRow(db, prefix);
  const item = await lockedSequence(db, prefix);

  const definition = prefixedIdDefinitionFor(prefix);
  let candidateValue = item.value;
  if (definition) {
    if (!(await tableExists(db, definition.table))) throw new Error(`ID 前缀 ${prefix} 对应的业务表不存在`);
    const maximum = await maxPrefixedBusinessId(db, definition);
    if (candidateValue < maximum) candidateValue = maximum;
  }
  if (candidateValue === maxInt64) throw new Error(`ID 前缀 ${prefix} 序列已达到上限`);

  for (;;) {
    candidateValue += 1;
    const candidate = `${prefix}_${String(candidateValue).padStart(6, "0")}`;
    if (!definition) {
      await updateSequence(db, item.name, candidateValue);
      return candidate;
    }
    const collisions = await db.all<{ total: number }>(`SELECT COUNT(*) AS "total" FROM "${definition.table}" WHERE "id" = ?`, [candidate]);
    if (Number(collisions[0]?.total ?? 0) !== 0) {
      if (candidateValue === maxInt64) throw new Error(`ID 前缀 ${prefix} 序列已达到上限`);
      continue;
    }
    await updateSequence(db, item.name, candidateValue);
    return candidate;
  }
}

export async function allocatePrefixedId(db: Database, prefix: string): Promise<string> {
  return db.transaction((tx) => allocatePrefixedIdWithin(tx, prefix));
}
