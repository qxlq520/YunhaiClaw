// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
// CloudAgentGeminiCache records an official Gemini CachedContent resource.
// The upstream credential is never stored; CredentialHash is only an identity
// component used to prevent reusing a cache across different credentials.

export interface CloudAgentGeminiCache {
  id: string;
  userId: string;
  cacheKey: string;
  baseUrl: string;
  model: string;
  credentialHash: string;
  resourceName: string;
  expireTime: string;
  createdAt: string;
  updatedAt: string;
}
