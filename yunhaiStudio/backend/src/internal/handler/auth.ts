import type { NextFunction, Request, Response, Router } from "express";
import { unauthorized } from "@/internal/kernel/errors";
import { failService, ok } from "./response";
import { sessionCookieName, Service, type LoginRequest, type RegisterRequest } from "@/internal/service/service";

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
      const result = await service.register(request.body as RegisterRequest);
      setSessionCookie(request, response, result.session, result.maxAgeSecs);
      ok(response, { user: result.user });
    } catch (error) {
      failService(response, error);
    }
  });

  router.post("/auth/login", async (request, response) => {
    try {
      const result = await service.login(request.body as LoginRequest);
      setSessionCookie(request, response, result.session, result.maxAgeSecs);
      ok(response, { user: result.user });
    } catch (error) {
      failService(response, error);
    }
  });

  router.post("/auth/logout", async (request, response) => {
    try {
      await service.logout(sessionValue(request));
      clearSessionCookie(request, response);
      ok(response, { loggedOut: true });
    } catch (error) {
      failService(response, error);
    }
  });

  const sessionHandler = async (request: Request, response: Response) => {
    try {
      const user = await service.currentUser(sessionValue(request));
      ok(response, { user: publicUser(user) });
    } catch (error) {
      failService(response, error);
    }
  };

  router.get("/auth/session", sessionHandler);
  router.get("/me", sessionHandler);
}

function publicUser(user: Awaited<ReturnType<Service["currentUser"]>>): unknown {
  const { passwordHash, ...rest } = user;
  void passwordHash;
  return rest;
}

export function requireSession(service: Service) {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const user = await service.currentUser(sessionValue(request));
      (request as Request & { user?: unknown }).user = user;
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
