// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
import { User } from "./modelsIdentity";
// PluginPlatformState stores the administrator-controlled availability of a
// plugin. User activation can never make an unavailable plugin effective.

export interface PluginPlatformState {
  pluginId: string;
  available: boolean;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

// UserPluginState stores one user's activation choice for an application
// plugin. System-scoped protocol and uploaded plugins do not use this table.

export interface UserPluginState {
  id: string;
  userId: string;
  pluginId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
