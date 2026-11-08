// 对应 backend/internal/protocol/payment_rpc.go

function cleanPath(value: string): string {
  const parts: string[] = [];
  for (const segment of value.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return "..";
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  const prefix = value.startsWith("/") ? "/" : "";
  return prefix + parts.join("/");
}

function pathBase(value: string): string {
  const cleaned = cleanPath(value);
  const index = cleaned.lastIndexOf("/");
  return index >= 0 ? cleaned.slice(index + 1) : cleaned;
}

function pathDir(value: string): string {
  const cleaned = cleanPath(value);
  const index = cleaned.lastIndexOf("/");
  return index >= 0 ? cleaned.slice(0, index) || "/" : ".";
}

export function paymentRpcBackendCandidates(entry: string, goos: string, goarch: string): string[] {
  const trimmedEntry = entry.trim().replace(/\.exe$/, "");
  const os = goos.trim();
  const arch = goarch.trim();
  if (!trimmedEntry || !os || !arch || cleanPath(trimmedEntry) !== trimmedEntry || !trimmedEntry.startsWith("backend/")) {
    return [];
  }
  const base = pathBase(trimmedEntry);
  const dir = pathDir(trimmedEntry);
  const tagged = `${trimmedEntry}-${os}-${arch}`;
  const nested = `${dir}/${os}-${arch}/${base}`;
  const candidates: string[] = [];
  if (os === "windows") candidates.push(`${tagged}.exe`, `${nested}.exe`, `${trimmedEntry}.exe`);
  candidates.push(tagged, nested, trimmedEntry);
  return uniqueStrings(candidates);
}

/** 判断包内文件是否是 entry 对应的某个平台的可执行文件。 */
export function isPaymentRpcBackendArtifact(entry: string, name: string): boolean {
  return hasAnyPaymentRpcBackend(entry, new Map([[name, null]]));
}

export function hasAnyPaymentRpcBackend(entry: string, files: Map<string, unknown>): boolean {
  const trimmed = entry.trim().replace(/\.exe$/, "");
  if (!trimmed) return false;
  if (files.has(trimmed)) return true;
  if (files.has(`${trimmed}.exe`)) return true;
  const prefix = `${trimmed}-`;
  const nestedRoot = `${pathDir(trimmed)}/`;
  const base = pathBase(trimmed);
  for (const name of files.keys()) {
    if (name.startsWith(prefix)) return true;
    if (!name.startsWith(nestedRoot)) continue;
    const rest = name.slice(nestedRoot.length);
    const slash = rest.indexOf("/");
    if (slash <= 0) continue;
    const leaf = rest.slice(slash + 1);
    if (leaf === base || leaf === `${base}.exe`) return true;
  }
  return false;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
