// 对应 backend/internal/auth/registration.go
// 注册开关、协议正文与登录注册打开方式。

import { badAuthRequest } from "@/internal/kernel/errors";
import type { User } from "@/internal/model/modelsIdentity";
import type { SystemSetting } from "@/internal/model/modelsPlatform";
import { saveSetting, setting } from "@/internal/repository/setting";
import type { Service } from "./authService";

export const registrationSettingKey = "registration";

/** 登录注册的打开方式：modal 在当前页面弹出登录框，page 跳转到独立页面。 */
export const loginModeModal = "modal";
export const loginModePage = "page";
export type LoginMode = typeof loginModeModal | typeof loginModePage;

/**
 * 协议字段和打开方式用可选值区分「未提交」和「明确修改」：
 * 注册开关单独切换时不带这些字段，必须保留已保存的协议正文与打开方式。
 */
export interface RegistrationSettingRequest {
  enabled: boolean;
  agreementTitle?: string | null;
  agreementContent?: string | null;
  loginMode?: string | null;
  emailRequired?: boolean | null;
  emailVerificationRequired?: boolean | null;
}

export interface PublicRegistrationSetting {
  enabled: boolean;
  agreementTitle: string;
  agreementContent: string;
  loginMode: LoginMode;
  emailRequired: boolean;
  emailVerificationRequired: boolean;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegistrationSettingValue {
  enabled: boolean;
  agreementTitle: string;
  agreementContent: string;
  /** 旧记录没有该字段，读取时按 modal 处理。 */
  loginMode?: string;
  /** 旧记录没有这两个字段：邮箱按选填、验证按必须处理。 */
  emailRequired?: boolean | null;
  emailVerificationRequired?: boolean | null;
}

export function registrationValueEmailRequired(value: RegistrationSettingValue): boolean {
  return value.emailRequired === true;
}

export function registrationValueVerificationRequired(value: RegistrationSettingValue): boolean {
  return value.emailVerificationRequired === undefined || value.emailVerificationRequired === null
    ? true
    : value.emailVerificationRequired;
}

export interface RegistrationSettingRead {
  setting: SystemSetting | null;
  value: RegistrationSettingValue;
  error: Error | null;
}

export async function readRegistrationSetting(service: Service): Promise<RegistrationSettingRead> {
  const existing = await setting(service.repo, registrationSettingKey);
  if (!existing) {
    return { setting: null, value: { enabled: registrationEnabledFromEnvironment(), agreementTitle: "", agreementContent: "" }, error: null };
  }
  if (!existing.valueJson.trim()) {
    return { setting: null, value: emptyValue(), error: new Error("用户注册配置格式无效") };
  }
  try {
    const value = JSON.parse(existing.valueJson) as RegistrationSettingValue;
    return { setting: existing, value, error: null };
  } catch {
    return { setting: null, value: emptyValue(), error: new Error("用户注册配置格式无效") };
  }
}

function emptyValue(): RegistrationSettingValue {
  return { enabled: false, agreementTitle: "", agreementContent: "" };
}

export async function adminRegistrationSetting(service: Service, actor: User | null): Promise<PublicRegistrationSetting> {
  await service.host.requireAdmin(actor);
  const read = await readRegistrationSetting(service);
  if (read.error) throw read.error;
  return publicRegistrationSetting(read.setting, read.value);
}

export async function updateRegistrationSetting(
  service: Service,
  actor: User | null,
  req: RegistrationSettingRequest,
): Promise<PublicRegistrationSetting> {
  await service.host.requireAdmin(actor);
  const read = await readRegistrationSetting(service);
  if (read.error) throw read.error;
  const currentValue = read.value;
  const nextValue: RegistrationSettingValue = {
    enabled: req.enabled,
    agreementTitle: currentValue.agreementTitle,
    agreementContent: currentValue.agreementContent,
    loginMode: normalizeLoginMode(currentValue.loginMode),
    emailRequired: registrationValueEmailRequired(currentValue),
    emailVerificationRequired: registrationValueVerificationRequired(currentValue),
  };
  if (req.emailRequired !== null && req.emailRequired !== undefined) nextValue.emailRequired = req.emailRequired;
  if (req.emailVerificationRequired !== null && req.emailVerificationRequired !== undefined) {
    nextValue.emailVerificationRequired = req.emailVerificationRequired;
  }
  // 只在本次打开验证要求时检查发送能力：否则新用户会因为无可用验证方式而无法注册。
  if (registrationValueVerificationRequired(nextValue) && !registrationValueVerificationRequired(currentValue)) {
    const methods = await availableRegistrationMethods(service);
    if (methods.length === 0) throw badAuthRequest("当前没有可用的注册验证方式，请先配置并开启邮件服务");
  }
  if (req.agreementTitle !== null && req.agreementTitle !== undefined) {
    nextValue.agreementTitle = req.agreementTitle.trim();
  }
  if (req.agreementContent !== null && req.agreementContent !== undefined) {
    nextValue.agreementContent = req.agreementContent.trim();
  }
  if (req.loginMode !== null && req.loginMode !== undefined) {
    const mode = req.loginMode.trim().toLowerCase();
    if (mode !== loginModeModal && mode !== loginModePage) {
      throw badAuthRequest("登录注册打开方式只能是 modal（弹窗）或 page（独立页面）");
    }
    nextValue.loginMode = mode;
  }
  const encoded = JSON.stringify({
    enabled: nextValue.enabled,
    agreementTitle: nextValue.agreementTitle,
    agreementContent: nextValue.agreementContent,
    loginMode: nextValue.loginMode,
    emailRequired: nextValue.emailRequired,
    emailVerificationRequired: nextValue.emailVerificationRequired,
  });
  const actorId = actor ? actor.id : "";
  await saveSetting(service.repo, registrationSettingKey, encoded, actorId);
  const saved = await setting(service.repo, registrationSettingKey);
  return publicRegistrationSetting(saved, nextValue);
}

export async function registrationEnabled(service: Service): Promise<boolean> {
  const read = await readRegistrationSetting(service);
  if (read.error) throw read.error;
  return read.value.enabled;
}

/** 只用于错误提示；读取失败时不返回品牌名兜底标题。 */
export async function agreementTitleForMessage(service: Service): Promise<string> {
  const agreement = await registrationAgreement(service);
  return agreement.title.trim() === "" ? "服务协议" : agreement.title;
}

/** 返回展示用协议标题（去掉书名号）和正文；标题未配置时跟随当前品牌名。 */
export async function registrationAgreement(service: Service): Promise<{ title: string; content: string }> {
  const read = await readRegistrationSetting(service);
  if (read.error) return { title: "", content: "" };
  let title = read.value.agreementTitle.trim().replace(/^《+|》+$/g, "");
  if (title === "") title = defaultAgreementTitle(service);
  return { title, content: read.value.agreementContent };
}

function defaultAgreementTitle(service: Service): string {
  const brand = service.host.brandName().trim();
  return `${brand === "" ? "影降" : brand}服务协议`;
}

/** 只用于读取已保存的值：缺失或无法识别时回到默认弹窗模式。 */
export function normalizeLoginMode(value: string | undefined): LoginMode {
  return (value ?? "").trim().toLowerCase() === loginModePage ? loginModePage : loginModeModal;
}

export function publicRegistrationSetting(
  saved: SystemSetting | null,
  value: RegistrationSettingValue,
): PublicRegistrationSetting {
  return {
    enabled: value.enabled,
    agreementTitle: value.agreementTitle,
    agreementContent: value.agreementContent,
    loginMode: normalizeLoginMode(value.loginMode),
    emailRequired: registrationValueEmailRequired(value),
    emailVerificationRequired: registrationValueVerificationRequired(value),
    updatedBy: saved ? saved.updatedBy : "",
    createdAt: saved ? saved.createdAt : "",
    updatedAt: saved ? saved.updatedAt : "",
  };
}

export function registrationEnabledFromEnvironment(): boolean {
  const value = (process.env.CANVAS_REGISTRATION_ENABLED ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

// 在 verification_policy.go 中定义；此处转发以保持注册模块的调用位置。
import { availableRegistrationMethods } from "./verificationPolicy";
