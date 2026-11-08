// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
// BuiltinSkillTombstone prevents a removed platform skill from being recreated
// by the next startup sync while retaining an auditable deletion record.

export interface BuiltinSkillTombstone {
  skillId: string;
  deletedBy: string;
  deletedAt: string;
}
