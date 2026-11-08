import type { Router } from "express";
import { failService, ok } from "./response";
import { Service } from "@/internal/service/service";
import { requireSession } from "./auth";
import { requestUser } from "./project";

export function registerSettingRoutes(router: Router, service: Service): void {
  router.get("/settings", requireSession(service), async (request, response) => {
    try {
      ok(response, await service.getSettings(""));
    } catch (error) {
      failService(response, error);
    }
  });

  router.put("/settings", requireSession(service), async (request, response) => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const values = body.settings && typeof body.settings === "object" ? (body.settings as Record<string, unknown>) : body;
      await service.saveSettings(values, requestUser(request).id);
      ok(response, { saved: true });
    } catch (error) {
      failService(response, error);
    }
  });
}
