// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
export const workbenchKindImage = "image";
export const workbenchKindVideo = "video";

// WorkbenchTool is an administrator-managed public generation entry.

export interface WorkbenchTool {
  id: string;
  kind: string;
  categoryId: string;
  name: string;
  subtitle: string;
  description: string;
  iconResourceId: string;
  coverResourceId: string;
  sortOrder: number;
  capabilityJson: string;
  guideJson: string;
  enabled: boolean;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

// WorkbenchPreset is a versioned prompt/configuration preset owned by a tool.

export interface WorkbenchPreset {
  id: string;
  toolId: string;
  name: string;
  summary: string;
  promptTemplate: string;
  defaultParameters: string;
  sortOrder: number;
  enabled: boolean;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}
