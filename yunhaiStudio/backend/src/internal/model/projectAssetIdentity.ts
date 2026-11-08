// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。


export function assetCandidateNameKey(value: string): string {
  return [...value.trim()]
    .filter((character) => /[\p{L}\p{N}]/u.test(character))
    .map((character) => character.toLowerCase())
    .join("");
}
