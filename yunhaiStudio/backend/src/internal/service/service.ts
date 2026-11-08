import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { AppError, newId, unauthorized, forbidden, invalidArgument, conflict } from "@/internal/kernel/errors";
import { codeAccountNotRegistered } from "@/internal/kernel/errorCodes";
import type { User } from "@/internal/model/modelsIdentity";
import { userRoleAdmin, userRoleUser, userStatusActive, userStatusDisabled } from "@/internal/model/models";
import type { AuthSession } from "@/internal/model/modelsIdentity";
import type { CanvasProject } from "@/internal/model/modelsProject";
import type { Task } from "@/internal/model/modelsTask";
import type { TaskStatus } from "@/internal/model/models";
import { Repository } from "@/internal/repository/repository";
import {
  authSession,
  createAuthSession,
  createUser,
  deleteAuthSession,
  updateUserLoginTime,
  userByAccount,
  userByEmail,
  userById,
  userByUsername,
  userCount,
} from "@/internal/repository/account";
import { listCanvasProjects, canvasProject, saveCanvasProject, deleteCanvasProject } from "@/internal/repository/project";
import { listTasks, taskById, deleteTask, type TaskQuery } from "@/internal/repository/task";
import { saveSetting, settingsByPrefix } from "@/internal/repository/setting";

export const sessionCookieName = "open_ai_canvas_session";

const sessionMaxAgeSeconds = 30 * 24 * 60 * 60;

const usernamePattern = /^[a-zA-Z0-9_-]{3,32}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RegisterRequest {
  username: string;
  email?: string;
  displayName?: string;
  password: string;
  acceptedTerms?: boolean;
}

export interface LoginRequest {
  username: string;
  password: string;
  autoRegister?: boolean;
}

export interface PublicAuthUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: User["role"];
  status: User["status"];
  avatarMode: string;
  avatarPreset: string;
  avatarVersion: string;
  isPromoter: boolean;
  userGroup: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSessionResult {
  user: PublicAuthUser;
  session: string;
  maxAgeSecs: number;
}

export interface PublicAuthSettings {
  firstUser: boolean;
  registrationEnabled: boolean;
  emailEnabled: boolean;
  emailCodeRequired: boolean;
  emailRequired: boolean;
  emailVerificationRequired: boolean;
  linuxDoEnabled: boolean;
  loginMode: string;
  agreementTitle: string;
  agreementContent: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function randomToken(): string {
  return randomBytes(32).toString("hex");
}

export function parseSessionCookie(value: string | undefined): { sessionId: string; token: string } | null {
  if (!value) return null;
  const index = value.indexOf(".");
  if (index < 0) return null;
  const sessionId = value.slice(0, index).trim();
  const token = value.slice(index + 1).trim();
  if (!sessionId || !token) return null;
  return { sessionId, token };
}

export function publicAuthUser(user: User): PublicAuthUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email ?? "",
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    avatarMode: user.avatarMode,
    avatarPreset: user.avatarPreset ?? "",
    avatarVersion: user.avatarVersion ?? "",
    isPromoter: user.isPromoter,
    userGroup: user.userGroup,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export class Service {
  readonly repo: Repository;
  readonly dataDir: string;

  constructor(repo: Repository, dataDir: string) {
    this.repo = repo;
    this.dataDir = dataDir;
  }

  async close(): Promise<void> {
    await this.repo.db.close();
  }

  async publicAuthSettings(): Promise<PublicAuthSettings> {
    const count = await userCount(this.repo);
    return {
      firstUser: count === 0,
      registrationEnabled: true,
      emailEnabled: false,
      emailCodeRequired: false,
      emailRequired: false,
      emailVerificationRequired: false,
      linuxDoEnabled: false,
      loginMode: "modal",
      agreementTitle: "",
      agreementContent: "",
    };
  }

  private validatePassword(password: string): void {
    if (typeof password !== "string" || password.length < 8) throw invalidArgument("密码至少需要 8 位");
    if (password.length > 128) throw invalidArgument("密码过长");
  }

  async register(request: RegisterRequest): Promise<AuthSessionResult> {
    const username = (request.username ?? "").trim();
    if (!usernamePattern.test(username)) throw invalidArgument("用户名需为 3-32 位字母、数字、下划线或短横线");
    if (request.email && !emailPattern.test(request.email.trim())) throw invalidArgument("邮箱格式不正确");
    this.validatePassword(request.password);

    const existing = await userByUsername(this.repo, username);
    if (existing) throw conflict("用户名已被占用");
    if (request.email) {
      const emailOwner = await userByEmail(this.repo, request.email.trim().toLowerCase());
      if (emailOwner) throw conflict("邮箱已被占用");
    }

    const count = await userCount(this.repo);
    const now = new Date().toISOString();
    const user: User = {
      id: newId(),
      username,
      email: request.email ? request.email.trim().toLowerCase() : "",
      phone: "",
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
      displayName: request.displayName?.trim() || username,
      avatarMode: "preset",
      avatarPreset: "",
      avatarVersion: "",
      role: count === 0 ? userRoleAdmin : userRoleUser,
      status: userStatusActive,
      isPromoter: false,
      userGroup: "",
      passwordHash: await bcrypt.hash(request.password, 10),
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await createUser(this.repo, user);
    return this.createSession(user);
  }

  async login(request: LoginRequest): Promise<AuthSessionResult> {
    const account = (request.username ?? "").trim();
    if (!account) throw invalidArgument("请输入用户名或邮箱");
    this.validatePassword(request.password);
    const user = await userByAccount(this.repo, account);
    if (!user) {
      if (request.autoRegister) {
        throw new AppError({ status: 404, code: codeAccountNotRegistered, reason: "account_not_registered", message: "该账号尚未注册，确认密码后即可创建账号" });
      }
      throw unauthorized("用户名、邮箱或密码不正确");
    }
    if (user.status === userStatusDisabled) throw forbidden("该账号已被禁用");
    const matched = await bcrypt.compare(request.password, user.passwordHash ?? "");
    if (!matched) throw unauthorized("用户名、邮箱或密码不正确");
    const now = new Date().toISOString();
    await updateUserLoginTime(this.repo, user.id, now);
    user.lastLoginAt = now;
    user.updatedAt = now;
    return this.createSession(user);
  }

  private async createSession(user: User): Promise<AuthSessionResult> {
    const token = randomToken();
    const now = new Date();
    const session: AuthSession = {
      id: newId(),
      userId: user.id,
      tokenHash: hashToken(token),
      reauthenticatedAt: null,
      expiresAt: new Date(now.getTime() + sessionMaxAgeSeconds * 1000).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await createAuthSession(this.repo, session);
    return { user: publicAuthUser(user), session: `${session.id}.${token}`, maxAgeSecs: sessionMaxAgeSeconds };
  }

  async logout(cookieValue: string | undefined): Promise<void> {
    const parsed = parseSessionCookie(cookieValue);
    if (!parsed) return;
    await deleteAuthSession(this.repo, parsed.sessionId);
  }

  async currentUser(cookieValue: string | undefined): Promise<User> {
    const parsed = parseSessionCookie(cookieValue);
    if (!parsed) throw unauthorized("请先登录");
    const session = await authSession(this.repo, parsed.sessionId);
    if (!session) throw unauthorized("登录状态已失效");
    if (session.tokenHash !== hashToken(parsed.token)) throw unauthorized("登录状态已失效");
    if (new Date(session.expiresAt).getTime() <= Date.now()) throw unauthorized("登录状态已过期");
    const user = await userById(this.repo, session.userId);
    if (!user) throw unauthorized("登录状态已失效");
    if (user.status === userStatusDisabled) throw forbidden("该账号已被禁用");
    return user;
  }

  async listProjects(user: User): Promise<CanvasProject[]> {
    return listCanvasProjects(this.repo, user.id);
  }

  async project(user: User, id: string): Promise<CanvasProject | null> {
    return canvasProject(this.repo, user.id, id);
  }

  async saveProject(user: User, payload: Record<string, unknown>): Promise<CanvasProject> {
    const now = new Date().toISOString();
    const id = String(payload.id ?? "").trim() || newId();
    const existing = await canvasProject(this.repo, user.id, id);
    const project: CanvasProject = {
      id,
      userId: user.id,
      projectId: String(payload.projectId ?? existing?.projectId ?? ""),
      title: String(payload.title ?? existing?.title ?? "未命名画布"),
      payloadJson: typeof payload.payloadJson === "string" ? payload.payloadJson : JSON.stringify(payload.payload ?? {}),
      revision: Number(payload.revision ?? (existing ? existing.revision + 1 : 1)),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await saveCanvasProject(this.repo, project);
    return project;
  }

  async removeProject(user: User, id: string): Promise<boolean> {
    return deleteCanvasProject(this.repo, user.id, id);
  }

  async tasks(user: User, query: TaskQuery): Promise<Task[]> {
    return listTasks(this.repo, user.id, query);
  }

  async task(user: User, id: string): Promise<Task | null> {
    return taskById(this.repo, user.id, id);
  }

  async removeTask(user: User, id: string): Promise<boolean> {
    return deleteTask(this.repo, user.id, id);
  }

  async getSettings(prefix = ""): Promise<Record<string, unknown>> {
    const rows = await settingsByPrefix(this.repo, prefix);
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.valueJson);
      } catch {
        result[row.key] = row.valueJson;
      }
    }
    return result;
  }

  async saveSettings(values: Record<string, unknown>, userId: string): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      await saveSetting(this.repo, key, JSON.stringify(value), userId);
    }
  }
}

export type { TaskQuery };
