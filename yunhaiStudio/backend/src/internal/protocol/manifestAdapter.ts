// 对应 backend/internal/protocol/manifest_adapter.go
// 声明式插件的运行期适配器：按清单组装请求、解析响应中的任务 ID、状态与媒体。

import crypto from "node:crypto";
import {
  defaultValue,
  evaluateManifestValue,
  manifestArray,
  manifestFloat,
  manifestInt,
  manifestObject,
  manifestString,
  manifestTruthy,
} from "./expression";
import { firstPathJsonValue, manifestError } from "./manifest";
import {
  MediaUploadIDKey,
  buildManifestOperation,
  buildManifestOperationWithEnv,
  firstPathValue,
  manifestMediaValues,
  manifestRequestValues,
  pathValue,
} from "./manifestRequest";
import { decodeObject, firstString, normalizeStatus } from "./builtin";
import { applyImageParameters } from "./imageParameters";
import type { AgentRequestContext, AgentResult, Adapter } from "./adapter";
import type {
  CreateResult,
  Manifest,
  ManifestAgentResponse,
  ManifestAuth,
  ManifestOperation,
  ManifestResponse,
  ManifestUpload,
  MediaReference,
  Metadata,
  PollContext,
  PollResult,
  RequestContext,
  RequestSpec,
  Result,
  Status,
} from "./types";

const maxStreamedJsonAudioBytes = 64 << 20;

export class ManifestAdapter implements Adapter {
  constructor(private readonly manifest: Manifest) {}

  Metadata(): Metadata {
    return this.manifest.metadata ?? { id: "", version: "", name: "", vendor: "", categories: [], scopes: [], enabled: true, installable: false };
  }

  AgentAvailable(): boolean {
    return Boolean(this.manifest.agent && this.manifest.agentResponse);
  }

  ResultAvailable(): boolean {
    return Boolean(this.manifest.resultOperation);
  }

  UploadKinds(): string[] {
    return this.manifest.upload?.kinds ?? [];
  }

  async BuildUpload(context: RequestContext, media: MediaReference): Promise<RequestSpec> {
    const upload = this.requireUpload();
    const values = manifestMediaValues([media]);
    const result = buildManifestOperationWithEnv(upload, this.manifest.auth ?? emptyAuth(), context.request, "", { media: values[0] });
    if (result.error) throw result.error;
    return result.spec as RequestSpec;
  }

  async ParseUpload(body: Uint8Array): Promise<string> {
    const upload = this.requireUpload();
    const payload = decodeObject(body);
    const id = manifestResponseString(upload.id, { response: payload });
    if (!id) throw new Error("上游素材上传没有返回素材 ID");
    return id;
  }

  async BuildCreate(context: RequestContext): Promise<RequestSpec> {
    if ((this.manifest.contributes?.providers ?? []).length === 0) {
      throw new Error(`plugin ${this.Metadata().id} does not provide a provider`);
    }
    const applied = applyImageParameters(context.request, this.Metadata().imageParameters ?? []);
    if (applied.error) throw applied.error;
    validateManifestRequest(this.manifest.validations ?? [], applied.request);
    const result = buildManifestOperation(this.manifest.create ?? emptyOperation(), this.manifest.auth ?? emptyAuth(), applied.request, "");
    if (result.error) throw result.error;
    return result.spec as RequestSpec;
  }

  async BuildAgent(context: AgentRequestContext): Promise<RequestSpec> {
    if (!this.manifest.agent) throw new Error(`protocol ${this.Metadata().id} has no agent operation`);
    const request = { model: context.model, extra: { agent: context.request } };
    const result = buildManifestOperation(this.manifest.agent, this.manifest.auth ?? emptyAuth(), request, "");
    if (result.error) throw result.error;
    return result.spec as RequestSpec;
  }

  async ParseAgent(body: Uint8Array): Promise<AgentResult> {
    const response = this.manifest.agentResponse;
    if (!response) throw new Error(`protocol ${this.Metadata().id} has no agent response mapping`);
    const payload = decodeObject(body);
    const result: AgentResult = {
      text: firstPathValue(payload, ...(response.textPaths ?? [])),
      reasoning: firstPathValue(payload, ...(response.reasoningPaths ?? [])),
      toolCalls: [],
    };
    if (!response.toolCallsPath) return result;
    const items = pathValue(payload, response.toolCallsPath);
    const list = Array.isArray(items) ? items : [];
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
      const object = item as Record<string, unknown>;
      const call = {
        id: firstPathValue(object, ...(response.toolCallIdPaths ?? [])),
        name: firstPathValue(object, ...(response.toolCallNamePaths ?? [])),
        arguments: firstPathJsonValue(object, ...(response.toolCallArgsPaths ?? [])),
        thoughtSignature: "",
      };
      for (const path of response.toolCallSignaturePaths ?? []) {
        const signature = pathValue(object, path);
        if (typeof signature === "string" && signature) {
          call.thoughtSignature = signature;
          break;
        }
      }
      if (call.name.trim()) {
        if (!call.id.trim()) call.id = syntheticAgentToolCallId(body, index);
        result.toolCalls.push(call);
      }
    }
    return result;
  }

  ParseCreate(body: Uint8Array): Promise<CreateResult> {
    return this.ParseCreateWithRequest({ model: "" }, body);
  }

  async ParseCreateWithRequest(request: { model: string; extra?: Record<string, unknown> }, body: Uint8Array): Promise<CreateResult> {
    const response = this.manifest.response ?? {};
    if (response.streamedJsonAudio) {
      const format = request.extra ? manifestString(request.extra.audioFormat) : "";
      return streamedJsonAudioCreateResult(body, response.resultKind ?? "", format);
    }
    if (response.binaryPayload) return binaryPayloadCreateResult(response.resultKind ?? "", body);
    const payload = decodeObject(body);
    return this.parse(payload, { baseUrl: "", model: request.model, request, taskId: "" });
  }

  async BuildPoll(context: PollContext): Promise<RequestSpec> {
    if (!this.manifest.poll) throw new Error(`protocol ${this.Metadata().id} has no poll operation`);
    const request = { ...context.request, model: context.model };
    const result = buildManifestOperation(this.manifest.poll, this.manifest.auth ?? emptyAuth(), request, context.taskId);
    if (result.error) throw result.error;
    return result.spec as RequestSpec;
  }

  async ParsePoll(context: PollContext, body: Uint8Array): Promise<PollResult> {
    const payload = decodeObject(body);
    const result = this.parse(payload, context);
    return {
      taskId: result.taskId,
      status: result.status,
      result: result.result,
      message: result.message,
      stage: result.stage,
      queueAhead: result.queueAhead,
    };
  }

  async BuildCancel(context: PollContext): Promise<RequestSpec> {
    if (!this.manifest.cancel) throw new Error(`protocol ${this.Metadata().id} does not support cancellation`);
    const request = { ...context.request, model: context.model };
    const result = buildManifestOperation(this.manifest.cancel, this.manifest.auth ?? emptyAuth(), request, context.taskId);
    if (result.error) throw result.error;
    return result.spec as RequestSpec;
  }

  async BuildResult(context: PollContext): Promise<RequestSpec> {
    if (!this.manifest.resultOperation) throw new Error(`protocol ${this.Metadata().id} has no result operation`);
    const request = { ...context.request, model: context.model };
    const result = buildManifestOperation(this.manifest.resultOperation, this.manifest.auth ?? emptyAuth(), request, context.taskId);
    if (result.error) throw result.error;
    return result.spec as RequestSpec;
  }

  private parse(payload: Record<string, unknown>, context: PollContext): CreateResult {
    const response: ManifestResponse = this.manifest.response ?? {};
    const env = { response: payload, taskId: context.taskId, request: manifestRequestValues(context.request) };
    let id = manifestResponseString(response.taskId, env);
    if (!id) id = firstPathValue(payload, ...(response.taskIdPaths ?? []));
    if (!id) id = context.taskId;
    let statusText = manifestResponseString(response.status, env);
    if (!statusText) statusText = firstPathValue(payload, ...(response.statusPaths ?? []));
    let status: Status = normalizeStatus(statusText) || "pending";
    let message = manifestResponseString(response.message, env);
    if (!message) message = firstPathValue(payload, ...(response.messagePaths ?? []));
    if (manifestError(payload, ...(response.errorPaths ?? []))) status = "failed";
    const stage = manifestResponseString(response.stage, env);
    let queueAhead = -1;
    if (response.queueAhead !== undefined && response.queueAhead !== null) {
      const evaluated = evaluateManifestValue(response.queueAhead, env);
      if (!evaluated.error && evaluated.value !== null && evaluated.value !== undefined) {
        queueAhead = Math.max(0, manifestInt(evaluated.value));
      }
    }
    const result: Result = {
      text: manifestResponseString(response.text, env),
      reasoning: manifestResponseString(response.reasoning, env),
      images: [],
      videos: [],
      audios: [],
    };
    if (!result.text) result.text = firstPathValue(payload, ...(response.textPaths ?? []));
    if (!result.reasoning) result.reasoning = firstPathValue(payload, ...(response.reasoningPaths ?? []));
    result.images = manifestResponseMedia(response.images, env, "image", Boolean(response.resultEphemeral));
    result.videos = manifestResponseMedia(response.videos, env, "video", Boolean(response.resultEphemeral));
    result.audios = manifestResponseMedia(response.audios, env, "audio", Boolean(response.resultEphemeral));
    if (response.usage !== undefined && response.usage !== null) {
      const evaluated = evaluateManifestValue(response.usage, env);
      if (!evaluated.error) result.usage = manifestObject(evaluated.value);
    }
    const paths = [...(response.resultUrlPaths ?? []), ...(response.resultPaths ?? [])];
    for (const path of paths) {
      for (const value of mediaPathValues(payload, path)) {
        const item: MediaReference = { url: value, kind: response.resultKind, ephemeral: Boolean(response.resultEphemeral) };
        if (response.resultKind === "image") result.images!.push(item);
        else if (response.resultKind === "audio") result.audios!.push(item);
        else result.videos!.push(item);
      }
    }
    const hasMedia = (result.images?.length ?? 0) + (result.videos?.length ?? 0) + (result.audios?.length ?? 0) > 0;
    if (status === "pending" && ((result.text ?? "") !== "" || hasMedia)) status = "succeeded";
    const empty =
      !result.text && !result.reasoning && (result.images?.length ?? 0) === 0 && (result.videos?.length ?? 0) === 0 && (result.audios?.length ?? 0) === 0;
    return {
      taskId: id,
      status,
      result: empty ? undefined : result,
      message,
      stage,
      queueAhead,
    };
  }

  private requireUpload(): ManifestUpload {
    const upload = this.manifest.upload;
    if (!upload) throw new Error(`protocol ${this.Metadata().id} has no upload operation`);
    return upload;
  }
}

function emptyAuth(): ManifestAuth {
  return { type: "none", field: "" };
}

function emptyOperation(): ManifestOperation {
  return { method: "POST", path: "" };
}

export function syntheticAgentToolCallId(body: Uint8Array, index: number): string {
  const digest = crypto.createHash("sha256").update(`${Buffer.from(body).toString("latin1")}#${index}`).digest();
  return `call_${digest.subarray(0, 8).toString("hex")}`;
}

/** 解析豆包单向 TTS 的分块 JSON 响应：兼容拼接 JSON 对象与 SSE 风格 data 帧。 */
export function streamedJsonAudioCreateResult(body: Uint8Array, resultKind: string, format: string): CreateResult {
  if (body.length === 0) throw new Error("streamed JSON audio response is empty");
  if (body.length > maxStreamedJsonAudioBytes) throw new Error(`streamed JSON audio response exceeds ${maxStreamedJsonAudioBytes} bytes`);
  const frames = decodeJsonFrames(body);
  const audioChunks: Buffer[] = [];
  let usage: Record<string, unknown> | undefined;
  for (const frame of frames) {
    const code = manifestString(firstNonNilPathValue(frame, "code", "status_code", "statusCode")).trim().toLowerCase();
    if (code && !["0", "ok", "success", "succeeded"].includes(code)) {
      let message = manifestString(firstNonNilPathValue(frame, "message", "msg", "error.message")).trim();
      if (!message) message = "上游返回失败状态";
      throw new Error(`流式音频合成失败（code ${code}）：${message}`);
    }
    const value = firstPathValue(frame, "data", "audio", "audio.data");
    if (value) audioChunks.push(decodeStreamedAudioBase64(value));
    const rawUsage = pathValue(frame, "usage");
    if (rawUsage !== null && rawUsage !== undefined) usage = manifestObject(rawUsage);
  }
  const audio = Buffer.concat(audioChunks);
  if (audio.length === 0) throw new Error("streamed JSON audio response contains no audio data");
  const mimeType = streamedAudioMimeType(format);
  const reference: MediaReference = { dataUrl: `data:${mimeType};base64,${audio.toString("base64")}`, mimeType };
  return { status: "succeeded", result: { audios: [reference], usage } };
}

function decodeJsonFrames(body: Uint8Array): Record<string, unknown>[] {
  const frames: Record<string, unknown>[] = [];
  const text = new TextDecoder().decode(body);
  for (const segment of splitJsonObjects(text)) {
    try {
      const frame = JSON.parse(segment);
      if (frame && typeof frame === "object" && !Array.isArray(frame)) frames.push(frame);
    } catch {
      break;
    }
  }
  if (frames.length > 0) return frames;
  for (const rawLine of text.split("\n")) {
    let line = rawLine.trim().replace(/\r$/, "");
    line = line.replace(/^data:/, "").trim();
    if (!line || line === "[DONE]") continue;
    const frame = JSON.parse(line);
    frames.push(frame);
  }
  if (frames.length === 0) throw new Error("no JSON frames found");
  return frames;
}

function splitJsonObjects(text: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        segments.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return segments;
}

function streamedAudioMimeType(format: string): string {
  switch (format.trim().toLowerCase()) {
    case "wav":
      return "audio/wav";
    case "ogg_opus":
    case "ogg":
      return "audio/ogg";
    case "pcm":
      return "audio/pcm";
    default:
      return "audio/mpeg";
  }
}

function firstNonNilPathValue(payload: Record<string, unknown>, ...paths: string[]): unknown {
  for (const path of paths) {
    const value = pathValue(payload, path);
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function decodeStreamedAudioBase64(value: string): Buffer {
  const trimmed = value.trim();
  if (!trimmed) return Buffer.alloc(0);
  return Buffer.from(trimmed, "base64");
}

/** 把同步二进制响应包装为单个媒体结果。 */
function binaryPayloadCreateResult(resultKind: string, body: Uint8Array): CreateResult {
  if (body.length === 0) throw new Error("binary payload response is empty");
  const mimeType = detectContentType(body);
  const reference: MediaReference = { dataUrl: `data:${mimeType};base64,${Buffer.from(body).toString("base64")}`, mimeType };
  const result: Result = {};
  if (resultKind === "audio") result.audios = [reference];
  else if (resultKind === "image") result.images = [reference];
  else if (resultKind === "video") result.videos = [reference];
  else throw new Error(`binary payload response requires resultKind image, video or audio, got "${resultKind}"`);
  return { status: "succeeded", result };
}

/** ACT: 对齐 http.DetectContentType 的常见媒体类型；未知类型回退 application/octet-stream。 */
function detectContentType(body: Uint8Array): string {
  const header = Buffer.from(body.subarray(0, 12));
  if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (header[0] === 0xff && header[1] === 0xd8) return "image/jpeg";
  if (header.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (header.subarray(0, 4).toString("latin1") === "RIFF" && header.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (header.subarray(0, 4).toString("latin1") === "RIFF" && header.subarray(8, 12).toString("latin1") === "WAVE") return "audio/wav";
  if (header.subarray(0, 4).toString("latin1") === "OggS") return "audio/ogg";
  if (header.subarray(0, 3).toString("latin1") === "ID3") return "audio/mpeg";
  if (header.subarray(4, 8).toString("latin1") === "ftyp") return "video/mp4";
  return "application/octet-stream";
}

export function validateManifestRequest(rules: Array<{ assert: unknown; message: string }>, request: { model: string }): void {
  if (rules.length === 0) return;
  const env = { request: manifestRequestValues(request as Parameters<typeof manifestRequestValues>[0]) };
  for (const rule of rules) {
    const evaluated = evaluateManifestValue(rule.assert, env);
    if (evaluated.error) throw new Error(`协议参数校验表达式错误：${evaluated.error.message}`);
    if (!manifestTruthy(evaluated.value)) throw new Error(rule.message.trim());
  }
}

function manifestResponseString(template: unknown, env: Record<string, unknown>): string {
  if (template === null || template === undefined) return "";
  const evaluated = evaluateManifestValue(template, env);
  if (evaluated.error) return "";
  return manifestArray(evaluated.value)
    .map((item) => manifestString(item).trim())
    .filter(Boolean)
    .join("");
}

function manifestResponseMedia(template: unknown, env: Record<string, unknown>, kind: string, ephemeral: boolean): MediaReference[] {
  if (template === null || template === undefined) return [];
  const evaluated = evaluateManifestValue(template, env);
  if (evaluated.error) return [];
  return mediaReferencesFromManifestValue(evaluated.value, kind, ephemeral);
}

export function mediaReferencesFromManifestValue(value: unknown, kind: string, ephemeral: boolean): MediaReference[] {
  const result: MediaReference[] = [];
  for (const item of manifestArray(value)) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (!trimmed) continue;
      const reference: MediaReference = { kind, ephemeral };
      if (trimmed.startsWith("data:")) reference.dataUrl = trimmed;
      else reference.url = trimmed;
      result.push(reference);
      continue;
    }
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const typed = item as Record<string, unknown>;
    const reference: MediaReference = {
      id: manifestString(typed.id),
      url: manifestString(typed.url),
      dataUrl: manifestString(typed.dataUrl),
      kind: defaultValue(manifestString(typed.kind), kind),
      role: manifestString(typed.role),
      mimeType: manifestString(typed.mimeType),
      name: manifestString(typed.name),
      order: manifestInt(typed.order),
      weight: manifestFloat(typed.weight),
      ephemeral: ephemeral || manifestTruthy(typed.ephemeral),
    };
    if (!reference.url) {
      reference.url = firstString(typed, "file_url", "fileUrl", "image_url", "imageUrl", "video_url", "videoUrl", "audio_url", "audioUrl", "uri");
    }
    if (!reference.dataUrl) reference.dataUrl = firstString(typed, "data_url", "b64_json");
    reference.dataUrl = normalizeManifestInlineDataUrl(reference.dataUrl ?? "", reference.kind ?? "", firstString(typed, "output_format", "mime_type", "mimeType"));
    if (reference.url || reference.dataUrl) result.push(reference);
  }
  return result;
}

function normalizeManifestInlineDataUrl(value: string, kind: string, formatHint: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("data:")) return trimmed;
  return `data:${manifestInlineMediaMime(kind, formatHint)};base64,${trimmed}`;
}

function manifestInlineMediaMime(kind: string, formatHint: string): string {
  const hint = formatHint.trim().toLowerCase();
  const direct: Record<string, string> = {
    "image/png": "image/png",
    "image/jpeg": "image/jpeg",
    "image/webp": "image/webp",
    "image/gif": "image/gif",
    "audio/mpeg": "audio/mpeg",
    "audio/wav": "audio/wav",
    "audio/ogg": "audio/ogg",
    "video/mp4": "video/mp4",
    "video/webm": "video/webm",
    "image/jpg": "image/jpeg",
    "audio/mp3": "audio/mpeg",
    png: "image/png",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    mp3: "audio/mpeg",
    mpeg: "audio/mpeg",
    wav: "audio/wav",
    mp4: "video/mp4",
    webm: "video/webm",
  };
  if (direct[hint]) return direct[hint];
  const normalizedKind = kind.trim().toLowerCase();
  if (normalizedKind === "audio") return "audio/mpeg";
  if (normalizedKind === "video") return "video/mp4";
  return "image/png";
}

const manifestMdImageRegex = /!\[[^\]]*\]\(([^)\s]+)\)/g;
const manifestHtmlVideoRegex = /<video[^>]+src=['"]([^'"]+)['"]/gi;

export function mediaPathValues(payload: Record<string, unknown>, path: string): string[] {
  const value = pathValue(payload, path);
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    const markdown = [...trimmed.matchAll(manifestMdImageRegex)].map((match) => match[1]).filter(Boolean);
    if (markdown.length > 0) return markdown;
    const videos = [...trimmed.matchAll(manifestHtmlVideoRegex)].map((match) => match[1]).filter(Boolean);
    if (videos.length > 0) return videos;
    return [trimmed];
  }
  if (!Array.isArray(value)) return [];
  const values: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) values.push(item.trim());
    else if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      const url = firstString(item as Record<string, unknown>, "url", "file_url", "fileUrl", "video_url", "videoUrl", "image_url", "imageUrl");
      if (url) values.push(url);
    }
  }
  return values;
}

export { MediaUploadIDKey };
export type { AgentResult, CreateResult, ManifestAgentResponse, ManifestUpload, PollResult, RequestSpec };
