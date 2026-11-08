// 对应 backend/internal/protocol/manifest.go

import type {
  Adapter,
  AgentRequestContext,
  AgentResult,
  CreateResult,
  PollContext,
  PollResult,
  RequestContext,
  RequestSpec,
} from "./adapter";
import { UnavailableAdapter } from "./adapter";
import { unavailable } from "./errors";
import { defaultValue, pathValue } from "./expression";
import { validateImageParameters } from "./imageParameters";
import { ManifestAdapter } from "./manifestAdapter";
import { textWireForPath } from "./textwire";
import {
  CapabilityAudio,
  CapabilityImage,
  CapabilityText,
  CapabilityVideo,
  ProviderKindGeneration,
  ProviderKindProcessing,
  SurfaceAdminSystemChannel,
  SurfaceAgent,
  SurfaceCanvas,
  SurfaceCreation,
  SurfaceUserCustomChannel,
  emptyMetadata,
  manifestFromWire,
} from "./types";
import type {
  Capability,
  Manifest,
  ManifestContributions,
  ManifestOperation,
  ManifestProvider,
  Metadata,
  Surface,
} from "./types";

export type AdapterResolver = (name: string) => Adapter | null;

/** 宿主用于把内置执行引擎绑定到 manifest；上传插件必须走声明式路径。 */
export function loadInstalledPlugin(data: Uint8Array, resolve: AdapterResolver | null): { adapter: Adapter | null; error: Error | null } {
  const loaded = loadInstalledProviders(data, resolve);
  if (loaded.error) return { adapter: null, error: loaded.error };
  if (loaded.adapters.length === 0) return { adapter: null, error: new Error("plugin does not provide an executable provider") };
  return { adapter: loaded.adapters[0], error: null };
}

export function loadInstalledProviders(data: Uint8Array, resolve: AdapterResolver | null): { adapters: Adapter[]; error: Error | null } {
  const decoded = decodeManifest(data);
  if (decoded.error || !decoded.manifest) return { adapters: [], error: decoded.error };
  const manifest = decoded.manifest;
  const providers = manifest.contributes?.providers ?? [];
  if ((manifest.runtime?.backend ?? "").trim().startsWith("host:")) {
    if (providers.length !== 1) return { adapters: [], error: new Error("host-backed plugin must declare exactly one provider") };
    if (!resolve) {
      return { adapters: [], error: new Error(`plugin "${manifest.metadata?.id ?? ""}" requires a host execution engine`) };
    }
    const name = (manifest.runtime?.backend ?? "").trim().slice("host:".length);
    const adapter = resolve(name);
    if (!adapter) return { adapters: [], error: new Error(`plugin host execution "${name}" is unavailable`) };
    const validated = validateManifest(manifest);
    if (validated) return { adapters: [], error: validated };
    const normalized = normalizeManifest(manifest);
    if (normalized) return { adapters: [], error: normalized };
    return { adapters: [new MetadataAdapter(manifest.metadata ?? emptyMetadata(), adapter)], error: null };
  }
  if (providers.length === 0) {
    const adapter = new ManifestAdapter({ ...manifest, runtime: { ...manifest.runtime, backend: "declarative" } });
    return { adapters: [adapter], error: null };
  }
  const adapters: Adapter[] = [];
  for (let index = 0; index < providers.length; index += 1) {
    const providerManifest = prepareProviderManifest(manifest, index);
    if (providerManifest.error || !providerManifest.manifest) {
      return { adapters: [], error: providerManifest.error };
    }
    adapters.push(new ManifestAdapter(providerManifest.manifest));
  }
  return { adapters, error: null };
}

function validatePluginMetadata(metadata: Metadata): Error | null {
  if (!metadata.id.trim() || !metadata.version.trim() || !validManifestIdentifier(metadata.id)) {
    return new Error("protocol plugin metadata is invalid");
  }
  if (metadata.categories.length === 0 || metadata.scopes.length === 0) {
    return new Error("protocol plugin metadata requires categories and scopes");
  }
  for (const capability of metadata.categories) {
    if (![CapabilityText, CapabilityImage, CapabilityVideo, CapabilityAudio].includes(capability)) {
      return new Error(`unsupported protocol capability "${capability}"`);
    }
  }
  for (const scope of metadata.scopes) {
    if (
      ![SurfaceAdminSystemChannel, SurfaceUserCustomChannel, SurfaceCanvas, SurfaceCreation, SurfaceAgent].includes(scope)
    ) {
      return new Error(`unsupported protocol scope "${scope}"`);
    }
  }
  return null;
}

/** 对应 Go 的 metadataAdapter：用插件声明的元数据包装宿主机执行引擎。 */
export class MetadataAdapter implements Adapter {
  constructor(
    private readonly metadata: Metadata,
    private readonly delegate: Adapter,
  ) {}

  Metadata(): Metadata {
    return this.metadata;
  }

  AgentAvailable(): boolean {
    return this.delegate.AgentAvailable?.() ?? false;
  }

  ResultAvailable(): boolean {
    return this.delegate.ResultAvailable?.() ?? false;
  }

  BuildCreate(context: RequestContext): Promise<RequestSpec> {
    return this.delegate.BuildCreate(context);
  }

  ParseCreate(body: Uint8Array): Promise<CreateResult> {
    return this.delegate.ParseCreate(body);
  }

  BuildPoll(context: PollContext): Promise<RequestSpec> {
    return this.delegate.BuildPoll(context);
  }

  ParsePoll(context: PollContext, body: Uint8Array): Promise<PollResult> {
    return this.delegate.ParsePoll(context, body);
  }

  BuildCancel(context: PollContext): Promise<RequestSpec> {
    return this.delegate.BuildCancel(context);
  }

  BuildResult(context: PollContext): Promise<RequestSpec> {
    if (!this.delegate.BuildResult) return Promise.reject(unavailable(this.metadata));
    return this.delegate.BuildResult(context);
  }

  BuildAgent(context: AgentRequestContext): Promise<RequestSpec> {
    if (!this.delegate.BuildAgent) return Promise.reject(unavailable(this.metadata));
    return this.delegate.BuildAgent(context);
  }

  ParseAgent(body: Uint8Array): Promise<AgentResult> {
    if (!this.delegate.ParseAgent) return Promise.reject(unavailable(this.metadata));
    return this.delegate.ParseAgent(body);
  }
}

export function loadManifest(data: Uint8Array): { adapter: Adapter | null; error: Error | null } {
  const decoded = decodeManifest(data);
  if (decoded.error || !decoded.manifest) return { adapter: null, error: decoded.error };
  return { adapter: new ManifestAdapter({ ...decoded.manifest, runtime: { ...decoded.manifest.runtime, backend: "declarative" } }), error: null };
}

export function decodeManifest(data: Uint8Array): { manifest: Manifest | null; error: Error | null } {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(data));
  } catch (error) {
    return { manifest: null, error: new Error(`decode plugin manifest: ${(error as Error).message}`) };
  }
  const manifest = manifestFromWire(raw);
  const validationError = validateManifest(manifest);
  if (validationError) return { manifest: null, error: validationError };
  return { manifest, error: null };
}

function prepareProviderManifest(manifest: Manifest, index: number): { manifest: Manifest | null; error: Error | null } {
  const providers = manifest.contributes?.providers ?? [];
  if (index < 0 || index >= providers.length) return { manifest: null, error: new Error("plugin provider contribution is missing") };
  const copy: Manifest = {
    ...manifest,
    contributes: { ...manifest.contributes, providers: [...providers] },
    runtime: { ...manifest.runtime, backend: "declarative" },
  };
  const error = normalizeManifestForProvider(copy, index);
  return { manifest: error ? null : copy, error };
}

export function validateManifest(manifest: Manifest): Error | null {
  const seenSms = new Set<string>();
  for (const provider of manifest.contributes?.smsProviders ?? []) {
    if (!validManifestIdentifier(provider.id) || !provider.label.trim() || seenSms.has(provider.id)) {
      return new Error("invalid or duplicate SMS provider contribution");
    }
    seenSms.add(provider.id);
  }
  const version = manifest.apiVersion.trim();
  if (version !== "yingce.plugin/v1" && version !== "yingce.plugin/v2") {
    return new Error(`unsupported protocol manifest apiVersion "${manifest.apiVersion}"`);
  }
  const metadata = manifest.metadata ?? emptyMetadata();
  if (!metadata.id.trim() || !metadata.version.trim()) return new Error("protocol manifest metadata requires id and version");
  if (!metadata.name.trim()) return new Error("protocol manifest metadata requires name");
  if (!validManifestIdentifier(metadata.id)) return new Error("protocol manifest metadata id is invalid");
  if (metadata.name.length > 160 || metadata.vendor.length > 120) {
    return new Error("protocol manifest metadata name or vendor is too long");
  }
  const contributes = manifest.contributes ?? {};
  const providers = contributes.providers ?? [];
  if (providers.length === 0 && !hasNonProviderContribution(contributes)) {
    return new Error("plugin must declare at least one contribution");
  }
  const backend = (manifest.runtime?.backend ?? "").trim();
  if (
    backend !== "" &&
    backend !== "declarative" &&
    backend !== "rpc" &&
    backend !== "wasm" &&
    backend !== "trusted-backend" &&
    !backend.startsWith("host:")
  ) {
    return new Error(`unsupported plugin backend "${backend}"`);
  }
  if (providers.length === 0) return validatePaymentProviderContributions(manifest);
  const providerIds = new Set<string>();
  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index];
    if (!provider.id.trim() || !provider.label.trim() || !validManifestIdentifier(provider.id)) {
      return new Error(`provider contribution ${index} requires a valid id and label`);
    }
    if (providerIds.has(provider.id)) return new Error(`duplicate provider contribution "${provider.id}"`);
    providerIds.add(provider.id);
    const imageParameterError = validateImageParameters(provider.imageParameters ?? []);
    if (imageParameterError) return new Error(`provider "${provider.id}" image parameters: ${imageParameterError.message}`);
    for (const parameter of provider.imageParameters ?? []) {
      if (!parameter.binding) return new Error(`provider "${provider.id}" image parameter ${parameter.name} requires a binding`);
      if (parameter.binding.startsWith("providerOptions.") && !parameter.binding.startsWith(`providerOptions.${provider.id}.`)) {
        return new Error(`provider "${provider.id}" image parameter ${parameter.name} must use its own namespace`);
      }
    }
    if (provider.capabilities.length === 0 || provider.scopes.length === 0) {
      return new Error(`provider contribution "${provider.id}" requires capabilities and scopes`);
    }
    const kind = provider.kind ?? "";
    if (kind !== "" && kind !== ProviderKindGeneration && kind !== ProviderKindProcessing) {
      return new Error(`unsupported provider kind "${kind}"`);
    }
    if (kind === ProviderKindProcessing) {
      if (provider.capabilities.length !== 1 || provider.capabilities[0] === CapabilityText) {
        return new Error(`processing provider "${provider.id}" must declare exactly one media capability`);
      }
    }
    for (const capability of provider.capabilities) {
      if (![CapabilityText, CapabilityImage, CapabilityVideo, CapabilityAudio].includes(capability)) {
        return new Error(`unsupported protocol capability "${capability}"`);
      }
    }
    for (const scope of provider.scopes) {
      if (![SurfaceAdminSystemChannel, SurfaceUserCustomChannel, SurfaceCanvas, SurfaceCreation, SurfaceAgent].includes(scope)) {
        return new Error(`unsupported protocol scope "${scope}"`);
      }
    }
    const createError = validateManifestOperation(provider.create);
    if (createError) return new Error(`provider "${provider.id}" create operation: ${createError.message}`);
    if (provider.agent) {
      const agentError = validateManifestOperation(provider.agent);
      if (agentError) return new Error(`provider "${provider.id}" agent operation: ${agentError.message}`);
      if (!provider.agentResponse) {
        return new Error(`provider "${provider.id}" agent response mapping is required when agent operation is declared`);
      }
    }
    if (provider.poll) {
      const pollError = validateManifestOperation(provider.poll);
      if (pollError) return new Error(`provider "${provider.id}" poll operation: ${pollError.message}`);
    }
    if (provider.detachedPolling && !provider.poll) {
      return new Error(`provider "${provider.id}" detachedPolling requires a poll operation`);
    }
    if (provider.upload) {
      const uploadError = validateManifestOperation(provider.upload);
      if (uploadError) return new Error(`provider "${provider.id}" upload operation: ${uploadError.message}`);
      if (provider.upload.id === undefined || provider.upload.id === null || provider.upload.kinds.length === 0) {
        return new Error(`provider "${provider.id}" upload operation requires kinds and id mapping`);
      }
      for (const kind of provider.upload.kinds) {
        if (kind !== "image" && kind !== "video" && kind !== "audio") {
          return new Error(`provider "${provider.id}" upload kind "${kind}" is unsupported`);
        }
      }
    }
    if (provider.cancel) {
      const cancelError = validateManifestOperation(provider.cancel);
      if (cancelError) return new Error(`provider "${provider.id}" cancel operation: ${cancelError.message}`);
    }
    if (provider.result) {
      const resultError = validateManifestOperation(provider.result);
      if (resultError) return new Error(`provider "${provider.id}" result operation: ${resultError.message}`);
    }
    for (let ruleIndex = 0; ruleIndex < (provider.validations ?? []).length; ruleIndex += 1) {
      const rule = provider.validations![ruleIndex];
      if (rule.assert === undefined || rule.assert === null || !rule.message.trim()) {
        return new Error(`provider "${provider.id}" validation ${ruleIndex} requires assert and message`);
      }
    }
  }
  return validatePaymentProviderContributions(manifest);
}

function validatePaymentProviderContributions(manifest: Manifest): Error | null {
  const seen = new Set<string>();
  const providers = manifest.contributes?.paymentProviders ?? [];
  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index];
    const id = provider.id.trim();
    if (!id || !provider.label.trim() || !validManifestIdentifier(id)) {
      return new Error(`payment provider contribution ${index} requires a valid id and label`);
    }
    if (seen.has(id)) return new Error(`duplicate payment provider contribution "${id}"`);
    seen.add(id);
    if (!provider.icon.trim()) return new Error(`payment provider contribution "${id}" requires an icon`);
    if (provider.checkoutMode !== "qr_code" && provider.checkoutMode !== "redirect") {
      return new Error(`payment provider contribution "${id}" has unsupported checkout mode "${provider.checkoutMode}"`);
    }
    const policy = provider.expiryPolicy;
    if (policy.minMinutes <= 0 || policy.defaultMinutes < policy.minMinutes || policy.maxMinutes < policy.defaultMinutes) {
      return new Error(`payment provider contribution "${id}" has invalid expiry policy`);
    }
    for (const field of provider.identityFields ?? []) {
      if (!field.trim() || field.length > 80) {
        return new Error(`payment provider contribution "${id}" has invalid identity field "${field}"`);
      }
    }
    for (const response of [provider.notificationSuccess, provider.notificationFailure]) {
      if (response && ((response.status ?? 0) < 0 || (response.status ?? 0) > 599)) {
        return new Error(`payment provider contribution "${id}" has invalid notification response status`);
      }
    }
    const methods = new Set<string>();
    for (const method of provider.methods ?? []) {
      if (!validPaymentMethodId(method.id) || !method.label.trim()) {
        return new Error(`payment provider contribution "${id}" has invalid method "${method.id}"`);
      }
      if (methods.has(method.id)) return new Error(`payment provider contribution "${id}" has duplicate method "${method.id}"`);
      methods.add(method.id);
    }
    const field = (provider.methodsField ?? "").trim();
    if (field && !manifestHasConfigField(manifest, field)) {
      return new Error(`payment provider contribution "${id}" methods field "${field}" is not a configuration field`);
    }
  }
  return null;
}

/** 支付方式 ID 限定为 1-32 位小写字母、数字、- 或 _，且以字母或数字开头。 */
export function validPaymentMethodId(value: string): boolean {
  if (value.length === 0 || value.length > 32) return false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if ((character >= "a" && character <= "z") || (character >= "0" && character <= "9")) continue;
    if (index > 0 && (character === "-" || character === "_")) continue;
    return false;
  }
  return true;
}

function manifestHasConfigField(manifest: Manifest, name: string): boolean {
  return (manifest.configuration?.fields ?? []).some((field) => field.name === name);
}

export function normalizeManifest(manifest: Manifest | null): Error | null {
  if (!manifest) return new Error("plugin manifest is missing");
  if ((manifest.contributes?.providers ?? []).length === 0) {
    manifest.metadata ??= emptyMetadata();
    manifest.metadata.execution = manifest.runtime?.backend;
    return null;
  }
  return normalizeManifestForProvider(manifest, 0);
}

export function normalizeManifestForProvider(manifest: Manifest | null, index: number): Error | null {
  const providers = manifest?.contributes?.providers ?? [];
  if (!manifest || index < 0 || index >= providers.length) return new Error("plugin provider contribution is missing");
  const provider = providers[index];
  manifest.metadata ??= emptyMetadata();
  const metadata = manifest.metadata;
  metadata.id = provider.id;
  metadata.categories = provider.capabilities;
  metadata.scopes = provider.scopes;
  metadata.parameters = provider.parameters;
  metadata.imageParameters = provider.imageParameters;
  metadata.create = operationSummary(provider.create);
  metadata.agent = operationSummaryOf(provider.agent);
  metadata.poll = operationSummaryOf(provider.poll);
  metadata.cancel = operationSummaryOf(provider.cancel);
  metadata.contentType = provider.create.contentType;
  metadata.textWire = "";
  metadata.agentWire = "";
  if (provider.capabilities.includes(CapabilityText)) {
    metadata.textWire = textWireForPath(provider.create.path ?? "");
    if (provider.agent) metadata.agentWire = textWireForPath(provider.agent.path ?? "");
  }
  metadata.auth = provider.auth;
  metadata.requiresPublicMediaUrls = provider.requiresPublicMediaUrls;
  metadata.detachedPolling = provider.detachedPolling;
  metadata.idempotentCreate = provider.idempotentCreate;
  metadata.kind = provider.kind;
  metadata.execution = manifest.runtime?.backend;
  manifest.create = provider.create;
  manifest.upload = provider.upload;
  manifest.agent = provider.agent;
  manifest.poll = provider.poll;
  manifest.cancel = provider.cancel;
  manifest.resultOperation = provider.result;
  manifest.response = provider.response;
  manifest.agentResponse = provider.agentResponse;
  manifest.auth = provider.auth;
  manifest.validations = provider.validations;
  return null;
}

function hasNonProviderContribution(contributes: ManifestContributions): boolean {
  if ((contributes.smsProviders?.length ?? 0) > 0) return true;
  return [
    contributes.paymentProviders,
    contributes.workflows,
    contributes.canvasNodes,
    contributes.transforms,
    contributes.commands,
    contributes.assetSources,
    contributes.usageObservers,
    contributes.aiCapabilities,
    contributes.agents,
    contributes.importExport,
  ].some((items) => (items?.length ?? 0) > 0);
}

function operationSummary(operation: ManifestOperation): string {
  const path = String(operation.path ?? "")
    .replaceAll("{{model}}", "{model}")
    .replaceAll("{{taskId}}", "{task_id}");
  return `${String(operation.method ?? "").toUpperCase()} ${path}`;
}

function operationSummaryOf(operation: ManifestOperation | undefined): string {
  return operation ? operationSummary(operation) : "";
}

export function validateManifestOperation(operation: ManifestOperation): Error | null {
  const method = String(operation.method ?? "").trim().toUpperCase();
  if (method !== "GET" && method !== "POST" && method !== "DELETE" && method !== "PUT") {
    return new Error(`unsupported HTTP method "${operation.method}"`);
  }
  if (operation.pathTemplate === undefined && !isRelativePath(operation.path ?? "")) {
    return new Error(`path must be relative: "${operation.path}"`);
  }
  const contentType = defaultValue(operation.contentType, "application/json").split(";")[0].trim().toLowerCase();
  const allowed = ["application/json", "multipart/form-data", "application/x-www-form-urlencoded", "application/octet-stream", ""];
  if (!allowed.includes(contentType)) {
    return new Error(`unsupported content type "${operation.contentType}"`);
  }
  if ((operation.files?.length ?? 0) > 0 && operation.contentTypeTemplate === undefined && contentType !== "multipart/form-data") {
    return new Error("file parts require multipart/form-data");
  }
  for (const file of operation.files ?? []) {
    if (!file.name.trim() || file.source === undefined || file.source === null) {
      return new Error("multipart file part requires name and source");
    }
  }
  return null;
}

export function manifestError(payload: Record<string, unknown>, ...paths: string[]): boolean {
  for (const path of paths) {
    const value = pathValue(payload, path);
    if (value === null || value === undefined) continue;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["", "0", "ok", "success", "succeeded", "true"].includes(normalized)) continue;
      return true;
    }
    if (typeof value === "number") {
      if (value === 0) continue;
      return true;
    }
    return true;
  }
  return false;
}

/** 标量响应字段保持字符串形态；对象参数统一转成 JSON 文本。 */
export function firstPathJsonValue(payload: Record<string, unknown>, ...paths: string[]): string {
  for (const path of paths) {
    const value = pathValue(payload, path);
    if (typeof value === "string") {
      if (value.trim()) return value.trim();
      continue;
    }
    if (value === null || value === undefined) continue;
    const encoded = JSON.stringify(value);
    if (encoded) return encoded;
  }
  return "";
}

export function setMapPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.replace(/^\.+|\.+$/g, "").split(".");
  if (parts.length === 0 || parts[0] === "") return;
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (next && typeof next === "object" && !Array.isArray(next)) {
      current = next as Record<string, unknown>;
    } else {
      const created: Record<string, unknown> = {};
      current[part] = created;
      current = created;
    }
  }
  current[parts[parts.length - 1]] = value;
}

export function isRelativePath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed, "http://protocol.invalid");
    return parsed.pathname !== "" && parsed.host === "protocol.invalid" && parsed.username === "";
  } catch {
    return false;
  }
}

export function validManifestIdentifier(value: string): boolean {
  if (value.length === 0 || value.length > 96) return false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const allowed =
      (character >= "a" && character <= "z") ||
      (character >= "0" && character <= "9") ||
      character === "-" ||
      character === "_" ||
      character === ".";
    if (!allowed) return false;
    if (index === 0 && (character === "-" || character === "_" || character === ".")) return false;
  }
  return true;
}

// 供宿主做类型收窄时使用，避免把 Go 的接口断言散落在各模块。
export function asAgentCapable(adapter: Adapter): boolean {
  return adapter.AgentAvailable?.() ?? false;
}

export function asResultCapable(adapter: Adapter): boolean {
  return adapter.ResultAvailable?.() ?? false;
}

export type { Capability, Manifest, ManifestProvider, Metadata, Surface };
