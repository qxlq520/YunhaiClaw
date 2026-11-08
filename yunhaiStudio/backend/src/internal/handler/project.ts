import type { Request, Router } from "express";
import type { User } from "@/internal/model/modelsIdentity";
import { fail, failService, ok } from "./response";
import { Service } from "@/internal/service/service";
import { requireSession } from "./auth";

export function requestUser(request: Request): User {
  return (request as Request & { user: User }).user;
}

export function registerProjectRoutes(router: Router, service: Service): void {
  router.get("/projects", requireSession(service), async (request, response) => {
    try {
      ok(response, await service.listProjects(requestUser(request)));
    } catch (error) {
      failService(response, error);
    }
  });

  router.get("/projects/:id", requireSession(service), async (request, response) => {
    try {
      const project = await service.project(requestUser(request), String(request.params.id));
      if (!project) fail(response, 404, new Error("项目不存在"));
      else ok(response, project);
    } catch (error) {
      failService(response, error);
    }
  });

  router.get("/canvases", requireSession(service), async (request, response) => {
    try {
      ok(response, await service.listProjects(requestUser(request)));
    } catch (error) {
      failService(response, error);
    }
  });

  router.post("/canvases", requireSession(service), async (request, response) => {
    try {
      ok(response, await service.saveProject(requestUser(request), request.body ?? {}));
    } catch (error) {
      failService(response, error);
    }
  });

  router.get("/canvases/:id", requireSession(service), async (request, response) => {
    try {
      const project = await service.project(requestUser(request), String(request.params.id));
      if (!project) fail(response, 404, new Error("画布不存在"));
      else ok(response, project);
    } catch (error) {
      failService(response, error);
    }
  });

  router.put("/canvases/:id", requireSession(service), async (request, response) => {
    try {
      ok(response, await service.saveProject(requestUser(request), { ...(request.body ?? {}), id: String(request.params.id) }));
    } catch (error) {
      failService(response, error);
    }
  });

  router.delete("/canvases/:id", requireSession(service), async (request, response) => {
    try {
      const removed = await service.removeProject(requestUser(request), String(request.params.id));
      if (!removed) fail(response, 404, new Error("画布不存在"));
      else ok(response, { removed: true });
    } catch (error) {
      failService(response, error);
    }
  });
}
