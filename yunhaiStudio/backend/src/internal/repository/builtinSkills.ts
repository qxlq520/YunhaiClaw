// 对应 backend/internal/repository/builtin_skills.go
// 平台内置技能的删除墓碑与关联数据清理。

import { recordNotFound, Repository } from "./repository";

export async function builtinSkillTombstoned(repo: Repository, skillId: string): Promise<boolean> {
  const rows = await repo.db.all<{ total: number }>(
    'SELECT COUNT(*) AS "total" FROM "builtin_skill_tombstones" WHERE "skill_id" = ?',
    [skillId],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

export async function deleteBuiltinSkill(repo: Repository, skillId: string, actorId: string): Promise<void> {
  const now = new Date().toISOString();
  await repo.transaction(async (tx) => {
    const locking = tx.dialect() === "postgres" ? " FOR UPDATE" : "";
    const locked = await tx.db.all<{ id: string }>(`SELECT "id" FROM "skills" WHERE "id" = ? LIMIT 1${locking}`, [skillId]);
    if (locked.length === 0) throw recordNotFound;
    await tx.db.run('DELETE FROM "skill_curation_assignments" WHERE "skill_id" = ?', [skillId]);
    await tx.db.run('DELETE FROM "skill_curation_root_assignments" WHERE "skill_id" = ?', [skillId]);
    await tx.db.run(
      'INSERT INTO "builtin_skill_tombstones" ("skill_id", "deleted_by", "deleted_at") VALUES (?, ?, ?) ON CONFLICT ("skill_id") DO UPDATE SET "deleted_by" = excluded."deleted_by", "deleted_at" = excluded."deleted_at"',
      [skillId, actorId, now],
    );
    await tx.db.run('DELETE FROM "user_skill_states" WHERE "skill_id" = ?', [skillId]);
    const versions = await tx.db.all<{ id: string }>('SELECT "id" FROM "skill_versions" WHERE "skill_id" = ?', [skillId]);
    const versionIds = versions.map((version) => version.id);
    if (versionIds.length > 0) {
      const placeholders = versionIds.map(() => "?").join(", ");
      await tx.db.run(`DELETE FROM "skill_files" WHERE "skill_version_id" IN (${placeholders})`, versionIds);
    }
    await tx.db.run('DELETE FROM "skill_versions" WHERE "skill_id" = ?', [skillId]);
    await tx.db.run('DELETE FROM "skills" WHERE "id" = ?', [skillId]);
  });
}
