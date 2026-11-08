import { AppError, newId } from "@/internal/kernel/errors";
import type { User } from "@/internal/model/modelsIdentity";
import type { CanvasProject } from "@/internal/model/modelsProject";
import type { Task } from "@/internal/model/modelsTask";
import type { TaskStatus } from "@/internal/model/models";
import { Repository } from "@/internal/repository/repository";
import { listCanvasProjects, canvasProject, saveCanvasProject, deleteCanvasProject } from "@/internal/repository/project";
import { listTasks, taskById, deleteTask, type TaskQuery } from "@/internal/repository/task";
import { saveSetting, settingsByPrefix } from "@/internal/repository/setting";
import {
  Service as AuthService,
  sessionCookieName as authSessionCookieName,
  type AuthSessionResult,
  type AuthUser,
  type LoginRequest,
  type PublicAuthSettings,
  type RegisterRequest,
} from "@/internal/auth/authService";
import type { LoginContext } from "@/internal/auth/loginLogs";
import { createAuthHost } from "./authHost";

export const sessionCookieName = authSessionCookieName;
export const defaultBrandName = "云海科技";

export type { AuthSessionResult, AuthUser, LoginRequest, PublicAuthSettings, RegisterRequest };

export type { LoginContext };

export class Service {
  readonly repo: Repository;
  readonly dataDir: string;
  readonly auth: AuthService;

  constructor(repo: Repository, dataDir: string) {
    this.repo = repo;
    this.dataDir = dataDir;
    this.auth = new AuthService(
      repo,
      createAuthHost({ dataDir, brandName: defaultBrandName }),
    );
  }

  async close(): Promise<void> {
    await this.repo.db.close();
  }

  // 认证域方法：实现位于 internal/auth，Service 只做宿主装配。
  publicAuthSettings(): Promise<PublicAuthSettings> {
    return this.auth.publicAuthSettings();
  }

  register(req: RegisterRequest): Promise<AuthSessionResult> {
    return this.auth.register(req);
  }

  login(req: LoginRequest): Promise<AuthSessionResult> {
    return this.auth.login(req);
  }

  loginRateLimitSubject(account: string): Promise<string> {
    return this.auth.loginRateLimitSubject(account);
  }

  logout(cookieValue: string, context?: LoginContext): Promise<void> {
    return this.auth.logout(cookieValue, context);
  }

  currentUser(cookieValue: string): Promise<User> {
    return this.auth.currentUser(cookieValue);
  }

  publicAuthUser(user: User): Promise<AuthUser> {
    return this.auth.publicAuthUser(user);
  }

  adminRegistrationSetting(actor: User | null) {
    return this.auth.adminRegistrationSetting(actor);
  }

  updateRegistrationSetting(actor: User | null, req: import("@/internal/auth/registration").RegistrationSettingRequest) {
    return this.auth.updateRegistrationSetting(actor, req);
  }

  registrationEnabled(): Promise<boolean> {
    return this.auth.registrationEnabled();
  }

  registrationAgreement(): Promise<{ title: string; content: string }> {
    return this.auth.registrationAgreement();
  }

  sendPasswordResetEmailCode(email: string): Promise<void> {
    return this.auth.sendPasswordResetEmailCode(email);
  }

  resetPassword(req: import("@/internal/auth/passwordReset").PasswordResetRequest): Promise<void> {
    return this.auth.resetPassword(req);
  }

  adminEmailSetting(actor: User | null) {
    return this.auth.adminEmailSetting(actor);
  }

  updateEmailSetting(actor: User | null, req: import("@/internal/auth/email").EmailSettingRequest) {
    return this.auth.updateEmailSetting(actor, req);
  }

  emailEnabled(): Promise<boolean> {
    return this.auth.emailEnabled();
  }

  sendRegistrationEmailCode(email: string): Promise<void> {
    return this.auth.sendRegistrationEmailCode(email);
  }

  verifyRegistrationEmailCode(email: string, code: string) {
    return this.auth.verifyRegistrationEmailCode(email, code);
  }

  adminEmailLogs(
    actor: User | null,
    query: import("@/internal/auth/emailAdmin").EmailLogQuery,
    page: number,
    pageSize: number,
  ) {
    return this.auth.adminEmailLogs(actor, query, page, pageSize);
  }

  sendTestEmail(actor: User | null, recipient: string): Promise<void> {
    return this.auth.sendTestEmail(actor, recipient);
  }

  cleanupEmailLogs(): Promise<number> {
    return this.auth.cleanupEmailLogs();
  }

  adminVerificationPolicy(actor: User | null) {
    return this.auth.adminVerificationPolicy(actor);
  }

  updateVerificationPolicy(actor: User | null, policy: import("@/internal/auth/verificationPolicy").VerificationPolicy) {
    return this.auth.updateVerificationPolicy(actor, policy);
  }

  startVerification(actor: User | null, req: import("@/internal/auth/verification").VerificationRequest) {
    return this.auth.startVerification(actor, req);
  }

  loginVerification(req: import("@/internal/auth/verification").VerificationConfirm) {
    return this.auth.loginVerification(req);
  }

  bindVerification(actor: User | null, req: import("@/internal/auth/verification").VerificationConfirm) {
    return this.auth.bindVerification(actor, req);
  }

  adminLinuxDOSetting(actor: User | null) {
    return this.auth.adminLinuxDOSetting(actor);
  }

  updateLinuxDOSetting(actor: User | null, req: import("@/internal/auth/linuxdo").LinuxDOSettingRequest) {
    return this.auth.updateLinuxDOSetting(actor, req);
  }

  linuxDOEnabled(): Promise<boolean> {
    return this.auth.linuxDOEnabled();
  }

  beginLinuxDOLogin(nextPath: string, acceptedTerms: boolean): Promise<string> {
    return this.auth.beginLinuxDOLogin(nextPath, acceptedTerms);
  }

  beginLinuxDOReauthentication(actor: User | null, cookie: string): Promise<string> {
    return this.auth.beginLinuxDOReauthentication(actor, cookie);
  }

  linuxDOReauthenticationState(stateValue: string): Promise<boolean> {
    return this.auth.linuxDOReauthenticationState(stateValue);
  }

  completeLinuxDOLogin(stateValue: string, code: string, cookieValue: string, context?: LoginContext) {
    return this.auth.completeLinuxDOLogin(stateValue, code, cookieValue, context);
  }

  adminLibTVSetting(actor: User | null) {
    return this.auth.adminLibTVSetting(actor);
  }

  updateLibTVSetting(actor: User | null, req: import("@/internal/auth/libtv").LibTVSettingRequest) {
    return this.auth.updateLibTVSetting(actor, req);
  }

  testLibTV(actor: User | null, projectUuid: string): Promise<void> {
    return this.auth.testLibTV(actor, projectUuid);
  }

  importLibTV(userId: string, canvasProjectId: string, projectUuid: string) {
    return this.auth.importLibTV(userId, canvasProjectId, projectUuid);
  }

  importTapNow(userId: string, canvasProjectId: string, shareId: string) {
    return this.auth.importTapNow(userId, canvasProjectId, shareId);
  }

  userProfile(actor: User | null, cookie: string) {
    return this.auth.userProfile(actor, cookie);
  }

  changeProfilePassword(actor: User | null, cookie: string, req: import("@/internal/auth/account").ProfilePasswordRequest) {
    return this.auth.changeProfilePassword(actor, cookie, req);
  }

  sendProfileEmailCode(actor: User | null, cookie: string, req: import("@/internal/auth/account").ProfileEmailCodeRequest) {
    return this.auth.sendProfileEmailCode(actor, cookie, req);
  }

  changeProfileEmail(actor: User | null, cookie: string, req: import("@/internal/auth/account").ProfileEmailChangeRequest) {
    return this.auth.changeProfileEmail(actor, cookie, req);
  }

  updateProfileAvatar(actor: User | null, data: Uint8Array | null) {
    return this.auth.updateProfileAvatar(actor, data);
  }

  useDefaultProfileAvatar(actor: User | null) {
    return this.auth.useDefaultProfileAvatar(actor);
  }

  selectDefaultProfileAvatar(actor: User | null, preset: string) {
    return this.auth.selectDefaultProfileAvatar(actor, preset);
  }

  profileAvatarContent(actor: User | null, targetUserId: string): Promise<Uint8Array> {
    return this.auth.profileAvatarContent(actor, targetUserId);
  }

  // 画布与任务域方法：后续按 repository/handler 的迁移节奏扩展。
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
export { AppError };
