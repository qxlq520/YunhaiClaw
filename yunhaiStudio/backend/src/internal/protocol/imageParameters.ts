// 对应 backend/internal/protocol/image_parameters.go

import { validManifestIdentifier } from "./manifest";
import type { GenerationRequest } from "./types";

export interface ImageParameter {
  name: string;
  label: string;
  type: string;
  description?: string;
  values?: unknown[];
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  default?: unknown;
  required?: boolean;
  pricing?: boolean;
  binding?: string;
  encoding?: string;
  models?: string[];
  enabled?: boolean;
}

const imageParameterName = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** 对应 Go 的 ImageParameter.IsEnabled。 */
export function isImageParameterEnabled(parameter: ImageParameter): boolean {
  return parameter.enabled === undefined || parameter.enabled;
}

/** 对应 Go 的 ImageParameter.AppliesTo。 */
export function imageParameterAppliesTo(parameter: ImageParameter, model: string): boolean {
  if (!parameter.models || parameter.models.length === 0) return true;
  return parameter.models.includes(model.trim().replace(/^models\//, ""));
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

export function validateImageParameters(parameters: ImageParameter[]): Error | null {
  const seen = new Set<string>();
  const bindings = new Set<string>();
  for (const parameter of parameters) {
    if (!imageParameterName.test(parameter.name) || seen.has(parameter.name) || parameter.label.trim() === "") {
      return new Error(`invalid or duplicate image parameter "${parameter.name}"`);
    }
    seen.add(parameter.name);
    if (parameter.encoding && (parameter.binding !== "aspectRatio" || (parameter.encoding !== "pixels" && parameter.encoding !== "ratio"))) {
      return new Error(`image parameter ${parameter.name} has invalid encoding`);
    }
    if (!["string", "number", "integer", "boolean"].includes(parameter.type)) {
      return new Error(`image parameter ${parameter.name} has unsupported type ${parameter.type}`);
    }
    if (
      (parameter.min !== undefined && (!finite(parameter.min) || (parameter.max !== undefined && parameter.min > parameter.max))) ||
      (parameter.max !== undefined && !finite(parameter.max)) ||
      (parameter.step !== undefined && (!finite(parameter.step) || parameter.step <= 0)) ||
      (parameter.maxLength ?? 0) < 0
    ) {
      return new Error(`image parameter ${parameter.name} has invalid bounds`);
    }
    if (parameter.binding) {
      if (!validImageParameterBinding(parameter.binding) || bindings.has(parameter.binding)) {
        return new Error(`image parameter ${parameter.name} has invalid or duplicate binding`);
      }
      bindings.add(parameter.binding);
    }
    for (const value of parameter.values ?? []) {
      const constraint: ImageParameter = { ...parameter, values: undefined };
      if (!imageParameterAccepts(constraint, value)) {
        return new Error(`image parameter ${parameter.name} has invalid enum value`);
      }
    }
    if (parameter.default !== undefined && parameter.default !== null && !imageParameterAccepts(parameter, parameter.default)) {
      return new Error(`image parameter ${parameter.name} default is outside its constraints`);
    }
  }
  return null;
}

/** 对应 Go 的 ImageParameter.Accepts。 */
export function imageParameterAccepts(parameter: ImageParameter, value: unknown): boolean {
  if (value === null || value === undefined) return !parameter.required;
  switch (parameter.type) {
    case "string": {
      if (typeof value !== "string") return false;
      if ((parameter.maxLength ?? 0) > 0 && Array.from(value).length > (parameter.maxLength as number)) return false;
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") return false;
      break;
    }
    case "number":
    case "integer": {
      const number = imageParameterNumber(value);
      if (number === null || !finite(number)) return false;
      if (parameter.type === "integer" && Math.trunc(number) !== number) return false;
      if ((parameter.min !== undefined && number < parameter.min) || (parameter.max !== undefined && number > parameter.max)) return false;
      if (parameter.step !== undefined) {
        const base = parameter.min ?? 0;
        const steps = (number - base) / parameter.step;
        if (Math.abs(steps - Math.round(steps)) > 1e-8) return false;
      }
      break;
    }
    default:
      return false;
  }
  if (!parameter.values || parameter.values.length === 0) return true;
  return parameter.values.some((candidate) => imageParameterValuesEqual(candidate, value));
}

function imageParameterNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  return null;
}

/** 对应 Go 的 ImageParameterValuesEqual。 */
export function imageParameterValuesEqual(left: unknown, right: unknown): boolean {
  const l = imageParameterNumber(left);
  const r = imageParameterNumber(right);
  if (l !== null || r !== null) return l !== null && r !== null && l === r;
  return JSON.stringify(left) === JSON.stringify(right);
}

function validImageParameterBinding(binding: string): boolean {
  if (["aspectRatio", "resolution", "quality", "imageCount", "transparentBackground"].includes(binding)) return true;
  const parts = binding.split(".");
  return parts.length === 3 && parts[0] === "providerOptions" && validManifestIdentifier(parts[1]) && imageParameterName.test(parts[2]);
}

/** 对应 Go 的 ResolveImageParameters：只接受渠道可编辑的限制，标签/类型/价格/绑定始终来自插件。 */
export function resolveImageParameters(
  definitions: ImageParameter[],
  configured: ImageParameter[],
  model: string,
): { parameters: ImageParameter[] | null; error: Error | null } {
  const validationError = validateImageParameters(definitions);
  if (validationError) return { parameters: null, error: validationError };
  const settings = new Map<string, ImageParameter>();
  for (const parameter of configured) {
    if (settings.has(parameter.name)) return { parameters: null, error: new Error(`duplicate image parameter ${parameter.name}`) };
    settings.set(parameter.name, parameter);
  }
  const result: ImageParameter[] = [];
  for (const definition of definitions) {
    if (!imageParameterAppliesTo(definition, model)) continue;
    const parameter: ImageParameter = { ...definition };
    const setting = settings.get(parameter.name);
    if (setting) {
      parameter.enabled = setting.enabled;
      if (!isImageParameterEnabled(parameter) && parameter.required) {
        return { parameters: null, error: new Error(`${parameter.label} is required`) };
      }
      if (setting.values !== undefined) {
        for (const value of setting.values) {
          if (!imageParameterAccepts(definition, value)) {
            return { parameters: null, error: new Error(`${parameter.label} value exceeds plugin constraints`) };
          }
        }
        if (setting.values.length === 0 && (definition.values?.length ?? 0) > 0 && isImageParameterEnabled(parameter)) {
          return { parameters: null, error: new Error(`${parameter.label} requires supported values`) };
        }
        parameter.values = setting.values;
      }
      if (setting.min !== undefined) {
        if (definition.min !== undefined && setting.min < definition.min) {
          return { parameters: null, error: new Error(`${parameter.label} minimum exceeds plugin constraints`) };
        }
        parameter.min = setting.min;
      }
      if (setting.max !== undefined) {
        if (definition.max !== undefined && setting.max > definition.max) {
          return { parameters: null, error: new Error(`${parameter.label} maximum exceeds plugin constraints`) };
        }
        parameter.max = setting.max;
      }
      if (setting.step !== undefined) {
        if (
          definition.step !== undefined &&
          (Math.abs(setting.step / definition.step - Math.round(setting.step / definition.step)) > 1e-8 || setting.step < definition.step)
        ) {
          return { parameters: null, error: new Error(`${parameter.label} step exceeds plugin constraints`) };
        }
        parameter.step = setting.step;
      }
      if (definition.step !== undefined && parameter.min !== undefined) {
        const base = definition.min ?? 0;
        const steps = (parameter.min - base) / definition.step;
        if (Math.abs(steps - Math.round(steps)) > 1e-8) {
          return { parameters: null, error: new Error(`${parameter.label} minimum does not align with plugin step`) };
        }
      }
      parameter.default = setting.default;
      settings.delete(parameter.name);
    }
    result.push(parameter);
  }
  for (const [name, parameter] of settings) {
    if (isImageParameterEnabled(parameter)) {
      return { parameters: null, error: new Error(`plugin does not declare image parameter ${name} for this model`) };
    }
  }
  const finalError = validateImageParameters(result);
  return { parameters: finalError ? null : result, error: finalError };
}

/** 对应 Go 的 ApplyImageParameters：保留 false 与 0，拒绝未声明的值，只映射插件声明的目标。 */
export function applyImageParameters(
  request: GenerationRequest,
  definitions: ImageParameter[],
): { request: GenerationRequest; error: Error | null } {
  if (request.capability !== "image" || request.imageParameters === null || request.imageParameters === undefined) {
    return { request, error: null };
  }
  const allowed = new Map<string, ImageParameter>();
  for (const parameter of definitions) {
    if (imageParameterAppliesTo(parameter, request.model)) allowed.set(parameter.name, parameter);
  }
  request.providerOptions ??= {};
  request.extra ??= {};
  for (const [name, value] of Object.entries(request.imageParameters)) {
    const parameter = allowed.get(name);
    if (!parameter || !imageParameterAccepts(parameter, value)) {
      return { request, error: new Error(`unsupported image parameter ${name}`) };
    }
    if (value === null || value === undefined) continue;
    switch (parameter.binding) {
      case "aspectRatio":
        request.aspectRatio = String(value);
        break;
      case "resolution":
        request.resolution = String(value);
        break;
      case "quality":
        request.quality = String(value);
        break;
      case "imageCount":
        request.imageCount = Math.trunc(imageParameterNumber(value) ?? 0);
        break;
      case "transparentBackground":
        request.extra.transparentBackground = String(value);
        break;
      default: {
        const parts = (parameter.binding ?? "").split(".");
        if (parts.length !== 3 || parts[0] !== "providerOptions") {
          return { request, error: new Error(`image parameter ${name} has no request binding`) };
        }
        request.providerOptions[parts[1]] ??= {};
        request.providerOptions[parts[1]][parts[2]] = value;
      }
    }
  }
  return { request, error: null };
}
