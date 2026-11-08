import { randomUUID } from "node:crypto";
import { codeInternal, reasonForStatus, type ErrorReason } from "./errorCodes";

export interface AppErrorOptions {
  status: number;
  code?: number;
  reason?: ErrorReason;
  message?: string;
  retryable?: boolean;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: number;
  readonly reason: ErrorReason;
  readonly retryable: boolean;
  readonly cause?: unknown;
  readonly details?: Record<string, unknown>;

  constructor(options: AppErrorOptions) {
    super(options.message ?? "服务暂时不可用");
    this.name = "AppError";
    this.status = options.status;
    this.code = options.code ?? options.status;
    this.reason = options.reason ?? reasonForStatus(options.status);
    this.retryable = options.retryable ?? false;
    this.cause = options.cause;
    this.details = options.details;
  }
}

export function newAppError(status: number, message: string, details?: Record<string, unknown>): AppError {
  return new AppError({ status, message, details });
}

export function invalidArgument(message: string): AppError {
  return new AppError({ status: 400, message });
}

export function unauthorized(message: string): AppError {
  return new AppError({ status: 401, message });
}

export function forbidden(message: string): AppError {
  return new AppError({ status: 403, message });
}

export function notFound(message: string): AppError {
  return new AppError({ status: 404, message });
}

export function conflict(message: string): AppError {
  return new AppError({ status: 409, message });
}

export function internalError(cause: unknown): AppError {
  return new AppError({ status: codeInternal, message: "服务暂时不可用", cause });
}

export function wrapAppError(status: number, message: string, cause: unknown): AppError {
  return new AppError({ status, message, cause });
}

export function badAuthRequest(message: string): AppError {
  return new AppError({ status: 400, message });
}

export function rateLimited(message: string): AppError {
  return new AppError({ status: 429, code: 42901, reason: "rate_limited", message, retryable: true });
}

export function firstNonEmpty(...values: (string | null | undefined)[]): string {
  for (const value of values) {
    if (value !== null && value !== undefined && value.trim() !== "") return value;
  }
  return "";
}

export function uniqueNonEmpty(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const item = (value ?? "").trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

export function truncateRunes(value: string, limit: number): string {
  const chars = Array.from(value);
  if (limit <= 0 || chars.length <= limit) return value;
  return chars.slice(0, limit).join("");
}

export function newId(): string {
  return randomUUID();
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
