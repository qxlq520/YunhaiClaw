// 对应 backend/internal/protocol/builtin_agnes.go
// Agnes 视频模型的内置适配：v2.0 / v2.5 两代请求体与分辨率、比例规范化。

import { defaultValue } from "./expression";
import {
  BuiltinAdapter,
  compactMap,
  defaultInt,
  firstString,
  jsonSpec,
  mediaValue,
  mediaValues,
  mergeExtra,
  metadata,
  normalizeStatus,
  object,
  orderedFrameImages,
  splitVideoImages,
} from "./builtin";
import { CapabilityVideo } from "./types";
import type { Adapter } from "./adapter";
import type { CreateResult, GenerationRequest, MediaReference, PollContext, PollResult, RequestSpec } from "./types";

export function agnesAdapter(): Adapter {
  const info = metadata(
    "agnes-video",
    "Agnes 视频",
    "Agnes AI",
    CapabilityVideo,
    "POST /v1/videos",
    "GET /agnesapi?video_id={id}&model_name={model}",
    "application/json",
  );
  info.version = "1.2.0";
  info.description = "Agnes AI 官方异步视频协议，支持 Agnes Video V2.0、2.5 与 2.5 Flash。";
  info.requiresPublicMediaUrls = true;
  info.parameters = [
    { name: "model", type: "string", required: true, mapping: "model", description: "官方模型 ID：agnes-video-v2.0、agnes-video-2.5 或 agnes-video-2.5-flash。" },
    { name: "prompt", type: "string", required: true, mapping: "prompt", description: "视频生成提示词。" },
    { name: "images", type: "media[]", mapping: "first_frame/last_frame/images/image/extra_body.image", description: "2.5 系列按 mode 映射为关键帧或参考图；V2.0 映射为 image 或关键帧数组。" },
    { name: "videos", type: "media[]", mapping: "videos", description: "仅 Agnes Video 2.5 reference 模式支持，Flash 与 V2.0 不支持。" },
    { name: "audios", type: "media[]", mapping: "audios", description: "Agnes Video 2.5 系列 reference 模式支持。" },
    { name: "duration", type: "integer", mapping: "seconds/num_frames", description: "2.5 系列映射为字符串 seconds；V2.0 按帧率换算 num_frames。" },
    { name: "aspectRatio", type: "string", values: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], mapping: "aspect_ratio", description: "2.5 系列画幅比例；历史像素尺寸会在插件边界转换为对应比例。" },
    { name: "resolution", type: "string", values: ["720P", "960P", "2K"], mapping: "size", description: "通用层分辨率档位，映射为 Agnes 的 size；Flash 固定 720P。" },
  ];
  return new BuiltinAdapter(info, {
    create: buildAgnesCreate,
    parseCreate: parseAgnesCreate,
    poll: (context) => {
      const model = (context.model ?? "").trim() || (context.request.model ?? "").trim();
      let path = `/agnesapi?video_id=${encodeURIComponent(context.taskId)}`;
      if (model) path += `&model_name=${encodeURIComponent(model)}`;
      return { method: "GET", path, originPath: true, contentType: "" };
    },
    parsePoll: parseAgnesPoll,
  });
}

function buildAgnesCreate(request: GenerationRequest): RequestSpec {
  const model = request.model.trim();
  switch (model) {
    case "agnes-video-v2.0":
      return jsonSpec("POST", "/v1/videos", buildAgnesV20Body(request));
    case "agnes-video-2.5":
    case "agnes-video-2.5-flash":
      return jsonSpec("POST", "/v1/videos", buildAgnesV25Body(request));
    default:
      throw new Error(`Agnes 不支持模型 "${model}"`);
  }
}

function buildAgnesV25Body(request: GenerationRequest): Record<string, unknown> {
  const images = request.images ?? [];
  const videos = request.videos ?? [];
  const audios = request.audios ?? [];
  const { frames, references } = splitVideoImages(images);
  if (frames.length > 0 && (references.length > 0 || videos.length + audios.length > 0)) {
    throw new Error("Agnes 2.5 不能同时混用首尾帧和角色、视频或音频参考素材");
  }
  let mode = firstString(request.extra ?? {}, "mode");
  if (!mode) {
    switch ((request.operation ?? "").trim()) {
      case "reference_to_video":
      case "audio_to_video":
        mode = "reference";
        break;
      case "image_to_video":
        mode = "keyframe";
        break;
      default:
        if (videos.length > 0 || audios.length > 0 || references.length > 0) mode = "reference";
        else if (frames.length > 0) mode = "keyframe";
        else if (images.length > 2) mode = "reference";
        else if (images.length > 0) mode = "keyframe";
        else mode = "text";
    }
  }
  if (mode !== "text" && mode !== "keyframe" && mode !== "reference") {
    throw new Error("Agnes 2.5 mode 必须是 text、keyframe 或 reference");
  }
  const seconds = defaultInt(request.duration ?? 0, 5);
  if (seconds < 4 || seconds > 12) throw new Error("Agnes 2.5 seconds 必须在 4 到 12 秒之间");
  const size = normalizeAgnesV25Resolution(defaultValue(request.resolution, firstString(request.extra ?? {}, "size")));
  const aspectRatio = normalizeAgnesV25AspectRatio(defaultValue(request.aspectRatio, firstString(request.extra ?? {}, "aspect_ratio")));
  if (request.model === "agnes-video-2.5-flash") {
    if (size !== "720P") throw new Error("Agnes Video 2.5 Flash 仅支持 720P");
    if (images.length > 5) throw new Error("Agnes Video 2.5 Flash 最多支持 5 张参考图");
    if (videos.length > 0) throw new Error("Agnes Video 2.5 Flash 不支持参考视频");
  } else if (size !== "720P" && size !== "960P" && size !== "2K") {
    throw new Error("Agnes Video 2.5 size 必须是 720P、960P 或 2K");
  }
  const body: Record<string, unknown> = {
    model: request.model,
    prompt: request.prompt,
    mode,
    seconds: String(seconds),
    size,
    aspect_ratio: aspectRatio,
    n: 1,
  };
  const extra = request.extra ?? {};
  if ("seed" in extra) body.seed = extra.seed;
  switch (mode) {
    case "text":
      if (images.length + videos.length + audios.length > 0) throw new Error("Agnes 2.5 text 模式不接受参考媒体");
      break;
    case "keyframe": {
      if (images.length === 0 || images.length > 2 || videos.length + audios.length > 0) {
        throw new Error("Agnes 2.5 keyframe 模式需要 1 到 2 张图片，且不接受音视频参考");
      }
      if (splitVideoImages(images).references.length > 0) {
        throw new Error("Agnes 2.5 keyframe 模式不能混用角色或风格参考图");
      }
      const ordered = orderedFrameImages(images);
      if (ordered.length === 0) throw new Error("Agnes 2.5 keyframe 模式缺少首帧图片");
      body.first_frame = mediaValue(ordered[0]);
      if (ordered.length > 1) body.last_frame = mediaValue(ordered[1]);
      break;
    }
    case "reference": {
      if (images.length + videos.length + audios.length === 0) throw new Error("Agnes 2.5 reference 模式至少需要一种参考媒体");
      if (images.length > 0) body.images = mediaValues(images);
      if (audios.length > 0) body.audios = mediaValues(audios);
      if (videos.length > 0) body.videos = videos.map((video) => ({ url: mediaValue(video) }));
      break;
    }
  }
  return compactMap(body);
}

function normalizeAgnesV25Resolution(value: string): string {
  switch (value.trim().toLowerCase()) {
    case "":
    case "auto":
    case "720":
    case "720p":
      return "720P";
    case "960":
    case "960p":
      return "960P";
    case "2k":
    case "1440":
    case "1440p":
      return "2K";
    default:
      throw new Error("Agnes Video 2.5 分辨率必须是 720P、960P 或 2K");
  }
}

function normalizeAgnesV25AspectRatio(value: string): string {
  const normalized = value.replaceAll("×", "x").trim().toLowerCase();
  if (!normalized || normalized === "auto") return "16:9";
  const ratios = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
  if (ratios.includes(normalized)) return normalized;
  const dimensions = normalized.split("x");
  if (dimensions.length === 2) {
    const width = Number.parseInt(dimensions[0], 10);
    const height = Number.parseInt(dimensions[1], 10);
    if (!Number.isNaN(width) && !Number.isNaN(height) && width > 0 && height > 0 && width <= 1_000_000 && height <= 1_000_000) {
      for (const ratio of ratios) {
        const [ratioWidth, ratioHeight] = ratio.split(":").map((part) => Number.parseInt(part, 10));
        if (width * ratioHeight === height * ratioWidth) return ratio;
      }
    }
  }
  throw new Error("Agnes Video 2.5 画幅必须是 21:9、16:9、4:3、1:1、3:4 或 9:16");
}

function buildAgnesV20Body(request: GenerationRequest): Record<string, unknown> {
  const images = request.images ?? [];
  const extra = request.extra ?? {};
  if ((request.videos?.length ?? 0) + (request.audios?.length ?? 0) > 0) {
    throw new Error("Agnes Video V2.0 不支持参考视频或音频");
  }
  const referenceImages = splitVideoImages(images).references;
  if (request.operation === "reference_to_video" || referenceImages.length > 0) {
    throw new Error("Agnes Video V2.0 不支持角色或风格参考图模式，请改用 Agnes Video 2.5");
  }
  const body: Record<string, unknown> = { model: request.model, prompt: request.prompt };
  mergeExtra(body, extra, "mode", "width", "height", "num_frames", "frame_rate", "num_inference_steps", "seed", "negative_prompt");
  if ((request.duration ?? 0) > 0) {
    let frameRate = 24;
    const configured = extra.frame_rate;
    if (typeof configured === "number" && configured >= 1 && configured <= 60) frameRate = Math.trunc(configured);
    if (!("frame_rate" in extra)) body.frame_rate = frameRate;
    if (!("num_frames" in extra)) {
      const target = (request.duration ?? 0) * frameRate;
      let frames = Math.trunc((target - 1 + 4) / 8) * 8 + 1;
      if (frames > 441) frames = 441;
      body.num_frames = frames;
    }
  }
  const orderedImages = orderedFrameImages(images);
  if (orderedImages.length === 1) {
    body.image = mediaValue(orderedImages[0]);
  } else if (orderedImages.length > 1) {
    const extraBody: Record<string, unknown> = { ...object(extra.extra_body) };
    extraBody.image = mediaValues(orderedImages);
    extraBody.mode = "keyframes";
    body.extra_body = extraBody;
  } else {
    const configured = object(extra.extra_body);
    if (Object.keys(configured).length > 0) body.extra_body = configured;
  }
  return compactMap(body);
}

function parseAgnesCreate(payload: Record<string, unknown>): CreateResult {
  const id = firstString(payload, "video_id", "task_id", "id");
  if (!id) throw new Error("Agnes 创建响应没有 video_id");
  return { taskId: id, status: normalizeStatus(firstString(payload, "status")) || "pending" };
}

function parseAgnesPoll(context: PollContext, payload: Record<string, unknown>): PollResult {
  const id = defaultValue(firstString(payload, "video_id", "task_id", "id"), context.taskId);
  const status = normalizeStatus(firstString(payload, "status")) || "processing";
  let message = firstString(payload, "message", "detail");
  const failure = object(payload.error);
  if (Object.keys(failure).length > 0) {
    message = defaultValue(firstString(failure, "message", "detail", "code"), message);
  }
  if (status === "failed") return { taskId: id, status, message: defaultValue(message, "Agnes 视频生成失败") };
  if (status !== "succeeded") return { taskId: id, status, message };
  let videoUrl = firstString(object(payload.metadata), "url");
  if (!videoUrl) videoUrl = firstString(payload, "url");
  if (!videoUrl) throw new Error("Agnes 完成响应没有返回视频 URL");
  const videos: MediaReference[] = [{ url: videoUrl, kind: "video" }];
  return { taskId: id, status, result: { videos } };
}
