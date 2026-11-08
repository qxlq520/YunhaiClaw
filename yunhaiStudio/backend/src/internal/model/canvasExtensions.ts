// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
// Canvas 数据模型扩展
// Canvas 画布

export interface Canvas {
  id: string;
  userId: string;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// CanvasNode 画布节点

export interface CanvasNode {
  id: string;
  canvasId: string;
  type: string;
  content: string;
  position: CanvasPosition | null;
  size: CanvasSize | null;
  parentId: string | null;
  children: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// CanvasPosition 节点位置

export interface CanvasPosition {
  x: number;
  y: number;
}

// CanvasSize 节点尺寸

export interface CanvasSize {
  width: number;
  height: number;
}

// CanvasNodeUpdate 节点更新请求

export interface CanvasNodeUpdate {
  content?: string | null;
  position?: CanvasPosition | null;
  size?: CanvasSize | null;
  parentId?: string | null;
  metadata?: Record<string, unknown>;
}

// CanvasRelationship 节点关系

export interface CanvasRelationship {
  from: string;
  to: string;
}

// Approval 审批请求

export interface Approval {
  id: string;
  userId: string;
  runId: string;
  toolName: string;
  data: Record<string, unknown>;
  decision: string;
  createdAt: string;
  updatedAt: string;
}
