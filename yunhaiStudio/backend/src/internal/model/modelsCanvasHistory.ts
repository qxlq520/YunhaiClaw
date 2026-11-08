// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
import { Resource } from "./modelsProject";
// CanvasSnapshot stores document structure only; media stays in Resource storage.

export interface CanvasSnapshot {
  id: string;
  canvasId: string;
  userId?: string;
  revision: number;
  title: string;
  nodeCount: number;
  connectionCount: number;
  payloadBytes: number;
  payloadJson?: string;
  reason: string;
  contentUpdatedAt: string;
  createdAt: string;
}

export interface CanvasSnapshotResource {
  snapshotId?: string;
  resourceId?: string;
  resource?: Resource | null;
}
