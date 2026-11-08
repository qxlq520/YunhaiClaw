// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
// InspirationFeedEntry 是从上游提示词库定时同步的灵感条目，即灵感大厅的「上新」。
// ID 与前端静态目录同形（"<来源>:<上游标识>"）：前端按 ID 去重，静态目录已有的条目以静态目录为准。

export interface InspirationFeedEntry {
  id: string;
  sourceId: string;
  mode: string;
  title: string;
  description: string;
  image: string;
  prompt: string;
  category: string;
  tags: string[];
  credit: string;
  sourceUrl: string;
  contentHash?: string;
  publishedAt?: string | null;
  firstSeenAt: string;
  createdAt: string;
  updatedAt: string;
}
