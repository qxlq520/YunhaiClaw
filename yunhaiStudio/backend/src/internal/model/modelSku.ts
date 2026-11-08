// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。


export function canonicalSkuSelector(raw: Record<string, string>): { selector: Record<string, string>; encoded: string } {
  const selector: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const key = rawKey.trim();
    const value = String(rawValue).trim();
    if (!key || !value) continue;
    selector[key] = value;
  }
  return { selector, encoded: JSON.stringify(selector) };
}

export function decodeSkuSelector(raw: string): Record<string, string> {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}
