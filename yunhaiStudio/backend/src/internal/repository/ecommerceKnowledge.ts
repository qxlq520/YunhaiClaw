// 对应 backend/internal/repository/ecommerce_knowledge.go
// 电商知识库来源/条目的去重落库、检索排序与状态统计。

import type {
  EcommerceCreativeRecommendation,
  EcommerceKnowledgeEntry,
  EcommerceKnowledgeSource,
} from "@/internal/model/modelsEcommerce";
import { recordNotFound, Repository, toIso, toNullableIso } from "./repository";

interface EcommerceKnowledgeSourceRow {
  id: string;
  name: string;
  url: string;
  repository: string | null;
  commit: string | null;
  license: string | null;
  license_text: string | null;
  version: string | null;
  status: string;
  last_synced_at: string | null;
  error_message: string | null;
  last_duplicate_count: number;
  created_at: string;
  updated_at: string;
}

function mapEcommerceKnowledgeSource(row: EcommerceKnowledgeSourceRow): EcommerceKnowledgeSource {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    repository: row.repository ?? "",
    commit: row.commit ?? "",
    license: row.license ?? "",
    licenseText: row.license_text ?? "",
    version: row.version ?? "",
    status: row.status,
    lastSyncedAt: toNullableIso(row.last_synced_at),
    errorMessage: row.error_message ?? "",
    lastDuplicateCount: Number(row.last_duplicate_count ?? 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const ecommerceKnowledgeSourceColumns =
  '"id", "name", "url", "repository", "commit", "license", "license_text", "version", "status", "last_synced_at", "error_message", "last_duplicate_count", "created_at", "updated_at"';

function sourceValues(source: EcommerceKnowledgeSource): (string | number | null)[] {
  return [
    source.id,
    source.name,
    source.url,
    source.repository,
    source.commit,
    source.license,
    source.licenseText,
    source.version,
    source.status,
    source.lastSyncedAt,
    source.errorMessage,
    source.lastDuplicateCount,
    source.createdAt,
    source.updatedAt,
  ];
}

interface EcommerceKnowledgeEntryRow {
  id: string;
  source_id: string;
  knowledge_domain: string | null;
  knowledge_type: string;
  title: string;
  content_json: string;
  category: string | null;
  platforms_json: string | null;
  languages_json: string | null;
  regions_json: string | null;
  applicability_json: string | null;
  exclusions_json: string | null;
  related_cases_json: string | null;
  related_quality_rules_json: string | null;
  styles_json: string | null;
  image_types_json: string | null;
  tags_json: string | null;
  source_url: string | null;
  source_commit: string | null;
  license: string | null;
  version: string | null;
  verified_at: string | null;
  valid_until: string | null;
  trust_level: string | null;
  review_status: string | null;
  dedup_hash: string | null;
  created_at: string;
  updated_at: string;
}

function mapEcommerceKnowledgeEntry(row: EcommerceKnowledgeEntryRow): EcommerceKnowledgeEntry {
  return {
    id: row.id,
    sourceId: row.source_id,
    knowledgeDomain: row.knowledge_domain ?? "",
    knowledgeType: row.knowledge_type,
    title: row.title,
    contentJson: row.content_json,
    category: row.category ?? "",
    platformsJson: row.platforms_json ?? "",
    languagesJson: row.languages_json ?? "",
    regionsJson: row.regions_json ?? "",
    applicabilityJson: row.applicability_json ?? "",
    exclusionsJson: row.exclusions_json ?? "",
    relatedCasesJson: row.related_cases_json ?? "",
    relatedQualityRulesJson: row.related_quality_rules_json ?? "",
    stylesJson: row.styles_json ?? "",
    imageTypesJson: row.image_types_json ?? "",
    tagsJson: row.tags_json ?? "",
    sourceUrl: row.source_url ?? "",
    sourceCommit: row.source_commit ?? "",
    license: row.license ?? "",
    version: row.version ?? "",
    verifiedAt: toNullableIso(row.verified_at),
    validUntil: toNullableIso(row.valid_until),
    trustLevel: row.trust_level ?? "",
    reviewStatus: row.review_status ?? "",
    dedupHash: row.dedup_hash ?? "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const ecommerceKnowledgeEntryColumns =
  '"id", "source_id", "knowledge_domain", "knowledge_type", "title", "content_json", "category", "platforms_json", "languages_json", "regions_json", "applicability_json", "exclusions_json", "related_cases_json", "related_quality_rules_json", "styles_json", "image_types_json", "tags_json", "source_url", "source_commit", "license", "version", "verified_at", "valid_until", "trust_level", "review_status", "dedup_hash", "created_at", "updated_at"';

function entryValues(entry: EcommerceKnowledgeEntry): (string | number | null)[] {
  return [
    entry.id,
    entry.sourceId,
    entry.knowledgeDomain,
    entry.knowledgeType,
    entry.title,
    entry.contentJson,
    entry.category,
    entry.platformsJson,
    entry.languagesJson,
    entry.regionsJson,
    entry.applicabilityJson,
    entry.exclusionsJson,
    entry.relatedCasesJson,
    entry.relatedQualityRulesJson,
    entry.stylesJson,
    entry.imageTypesJson,
    entry.tagsJson,
    entry.sourceUrl,
    entry.sourceCommit,
    entry.license,
    entry.version,
    entry.verifiedAt,
    entry.validUntil,
    entry.trustLevel,
    entry.reviewStatus,
    entry.dedupHash,
    entry.createdAt,
    entry.updatedAt,
  ];
}

function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}

export async function insertEcommerceKnowledgeSources(
  repo: Repository,
  sources: EcommerceKnowledgeSource[],
): Promise<number> {
  if (sources.length === 0) return 0;
  const tuple = `(${placeholders(14)})`;
  let affected = 0;
  for (let index = 0; index < sources.length; index += 100) {
    const batch = sources.slice(index, index + 100);
    affected += await repo.db.run(
      `INSERT INTO "ecommerce_knowledge_sources" (${ecommerceKnowledgeSourceColumns}) VALUES ${batch.map(() => tuple).join(", ")} ON CONFLICT DO NOTHING`,
      batch.flatMap(sourceValues),
    );
  }
  return affected;
}

export async function insertEcommerceKnowledgeEntries(
  repo: Repository,
  entries: EcommerceKnowledgeEntry[],
): Promise<number> {
  if (entries.length === 0) return 0;
  const tuple = `(${placeholders(28)})`;
  let affected = 0;
  for (let index = 0; index < entries.length; index += 100) {
    const batch = entries.slice(index, index + 100);
    affected += await repo.db.run(
      `INSERT INTO "ecommerce_knowledge_entries" (${ecommerceKnowledgeEntryColumns}) VALUES ${batch.map(() => tuple).join(", ")} ON CONFLICT DO NOTHING`,
      batch.flatMap(entryValues),
    );
  }
  return affected;
}

export async function ecommerceKnowledgeEntryExists(repo: Repository, hash: string): Promise<boolean> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "ecommerce_knowledge_entries" WHERE "dedup_hash" = ?',
    [hash],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

export async function ecommerceKnowledgeSourceEntryCount(
  repo: Repository,
  sourceId: string,
  commit: string,
): Promise<number> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "ecommerce_knowledge_entries" WHERE "source_id" = ? AND "source_commit" = ?',
    [sourceId, commit],
  );
  return Number(rows[0]?.total ?? 0);
}

export async function ecommerceKnowledgeSources(repo: Repository): Promise<EcommerceKnowledgeSource[]> {
  const rows = await repo.db.all<EcommerceKnowledgeSourceRow>(
    `SELECT ${ecommerceKnowledgeSourceColumns} FROM "ecommerce_knowledge_sources" ORDER BY "name" ASC`,
  );
  return rows.map(mapEcommerceKnowledgeSource);
}

export async function ecommerceKnowledgeEntries(repo: Repository): Promise<EcommerceKnowledgeEntry[]> {
  const rows = await repo.db.all<EcommerceKnowledgeEntryRow>(
    `SELECT ${ecommerceKnowledgeEntryColumns} FROM "ecommerce_knowledge_entries" WHERE "review_status" = ?`,
    ["approved"],
  );
  return rows.map(mapEcommerceKnowledgeEntry);
}

export async function ecommerceKnowledgeByIDs(
  repo: Repository,
  ids: string[],
): Promise<EcommerceKnowledgeEntry[]> {
  if (ids.length === 0) return [];
  const rows = await repo.db.all<EcommerceKnowledgeEntryRow>(
    `SELECT ${ecommerceKnowledgeEntryColumns} FROM "ecommerce_knowledge_entries" WHERE "id" IN (${placeholders(ids.length)}) AND "review_status" = ? AND ("valid_until" IS NULL OR "valid_until" > ?)`,
    [...ids, "approved", new Date().toISOString()],
  );
  return rows.map(mapEcommerceKnowledgeEntry);
}

const knowledgeTermSeparators = /[ \n,，。；]+/;

const knowledgeTermMappings: { zh: string; en: string }[] = [
  { zh: "耳机", en: "headphone" },
  { zh: "奶瓶", en: "baby bottle" },
  { zh: "洗面奶", en: "facial cleanser" },
  { zh: "连衣裙", en: "dress" },
  { zh: "女装", en: "clothing" },
  { zh: "沙发", en: "sofa" },
  { zh: "珠宝", en: "jewelry" },
  { zh: "咖啡", en: "coffee" },
  { zh: "手表", en: "watch" },
  { zh: "手机", en: "mobile phone" },
  { zh: "玩具", en: "toy" },
  { zh: "灯具", en: "lighting" },
  { zh: "宠物", en: "pet" },
  { zh: "电脑", en: "computer" },
  { zh: "鞋", en: "shoe" },
  { zh: "箱包", en: "bag" },
  { zh: "香水", en: "perfume" },
  { zh: "口红", en: "lipstick" },
  { zh: "文具", en: "stationery" },
  { zh: "园艺", en: "garden" },
];

export async function searchEcommerceKnowledgeEntries(
  repo: Repository,
  category: string,
  query: string,
): Promise<EcommerceKnowledgeEntry[]> {
  const now = new Date().toISOString();
  const validCondition = '"review_status" = ? AND ("valid_until" IS NULL OR "valid_until" > ?)';
  const generalRows = await repo.db.all<EcommerceKnowledgeEntryRow>(
    `SELECT ${ecommerceKnowledgeEntryColumns} FROM "ecommerce_knowledge_entries" WHERE ${validCondition} AND "category" = ? ORDER BY "knowledge_type" ASC, "title" ASC LIMIT 400`,
    ["approved", now, "general"],
  );
  const entries = generalRows.map(mapEcommerceKnowledgeEntry);
  if (category === "general") return entries;

  const terms = query
    .toLowerCase()
    .split(knowledgeTermSeparators)
    .filter((term) => term !== "");
  for (const mapping of knowledgeTermMappings) {
    if (query.includes(mapping.zh)) terms.push(mapping.en);
  }
  let matched: EcommerceKnowledgeEntry[] = [];
  for (let term of terms) {
    const runeLength = [...term].length;
    if (runeLength < 2 || runeLength > 80) continue;
    // 即使查询文本包含 LIKE 元字符也按数据处理。
    term = term.replace(/[%_]/g, "");
    if (term === "") continue;
    const like = `%${term}%`;
    const found = await repo.db.all<EcommerceKnowledgeEntryRow>(
      `SELECT ${ecommerceKnowledgeEntryColumns} FROM "ecommerce_knowledge_entries" WHERE ${validCondition} AND "category" = ? AND (LOWER("title") LIKE ? OR LOWER("tags_json") LIKE ? OR LOWER("content_json") LIKE ? OR LOWER("platforms_json") LIKE ?) ORDER BY "updated_at" DESC, "knowledge_type" ASC, "title" ASC LIMIT 24`,
      ["approved", now, category, like, like, like, like],
    );
    matched = matched.concat(found.map(mapEcommerceKnowledgeEntry));
    if (matched.length >= 64) break;
  }
  // 始终附带该分类自身的条目：中文查询没有分词，单个关键词命中不能隐藏同分类其余内容。
  const byCategory = await repo.db.all<EcommerceKnowledgeEntryRow>(
    `SELECT ${ecommerceKnowledgeEntryColumns} FROM "ecommerce_knowledge_entries" WHERE ${validCondition} AND "category" = ? ORDER BY "updated_at" DESC, "knowledge_type" ASC, "title" ASC LIMIT 48`,
    ["approved", now, category],
  );
  matched = matched.concat(byCategory.map(mapEcommerceKnowledgeEntry));
  const seen = new Set<string>();
  const result: EcommerceKnowledgeEntry[] = [];
  for (const entry of [...entries, ...matched]) {
    if (seen.has(entry.id)) continue;
    result.push(entry);
    seen.add(entry.id);
  }
  return result;
}

export async function ecommerceKnowledgeCounts(
  repo: Repository,
): Promise<{ total: number; approved: number }> {
  const totals = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "ecommerce_knowledge_entries"',
  );
  const approved = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "ecommerce_knowledge_entries" WHERE "review_status" = ? AND ("valid_until" IS NULL OR "valid_until" > ?)',
    ["approved", new Date().toISOString()],
  );
  return { total: Number(totals[0]?.total ?? 0), approved: Number(approved[0]?.total ?? 0) };
}

export async function ecommerceKnowledgeStatusCounts(repo: Repository): Promise<Record<string, number>> {
  const rows = await repo.db.all<{ review_status: string | null; count: number }>(
    'SELECT "review_status", COUNT(*) AS "count" FROM "ecommerce_knowledge_entries" GROUP BY "review_status"',
  );
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.review_status ?? ""] = Number(row.count ?? 0);
  return counts;
}

export async function ecommerceKnowledgeCoverage(
  repo: Repository,
): Promise<{ coverage: Record<string, number>; expired: number }> {
  const rows = await repo.db.all<{ category: string | null; count: number }>(
    'SELECT "category", COUNT(*) AS "count" FROM "ecommerce_knowledge_entries" WHERE "review_status" = ? AND ("valid_until" IS NULL OR "valid_until" > ?) GROUP BY "category"',
    ["approved", new Date().toISOString()],
  );
  const coverage: Record<string, number> = {};
  for (const row of rows) coverage[row.category ?? ""] = Number(row.count ?? 0);
  const expiredRows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "ecommerce_knowledge_entries" WHERE "valid_until" <= ?',
    [new Date().toISOString()],
  );
  return { coverage, expired: Number(expiredRows[0]?.total ?? 0) };
}

export async function ecommerceKnowledgeDomainCoverage(repo: Repository): Promise<Record<string, number>> {
  const rows = await repo.db.all<{ knowledge_domain: string | null; count: number }>(
    `SELECT "knowledge_domain", COUNT(*) AS "count" FROM "ecommerce_knowledge_entries" WHERE "review_status" = ? AND ("valid_until" IS NULL OR "valid_until" > ?) AND "knowledge_domain" <> '' GROUP BY "knowledge_domain"`,
    ["approved", new Date().toISOString()],
  );
  const coverage: Record<string, number> = {};
  for (const row of rows) coverage[row.knowledge_domain ?? ""] = Number(row.count ?? 0);
  return coverage;
}

export async function ecommerceKnowledgeEntryPage(
  repo: Repository,
  keyword: string,
  status: string,
  page: number,
  limit: number,
): Promise<{ entries: EcommerceKnowledgeEntry[]; total: number }> {
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  if (keyword !== "") {
    conditions.push('LOWER("title") LIKE ?');
    values.push(`%${keyword.toLowerCase()}%`);
  }
  if (status !== "") {
    conditions.push('"review_status" = ?');
    values.push(status);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const totals = await repo.db.all<{ total: number }>(
    `SELECT COUNT(*) AS "total" FROM "ecommerce_knowledge_entries"${where}`,
    values,
  );
  const rows = await repo.db.all<EcommerceKnowledgeEntryRow>(
    `SELECT ${ecommerceKnowledgeEntryColumns} FROM "ecommerce_knowledge_entries"${where} ORDER BY "updated_at" DESC, "id" ASC LIMIT ? OFFSET ?`,
    [...values, limit, (page - 1) * limit],
  );
  return { entries: rows.map(mapEcommerceKnowledgeEntry), total: Number(totals[0]?.total ?? 0) };
}

export async function reviewEcommerceKnowledgeEntry(repo: Repository, id: string, status: string): Promise<void> {
  const changes = await repo.db.run(
    'UPDATE "ecommerce_knowledge_entries" SET "review_status" = ?, "updated_at" = ? WHERE "id" = ?',
    [status, new Date().toISOString(), id],
  );
  if (changes === 0) throw recordNotFound;
}

export async function ecommerceKnowledgeSource(
  repo: Repository,
  id: string,
): Promise<EcommerceKnowledgeSource | null> {
  const rows = await repo.db.all<EcommerceKnowledgeSourceRow>(
    `SELECT ${ecommerceKnowledgeSourceColumns} FROM "ecommerce_knowledge_sources" WHERE "id" = ? LIMIT 1`,
    [id],
  );
  return rows.length ? mapEcommerceKnowledgeSource(rows[0]) : null;
}

export async function setEcommerceKnowledgeSourceStatus(
  repo: Repository,
  id: string,
  status: string,
): Promise<void> {
  const changes = await repo.db.run(
    'UPDATE "ecommerce_knowledge_sources" SET "status" = ?, "updated_at" = ? WHERE "id" = ?',
    [status, new Date().toISOString(), id],
  );
  if (changes === 0) throw recordNotFound;
}

export async function upsertEcommerceKnowledgeSource(
  repo: Repository,
  source: EcommerceKnowledgeSource,
): Promise<void> {
  const rows = await repo.db.all<{ id: string }>(
    'SELECT "id" FROM "ecommerce_knowledge_sources" WHERE "id" = ? LIMIT 1',
    [source.id],
  );
  if (!rows.length) {
    await repo.db.run(
      `INSERT INTO "ecommerce_knowledge_sources" (${ecommerceKnowledgeSourceColumns}) VALUES (${placeholders(14)})`,
      sourceValues(source),
    );
    return;
  }
  await repo.db.run(
    'UPDATE "ecommerce_knowledge_sources" SET "name" = ?, "url" = ?, "repository" = ?, "commit" = ?, "license" = ?, "license_text" = ?, "version" = ?, "status" = ?, "last_synced_at" = ?, "error_message" = ?, "last_duplicate_count" = ?, "updated_at" = ? WHERE "id" = ?',
    [
      source.name,
      source.url,
      source.repository,
      source.commit,
      source.license,
      source.licenseText,
      source.version,
      source.status,
      source.lastSyncedAt,
      source.errorMessage,
      source.lastDuplicateCount,
      new Date().toISOString(),
      source.id,
    ],
  );
}

export async function upsertEcommerceKnowledgeEntry(
  repo: Repository,
  entry: EcommerceKnowledgeEntry,
): Promise<void> {
  const rows = await repo.db.all<{ id: string }>(
    'SELECT "id" FROM "ecommerce_knowledge_entries" WHERE "dedup_hash" = ? LIMIT 1',
    [entry.dedupHash],
  );
  if (!rows.length) {
    await repo.db.run(
      `INSERT INTO "ecommerce_knowledge_entries" (${ecommerceKnowledgeEntryColumns}) VALUES (${placeholders(28)})`,
      entryValues(entry),
    );
    return;
  }
  await repo.db.run(
    'UPDATE "ecommerce_knowledge_entries" SET "source_id" = ?, "knowledge_domain" = ?, "knowledge_type" = ?, "title" = ?, "content_json" = ?, "category" = ?, "platforms_json" = ?, "languages_json" = ?, "regions_json" = ?, "applicability_json" = ?, "exclusions_json" = ?, "related_cases_json" = ?, "related_quality_rules_json" = ?, "styles_json" = ?, "image_types_json" = ?, "tags_json" = ?, "source_url" = ?, "source_commit" = ?, "license" = ?, "version" = ?, "verified_at" = ?, "valid_until" = ?, "trust_level" = ?, "updated_at" = ? WHERE "dedup_hash" = ?',
    [
      entry.sourceId,
      entry.knowledgeDomain,
      entry.knowledgeType,
      entry.title,
      entry.contentJson,
      entry.category,
      entry.platformsJson,
      entry.languagesJson,
      entry.regionsJson,
      entry.applicabilityJson,
      entry.exclusionsJson,
      entry.relatedCasesJson,
      entry.relatedQualityRulesJson,
      entry.stylesJson,
      entry.imageTypesJson,
      entry.tagsJson,
      entry.sourceUrl,
      entry.sourceCommit,
      entry.license,
      entry.version,
      entry.verifiedAt,
      entry.validUntil,
      entry.trustLevel,
      new Date().toISOString(),
      entry.dedupHash,
    ],
  );
}

// 内置知识同步需要读取任意审核状态的条目，以便与随包版本比对。
export async function ecommerceKnowledgeEntryById(
  repo: Repository,
  id: string,
): Promise<EcommerceKnowledgeEntry | null> {
  const rows = await repo.db.all<EcommerceKnowledgeEntryRow>(
    `SELECT ${ecommerceKnowledgeEntryColumns} FROM "ecommerce_knowledge_entries" WHERE "id" = ? LIMIT 1`,
    [id],
  );
  return rows.length ? mapEcommerceKnowledgeEntry(rows[0]) : null;
}

export async function createEcommerceKnowledgeEntry(
  repo: Repository,
  entry: EcommerceKnowledgeEntry,
): Promise<void> {
  await repo.db.run(
    `INSERT INTO "ecommerce_knowledge_entries" (${ecommerceKnowledgeEntryColumns}) VALUES (${placeholders(28)})`,
    entryValues(entry),
  );
}

// 仅当存储行仍是预期哈希时替换随包内容；审核状态不参与更新，管理员驳回不会被覆盖。
export async function updateBuiltinEcommerceKnowledgeEntry(
  repo: Repository,
  id: string,
  expectedHash: string,
  entry: EcommerceKnowledgeEntry,
): Promise<boolean> {
  const changes = await repo.db.run(
    'UPDATE "ecommerce_knowledge_entries" SET "source_id" = ?, "knowledge_domain" = ?, "knowledge_type" = ?, "title" = ?, "content_json" = ?, "category" = ?, "platforms_json" = ?, "languages_json" = ?, "regions_json" = ?, "tags_json" = ?, "source_url" = ?, "license" = ?, "version" = ?, "dedup_hash" = ?, "updated_at" = ? WHERE "id" = ? AND "dedup_hash" = ?',
    [
      entry.sourceId,
      entry.knowledgeDomain,
      entry.knowledgeType,
      entry.title,
      entry.contentJson,
      entry.category,
      entry.platformsJson,
      entry.languagesJson,
      entry.regionsJson,
      entry.tagsJson,
      entry.sourceUrl,
      entry.license,
      entry.version,
      entry.dedupHash,
      new Date().toISOString(),
      id,
      expectedHash,
    ],
  );
  return changes === 1;
}

// 刷新描述字段，但保留管理员设置的启用/停用状态。
export async function updateBuiltinEcommerceKnowledgeSource(
  repo: Repository,
  source: EcommerceKnowledgeSource,
): Promise<void> {
  await repo.db.run(
    'UPDATE "ecommerce_knowledge_sources" SET "name" = ?, "url" = ?, "license" = ?, "version" = ?, "last_synced_at" = ?, "error_message" = ?, "updated_at" = ? WHERE "id" = ?',
    [source.name, source.url, source.license, source.version, source.lastSyncedAt, "", new Date().toISOString(), source.id],
  );
}

export async function createEcommerceKnowledgeSource(
  repo: Repository,
  source: EcommerceKnowledgeSource,
): Promise<void> {
  await repo.db.run(
    `INSERT INTO "ecommerce_knowledge_sources" (${ecommerceKnowledgeSourceColumns}) VALUES (${placeholders(14)})`,
    sourceValues(source),
  );
}

// 按来源前缀统计各领域与审核状态的存量，供审计报表使用。
export async function ecommerceKnowledgeDomainStatusCounts(
  repo: Repository,
  sourcePrefix: string,
): Promise<Record<string, Record<string, number>>> {
  const rows = await repo.db.all<{ knowledge_domain: string | null; review_status: string | null; count: number }>(
    'SELECT "knowledge_domain", "review_status", COUNT(*) AS "count" FROM "ecommerce_knowledge_entries" WHERE "source_id" LIKE ? GROUP BY "knowledge_domain", "review_status"',
    [`${sourcePrefix}%`],
  );
  const counts: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const domain = row.knowledge_domain ?? "";
    counts[domain] ??= {};
    counts[domain][row.review_status ?? ""] = Number(row.count ?? 0);
  }
  return counts;
}

export async function createEcommerceRecommendation(
  repo: Repository,
  item: EcommerceCreativeRecommendation,
): Promise<void> {
  await repo.db.run(
    `INSERT INTO "ecommerce_creative_recommendations" (${ecommerceRecommendationColumns}) VALUES (${placeholders(14)})`,
    [
      item.id,
      item.userId,
      item.projectId,
      item.inputSignature,
      item.productCategory,
      item.platform,
      item.region,
      item.language,
      item.directionsJson,
      item.evidenceJson,
      item.selectedDirectionId,
      item.status,
      item.createdAt,
      item.updatedAt,
    ],
  );
}

const ecommerceRecommendationColumns =
  '"id", "user_id", "project_id", "input_signature", "product_category", "platform", "region", "language", "directions_json", "evidence_json", "selected_direction_id", "status", "created_at", "updated_at"';

export async function ecommerceRecommendation(
  repo: Repository,
  userId: string,
  id: string,
): Promise<EcommerceCreativeRecommendation | null> {
  const rows = await repo.db.all<{
    id: string;
    user_id: string;
    project_id: string;
    input_signature: string;
    product_category: string | null;
    platform: string | null;
    region: string | null;
    language: string | null;
    directions_json: string;
    evidence_json: string | null;
    selected_direction_id: string | null;
    status: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT ${ecommerceRecommendationColumns} FROM "ecommerce_creative_recommendations" WHERE "user_id" = ? AND "id" = ? LIMIT 1`,
    [userId, id],
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    inputSignature: row.input_signature,
    productCategory: row.product_category ?? "",
    platform: row.platform ?? "",
    region: row.region ?? "",
    language: row.language ?? "",
    directionsJson: row.directions_json,
    evidenceJson: row.evidence_json ?? "",
    selectedDirectionId: row.selected_direction_id ?? "",
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

// 记录用户最终选择的风格并一次性选中，两个并发确认不会同时成功。
export async function selectEcommerceRecommendationStyle(
  repo: Repository,
  userId: string,
  id: string,
  directionId: string,
  directionsJSON: string,
): Promise<void> {
  const changes = await repo.db.run(
    'UPDATE "ecommerce_creative_recommendations" SET "selected_direction_id" = ?, "status" = ?, "directions_json" = ?, "updated_at" = ? WHERE "user_id" = ? AND "id" = ? AND "selected_direction_id" = \'\'',
    [directionId, "selected", directionsJSON, new Date().toISOString(), userId, id],
  );
  if (changes === 0) throw recordNotFound;
}

export async function selectEcommerceRecommendationDirection(
  repo: Repository,
  userId: string,
  id: string,
  directionId: string,
): Promise<void> {
  const changes = await repo.db.run(
    'UPDATE "ecommerce_creative_recommendations" SET "selected_direction_id" = ?, "status" = ?, "updated_at" = ? WHERE "user_id" = ? AND "id" = ? AND ("selected_direction_id" = \'\' OR "selected_direction_id" = ?)',
    [directionId, "selected", new Date().toISOString(), userId, id, directionId],
  );
  if (changes === 0) throw recordNotFound;
}
