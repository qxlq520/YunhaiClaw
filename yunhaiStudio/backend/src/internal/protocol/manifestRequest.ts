// 对应 backend/internal/protocol/manifest_request.go
// 声明式插件请求的求值：把清单里的表达式、查询、文件与变换代入任务输入，得到最终请求。

import {
  anthropicWireForBaseUrl,
  textWireForPath,
  TextWireClaude,
} from "./textwire";
import {
  defaultValue,
  evaluateManifestValue,
  interpolateManifestString,
  manifestArray,
  manifestPathValue,
  manifestString,
} from "./expression";
import { isRelativePath, setMapPath } from "./manifest";
import { mediaReferencesFromManifestValue } from "./manifestAdapter";
import type { GenerationRequest, ManifestAuth, ManifestFilePart, ManifestOperation, MediaReference, RequestFilePart, RequestSpec } from "./types";

export const MediaUploadIDKey = "uploadId";

export function buildManifestOperation(
  operation: ManifestOperation,
  auth: ManifestAuth,
  request: GenerationRequest,
  taskId: string,
): { spec: RequestSpec | null; error: Error | null } {
  return buildManifestOperationWithEnv(operation, auth, request, taskId, null);
}

/** 允许宿主为单次请求追加只读变量（如上传步骤的当前 media）；request 与 taskId 不可被覆盖。 */
export function buildManifestOperationWithEnv(
  operation: ManifestOperation,
  auth: ManifestAuth,
  request: GenerationRequest,
  taskId: string,
  extra: Record<string, unknown> | null,
): { spec: RequestSpec | null; error: Error | null } {
  const env: Record<string, unknown> = { request: manifestRequestValues(request), taskId };
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (!(key in env)) env[key] = value;
  }
  let body: unknown;
  if (operation.body !== undefined && operation.body !== null) {
    const evaluated = evaluateManifestValue(operation.body, env);
    if (evaluated.error) return { spec: null, error: new Error(`evaluate request body: ${evaluated.error.message}`) };
    body = normalizeManifestValue(evaluated.value);
  } else if (operation.fields && Object.keys(operation.fields).length > 0) {
    const legacyBody: Record<string, unknown> = {};
    for (const [key, expression] of Object.entries(operation.fields)) {
      const value = manifestExpressionValue(expression, request, taskId);
      if (value === null || value === undefined) continue;
      setMapPath(legacyBody, key, value);
    }
    body = normalizeManifestValue(legacyBody);
  }
  const pathTemplate = operation.pathTemplate !== undefined && operation.pathTemplate !== null ? operation.pathTemplate : operation.path;
  const evaluatedPath = evaluateManifestValue(pathTemplate, env);
  if (evaluatedPath.error) return { spec: null, error: new Error(`evaluate request path: ${evaluatedPath.error.message}`) };
  let path = manifestString(evaluatedPath.value).replaceAll("{{taskId}}", encodeURIComponent(taskId));
  const escapedModel = encodeURIComponent(request.model).replaceAll("%2F", "/");
  path = path.replaceAll("{{model}}", escapedModel);
  path = interpolateManifestString(path, env);
  if (!isRelativePath(path)) return { spec: null, error: new Error(`evaluated request path must be relative: "${path}"`) };
  const headers = evaluateManifestStringMap(operation.headers, env);
  if (headers.error) return { spec: null, error: new Error(`evaluate request headers: ${headers.error.message}`) };
  const query = evaluateManifestQuery(operation.query, env);
  if (query.error) return { spec: null, error: new Error(`evaluate request query: ${query.error.message}`) };
  const files = evaluateManifestFiles(operation.files ?? [], env);
  if (files.error) return { spec: null, error: files.error };
  const contentTypeValue =
    operation.contentTypeTemplate !== undefined && operation.contentTypeTemplate !== null
      ? operation.contentTypeTemplate
      : operation.contentType;
  const evaluatedContentType = evaluateManifestValue(contentTypeValue, env);
  if (evaluatedContentType.error) {
    return { spec: null, error: new Error(`evaluate request content type: ${evaluatedContentType.error.message}`) };
  }
  const contentType = defaultValue(manifestString(evaluatedContentType.value), "application/json");
  const spec: RequestSpec = {
    method: String(operation.method ?? "").toUpperCase(),
    path,
    originPath: operation.originPath,
    contentType,
  };
  if (headers.value) spec.headers = headers.value;
  if (query.value) spec.query = query.value;
  if (body !== undefined) spec.body = body;
  if (files.value.length > 0) spec.files = files.value;
  if (auth) spec.auth = auth;
  return { spec, error: null };
}

function evaluateManifestStringMap(
  values: Record<string, unknown> | undefined,
  env: Record<string, unknown>,
): { value: Record<string, string> | null; error: Error | null } {
  if (!values || Object.keys(values).length === 0) return { value: null, error: null };
  const result: Record<string, string> = {};
  for (const [key, template] of Object.entries(values)) {
    const evaluated = evaluateManifestValue(template, env);
    if (evaluated.error) return { value: null, error: evaluated.error };
    const text = manifestString(evaluated.value).trim();
    if (text) result[key] = text;
  }
  return { value: result, error: null };
}

function evaluateManifestQuery(
  values: Record<string, unknown> | undefined,
  env: Record<string, unknown>,
): { value: Record<string, string[]> | null; error: Error | null } {
  if (!values || Object.keys(values).length === 0) return { value: null, error: null };
  const result: Record<string, string[]> = {};
  for (const [key, template] of Object.entries(values)) {
    const evaluated = evaluateManifestValue(template, env);
    if (evaluated.error) return { value: null, error: evaluated.error };
    for (const item of manifestArray(evaluated.value)) {
      const text = manifestString(item).trim();
      if (text) result[key] = [...(result[key] ?? []), text];
    }
  }
  return { value: result, error: null };
}

function evaluateManifestFiles(parts: ManifestFilePart[], env: Record<string, unknown>): { value: RequestFilePart[]; error: Error | null } {
  const result: RequestFilePart[] = [];
  for (const part of parts) {
    const source = evaluateManifestValue(part.source, env);
    if (source.error) return { value: [], error: new Error(`evaluate multipart file "${part.name}": ${source.error.message}`) };
    const filename = evaluateManifestValue(part.filename, env);
    if (filename.error) return { value: [], error: new Error(`evaluate multipart filename "${part.name}": ${filename.error.message}`) };
    const mimeType = evaluateManifestValue(part.mimeType, env);
    if (mimeType.error) return { value: [], error: new Error(`evaluate multipart MIME type "${part.name}": ${mimeType.error.message}`) };
    const values = manifestArray(source.value);
    for (let index = 0; index < values.length; index += 1) {
      for (const reference of mediaReferencesFromManifestValue(values[index], "file", false)) {
        let name = manifestString(filename.value).trim();
        if (!name) name = reference.name ?? "";
        if (!name) name = `${part.name}-${index + 1}`;
        let contentType = manifestString(mimeType.value).trim();
        if (!contentType) contentType = reference.mimeType ?? "";
        result.push({ name: part.name, filename: name, mimeType: contentType, reference });
      }
    }
  }
  return { value: result, error: null };
}

export function normalizeManifestValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeManifestValue(item));
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length > 0) {
      let sequential = true;
      for (let index = 0; index < keys.length; index += 1) {
        if (!(String(index) in record)) {
          sequential = false;
          break;
        }
      }
      if (sequential) {
        return keys.map((key) => normalizeManifestValue(record[key]));
      }
    }
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) result[key] = normalizeManifestValue(item);
    return result;
  }
  return value;
}

export function manifestExpressionValue(expression: string, request: GenerationRequest, taskId: string): unknown {
  const trimmed = expression.trim();
  let source = trimmed;
  let transforms: string[] = [];
  const separator = trimmed.indexOf("|");
  if (separator >= 0) {
    source = trimmed.slice(0, separator).trim();
    transforms = trimmed.slice(separator + 1).split("|");
  }
  let value: unknown;
  if (source === "taskId") value = taskId;
  else if (source.startsWith("request.")) value = pathValue(manifestRequestValues(request), source.slice("request.".length));
  else value = source;
  for (const transform of transforms) {
    value = applyManifestTransform(value, transform, request);
    if (value === null || value === undefined) break;
  }
  return value;
}

/** 平台请求的 JSON 形状视图，让上传的清单能按下标引用媒体而不暴露宿主对象。 */
export function manifestRequestValues(request: GenerationRequest): Record<string, unknown> {
  const userContent: unknown[] = [];
  if ((request.prompt ?? "").trim()) userContent.push({ type: "text", text: request.prompt });
  let isClaudeWire = request.interfaceType === TextWireClaude;
  if (!isClaudeWire && request.capability === "text") {
    isClaudeWire = textWireForPath(request.linePath ?? "") === TextWireClaude || anthropicWireForBaseUrl(request.baseUrl ?? "");
  }
  for (const image of request.images ?? []) {
    const value = defaultValue(image.url, image.dataUrl ?? "");
    if (!value) continue;
    if (isClaudeWire) {
      let source: Record<string, unknown> = { type: "url", url: value };
      if (value.startsWith("data:")) {
        const split = manifestSplitDataUrl(value);
        if (split) source = { type: "base64", media_type: split.mimeType, data: split.data };
      }
      userContent.push({ type: "image", source });
    } else {
      userContent.push({ type: "image_url", image_url: { url: value } });
    }
  }
  for (const video of request.videos ?? []) {
    const value = defaultValue(video.url, video.dataUrl ?? "");
    if (value) userContent.push({ type: "video_url", video_url: { url: value } });
  }
  for (const audio of request.audios ?? []) {
    const value = defaultValue(audio.url, audio.dataUrl ?? "");
    if (value) userContent.push({ type: "audio_url", audio_url: { url: value } });
  }
  const messages: unknown[] = [];
  const instructions = (request.instructions ?? "").trim();
  if (instructions && !hasSystemMessage(request.messages ?? [])) {
    messages.push({ role: "system", content: instructions });
  }
  for (const message of request.messages ?? []) {
    if (!message.role.trim() || message.content === null || message.content === undefined) continue;
    messages.push({ role: message.role, content: message.content });
  }
  if (userContent.length > 0) {
    let content: unknown = userContent;
    const mediaCount = (request.images?.length ?? 0) + (request.videos?.length ?? 0) + (request.audios?.length ?? 0);
    if (userContent.length === 1 && mediaCount === 0) content = request.prompt;
    messages.push({ role: "user", content });
  }

  let inputs = request.inputs ?? [];
  if (inputs.length === 0) inputs = [...(request.images ?? []), ...(request.videos ?? []), ...(request.audios ?? [])];
  const output = { ...(request.output ?? {}) };
  if (!output.count) output.count = request.imageCount;
  if (!output.duration) output.duration = request.duration;
  if (!output.aspectRatio) output.aspectRatio = request.aspectRatio;
  if (!output.resolution) output.resolution = request.resolution;
  if (!output.quality) output.quality = request.quality;
  output.generateAudio = Boolean(output.generateAudio) || Boolean(request.generateAudio);
  output.watermark = Boolean(output.watermark) || Boolean(request.watermark);

  return {
    capability: request.capability,
    model: request.model,
    prompt: request.prompt,
    instructions: request.instructions,
    messages,
    inputs: manifestMediaValues(inputs),
    images: manifestMediaValues(request.images ?? []),
    videos: manifestMediaValues(request.videos ?? []),
    audios: manifestMediaValues(request.audios ?? []),
    imageCount: request.imageCount,
    duration: request.duration,
    aspectRatio: request.aspectRatio,
    resolution: request.resolution,
    quality: request.quality,
    generateAudio: request.generateAudio,
    watermark: request.watermark,
    operation: request.operation,
    output: requestAsManifestValue(output),
    providerOptions: requestAsManifestValue(request.providerOptions ?? {}) ?? {},
    extra: request.extra,
  };
}

function hasSystemMessage(messages: Array<{ role: string }>): boolean {
  return messages.some((message) => message.role.trim().toLowerCase() === "system");
}

function requestAsManifestValue(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

export function manifestModelId(request: GenerationRequest): string {
  let modelId = (request.model ?? "").trim();
  const separator = modelId.lastIndexOf("::");
  if (separator >= 0) modelId = modelId.slice(separator + 2);
  return modelId.toLowerCase();
}

export function manifestMediaValues(values: MediaReference[]): unknown[] {
  return values.map((value, index) => {
    let order = value.order ?? 0;
    if (order === 0 && index > 0) order = index;
    const resolved = defaultValue(value.url, value.dataUrl ?? "");
    const uploadId = value.metadata ? manifestString(value.metadata[MediaUploadIDKey]) : "";
    return {
      uploadId,
      id: value.id,
      url: value.url,
      dataUrl: value.dataUrl,
      value: resolved,
      kind: value.kind,
      role: value.role,
      mimeType: value.mimeType,
      name: value.name,
      order,
      weight: value.weight,
      metadata: value.metadata,
      source: { type: manifestMediaSourceType(value), value: resolved, mimeType: value.mimeType },
      ephemeral: value.ephemeral,
    };
  });
}

function manifestMediaSourceType(value: MediaReference): string {
  if (value.dataUrl) return "data";
  if (value.url) return "url";
  return "unknown";
}

export function applyManifestTransform(value: unknown, transformInput: string, request: GenerationRequest): unknown {
  const transform = transformInput.trim().toLowerCase();
  if (transform === "bool" || transform === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const text = value.trim().toLowerCase();
      return text === "true" || text === "1" || text === "yes";
    }
    if (typeof value === "number") return value !== 0;
    return false;
  }
  if (transform === "int" || transform === "integer") {
    if (typeof value === "number") return Math.trunc(value);
    if (typeof value === "string") {
      const parsed = Number.parseInt(value.trim(), 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }
  if (transform === "omit_zero") {
    if (typeof value === "number" && value === 0) return null;
    if (typeof value === "string" && (value.trim() === "0" || value.trim() === "")) return null;
  }
  const cleanModel = manifestModelId(request);
  if (transform.startsWith("omit_unless_model_contains:")) {
    const needle = transform.slice("omit_unless_model_contains:".length).trim().toLowerCase();
    if (!needle || !cleanModel.includes(needle)) return null;
  }
  if (transform.startsWith("omit_if_model_contains:")) {
    const needle = transform.slice("omit_if_model_contains:".length).trim().toLowerCase();
    if (needle && cleanModel.includes(needle)) return null;
  }
  if (transform.startsWith("omit_unless_model_equals:")) {
    const target = transform.slice("omit_unless_model_equals:".length).trim().toLowerCase();
    if (!target || cleanModel !== target) return null;
  }
  if (transform.startsWith("omit_if_model_equals:")) {
    const target = transform.slice("omit_if_model_equals:".length).trim().toLowerCase();
    if (target && cleanModel === target) return null;
  }
  const isText = typeof value === "string";
  const text = isText ? (value as string) : "";
  if (transform === "omit_empty" && (!isText || !text.trim())) return null;
  if (
    transform === "omit_auto" &&
    (!isText || !text.trim() || text.trim().toLowerCase() === "auto" || text.trim().toLowerCase() === "default")
  ) {
    return null;
  }
  if (!isText) return value;
  switch (transform) {
    case "trim":
      return text.trim();
    case "lower":
    case "lowercase":
      return text.toLowerCase();
    case "upper":
    case "uppercase":
      return text.toUpperCase();
    case "resolution_p":
      return /^\d+$/.test(text.trim()) ? `${text.trim()}p` : text;
    case "video-resolution":
    case "video_resolution":
    case "videoresolution":
      return normalizeLegacyManifestVideoResolution(text);
    default:
      return value;
  }
}

function normalizeLegacyManifestVideoResolution(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  for (const character of normalized) {
    if (character < "0" || character > "9") return normalized;
  }
  return `${normalized}p`;
}

export function pathValue(payload: Record<string, unknown>, path: string): unknown {
  return manifestPathValue(payload, path);
}

export function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function firstPathValue(payload: Record<string, unknown>, ...paths: string[]): string {
  for (const path of paths) {
    const value = pathValue(payload, path);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** 解析 data:<mime>;base64,<data> 形式的内嵌媒体。 */
export function manifestSplitDataUrl(value: string): { mimeType: string; data: string } | null {
  if (!value.startsWith("data:")) return null;
  const separator = value.indexOf(",");
  if (separator <= "data:".length) return null;
  const header = value.slice(5, separator);
  if (!header.endsWith(";base64")) return null;
  const data = value.slice(separator + 1);
  if (!data) return null;
  return { mimeType: header.slice(0, -";base64".length), data };
}
