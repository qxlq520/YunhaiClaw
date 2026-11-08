// 对应 backend/internal/protocol/builtin.go
// 随应用内置的协议适配器集合：文本三线、各视频供应商与通用异步媒体轮询。

import { dataMime, dataPayload, defaultValue } from "./expression";
import { unavailable } from "./errors";
import { ManifestAdapter } from "./manifestAdapter";
import { agnesAdapter } from "./builtinAgnes";
import { Registry } from "./registry";
import { textWireForOperation } from "./textwire";
import type { Adapter } from "./adapter";
import {
  CapabilityAudio,
  CapabilityImage,
  CapabilityText,
  CapabilityVideo,
  SurfaceAdminSystemChannel,
  SurfaceAgent,
  SurfaceCanvas,
  SurfaceCreation,
  SurfaceUserCustomChannel,
} from "./types";
import type {
  Capability,
  CreateResult,
  GenerationRequest,
  Manifest,
  ManifestAuth,
  MediaReference,
  Metadata,
  Parameter,
  PollContext,
  PollResult,
  RequestSpec,
  Status,
  Surface,
} from "./types";

export interface BuiltinHooks {
  create?: (request: GenerationRequest) => Promise<RequestSpec> | RequestSpec;
  parseCreate?: (payload: Record<string, unknown>) => Promise<CreateResult> | CreateResult;
  poll?: (context: PollContext) => Promise<RequestSpec> | RequestSpec;
  parsePoll?: (context: PollContext, payload: Record<string, unknown>) => Promise<PollResult> | PollResult;
  cancel?: (context: PollContext) => Promise<RequestSpec> | RequestSpec;
}

export class BuiltinAdapter implements Adapter {
  constructor(
    private readonly info: Metadata,
    private readonly hooks: BuiltinHooks,
  ) {}

  Metadata(): Metadata {
    return this.info;
  }

  async BuildCreate(context: { request: GenerationRequest }): Promise<RequestSpec> {
    if (!this.hooks.create) throw unavailable(this.info);
    return this.hooks.create(context.request);
  }

  async ParseCreate(body: Uint8Array): Promise<CreateResult> {
    if (!this.hooks.parseCreate) throw unavailable(this.info);
    return this.hooks.parseCreate(decodeObject(body));
  }

  async BuildPoll(context: PollContext): Promise<RequestSpec> {
    if (!this.hooks.poll) throw unavailable(this.info);
    return this.hooks.poll(context);
  }

  async ParsePoll(context: PollContext, body: Uint8Array): Promise<PollResult> {
    if (!this.hooks.parsePoll) throw unavailable(this.info);
    return this.hooks.parsePoll(context, decodeObject(body));
  }

  async BuildCancel(context: PollContext): Promise<RequestSpec> {
    if (!this.hooks.cancel) throw new Error(`protocol ${this.info.id} does not support cancellation`);
    return this.hooks.cancel(context);
  }
}

let builtinRegistry: Registry | null = null;

/** 进程级内置协议注册表；安装器可在启动阶段继续扩展。 */
export function builtins(): Registry {
  if (builtinRegistry) return builtinRegistry;
  builtinRegistry = new Registry([
    openAIChatAdapter(),
    openAIResponsesAdapter(),
    claudeAdapter(),
    openAIVideosAdapter(),
    newAPIChannel1Adapter(),
    newAPIVideosAdapter(),
    xAIVideosAdapter(),
    arkVideosAdapter(),
    jimengVideosAdapter(),
    geminiVeoAdapter(),
    novitaVideosAdapter(),
    miniMaxVideosAdapter(),
    agnesAdapter(),
  ]);
  return builtinRegistry;
}

/** 返回声明式内置贡献的规范清单；宿主型内置由安装器生成。 */
export function bundledManifest(id: string): { manifest: Manifest | null } {
  const adapter = builtins().get(id);
  if (!adapter || !(adapter instanceof ManifestAdapter)) return { manifest: null };
  return { manifest: (adapter as unknown as { manifest: Manifest }).manifest };
}

function allSurfaces(): Surface[] {
  return [SurfaceAdminSystemChannel, SurfaceUserCustomChannel, SurfaceCanvas, SurfaceCreation, SurfaceAgent];
}

export function metadata(id: string, name: string, vendor: string, capability: Capability, create: string, poll: string, contentType: string): Metadata {
  const info: Metadata = {
    id,
    version: "1.0.0",
    name,
    vendor,
    categories: [capability],
    scopes: allSurfaces(),
    create,
    poll,
    contentType,
    enabled: true,
    installable: true,
  };
  if (capability === CapabilityText) info.textWire = textWireForOperation(create);
  return info;
}

function mediaParams(): Parameter[] {
  return [
    { name: "model", type: "string", required: true, mapping: "model" },
    { name: "prompt", type: "string", required: true, mapping: "prompt" },
    { name: "images", type: "media[]", mapping: "provider-specific" },
    { name: "imageCount", type: "integer", mapping: "provider-specific" },
    { name: "aspectRatio", type: "string", mapping: "provider-specific" },
    { name: "resolution", type: "string", mapping: "provider-specific" },
    { name: "quality", type: "string", mapping: "provider-specific" },
  ];
}

function videoParams(): Parameter[] {
  return [
    { name: "model", type: "string", required: true, mapping: "model", description: "上游模型标识。" },
    { name: "prompt", type: "string", required: true, mapping: "prompt", description: "视频生成提示词。" },
    { name: "images", type: "media[]", mapping: "provider-specific", description: "参考图片，由协议适配器转换为上游要求的 URL、Data URL 或 multipart 文件。" },
    { name: "videos", type: "media[]", mapping: "provider-specific", description: "参考视频；仅在上游协议支持时发送。" },
    { name: "audios", type: "media[]", mapping: "provider-specific", description: "参考音频或声音；仅在上游协议支持时发送。" },
    { name: "duration", type: "integer", mapping: "provider-specific", description: "视频时长，单位由上游协议决定。" },
    { name: "aspectRatio", type: "string", mapping: "provider-specific", description: "画幅比例或上游尺寸字段。" },
    { name: "resolution", type: "string", mapping: "provider-specific", description: "输出分辨率档位。" },
    { name: "generateAudio", type: "boolean", mapping: "provider-specific", description: "是否同时生成音频。" },
    { name: "watermark", type: "boolean", mapping: "provider-specific", description: "是否添加水印。" },
  ];
}

function openAIChatAdapter(): Adapter {
  const info = metadata("chat-completion", "OpenAI Chat Completions", "OpenAI", CapabilityText, "POST /v1/chat/completions", "", "application/json");
  info.parameters = [
    { name: "model", type: "string", required: true, mapping: "model", description: "上游模型标识。" },
    { name: "prompt", type: "string", required: true, mapping: "messages[0].content", description: "默认转换为一条 user message；extra.messages 可替换完整消息数组。" },
    { name: "stream", type: "boolean", mapping: "stream", description: "是否请求流式响应。" },
  ];
  return new BuiltinAdapter(info, {
    create: (request) => {
      const body: Record<string, unknown> = { model: request.model, messages: [{ role: "user", content: request.prompt }] };
      mergeExtra(body, request.extra, "messages", "temperature", "top_p", "max_tokens", "stream", "tools", "response_format");
      return jsonSpec("POST", "/v1/chat/completions", body);
    },
    parseCreate: parseChatResponse,
  });
}

function openAIResponsesAdapter(): Adapter {
  const info = metadata("openai-response", "OpenAI Responses", "OpenAI", CapabilityText, "POST /v1/responses", "", "application/json");
  info.parameters = [
    { name: "model", type: "string", required: true, mapping: "model", description: "上游模型标识。" },
    { name: "prompt", type: "string", required: true, mapping: "input", description: "默认作为 input 字符串；extra.input 可提供结构化输入。" },
    { name: "stream", type: "boolean", mapping: "stream", description: "是否请求流式响应。" },
  ];
  return new BuiltinAdapter(info, {
    create: (request) => {
      const body: Record<string, unknown> = { model: request.model, input: request.prompt };
      mergeExtra(body, request.extra, "input", "instructions", "temperature", "top_p", "max_output_tokens", "stream", "tools", "text");
      return jsonSpec("POST", "/v1/responses", body);
    },
    parseCreate: parseResponsesResponse,
  });
}

function claudeAdapter(): Adapter {
  const info = metadata("claude-api", "Claude API", "Anthropic", CapabilityText, "POST /v1/messages", "", "application/json");
  info.parameters = [
    { name: "model", type: "string", required: true, mapping: "model", description: "Anthropic 模型标识。" },
    { name: "prompt", type: "string", required: true, mapping: "messages[0].content", description: "默认转换为一条 user message；extra.messages 可替换完整消息数组。" },
    { name: "stream", type: "boolean", mapping: "stream", description: "是否请求流式响应。" },
  ];
  info.legacyAliases = ["anthropic-messages", "claude-messages"];
  return new BuiltinAdapter(info, {
    create: (request) => {
      const body: Record<string, unknown> = {
        model: request.model,
        max_tokens: 4096,
        messages: [{ role: "user", content: request.prompt }],
      };
      mergeExtra(body, request.extra, "max_tokens", "system", "messages", "temperature", "top_p", "top_k", "tools", "tool_choice", "stream");
      const spec = jsonSpec("POST", "/v1/messages", body);
      spec.headers = { "anthropic-version": "2023-06-01" };
      return spec;
    },
    parseCreate: parseClaudeResponse,
  });
}

function openAIVideosAdapter(): Adapter {
  const info = metadata("newapi", "OpenAI Videos", "OpenAI compatible", CapabilityVideo, "POST /v1/videos", "GET /v1/videos/{task_id}", "multipart/form-data");
  info.legacyAliases = ["openai-video", "openai-videos"];
  info.parameters = openAIVideoParams();
  return videoAdapter(info, (request) => {
    const body: Record<string, unknown> = { model: request.model, prompt: request.prompt };
    if ((request.duration ?? 0) > 0) body.seconds = String(request.duration);
    if (request.aspectRatio) body.size = request.aspectRatio;
    if ((request.images?.length ?? 0) > 0) body.input_reference = mediaValues(request.images ?? []);
    return { method: "POST", path: "/v1/videos", contentType: "multipart/form-data", body };
  });
}

function openAIVideoParams(): Parameter[] {
  return [
    { name: "model", type: "string", required: true, mapping: "model", description: "Sora 等视频模型标识。" },
    { name: "prompt", type: "string", required: true, mapping: "prompt", description: "视频生成提示词。" },
    { name: "images", type: "media[]", mapping: "input_reference", description: "可选参考图，作为 multipart 文件上传到 input_reference。" },
    { name: "duration", type: "integer", mapping: "seconds", description: "视频时长，单位为秒。" },
    { name: "aspectRatio", type: "string", mapping: "size", description: "视频尺寸，例如 1280x720；该协议使用 size 而不是独立的 aspect_ratio。" },
    { name: "videos", type: "media[]", mapping: "unsupported", description: "OpenAI Videos 当前适配器不发送参考视频。" },
    { name: "audios", type: "media[]", mapping: "unsupported", description: "OpenAI Videos 当前适配器不发送参考音频。" },
    { name: "resolution", type: "string", mapping: "unsupported", description: "分辨率通过 size 表达。" },
    { name: "generateAudio", type: "boolean", mapping: "unsupported", description: "当前适配器不额外发送该字段。" },
    { name: "watermark", type: "boolean", mapping: "unsupported", description: "当前适配器不额外发送该字段。" },
  ];
}

function newAPIVideosAdapter(): Adapter {
  const info = metadata(
    "newapi-channel-2",
    "NewAPI Video Generations",
    "NewAPI",
    CapabilityVideo,
    "POST /v1/video/generations",
    "GET /v1/video/generations/{task_id}",
    "application/json",
  );
  info.legacyAliases = ["newapi-video-generations"];
  info.parameters = videoParams();
  return videoAdapter(info, (request) => {
    const body: Record<string, unknown> = {
      model: request.model,
      prompt: request.prompt,
      seconds: String(defaultInt(request.duration ?? 0, 6)),
      aspect_ratio: defaultValue(request.aspectRatio, "16:9"),
    };
    copyIf(body, "resolution", request.resolution ?? "");
    if (request.generateAudio) body.generate_audio = true;
    if ((request.images?.length ?? 0) > 0) body.image_urls = mediaValues(request.images ?? []);
    if ((request.videos?.length ?? 0) > 0) body.video_urls = mediaValues(request.videos ?? []);
    if ((request.audios?.length ?? 0) > 0) body.audio_urls = mediaValues(request.audios ?? []);
    return jsonSpec("POST", "/v1/video/generations", body);
  });
}

function newAPIChannel1Adapter(): Adapter {
  const info = metadata("newapi-channel-1", "NewAPI 媒体任务", "NewAPI", CapabilityVideo, "POST /v1/videos", "GET /v1/videos/{task_id}", "application/json");
  info.parameters = videoParams();
  return videoAdapter(info, (request) => {
    const media: Array<Record<string, string>> = [];
    for (const image of request.images ?? []) media.push({ type: mediaRole(image, "reference_image"), url: mediaValue(image) });
    for (const video of request.videos ?? []) media.push({ type: "reference_video", url: mediaValue(video) });
    for (const audio of request.audios ?? []) media.push({ type: "reference_voice", url: mediaValue(audio) });
    const input: Record<string, unknown> = { prompt: request.prompt };
    if (media.length > 0) input.media = media;
    const parameters: Record<string, unknown> = {
      resolution: defaultValue(request.resolution, "720P"),
      ratio: defaultValue(request.aspectRatio, "16:9"),
      duration: defaultInt(request.duration ?? 0, 5),
    };
    if (request.watermark) parameters.watermark = true;
    return jsonSpec("POST", "/v1/videos", { model: request.model, input, parameters });
  });
}

function xAIVideosAdapter(): Adapter {
  const info = metadata("xai-video", "xAI 官方视频", "xAI", CapabilityVideo, "POST /v1/videos/generations", "GET /v1/videos/{request_id}", "application/json");
  info.parameters = videoParams();
  return videoAdapter(info, (request) => {
    const body: Record<string, unknown> = {
      model: request.model,
      prompt: request.prompt,
      duration: defaultInt(request.duration ?? 0, 6),
      aspect_ratio: defaultValue(request.aspectRatio, "16:9"),
      resolution: defaultValue(request.resolution, "720p"),
    };
    const { frames, references, unspecified } = splitVideoImages(request.images ?? []);
    if (frames.length > 0 && references.length > 0) throw new Error("xAI 视频协议不能同时混用首尾帧和角色参考图");
    if (frames.length > 1) throw new Error("xAI 视频协议最多支持 1 张起始图，不支持尾帧输入");
    if (frames.length === 1) {
      body.image = { url: mediaValue(frames[0]) };
    } else if (references.length > 0) {
      body.reference_images = references.map((image) => ({ url: mediaValue(image) }));
    } else if (unspecified.length === 1) {
      body.image = { url: mediaValue(unspecified[0]) };
    } else if (unspecified.length > 1) {
      body.reference_images = unspecified.map((image) => ({ url: mediaValue(image) }));
    }
    return jsonSpec("POST", "/v1/videos/generations", body);
  });
}

function arkVideosAdapter(): Adapter {
  const info = metadata(
    "volcengine-ark-video",
    "火山方舟视频",
    "Volcengine Ark",
    CapabilityVideo,
    "POST /api/v3/contents/generations/tasks",
    "GET /api/v3/contents/generations/tasks/{task_id}",
    "application/json",
  );
  info.parameters = videoParams();
  return videoAdapter(info, (request) => {
    if ((request.images?.length ?? 0) > 9 || (request.videos?.length ?? 0) > 3 || (request.audios?.length ?? 0) > 3) {
      throw new Error("火山方舟全模态参考最多支持 9 张图片、3 个视频和 3 个音频");
    }
    if ((request.audios?.length ?? 0) > 0 && (request.images?.length ?? 0) === 0 && (request.videos?.length ?? 0) === 0) {
      throw new Error("火山方舟全模态参考不支持纯音频或文本+音频，请同时添加参考图片或参考视频");
    }
    const content: unknown[] = [{ type: "text", text: request.prompt }];
    for (const image of request.images ?? []) {
      content.push({ type: "image_url", image_url: { url: mediaValue(image) }, role: mediaRole(image, "reference_image") });
    }
    for (const video of request.videos ?? []) content.push({ type: "video_url", video_url: { url: mediaValue(video) }, role: "reference_video" });
    for (const audio of request.audios ?? []) content.push({ type: "audio_url", audio_url: { url: mediaValue(audio) }, role: "reference_audio" });
    const body: Record<string, unknown> = {
      model: request.model,
      content,
      ratio: defaultValue(request.aspectRatio, "16:9"),
      resolution: defaultValue(request.resolution, "720p"),
      duration: defaultInt(request.duration ?? 0, 5),
    };
    if (request.generateAudio) body.generate_audio = true;
    if (request.watermark) body.watermark = true;
    return jsonSpec("POST", "/api/v3/contents/generations/tasks", body);
  });
}

function jimengVideosAdapter(): Adapter {
  const info = metadata(
    "volcengine-jimeng-video",
    "即梦官方视频",
    "Volcengine Jimeng",
    CapabilityVideo,
    "POST CVSync2AsyncSubmitTask",
    "POST CVSync2AsyncGetResult",
    "application/json + AK/SK signature",
  );
  info.parameters = videoParams();
  info.auth = { type: "volcengine-v4", field: "apiKey", secretField: "secretKey", service: "cv", region: "cn-north-1" };
  return videoAdapterWithPoll(
    info,
    (request) => {
      const body: Record<string, unknown> = { req_key: request.model, prompt: request.prompt };
      if ((request.images?.length ?? 0) > 0) body.image_urls = mediaValues(request.images ?? []);
      mergeExtra(body, request.extra, "req_key", "prompt", "image_urls", "duration", "ratio", "resolution");
      return jsonSpec("POST", "/CVSync2AsyncSubmitTask", body);
    },
    (context) => jsonSpec("POST", "/CVSync2AsyncGetResult", { req_key: context.model, task_id: context.taskId }),
  );
}

function geminiVeoAdapter(): Adapter {
  const info = metadata(
    "gemini-veo",
    "Gemini Veo",
    "Google",
    CapabilityVideo,
    "POST /v1beta/models/{model}:predictLongRunning",
    "GET /v1beta/{operation_name}",
    "application/json",
  );
  info.parameters = videoParams();
  return new BuiltinAdapter(info, {
    create: (request) => {
      if (hasVideoImageRole(request.images ?? [], "reference_image")) {
        throw new Error("Gemini Veo 当前不支持角色或风格参考图生视频，请改用支持 reference_to_video 的模型");
      }
      const instance: Record<string, unknown> = { prompt: request.prompt };
      const images = request.images ?? [];
      if (images.length > 0) {
        const image = images[0];
        instance.image = { inlineData: { mimeType: dataMime(image.dataUrl ?? ""), data: dataPayload(image.dataUrl ?? "") } };
      }
      const body = {
        instances: [instance],
        parameters: compactMap({
          aspectRatio: request.aspectRatio,
          durationSeconds: request.duration,
          resolution: request.resolution,
          generateAudio: request.generateAudio,
        }),
      };
      return jsonSpec("POST", `/v1beta/models/${encodeURIComponent(request.model)}:predictLongRunning`, body);
    },
    parseCreate: parseGeminiVeoCreate,
    poll: (context) => {
      let operation = context.taskId.replace(/^\/+/, "");
      if (!operation.startsWith("operations/")) operation = `operations/${operation}`;
      return { method: "GET", path: `/v1beta/${operation}`, contentType: "" };
    },
    parsePoll: parseGeminiVeoPoll,
  });
}

function novitaVideosAdapter(): Adapter {
  const info = metadata(
    "novita-video",
    "Novita 视频",
    "Novita",
    CapabilityVideo,
    "POST /v3/video/create",
    "GET /v3/async/task-result?task_id={id}",
    "application/json",
  );
  info.parameters = videoParams();
  return videoAdapter(info, (request) => {
    if (hasVideoImageRole(request.images ?? [], "reference_image")) {
      throw new Error("Novita 视频当前不支持角色或风格参考图生视频，请改用支持 reference_to_video 的模型");
    }
    const body: Record<string, unknown> = {
      model_name: request.model,
      prompt: request.prompt,
      duration: defaultInt(request.duration ?? 0, 5),
      aspect_ratio: defaultValue(request.aspectRatio, "16:9"),
    };
    if ((request.images?.length ?? 0) > 0) body.image_url = mediaValue((request.images ?? [])[0]);
    return jsonSpec("POST", "/v3/video/create", body);
  });
}

function miniMaxVideosAdapter(): Adapter {
  const info = metadata(
    "minimax-video",
    "MiniMax 视频",
    "MiniMax",
    CapabilityVideo,
    "POST /v2/video_generation",
    "GET /v2/query/video_generation/{task_id}",
    "application/json",
  );
  info.parameters = videoParams();
  return videoAdapter(info, (request) => {
    const content: unknown[] = [{ type: "text", text: request.prompt }];
    for (const image of request.images ?? []) {
      content.push({ type: "image_url", image_url: { url: mediaValue(image) }, role: mediaRole(image, "reference_image") });
    }
    for (const video of request.videos ?? []) content.push({ type: "video_url", video_url: { url: mediaValue(video) }, role: "reference_video" });
    for (const audio of request.audios ?? []) content.push({ type: "audio_url", audio_url: { url: mediaValue(audio) }, role: "reference_audio" });
    const body: Record<string, unknown> = {
      model: request.model,
      prompt: request.prompt,
      duration: defaultInt(request.duration ?? 0, 6),
      content,
    };
    mergeExtra(body, request.extra, "model", "prompt", "duration", "content", "resolution", "aspect_ratio");
    return jsonSpec("POST", "/v2/video_generation", body);
  });
}

function videoAdapter(info: Metadata, create: (request: GenerationRequest) => RequestSpec): Adapter {
  return asyncMediaAdapterWithPoll(info, CapabilityVideo, create, (context) => {
    let path = (info.poll ?? "").trim();
    const space = path.indexOf(" ");
    if (space > 0) path = path.slice(space + 1).trim();
    const escaped = encodeURIComponent(context.taskId);
    path = path.replace("{task_id}", escaped);
    path = path.replace("{request_id}", escaped);
    path = path.replace("{id}", encodeURIComponent(context.taskId));
    return { method: "GET", path, contentType: "" };
  });
}

function videoAdapterWithPoll(
  info: Metadata,
  create: (request: GenerationRequest) => RequestSpec,
  poll: (context: PollContext) => RequestSpec,
): Adapter {
  return asyncMediaAdapterWithPoll(info, CapabilityVideo, create, poll);
}

function asyncMediaAdapterWithPoll(
  info: Metadata,
  capability: Capability,
  create: (request: GenerationRequest) => RequestSpec,
  poll: (context: PollContext) => RequestSpec,
): Adapter {
  return new BuiltinAdapter(info, {
    create,
    parseCreate: parseAsyncCreate,
    poll,
    parsePoll: (context, payload) => parseAsyncMediaPoll(context, payload, capability),
  });
}

export function jsonSpec(method: string, path: string, body: unknown): RequestSpec {
  return { method, path, contentType: "application/json", body };
}

function parseChatResponse(payload: Record<string, unknown>): CreateResult {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  if (choices.length === 0) throw new Error("chat response has no choices");
  const choice = object(choices[0]);
  const message = object(choice.message);
  return { status: "succeeded", result: { text: firstString(message, "content"), usage: object(payload.usage) } };
}

function parseResponsesResponse(payload: Record<string, unknown>): CreateResult {
  let text = firstString(payload, "output_text", "text");
  if (!text && Array.isArray(payload.output)) {
    for (const item of payload.output) {
      const message = object(item);
      text = firstString(message, "text", "content");
      if (text) break;
    }
  }
  return { status: "succeeded", result: { text, usage: object(payload.usage) } };
}

function parseClaudeResponse(payload: Record<string, unknown>): CreateResult {
  const content = Array.isArray(payload.content) ? payload.content : [];
  let text = "";
  for (const item of content) {
    const message = object(item);
    if (firstString(message, "type") === "text") text += firstString(message, "text");
  }
  return { status: "succeeded", result: { text, usage: object(payload.usage) } };
}

function parseGeminiVeoCreate(payload: Record<string, unknown>): CreateResult {
  const id = firstString(payload, "name");
  if (!id) throw new Error("Gemini Veo response has no operation name");
  return { taskId: id, status: "pending" };
}

function parseGeminiVeoPoll(context: PollContext, payload: Record<string, unknown>): PollResult {
  const id = defaultValue(firstString(payload, "name"), context.taskId);
  const failure = object(payload.error);
  if (Object.keys(failure).length > 0) {
    const message = firstString(failure, "message", "status") || "Gemini Veo operation failed";
    return { taskId: id, status: "failed", message };
  }
  if (payload.done !== true) return { taskId: id, status: "processing" };
  const videos = geminiVeoVideos(object(payload.response));
  if (videos.length === 0) return { taskId: id, status: "succeeded" };
  return { taskId: id, status: "succeeded", result: { videos } };
}

function geminiVeoVideos(response: Record<string, unknown>): MediaReference[] {
  if (Object.keys(response).length === 0) return [];
  const containers = [response];
  for (const key of ["generateVideoResponse", "generate_video_response"]) {
    const nested = object(response[key]);
    if (Object.keys(nested).length > 0) containers.push(nested);
  }
  const result: MediaReference[] = [];
  for (const container of containers) {
    for (const key of ["generatedVideos", "generated_videos", "generatedSamples", "generated_samples", "videos"]) {
      const items = Array.isArray(container[key]) ? (container[key] as unknown[]) : [];
      for (const item of items) {
        const entry = object(item);
        let video = object(entry.video);
        if (Object.keys(video).length === 0) video = entry;
        const value = firstString(video, "uri", "url", "videoUri", "video_url");
        if (value) result.push({ url: value, kind: "video" });
      }
    }
  }
  return result;
}

export function parseAsyncCreate(payload: Record<string, unknown>): CreateResult {
  let id = firstString(payload, "id", "task_id", "taskId", "request_id");
  let status = normalizeStatus(firstString(payload, "status", "state"));
  const task = object(payload.task);
  if (Object.keys(task).length > 0) {
    id = defaultValue(firstString(task, "id", "task_id", "taskId", "request_id"), id);
    status = normalizeStatus(defaultValue(firstString(task, "status", "state"), status));
  }
  const data = object(payload.data);
  if (Object.keys(data).length > 0) {
    id = defaultValue(firstString(data, "id", "task_id", "taskId", "request_id"), id);
    status = normalizeStatus(defaultValue(firstString(data, "status", "state"), status));
  }
  if (!id) throw new Error("async response has no task id");
  return { taskId: id, status: status || "pending", message: firstString(payload, "message", "error") };
}

function parseAsyncMediaPoll(context: PollContext, input: Record<string, unknown>, capability: Capability): PollResult {
  if (capability !== CapabilityImage && capability !== CapabilityVideo && capability !== CapabilityAudio) {
    throw new Error(`unsupported async media capability "${capability}"`);
  }
  let payload = input;
  let status = normalizeStatus(firstString(payload, "status", "state", "task_status"));
  const task = object(payload.task);
  if (Object.keys(task).length > 0) {
    status = normalizeStatus(defaultValue(firstString(task, "status", "state"), status));
    payload = mergeMaps(task, payload);
  }
  const data = object(payload.data);
  if (Object.keys(data).length > 0) {
    payload = mergeMaps(data, payload);
    status = normalizeStatus(defaultValue(firstString(data, "status", "state"), status));
  }
  if (!status) status = "processing";
  const resultKind = capability;
  let references = mediaFromArray(payload[`${resultKind}s`], capability);
  references = [...references, ...mediaFromArray(payload.data, capability)];
  const mediaObject = object(payload[resultKind]);
  if (Object.keys(mediaObject).length > 0) references = [...references, ...mediaFromArray([mediaObject], capability)];
  const content = object(payload.content);
  if (Object.keys(content).length > 0) references = [...references, ...mediaFromArray([content], capability)];
  let keys = [`${resultKind}_url`, `${resultKind}Url`, "result_url", "url"];
  if (resultKind === "video") keys = [...keys, "object"];
  const value = firstString(payload, ...keys);
  if (value) references = [...references, { url: value, kind: resultKind }];
  const result: { images?: MediaReference[]; videos?: MediaReference[]; audios?: MediaReference[] } = {};
  if (capability === CapabilityImage) result.images = references;
  else if (capability === CapabilityAudio) result.audios = references;
  else result.videos = references;
  const keepResult = status === "succeeded" && references.length > 0 ? result : undefined;
  return {
    taskId: defaultValue(firstString(payload, "id", "task_id", "taskId"), context.taskId),
    status,
    result: keepResult,
    message: firstString(payload, "message", "error", "fail_reason"),
  };
}

/** 上游任务状态词表唯一来源；宿主的旁路判断必须复用。 */
export function normalizeStatus(raw: string): Status | "" {
  switch (raw.trim().toLowerCase()) {
    case "queued":
    case "pending":
    case "created":
    case "submitted":
    case "in_queue":
    case "task_status_queued":
      return "pending";
    case "running":
    case "processing":
    case "in_progress":
    case "executing":
    case "task_status_running":
    case "task_status_processing":
      return "processing";
    case "succeeded":
    case "success":
    case "completed":
    case "complete":
    case "done":
    case "task_status_succeed":
      return "succeeded";
    case "cancelled":
    case "canceled":
    case "aborted":
      return "cancelled";
    case "failed":
    case "failure":
    case "error":
    case "expired":
    case "task_status_failed":
      return "failed";
    default:
      return "";
  }
}

export function decodeObject(body: Uint8Array): Record<string, unknown> {
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch (error) {
    throw new Error(`protocol response is not JSON: ${(error as Error).message}`);
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("protocol response is not a JSON object");
  }
  return payload as Record<string, unknown>;
}

export function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function mergeMaps(primary: Record<string, unknown>, fallback: Record<string, unknown>): Record<string, unknown> {
  return { ...fallback, ...primary };
}

export function firstString(payload: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function defaultInt(value: number, fallback: number): number {
  return value <= 0 ? fallback : value;
}

export function copyIf(body: Record<string, unknown>, key: string, value: string): void {
  if (value.trim()) body[key] = value;
}

export function mergeExtra(body: Record<string, unknown>, extra: Record<string, unknown> | undefined, ...keys: string[]): void {
  if (!extra) return;
  for (const key of keys) {
    if (key in extra) body[key] = extra[key];
  }
}

export function compactMap(body: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      if (value.trim()) result[key] = value;
    } else if (typeof value === "number") {
      if (value > 0) result[key] = value;
    } else if (typeof value === "boolean") {
      result[key] = value;
    } else if (value !== null && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

export function mediaValue(media: MediaReference): string {
  return defaultValue(media.url, media.dataUrl ?? "");
}

export function mediaRole(media: MediaReference, fallback: string): string {
  return defaultValue((media.role ?? "").trim(), fallback);
}

export function splitVideoImages(images: MediaReference[]): {
  frames: MediaReference[];
  references: MediaReference[];
  unspecified: MediaReference[];
} {
  const firstFrames: MediaReference[] = [];
  const lastFrames: MediaReference[] = [];
  const references: MediaReference[] = [];
  const unspecified: MediaReference[] = [];
  for (const image of images) {
    switch ((image.role ?? "").trim()) {
      case "first_frame":
        firstFrames.push(image);
        break;
      case "last_frame":
        lastFrames.push(image);
        break;
      case "reference_image":
        references.push(image);
        break;
      default:
        unspecified.push(image);
    }
  }
  return { frames: [...firstFrames, ...lastFrames], references, unspecified };
}

export function orderedFrameImages(images: MediaReference[]): MediaReference[] {
  const { frames, unspecified } = splitVideoImages(images);
  if (frames.length === 0) return unspecified;
  return [...frames, ...unspecified];
}

export function hasVideoImageRole(images: MediaReference[], role: string): boolean {
  return images.some((image) => (image.role ?? "").trim() === role);
}

export function mediaValues(values: MediaReference[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const item = mediaValue(value);
    if (item) result.push(item);
  }
  return result;
}

export function mediaFromArray(value: unknown, capability: Capability): MediaReference[] {
  const values = Array.isArray(value) ? value : [];
  const result: MediaReference[] = [];
  const kind = capability;
  for (const item of values) {
    if (typeof item === "string" && item.trim()) {
      result.push({ url: item.trim(), kind });
      continue;
    }
    const record = object(item);
    if (Object.keys(record).length === 0) continue;
    if (capability === CapabilityImage) {
      let encoded = firstString(record, "b64_json", "data");
      if (encoded) {
        if (!encoded.startsWith("data:")) encoded = `data:image/png;base64,${encoded}`;
        result.push({ dataUrl: encoded, kind });
        continue;
      }
    }
    const url = firstString(record, "url", "image_url", "video_url", "audio_url");
    if (url) result.push({ url, kind });
  }
  return result;
}

export { dataMime, dataPayload };

// 供后续接入自定义 provider 时复用同一套构造方式。
export type { ManifestAuth, Parameter, PollContext, RequestSpec, Surface };
