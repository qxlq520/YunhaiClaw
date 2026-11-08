import type { Response } from "express";
import { AppError } from "@/internal/kernel/errors";
import { codeOk, reasonForStatus } from "@/internal/kernel/errorCodes";

export function ok(res: Response, data: unknown): void {
  res.json({ code: codeOk, data, msg: "ok" });
}

export function fail(res: Response, status: number, error: unknown): void {
  const message = error instanceof Error && error.message.trim() ? error.message.trim() : String(error ?? "请求失败");
  res.status(status).json({ code: status, data: null, msg: message, reason: reasonForStatus(status) });
}

export function failService(res: Response, error: unknown): void {
  if (error instanceof AppError) {
    const body: Record<string, unknown> = { code: error.code, data: null, msg: error.message, reason: error.reason };
    if (error.details) body.details = error.details;
    res.status(error.status).json(body);
    return;
  }
  const message = error instanceof Error && error.message ? error.message : "服务暂时不可用";
  res.status(500).json({ code: 500, data: null, msg: message, reason: "internal" });
}
