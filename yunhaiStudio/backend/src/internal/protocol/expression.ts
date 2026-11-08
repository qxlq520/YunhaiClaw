// 对应 backend/internal/protocol/expression.go
// manifest 表达式是一组受限的 $ 前缀算子，用来在不执行插件代码的前提下构造上游请求体。

export interface ManifestEnvironment {
  [key: string]: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function evaluateManifestValue(template: unknown, env: ManifestEnvironment): { value: unknown; error: Error | null } {
  if (template === null || template === undefined) return { value: template ?? null, error: null };
  if (typeof template === "boolean" || typeof template === "number") return { value: template, error: null };
  if (typeof template === "string") {
    const trimmed = template.trim();
    if (trimmed.startsWith("${") && trimmed.endsWith("}")) {
      return { value: manifestPathValue(env, trimmed.slice(2, -1).trim()), error: null };
    }
    return { value: template, error: null };
  }
  if (Array.isArray(template)) {
    const result: unknown[] = [];
    for (const item of template) {
      const evaluated = evaluateManifestValue(item, env);
      if (evaluated.error) return { value: null, error: evaluated.error };
      if (evaluated.value !== null && evaluated.value !== undefined) result.push(evaluated.value);
    }
    return { value: result, error: null };
  }
  if (isPlainObject(template)) {
    const keys = Object.keys(template);
    if (keys.length === 1 && keys[0].startsWith("$")) {
      return evaluateManifestOperator(keys[0], template[keys[0]], env);
    }
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(template)) {
      const evaluated = evaluateManifestValue(item, env);
      if (evaluated.error) return { value: null, error: new Error(`evaluate ${key}: ${evaluated.error.message}`) };
      if (evaluated.value !== null && evaluated.value !== undefined) result[key] = evaluated.value;
    }
    return { value: result, error: null };
  }
  return { value: null, error: new Error(`unsupported manifest template value ${typeof template}`) };
}

export function evaluateManifestOperator(operator: string, operand: unknown, env: ManifestEnvironment): { value: unknown; error: Error | null } {
  switch (operator) {
    case "$ref": {
      if (typeof operand !== "string") return { value: null, error: new Error("$ref requires a string path") };
      return { value: manifestPathValue(env, operand), error: null };
    }
    case "$literal":
      return { value: operand, error: null };
    case "$coalesce":
    case "$default": {
      if (!Array.isArray(operand)) return { value: null, error: new Error(`${operator} requires an array`) };
      for (const item of operand) {
        const evaluated = evaluateManifestValue(item, env);
        if (evaluated.error) return { value: null, error: evaluated.error };
        if (!manifestEmpty(evaluated.value)) return { value: evaluated.value, error: null };
      }
      return { value: null, error: null };
    }
    case "$concat": {
      if (!Array.isArray(operand)) return { value: null, error: new Error("$concat requires an array") };
      let result = "";
      for (const item of operand) {
        const evaluated = evaluateManifestValue(item, env);
        if (evaluated.error) return { value: null, error: evaluated.error };
        if (evaluated.value !== null && evaluated.value !== undefined) result += manifestString(evaluated.value);
      }
      return { value: result, error: null };
    }
    case "$concatArrays": {
      if (!Array.isArray(operand)) return { value: null, error: new Error("$concatArrays requires an array") };
      const result: unknown[] = [];
      for (const item of operand) {
        const evaluated = evaluateManifestValue(item, env);
        if (evaluated.error) return { value: null, error: evaluated.error };
        result.push(...manifestArray(evaluated.value));
      }
      return { value: result, error: null };
    }
    case "$map":
    case "$filter": {
      if (!isPlainObject(operand)) return { value: null, error: new Error(`${operator} requires an object`) };
      const from = evaluateManifestValue(operand.from, env);
      if (from.error) return { value: null, error: from.error };
      let alias = manifestString(operand.as).trim();
      if (!alias) alias = "item";
      const items = manifestArray(from.value);
      const result: unknown[] = [];
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const child = cloneManifestEnv(env);
        child[alias] = item;
        child[`${alias}Index`] = index;
        if (operator === "$filter") {
          const condition = evaluateManifestValue(operand.where, child);
          if (condition.error) return { value: null, error: condition.error };
          if (manifestTruthy(condition.value)) result.push(item);
          continue;
        }
        const mapped = evaluateManifestValue(operand.in, child);
        if (mapped.error) return { value: null, error: mapped.error };
        if (mapped.value !== null && mapped.value !== undefined) result.push(mapped.value);
      }
      return { value: result, error: null };
    }
    case "$indexObject": {
      if (!isPlainObject(operand)) return { value: null, error: new Error("$indexObject requires an object") };
      const from = evaluateManifestValue(operand.from, env);
      if (from.error) return { value: null, error: from.error };
      let alias = manifestString(operand.as).trim();
      if (!alias) alias = "item";
      const prefixValue = evaluateManifestValue(operand.prefix, env);
      if (prefixValue.error) return { value: null, error: prefixValue.error };
      const prefix = manifestString(prefixValue.value);
      const allItems = manifestArray(from.value);
      let maxItems = allItems.length;
      if (operand.max !== undefined && operand.max !== null) {
        const configuredValue = evaluateManifestValue(operand.max, env);
        if (configuredValue.error) return { value: null, error: configuredValue.error };
        const configured = manifestInt(configuredValue.value);
        if (configured >= 0 && configured < maxItems) maxItems = configured;
      }
      const result: Record<string, unknown> = {};
      for (let index = 0; index < maxItems; index += 1) {
        const item = allItems[index];
        const child = cloneManifestEnv(env);
        child[alias] = item;
        child[`${alias}Index`] = index;
        const value = evaluateManifestValue(operand.value, child);
        if (value.error) return { value: null, error: value.error };
        if (value.value !== null && value.value !== undefined && !manifestEmpty(value.value)) {
          result[`${prefix}${index}`] = value.value;
        }
      }
      return { value: result, error: null };
    }
    case "$first":
    case "$last": {
      const evaluated = evaluateManifestValue(operand, env);
      if (evaluated.error) return { value: null, error: evaluated.error };
      const items = manifestArray(evaluated.value);
      if (items.length === 0) return { value: null, error: null };
      return { value: operator === "$last" ? items[items.length - 1] : items[0], error: null };
    }
    case "$at": {
      if (!Array.isArray(operand) || operand.length !== 2) return { value: null, error: new Error("$at requires [array, index]") };
      const value = evaluateManifestValue(operand[0], env);
      if (value.error) return { value: null, error: value.error };
      const indexValue = evaluateManifestValue(operand[1], env);
      if (indexValue.error) return { value: null, error: indexValue.error };
      const items = manifestArray(value.value);
      const index = manifestInt(indexValue.value);
      if (index < 0 || index >= items.length) return { value: null, error: null };
      return { value: items[index], error: null };
    }
    case "$len": {
      const evaluated = evaluateManifestValue(operand, env);
      if (evaluated.error) return { value: null, error: evaluated.error };
      const value = evaluated.value;
      if (Array.isArray(value)) return { value: value.length, error: null };
      if (isPlainObject(value)) return { value: Object.keys(value).length, error: null };
      if (typeof value === "string") return { value: Array.from(value).length, error: null };
      return { value: 0, error: null };
    }
    case "$split": {
      if (!Array.isArray(operand) || operand.length !== 2) return { value: null, error: new Error("$split requires [value, separator]") };
      const value = evaluateManifestValue(operand[0], env);
      if (value.error) return { value: null, error: value.error };
      const separator = evaluateManifestValue(operand[1], env);
      if (separator.error) return { value: null, error: separator.error };
      const separatorText = manifestString(separator.value);
      if (!separatorText) return { value: null, error: new Error("$split separator must not be empty") };
      return { value: manifestString(value.value).split(separatorText), error: null };
    }
    case "$if": {
      if (!isPlainObject(operand)) return { value: null, error: new Error("$if requires an object") };
      const condition = evaluateManifestValue(operand.condition, env);
      if (condition.error) return { value: null, error: condition.error };
      return evaluateManifestValue(manifestTruthy(condition.value) ? operand.then : operand.else, env);
    }
    case "$switch": {
      if (!isPlainObject(operand)) return { value: null, error: new Error("$switch requires an object") };
      for (const rawCase of manifestArray(operand.cases)) {
        const item = isPlainObject(rawCase) ? rawCase : {};
        const when = evaluateManifestValue(item.when, env);
        if (when.error) return { value: null, error: when.error };
        if (manifestTruthy(when.value)) return evaluateManifestValue(item.then, env);
      }
      return evaluateManifestValue(operand.default, env);
    }
    case "$omitEmpty": {
      const evaluated = evaluateManifestValue(operand, env);
      if (evaluated.error || manifestEmpty(evaluated.value)) return { value: null, error: evaluated.error };
      return evaluated;
    }
    case "$lower":
    case "$upper":
    case "$trim":
    case "$toString":
    case "$toInt":
    case "$toFloat":
    case "$toBool":
    case "$dataMime":
    case "$dataPayload":
    case "$json": {
      const evaluated = evaluateManifestValue(operand, env);
      if (evaluated.error) return { value: null, error: evaluated.error };
      const text = manifestString(evaluated.value);
      switch (operator) {
        case "$lower":
          return { value: text.toLowerCase(), error: null };
        case "$upper":
          return { value: text.toUpperCase(), error: null };
        case "$trim":
          return { value: text.trim(), error: null };
        case "$toString":
          return { value: text, error: null };
        case "$toInt":
          return { value: manifestInt(evaluated.value), error: null };
        case "$toFloat": {
          const parsed = manifestFloatValue(evaluated.value);
          return { value: parsed.ok ? parsed.value : null, error: null };
        }
        case "$toBool":
          return { value: manifestTruthy(evaluated.value), error: null };
        case "$dataMime":
          return { value: dataMime(text), error: null };
        case "$dataPayload":
          return { value: dataPayload(text), error: null };
        default:
          return { value: JSON.stringify(evaluated.value), error: null };
      }
    }
    case "$merge": {
      if (!Array.isArray(operand)) return { value: null, error: new Error("$merge requires an array") };
      const result: Record<string, unknown> = {};
      for (const item of operand) {
        const evaluated = evaluateManifestValue(item, env);
        if (evaluated.error) return { value: null, error: evaluated.error };
        Object.assign(result, manifestObject(evaluated.value));
      }
      return { value: result, error: null };
    }
    case "$sortByOrder": {
      const evaluated = evaluateManifestValue(operand, env);
      if (evaluated.error) return { value: null, error: evaluated.error };
      const items = [...manifestArray(evaluated.value)];
      items.sort((left, right) => manifestInt(manifestPathValue(left, "order")) - manifestInt(manifestPathValue(right, "order")));
      return { value: items, error: null };
    }
    case "$add":
    case "$multiply":
    case "$divide":
    case "$min":
    case "$max": {
      if (!Array.isArray(operand) || operand.length === 0) return { value: null, error: new Error(`${operator} requires an array`) };
      if (operator === "$divide") {
        if (operand.length !== 2) return { value: null, error: new Error("$divide requires [numerator, denominator]") };
        const numerator = evaluateManifestValue(operand[0], env);
        if (numerator.error) return { value: null, error: numerator.error };
        const denominator = evaluateManifestValue(operand[1], env);
        if (denominator.error) return { value: null, error: denominator.error };
        const divisor = manifestFloat(denominator.value);
        if (divisor === 0) return { value: null, error: new Error("$divide denominator must not be zero") };
        return { value: normalizeManifestNumber(manifestFloat(numerator.value) / divisor), error: null };
      }
      let result = operator === "$multiply" ? 1 : operator === "$min" ? Number.POSITIVE_INFINITY : operator === "$max" ? Number.NEGATIVE_INFINITY : 0;
      for (const item of operand) {
        const evaluated = evaluateManifestValue(item, env);
        if (evaluated.error) return { value: null, error: evaluated.error };
        const number = manifestFloat(evaluated.value);
        if (operator === "$multiply") result *= manifestFloat(evaluated.value);
        else if (operator === "$min") result = Math.min(result, number);
        else if (operator === "$max") result = Math.max(result, number);
        else result += manifestFloat(evaluated.value);
      }
      return { value: normalizeManifestNumber(result), error: null };
    }
    case "$ceilStep": {
      if (!Array.isArray(operand) || operand.length !== 2) return { value: null, error: new Error("$ceilStep requires [value, step]") };
      const value = evaluateManifestValue(operand[0], env);
      if (value.error) return { value: null, error: value.error };
      const step = evaluateManifestValue(operand[1], env);
      if (step.error) return { value: null, error: step.error };
      const stepValue = manifestFloat(step.value);
      if (stepValue <= 0) return { value: null, error: new Error("$ceilStep step must be positive") };
      return { value: normalizeManifestNumber(Math.ceil(manifestFloat(value.value) / stepValue) * stepValue), error: null };
    }
    case "$eq":
    case "$ne":
    case "$gt":
    case "$gte":
    case "$lt":
    case "$lte":
    case "$in":
    case "$and":
    case "$or":
      return evaluateManifestComparison(operator, operand, env);
    case "$not": {
      const evaluated = evaluateManifestValue(operand, env);
      return { value: !manifestTruthy(evaluated.value), error: evaluated.error };
    }
    default:
      return { value: null, error: new Error(`unsupported manifest operator "${operator}"`) };
  }
}

export function evaluateManifestComparison(operator: string, operand: unknown, env: ManifestEnvironment): { value: unknown; error: Error | null } {
  if (!Array.isArray(operand)) return { value: null, error: new Error(`${operator} requires an array`) };
  const evaluated: unknown[] = [];
  for (const item of operand) {
    const value = evaluateManifestValue(item, env);
    if (value.error) return { value: null, error: value.error };
    evaluated.push(value.value);
  }
  if (operator === "$and" || operator === "$or") {
    let result = operator === "$and";
    for (const value of evaluated) {
      result = operator === "$and" ? result && manifestTruthy(value) : result || manifestTruthy(value);
    }
    return { value: result, error: null };
  }
  if (evaluated.length !== 2) return { value: null, error: new Error(`${operator} requires two operands`) };
  const [left, right] = evaluated;
  switch (operator) {
    case "$eq":
      return { value: JSON.stringify(left) === JSON.stringify(right), error: null };
    case "$ne":
      return { value: JSON.stringify(left) !== JSON.stringify(right), error: null };
    case "$gt":
      return { value: manifestFloat(left) > manifestFloat(right), error: null };
    case "$gte":
      return { value: manifestFloat(left) >= manifestFloat(right), error: null };
    case "$lt":
      return { value: manifestFloat(left) < manifestFloat(right), error: null };
    case "$lte":
      return { value: manifestFloat(left) <= manifestFloat(right), error: null };
    case "$in":
      return { value: manifestArray(right).some((item) => JSON.stringify(left) === JSON.stringify(item)), error: null };
    default:
      return { value: false, error: null };
  }
}

export function interpolateManifestString(value: string, env: ManifestEnvironment): string {
  let result = value;
  for (;;) {
    const start = result.indexOf("{{");
    if (start < 0) return result;
    const endOffset = result.slice(start + 2).indexOf("}}");
    if (endOffset < 0) return result;
    const end = start + 2 + endOffset;
    const path = result.slice(start + 2, end).trim();
    result = result.slice(0, start) + manifestString(manifestPathValue(env, path)) + result.slice(end + 2);
  }
}

export function manifestPathValue(root: unknown, path: string): unknown {
  if (!path.trim()) return root;
  let value = root;
  for (const part of path.replace(/^\.+|\.+$/g, "").split(".")) {
    if (isPlainObject(value)) {
      value = value[part];
    } else if (Array.isArray(value)) {
      const index = Number.parseInt(part, 10);
      if (Number.isNaN(index) || index < 0 || index >= value.length) return null;
      value = value[index];
    } else {
      return null;
    }
  }
  return value;
}

export function cloneManifestEnv(env: ManifestEnvironment): ManifestEnvironment {
  return { ...env };
}

export function manifestArray(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function manifestObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

export function manifestEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

export function manifestTruthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return !["", "false", "0", "no", "null"].includes(normalized);
  }
  if (typeof value === "number") return value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return true;
}

export function manifestString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value);
}

function manifestFloatValue(value: unknown): { value: number; ok: boolean } {
  if (typeof value === "number") return { value, ok: true };
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.trim());
    return { value: Number.isNaN(parsed) ? 0 : parsed, ok: !Number.isNaN(parsed) };
  }
  return { value: 0, ok: false };
}

export function manifestFloat(value: unknown): number {
  return manifestFloatValue(value).value;
}

export function manifestInt(value: unknown): number {
  return Math.trunc(manifestFloat(value));
}

export function normalizeManifestNumber(value: number): unknown {
  return Math.trunc(value) === value ? Math.trunc(value) : value;
}

/** 对应 Go 的 defaultValue：空白值回退到 fallback。 */
export function defaultValue(value: unknown, fallback: string): string {
  const text = value === null || value === undefined ? "" : String(value);
  return text.trim() ? text : fallback;
}

/** 对应 Go 的 dataMIME / dataPayload。 */
export function dataMime(value: string): string {
  const index = value.indexOf(";");
  if (value.startsWith("data:") && index > 5) return value.slice(5, index).trim();
  return "application/octet-stream";
}

export function dataPayload(value: string): string {
  const index = value.indexOf(",");
  if (value.startsWith("data:") && index >= 0) return value.slice(index + 1);
  return value;
}

/** 对应 Go 的 pathValue(payload, path)。 */
export function pathValue(payload: Record<string, unknown>, path: string): unknown {
  return manifestPathValue(payload, path);
}
