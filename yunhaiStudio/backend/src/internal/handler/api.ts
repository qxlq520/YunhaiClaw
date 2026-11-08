import type { Router } from "express";
import type { Service } from "@/internal/service/service";
import { registerAuthRoutes } from "./auth";
import { registerProjectRoutes } from "./project";
import { registerTaskRoutes } from "./task";
import { registerSettingRoutes } from "./setting";
import { registerSystemStatusRoutes, type SystemStatus } from "./systemStatus";

export function registerApiRoutes(router: Router, service: Service, status: SystemStatus): void {
  registerSystemStatusRoutes(router, status);
  registerAuthRoutes(router, service);
  registerProjectRoutes(router, service);
  registerTaskRoutes(router, service);
  registerSettingRoutes(router, service);
}
