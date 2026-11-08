// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
export interface SkillCurationSetting {
  id?: number;
  enabled: boolean;
  revision: number;
}

export interface SkillCurationCategory {
  id: string;
  rootTag: string;
  name: string;
  normalizedName?: string;
  sortOrder: number;
  enabled: boolean;
}

export interface SkillCurationAssignment {
  skillId: string;
  categoryId: string;
}
