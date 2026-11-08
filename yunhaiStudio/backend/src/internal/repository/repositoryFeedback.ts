// 对应 backend/internal/repository/repository_feedback.go
// 用户反馈的持久化与后台筛选分页。

import type { UserFeedback } from "@/internal/model/modelsFeedback";
import { Repository, toBool, toIso, toNullableIso } from "./repository";

// 标记反馈附件对资源的引用；孤儿清理和管理员删除都保留这些资源。
export const feedbackResourceReferenceKind = "用户反馈";

export interface FeedbackFilter {
  type: string;
  status: string;
  keyword: string;
  archived?: boolean | null;
  page: number;
  limit: number;
}

const feedbackColumns = `"id", "user_id", "user_name", "user_email", "contact", "type", "title", "content", "status", "admin_reply", "replied_at", "archived", "archived_at", "created_at", "updated_at"`;

interface FeedbackRow {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  contact: string;
  type: string;
  title: string;
  content: string;
  status: string;
  admin_reply: string;
  replied_at: string | null;
  archived: unknown;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapFeedback(row: FeedbackRow): UserFeedback {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    contact: row.contact,
    type: row.type,
    title: row.title,
    content: row.content,
    status: row.status,
    adminReply: row.admin_reply,
    repliedAt: toNullableIso(row.replied_at),
    archived: toBool(row.archived),
    archivedAt: toNullableIso(row.archived_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function insertFeedback(repo: Repository, feedback: UserFeedback): Promise<void> {
  await repo.db.run(
    `INSERT INTO "user_feedbacks" (${feedbackColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      feedback.id,
      feedback.userId,
      feedback.userName,
      feedback.userEmail,
      feedback.contact,
      feedback.type,
      feedback.title,
      feedback.content,
      feedback.status,
      feedback.adminReply,
      feedback.repliedAt ?? null,
      feedback.archived,
      feedback.archivedAt ?? null,
      feedback.createdAt,
      feedback.updatedAt,
    ],
  );
}

export async function createFeedback(repo: Repository, feedback: UserFeedback): Promise<void> {
  await insertFeedback(repo, feedback);
}

export async function listFeedbacksByUser(repo: Repository, userId: string): Promise<UserFeedback[]> {
  const rows = await repo.db.all<FeedbackRow>(
    `SELECT ${feedbackColumns} FROM "user_feedbacks" WHERE "user_id" = ? ORDER BY "created_at" DESC`,
    [userId],
  );
  return rows.map(mapFeedback);
}

export async function getFeedback(repo: Repository, id: string): Promise<UserFeedback | null> {
  const rows = await repo.db.all<FeedbackRow>(`SELECT ${feedbackColumns} FROM "user_feedbacks" WHERE "id" = ? LIMIT 1`, [id]);
  return rows.length ? mapFeedback(rows[0]) : null;
}

export async function listAllFeedbacks(
  repo: Repository,
  filter: FeedbackFilter,
): Promise<{ feedbacks: UserFeedback[]; total: number }> {
  const conditions: string[] = [];
  const values: (string | number | boolean | null)[] = [];
  if (filter.type !== "" && filter.type !== "all") {
    conditions.push('"type" = ?');
    values.push(filter.type);
  }
  if (filter.status === "archived") {
    conditions.push('"archived" = ?');
    values.push(true);
  } else if (filter.status !== "" && filter.status !== "all") {
    conditions.push('"status" = ?');
    values.push(filter.status);
  }
  if (filter.archived !== undefined && filter.archived !== null) {
    conditions.push('"archived" = ?');
    values.push(filter.archived);
  }
  const keyword = filter.keyword.trim();
  if (keyword !== "") {
    const like = `%${keyword}%`;
    conditions.push('("title" LIKE ? OR "content" LIKE ? OR "user_name" LIKE ? OR "contact" LIKE ?)');
    values.push(like, like, like, like);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";

  const totals = await repo.db.all<{ total: number }>(`SELECT COUNT(*) AS "total" FROM "user_feedbacks"${where}`, values);
  const total = Number(totals[0]?.total ?? 0);

  let page = filter.page;
  if (page < 1) page = 1;
  let limit = filter.limit;
  if (limit <= 0 || limit > 100) limit = 20;
  const offset = (page - 1) * limit;

  const rows = await repo.db.all<FeedbackRow>(
    `SELECT ${feedbackColumns} FROM "user_feedbacks"${where} ORDER BY "created_at" DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset],
  );
  return { feedbacks: rows.map(mapFeedback), total };
}

export async function updateFeedback(repo: Repository, feedback: UserFeedback): Promise<void> {
  const affected = await repo.db.run(
    'UPDATE "user_feedbacks" SET "user_id" = ?, "user_name" = ?, "user_email" = ?, "contact" = ?, "type" = ?, "title" = ?, "content" = ?, "status" = ?, "admin_reply" = ?, "replied_at" = ?, "archived" = ?, "archived_at" = ?, "created_at" = ?, "updated_at" = ? WHERE "id" = ?',
    [
      feedback.userId,
      feedback.userName,
      feedback.userEmail,
      feedback.contact,
      feedback.type,
      feedback.title,
      feedback.content,
      feedback.status,
      feedback.adminReply,
      feedback.repliedAt ?? null,
      feedback.archived,
      feedback.archivedAt ?? null,
      feedback.createdAt,
      feedback.updatedAt,
      feedback.id,
    ],
  );
  if (affected === 0) await insertFeedback(repo, feedback);
}

export async function deleteFeedback(repo: Repository, id: string): Promise<void> {
  await repo.db.run('DELETE FROM "user_feedbacks" WHERE "id" = ?', [id]);
}
