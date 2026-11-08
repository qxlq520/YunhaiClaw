import type { Router } from "express";
import { ok } from "./response";

export interface SystemStatus {
  started: boolean;
  draining: boolean;
  startedAt: string | null;
  version: string;
}

export function createSystemStatus(): SystemStatus {
  return { started: false, draining: false, startedAt: null, version: process.env.CANVAS_VERSION ?? "0.1.0" };
}

export function registerSystemStatusRoutes(router: Router, status: SystemStatus): void {
  const ready = () => status.started && !status.draining;
  router.get("/health/live", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });
  router.get("/health/startup", (_request, response) => {
    response.status(status.started ? 200 : 503).json({ status: status.started ? "ok" : "starting" });
  });
  router.get("/health/ready", (_request, response) => {
    response.status(ready() ? 200 : 503).json({ status: ready() ? "ok" : status.draining ? "draining" : "starting" });
  });
  router.get("/health", (_request, response) => {
    response.status(ready() ? 200 : 503).json({ status: ready() ? "ok" : "starting" });
  });
  router.get("/system/version", (_request, response) => {
    ok(response, { version: status.version, startedAt: status.startedAt, draining: status.draining });
  });
  router.get("/system/status", (_request, response) => {
    ok(response, { api: { status: "ok" }, database: { status: "ok" }, worker: { status: "ok" }, version: status.version });
  });
}
