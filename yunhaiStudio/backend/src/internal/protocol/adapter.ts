// 对应 backend/internal/protocol/adapter.go

import type {
  CreateResult,
  MediaReference,
  Metadata,
  PollContext,
  PollResult,
  RequestContext,
  RequestSpec,
} from "./types";
import { unavailable } from "./errors";

export interface AgentRequestContext {
  baseUrl: string;
  model: string;
  request: Record<string, unknown>;
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: string;
  thoughtSignature: string;
}

export interface AgentResult {
  text: string;
  reasoning: string;
  toolCalls: AgentToolCall[];
}

/**
 * 适配器只负责协议翻译。凭据、出站安全、轮询租约、计费、结果下载与任务恢复由宿主负责。
 */
export interface Adapter {
  Metadata(): Metadata;
  BuildCreate(context: RequestContext): Promise<RequestSpec>;
  ParseCreate(body: Uint8Array): Promise<CreateResult>;
  BuildPoll(context: PollContext): Promise<RequestSpec>;
  ParsePoll(context: PollContext, body: Uint8Array): Promise<PollResult>;
  BuildCancel(context: PollContext): Promise<RequestSpec>;
  AgentAvailable?(): boolean;
  ResultAvailable?(): boolean;
  BuildResult?(context: PollContext): Promise<RequestSpec>;
  BuildAgent?(context: AgentRequestContext): Promise<RequestSpec>;
  ParseAgent?(body: Uint8Array): Promise<AgentResult>;
  UploadKinds?(): string[];
  BuildUpload?(context: RequestContext, media: MediaReference): Promise<RequestSpec>;
  ParseUpload?(body: Uint8Array): Promise<string>;
}

/** 对应 Go 的 UnavailableAdapter：所有操作都返回统一的不可用错误。 */
export class UnavailableAdapter implements Adapter {
  constructor(readonly info: Metadata) {}

  Metadata(): Metadata {
    return this.info;
  }

  BuildCreate(): Promise<RequestSpec> {
    return Promise.reject(unavailable(this.info));
  }

  ParseCreate(): Promise<CreateResult> {
    return Promise.reject(unavailable(this.info));
  }

  BuildPoll(): Promise<RequestSpec> {
    return Promise.reject(unavailable(this.info));
  }

  ParsePoll(): Promise<PollResult> {
    return Promise.reject(unavailable(this.info));
  }

  BuildCancel(): Promise<RequestSpec> {
    return Promise.reject(unavailable(this.info));
  }
}

export type { CreateResult, PollContext, PollResult, RequestContext, RequestSpec };
