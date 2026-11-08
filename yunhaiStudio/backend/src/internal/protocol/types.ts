// 对应 backend/internal/protocol/types.go
// Go 结构体的 JSON 标签在 TS 中由序列化层处理；带方法的类型在末尾提供等价函数。

export type Capability = "text" | "image" | "video" | "audio";

export const CapabilityText: Capability = "text";
export const CapabilityImage: Capability = "image";
export const CapabilityVideo: Capability = "video";
export const CapabilityAudio: Capability = "audio";

export type Surface = "admin.system-channel" | "user.custom-channel" | "canvas" | "creation" | "agent";

export const SurfaceAdminSystemChannel: Surface = "admin.system-channel";
export const SurfaceUserCustomChannel: Surface = "user.custom-channel";
export const SurfaceCanvas: Surface = "canvas";
export const SurfaceCreation: Surface = "creation";
export const SurfaceAgent: Surface = "agent";

export type Status = "pending" | "processing" | "succeeded" | "failed" | "cancelled";

export const StatusPending: Status = "pending";
export const StatusProcessing: Status = "processing";
export const StatusSucceeded: Status = "succeeded";
export const StatusFailed: Status = "failed";
export const StatusCancelled: Status = "cancelled";

export interface MediaReference {
  id?: string;
  url?: string;
  dataUrl?: string;
  kind?: string;
  role?: string;
  mimeType?: string;
  name?: string;
  order?: number;
  weight?: number;
  metadata?: Record<string, unknown>;
  ephemeral?: boolean;
}

export interface OutputOptions {
  count?: number;
  duration?: number;
  aspectRatio?: string;
  width?: number;
  height?: number;
  resolution?: string;
  quality?: string;
  fps?: number;
  generateAudio?: boolean;
  watermark?: boolean;
  format?: string;
  options?: Record<string, unknown>;
}

export interface Message {
  role: string;
  content: unknown;
}

export interface GenerationRequest {
  capability?: Capability;
  model: string;
  prompt?: string;
  instructions?: string;
  messages?: Message[];
  inputs?: MediaReference[];
  images?: MediaReference[];
  videos?: MediaReference[];
  audios?: MediaReference[];
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  quality?: string;
  generateAudio?: boolean;
  watermark?: boolean;
  imageCount?: number;
  operation?: string;
  output?: OutputOptions;
  providerOptions?: Record<string, Record<string, unknown>>;
  imageParameters?: Record<string, unknown>;
  /** 宿主解析后的协议接口，不序列化。 */
  interfaceType?: string;
  /** 宿主解析后的上游基础地址，不序列化。 */
  baseUrl?: string;
  /** 宿主/插件解析后的创建端点路径，不序列化。 */
  linePath?: string;
  extra?: Record<string, unknown>;
}

export interface RequestContext {
  baseUrl: string;
  request: GenerationRequest;
}

export interface PollContext {
  baseUrl: string;
  model: string;
  request: GenerationRequest;
  taskId: string;
  metadata?: Record<string, unknown>;
}

export interface RequestSpec {
  method: string;
  path: string;
  originPath?: boolean;
  contentType: string;
  headers?: Record<string, string>;
  query?: Record<string, string[]>;
  body?: unknown;
  files?: RequestFilePart[];
  auth?: ManifestAuth;
}

export interface RequestFilePart {
  name: string;
  filename?: string;
  mimeType?: string;
  reference: MediaReference;
}

export interface ManifestFilePart {
  name: string;
  source: unknown;
  filename?: unknown;
  mimeType?: unknown;
}

export interface ManifestOperation {
  id?: unknown;
  method: string;
  path?: string;
  pathTemplate?: unknown;
  originPath?: boolean;
  contentType?: string;
  contentTypeTemplate?: unknown;
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  fields?: Record<string, string>;
  files?: ManifestFilePart[];
}

export interface ManifestUpload extends ManifestOperation {
  kinds: string[];
}

export interface ManifestResponse {
  taskId?: unknown;
  taskIdPaths?: string[];
  status?: unknown;
  statusPaths?: string[];
  message?: unknown;
  messagePaths?: string[];
  errorPaths?: string[];
  stage?: unknown;
  queueAhead?: unknown;
  text?: unknown;
  textPaths?: string[];
  reasoning?: unknown;
  reasoningPaths?: string[];
  images?: unknown;
  videos?: unknown;
  audios?: unknown;
  resultUrlPaths?: string[];
  resultPaths?: string[];
  resultKind?: string;
  resultEphemeral?: boolean;
  usage?: unknown;
  streamedJsonAudio?: boolean;
  binaryPayload?: boolean;
}

export interface ManifestAgentResponse {
  textPaths?: string[];
  reasoningPaths?: string[];
  toolCallsPath?: string;
  toolCallIdPaths?: string[];
  toolCallNamePaths?: string[];
  toolCallArgsPaths?: string[];
  toolCallSignaturePaths?: string[];
}


export interface CreateResult {
  taskId?: string;
  status: Status;
  result?: Result;
  message?: string;
  stage?: string;
  queueAhead?: number;
}

export interface PollResult {
  taskId?: string;
  status: Status;
  result?: Result;
  message?: string;
  stage?: string;
  queueAhead?: number;
}

export interface Result {
  images?: MediaReference[];
  videos?: MediaReference[];
  audios?: MediaReference[];
  text?: string;
  reasoning?: string;
  usage?: Record<string, unknown>;
}

export interface Parameter {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
  values?: string[];
  mapping?: string;
}

export interface Metadata {
  id: string;
  version: string;
  name: string;
  vendor: string;
  description?: string;
  categories: Capability[];
  scopes: Surface[];
  parameters?: Parameter[];
  imageParameters?: ImageParameter[];
  create?: string;
  agent?: string;
  poll?: string;
  cancel?: string;
  contentType?: string;
  documentation?: string;
  legacyAliases?: string[];
  enabled: boolean;
  installable: boolean;
  execution?: string;
  requiresPublicMediaUrls?: boolean;
  /** 上游可能排队数小时：提交后释放 worker，由任务调度按间隔回查原任务。 */
  detachedPolling?: boolean;
  /** create 以宿主幂等键作为上游任务 ID，同一键重复提交不会重复扣费，可安全重试。 */
  idempotentCreate?: boolean;
  unavailableReason?: string;
  kind?: ProviderKind;
  textWire?: string;
  agentWire?: string;
  auth?: ManifestAuth;
}

export type ProviderKind = "generation" | "processing" | "";

export const ProviderKindGeneration: ProviderKind = "generation";
export const ProviderKindProcessing: ProviderKind = "processing";

/** 判断 provider 是否为处理类（画质增强、字幕擦除、插帧等），对应 Go 的 IsProcessing。 */
export function isProcessing(kind: ProviderKind | undefined): boolean {
  return kind === ProviderKindProcessing;
}

export interface Manifest {
  apiVersion: string;
  /** 内部执行投影，不进入公开 JSON。 */
  metadata?: Metadata;
  entry?: string;
  surfaces?: string[];
  runtime?: ManifestRuntime;
  permissions?: string[];
  configuration?: ManifestConfiguration;
  contributes?: ManifestContributions;
  create?: ManifestOperation;
  upload?: ManifestUpload;
  agent?: ManifestOperation;
  poll?: ManifestOperation;
  cancel?: ManifestOperation;
  resultOperation?: ManifestOperation;
  response?: ManifestResponse;
  agentResponse?: ManifestAgentResponse;
  auth?: ManifestAuth;
  validations?: ManifestValidation[];
}

export interface ManifestRuntime {
  backend?: string;
  backendEntry?: string;
  web?: string;
}

export interface ManifestConfiguration {
  fields?: ManifestField[];
}

export interface ManifestField {
  name: string;
  type: string;
  label?: string;
  required?: boolean;
  secret?: boolean;
  default?: unknown;
  description?: string;
  values?: string[];
}

export interface ManifestContributions {
  smsProviders?: ManifestSMSProvider[];
  providers?: ManifestProvider[];
  paymentProviders?: ManifestPaymentProvider[];
  workflows?: ManifestWorkflow[];
  canvasNodes?: ManifestCanvasNode[];
  transforms?: ManifestTransform[];
  commands?: ManifestCommand[];
  assetSources?: string[];
  usageObservers?: string[];
  aiCapabilities?: string[];
  agents?: string[];
  importExport?: string[];
}

export interface ManifestSMSProvider {
  id: string;
  label: string;
}

export interface ManifestPaymentProvider {
  id: string;
  label: string;
  icon: string;
  checkoutMode: string;
  expiryPolicy: ManifestPaymentExpiryPolicy;
  identityFields?: string[];
  notificationSuccess?: ManifestPaymentResponse;
  notificationFailure?: ManifestPaymentResponse;
  methods?: ManifestPaymentMethod[];
  methodsField?: string;
}

export interface ManifestPaymentMethod {
  id: string;
  label: string;
  icon?: string;
}

export interface ManifestPaymentExpiryPolicy {
  defaultMinutes: number;
  minMinutes: number;
  maxMinutes: number;
}

export interface ManifestPaymentResponse {
  status?: number;
  contentType?: string;
  body?: string;
}

export interface ManifestProvider {
  id: string;
  label: string;
  kind?: ProviderKind;
  capabilities: Capability[];
  scopes: Surface[];
  baseUrl?: string;
  requiresPublicMediaUrls?: boolean;
  detachedPolling?: boolean;
  idempotentCreate?: boolean;
  auth?: ManifestAuth;
  parameters?: Parameter[];
  imageParameters?: ImageParameter[];
  validations?: ManifestValidation[];
  create: ManifestOperation;
  upload?: ManifestUpload;
  agent?: ManifestOperation;
  poll?: ManifestOperation;
  cancel?: ManifestOperation;
  result?: ManifestOperation;
  response: ManifestResponse;
  agentResponse?: ManifestAgentResponse;
}

export interface ManifestAuth {
  type: string;
  field: string;
  secretField?: string;
  header?: string;
  prefix?: string;
  query?: string;
  username?: string;
  service?: string;
  region?: string;
}

export interface ManifestValidation {
  assert: unknown;
  message: string;
}

export interface ManifestWorkflow {
  id: string;
  label: string;
  providerId: string;
  capability: Capability;
  parameters: Parameter[];
  defaults?: Record<string, unknown>;
}

export interface ManifestCanvasNode {
  id: string;
  label: string;
  defaultTitle: string;
  defaultSize: Record<string, number>;
  schema: Record<string, unknown>;
  renderer: string;
}

export interface ManifestTransform {
  id: string;
  input: string;
  output: string;
  runtime: string;
}

export interface ManifestCommand {
  id: string;
  label: string;
}

/** 对应 Go 的 RequestSpec.Validate。 */
export function validateRequestSpec(spec: RequestSpec): Error | null {
  if (!spec.method || !spec.path) return new Error("protocol request spec is incomplete");
  if ((spec.files?.length ?? 0) > 0 && spec.contentType !== "multipart/form-data") {
    return new Error("protocol file parts require multipart/form-data");
  }
  return null;
}

export interface ManifestWire {
  apiVersion: string;
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  documentation?: string;
  entry?: string;
  surfaces?: string[];
  enabled: boolean;
  installable?: boolean;
  runtime?: ManifestRuntime;
  permissions?: string[];
  configuration?: ManifestConfiguration;
  contributes?: ManifestContributions;
}

/** 对应 Go 的 Manifest.MarshalJSON：公开的插件契约结构。 */
export function manifestToWire(manifest: Manifest): ManifestWire {
  const metadata = manifest.metadata ?? emptyMetadata();
  return {
    apiVersion: manifest.apiVersion,
    id: metadata.id,
    name: metadata.name,
    version: metadata.version,
    author: metadata.vendor,
    description: metadata.description,
    documentation: metadata.documentation,
    entry: manifest.entry,
    surfaces: manifest.surfaces,
    enabled: metadata.enabled,
    installable: metadata.installable,
    runtime: manifest.runtime,
    permissions: manifest.permissions,
    configuration: manifest.configuration,
    contributes: manifest.contributes,
  };
}

/** 对应 Go 的 Manifest.UnmarshalJSON；enabled 缺省为 true。 */
export function manifestFromWire(data: unknown): Manifest {
  const wire = (data ?? {}) as Partial<ManifestWire>;
  const enabled = wire.enabled === undefined ? true : Boolean(wire.enabled);
  return {
    apiVersion: wire.apiVersion ?? "",
    entry: wire.entry,
    surfaces: wire.surfaces,
    runtime: wire.runtime,
    permissions: wire.permissions,
    configuration: wire.configuration,
    contributes: wire.contributes,
    metadata: {
      id: wire.id ?? "",
      name: wire.name ?? "",
      version: wire.version ?? "",
      vendor: wire.author ?? "",
      description: wire.description ?? "",
      documentation: wire.documentation ?? "",
      enabled,
      installable: Boolean(wire.installable),
      categories: [],
      scopes: [],
    },
  };
}

export function emptyMetadata(): Metadata {
  return { id: "", version: "", name: "", vendor: "", categories: [], scopes: [], enabled: true, installable: false };
}

// ImageParameter 定义在 imageParameters.ts，这里统一再导出，避免调用方多路径引用。
import type { ImageParameter } from "./imageParameters";

export type { ImageParameter };
