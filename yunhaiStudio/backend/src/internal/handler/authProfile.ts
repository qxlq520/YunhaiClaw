// 对应 backend/internal/handler/auth_profile.go
// 账号资料、头像、密码与邮箱变更接口。

import type { Request, Response, Router } from "express";
import multer from "multer";
import { badAuthRequest, rateLimited } from "@/internal/kernel/errors";
import type { User } from "@/internal/model/modelsIdentity";
import type { Service } from "@/internal/service/service";
import { clearSessionCookie, loginRequestContext, requireSession, sessionValue } from "./auth";
import { failService, ok } from "./response";

const avatarBodyLimit = (5 << 20) + (64 << 10);

type ProfileRequest = Request & { profileActor?: User };

export function registerAuthProfileRoutes(router: Router, service: Service): void {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: avatarBodyLimit, files: 1 } });

  router.get("/auth/profile", requireSession(service), async (request, response) => {
    const actor = (request as ProfileRequest).profileActor as User;
    try {
      ok(response, await service.userProfile(actor, sessionValue(request) ?? ""));
    } catch (error) {
      failService(response, error);
    }
  });

  router.put(
    "/auth/profile/avatar",
    requireSession(service),
    upload.single("file"),
    async (request, response) => {
      const actor = (request as ProfileRequest).profileActor as User;
      try {
        if (!enforceLimit(service, `profile-avatar:${actor.id}`, 30, 60_000, response)) return;
        const file = request.file;
        if (!file || file.size === 0) throw badAuthRequest("请选择不超过 5 MiB 的 PNG 或 JPEG 头像");
        ok(response, { user: await service.updateProfileAvatar(actor, file.buffer) });
      } catch (error) {
        failService(response, error);
      }
    },
  );

  router.delete("/auth/profile/avatar", requireSession(service), async (request, response) => {
    const actor = (request as ProfileRequest).profileActor as User;
    try {
      if (!enforceLimit(service, `profile-avatar-default:${actor.id}`, 30, 60_000, response)) return;
      ok(response, { user: await service.useDefaultProfileAvatar(actor) });
    } catch (error) {
      failService(response, error);
    }
  });

  router.get("/auth/profile/avatar/:userId", requireSession(service), async (request, response) => {
    const actor = (request as ProfileRequest).profileActor as User;
    try {
      const data = await service.profileAvatarContent(actor, String(request.params.userId ?? ""));
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.type("image/png").send(Buffer.from(data));
    } catch (error) {
      failService(response, error);
    }
  });

  router.post("/auth/profile/avatar/default", requireSession(service), async (request, response) => {
    const actor = (request as ProfileRequest).profileActor as User;
    try {
      if (!enforceLimit(service, `profile-avatar-default:${actor.id}`, 30, 60_000, response)) return;
      const preset = typeof request.body?.preset === "string" ? request.body.preset : "";
      if (preset === "") throw badAuthRequest("系统头像选择参数无效");
      ok(response, { user: await service.selectDefaultProfileAvatar(actor, preset) });
    } catch (error) {
      failService(response, error);
    }
  });

  router.post("/auth/profile/password", requireSession(service), async (request, response) => {
    const actor = (request as ProfileRequest).profileActor as User;
    try {
      if (!securityWriteLimit(service, actor, request, response)) return;
      await service.changeProfilePassword(actor, sessionValue(request) ?? "", request.body ?? {});
      clearSessionCookie(request, response);
      ok(response, { changed: true });
    } catch (error) {
      failService(response, error);
    }
  });

  router.post("/auth/profile/email-code", requireSession(service), async (request, response) => {
    const actor = (request as ProfileRequest).profileActor as User;
    try {
      if (!securityWriteLimit(service, actor, request, response)) return;
      if (!enforceLimit(service, `profile-email-code:${actor.id}`, 20, 3_600_000, response)) return;
      ok(response, await service.sendProfileEmailCode(actor, sessionValue(request) ?? "", request.body ?? {}));
    } catch (error) {
      failService(response, error);
    }
  });

  router.post("/auth/profile/email", requireSession(service), async (request, response) => {
    const actor = (request as ProfileRequest).profileActor as User;
    try {
      if (!securityWriteLimit(service, actor, request, response)) return;
      const result = await service.changeProfileEmail(actor, sessionValue(request) ?? "", request.body ?? {});
      clearSessionCookie(request, response);
      ok(response, result);
    } catch (error) {
      failService(response, error);
    }
  });

  router.get("/auth/profile/linuxdo/start", requireSession(service), async (request, response) => {
    const actor = (request as ProfileRequest).profileActor as User;
    try {
      if (!enforceLimit(service, `profile-linuxdo-reauth:${actor.id}`, 10, 10 * 60_000, response)) return;
      const target = await service.beginLinuxDOReauthentication(actor, sessionValue(request) ?? "");
      response.redirect(302, target);
    } catch (error) {
      failService(response, error);
    }
  });
}

// ACT: 运行时策略尚未随 app 包迁移，这里使用与默认策略一致的固定限额。
function securityWriteLimit(service: Service, actor: User, request: Request, response: Response): boolean {
  const context = loginRequestContext(request);
  return (
    enforceLimit(service, `profile-security-ip:${context.ip}`, 30, 10 * 60_000, response) &&
    enforceLimit(service, `profile-security-user:${actor.id}`, 30, 10 * 60_000, response)
  );
}

function enforceLimit(service: Service, key: string, limit: number, windowMs: number, response: Response): boolean {
  const host = service.auth.host;
  if (host.allowRequest(key, limit, windowMs)) return true;
  const retryAfter = host.requestRetryAfter(key, windowMs);
  const error = rateLimited("请求过于频繁，请稍后再试");
  response.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfter / 1000))));
  failService(response, error);
  return false;
}
