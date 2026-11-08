import type { NextFunction, Request, Response, Router } from "express";
import { unauthorized } from "@/internal/kernel/errors";
import type { User } from "@/internal/model/modelsIdentity";
import { failService, ok } from "./response";
import {
  sessionCookieName,
  Service,
  type LoginContext,
  type LoginRequest,
  type RegisterRequest,
} from "@/internal/service/service";

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return undefined;
}

export function sessionValue(request: Request): string | undefined {
  return readCookie(request, sessionCookieName);
}

export function loginRequestContext(request: Request): LoginContext {
  return {
    ip: request.ip ?? request.socket.remoteAddress ?? "",
    userAgent: String(request.headers["user-agent"] ?? ""),
  };
}

export function setSessionCookie(request: Request, response: Response, value: string, maxAge: number): void {
  const secure = request.protocol === "https" || String(request.headers["x-forwarded-proto"] ?? "").toLowerCase() === "https";
  response.cookie(sessionCookieName, value, {
    path: "/",
    maxAge: maxAge * 1000,
    httpOnly: true,
    sameSite: "lax",
    secure,
  });
}

export function clearSessionCookie(request: Request, response: Response): void {
  const secure = request.protocol === "https" || String(request.headers["x-forwarded-proto"] ?? "").toLowerCase() === "https";
  response.clearCookie(sessionCookieName, { path: "/", httpOnly: true, sameSite: "lax", secure });
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function registerAuthRoutes(router: Router, service: Service): void {
  router.get("/auth/settings", async (_request, response) => {
    try {
      ok(response, await service.publicAuthSettings());
    } catch (error) {
      failService(response, error);
    }
  });

  router.post("/auth/register", async (request, response) => {
    try {
      const result = await service.register({
        ...(request.body as RegisterRequest),
        loginContext: loginRequestContext(request),
      });
      setSessionCookie(request, response, result.session, result.maxAgeSecs);
      ok(response, { user: result.user });
    } catch (error) {
      failService(response, error);
    }
  });

  router.post("/auth/email-code", async (request, response) => {
    try {
      await service.sendRegistrationEmailCode(text(request.body?.email));
      ok(response, { sent: true });
    } catch (error) {
      failService(response, error);
    }
  });

  router.post("/auth/password-reset-code", async (request, response) => {
    try {
      await service.sendPasswordResetEmailCode(text(request.body?.email));
      ok(response, { sent: true });
    } catch (error) {
      failService(response, error);
    }
  });

  router.post("/auth/password-reset", async (request, response) => {
    try {
      await service.resetPassword(request.body as import("@/internal/auth/passwordReset").PasswordResetRequest);
      ok(response, { reset: true });
    } catch (error) {
      failService(response, error);
    }
  });

  router.post("/auth/login", async (request, response) => {
    try {
      const result = await service.login({
        ...(request.body as LoginRequest),
        loginContext: loginRequestContext(request),
      });
      setSessionCookie(request, response, result.session, result.maxAgeSecs);
      ok(response, { user: result.user });
    } catch (error) {
      failService(response, error);
    }
  });

  router.get("/auth/linuxdo/start", async (request, response) => {
    try {
      const acceptedTerms = request.query.acceptedTerms === "true";
      const target = await service.beginLinuxDOLogin(text(request.query.next), acceptedTerms);
      response.redirect(302, target);
    } catch (error) {
      failService(response, error);
    }
  });

  const callbackHandler = async (request: Request, response: Response) => {
    const state = text(request.query.state);
    const code = text(request.query.code);
    let reauthentication = false;
    try {
      reauthentication = await service.linuxDOReauthenticationState(state);
    } catch {
      response.redirect(302, `/login?oauth_error=${encodeURIComponent("无法读取身份验证状态，请重试")}`);
      return;
    }
    try {
      const result = await service.completeLinuxDOLogin(
        state,
        code,
        sessionValue(request) ?? "",
        loginRequestContext(request),
      );
      if (!result.reauthenticated && result.session) {
        setSessionCookie(request, response, result.session.session, result.session.maxAgeSecs);
      }
      response.redirect(302, result.next);
    } catch (error) {
      if (reauthentication) {
        response.redirect(302, "/settings?section=profile&reauth=error");
        return;
      }
      response.redirect(302, `/login?oauth_error=${encodeURIComponent((error as Error).message)}`);
    }
  };

  router.get("/auth/linuxdo/callback", callbackHandler);

  router.post("/auth/logout", async (request, response) => {
    try {
      await service.logout(sessionValue(request) ?? "", loginRequestContext(request));
      clearSessionCookie(request, response);
      ok(response, { ok: true });
    } catch (error) {
      failService(response, error);
    }
  });

  const sessionHandler = async (request: Request, response: Response) => {
    try {
      const user = await service.currentUser(sessionValue(request) ?? "");
      ok(response, { user: await service.publicAuthUser(user) });
    } catch {
      // 与 Go handler 一致：未登录时返回 user: null，由前端决定展示登录入口。
      ok(response, { user: null });
    }
  };

  router.get("/auth/session", sessionHandler);
  router.get("/me", sessionHandler);
}

export function registerOAuthCallbackRoutes(router: Router, service: Service): void {
  router.get("/oauth/linuxdo/callback", async (request, response) => {
    let reauthentication = false;
    try {
      reauthentication = await service.linuxDOReauthenticationState(text(request.query.state));
    } catch {
      response.redirect(302, `/login?oauth_error=${encodeURIComponent("无法读取身份验证状态，请重试")}`);
      return;
    }
    try {
      const result = await service.completeLinuxDOLogin(
        text(request.query.state),
        text(request.query.code),
        sessionValue(request) ?? "",
        loginRequestContext(request),
      );
      if (!result.reauthenticated && result.session) {
        setSessionCookie(request, response, result.session.session, result.session.maxAgeSecs);
      }
      response.redirect(302, result.next);
    } catch (error) {
      if (reauthentication) {
        response.redirect(302, "/settings?section=profile&reauth=error");
        return;
      }
      response.redirect(302, `/login?oauth_error=${encodeURIComponent((error as Error).message)}`);
    }
  });
}

export function requireSession(service: Service) {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const user = await service.currentUser(sessionValue(request) ?? "");
      (request as Request & { user?: User; profileActor?: User }).user = user;
      (request as Request & { user?: User; profileActor?: User }).profileActor = user;
      next();
    } catch (error) {
      if (!(error instanceof Error)) {
        failService(response, unauthorized("请先登录"));
        return;
      }
      failService(response, error);
    }
  };
}
