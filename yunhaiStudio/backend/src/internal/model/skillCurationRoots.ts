// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
export interface SkillCurationRoot {
  id: string;
  name: string;
  normalizedName?: string;
  iconKey: string;
  sortOrder: number;
  enabled: boolean;
}

export interface SkillCurationRootAssignment {
  skillId: string;
  rootId: string;
}

export function defaultSkillCurationRoots(): SkillCurationRoot[] {
  return [
    { id: "drama", name: "短剧影视", normalizedName: "短剧影视", iconKey: "film", sortOrder: 10, enabled: true },
    { id: "ecommerce", name: "电商营销", normalizedName: "电商营销", iconKey: "shopping-bag", sortOrder: 20, enabled: true },
    { id: "creative", name: "创意设计", normalizedName: "创意设计", iconKey: "palette", sortOrder: 30, enabled: true },
    { id: "social", name: "社媒内容", normalizedName: "社媒内容", iconKey: "users", sortOrder: 40, enabled: true },
    { id: "others", name: "其他", normalizedName: "其他", iconKey: "shapes", sortOrder: 50, enabled: true },
  ];
}
