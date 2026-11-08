// 对应 backend/internal/repository/ecommerce_skill_install.go
// 防止后台更新覆盖管理员并发修改的 compare-and-swap。

import { Repository } from "./repository";

export async function compareAndSwapEcommerceSkill(
  repo: Repository,
  key: string,
  previous: string,
  next: string,
): Promise<boolean> {
  const changes = await repo.db.run(
    'UPDATE "system_settings" SET "value_json" = ?, "updated_at" = ? WHERE "key" = ? AND "value_json" = ?',
    [next, new Date().toISOString(), key, previous],
  );
  return changes === 1;
}
