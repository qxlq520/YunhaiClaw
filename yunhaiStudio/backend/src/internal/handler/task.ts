import type { Router } from "express";
import type { TaskStatus } from "@/internal/model/models";
import { fail, failService, ok } from "./response";
import { Service } from "@/internal/service/service";
import { requireSession } from "./auth";
import { requestUser } from "./project";

export function registerTaskRoutes(router: Router, service: Service): void {
  router.get("/tasks", requireSession(service), async (request, response) => {
    try {
      const tasks = await service.tasks(requestUser(request), {
        projectId: typeof request.query.projectId === "string" ? request.query.projectId : undefined,
        status: typeof request.query.status === "string" ? (request.query.status as TaskStatus) : undefined,
        limit: typeof request.query.limit === "string" ? Number(request.query.limit) : undefined,
      });
      ok(response, tasks);
    } catch (error) {
      failService(response, error);
    }
  });

  router.get("/tasks/:id", requireSession(service), async (request, response) => {
    try {
      const task = await service.task(requestUser(request), String(request.params.id));
      if (!task) fail(response, 404, new Error("任务不存在"));
      else ok(response, task);
    } catch (error) {
      failService(response, error);
    }
  });

  router.delete("/tasks/:id", requireSession(service), async (request, response) => {
    try {
      const removed = await service.removeTask(requestUser(request), String(request.params.id));
      if (!removed) fail(response, 404, new Error("任务不存在"));
      else ok(response, { removed: true });
    } catch (error) {
      failService(response, error);
    }
  });
}
