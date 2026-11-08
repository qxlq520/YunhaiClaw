// 对应 backend/internal/auth/verification_policy.go
// 登录注册的验证方式策略。

import { badAuthRequest, AppError } from "@/internal/kernel/errors";
import type { User } from "@/internal/model/modelsIdentity";
import { saveSetting, setting } from "@/internal/repository/setting";
import { hashToken, type Service } from "./authService";
import { emailEnabled } from "./email";

export const authPolicyKey = "auth_verification_policy";

export interface VerificationPolicy {
  smsLogin: boolean;
  emailLogin: boolean;
  smsRegistration: boolean;
  emailRegistration: boolean;
  smsAndEmailRegistration: boolean;
}

export function defaultVerificationPolicy(): VerificationPolicy {
  return {
    smsLogin: false,
    emailLogin: false,
    smsRegistration: false,
    emailRegistration: true,
    smsAndEmailRegistration: false,
  };
}

export async function verificationPolicy(service: Service): Promise<VerificationPolicy> {
  const saved = await setting(service.repo, authPolicyKey);
  if (!saved) return defaultVerificationPolicy();
  try {
    const parsed = JSON.parse(saved.valueJson) as Partial<VerificationPolicy>;
    return {
      smsLogin: parsed.smsLogin === true,
      emailLogin: parsed.emailLogin === true,
      smsRegistration: parsed.smsRegistration === true,
      emailRegistration: parsed.emailRegistration === true,
      smsAndEmailRegistration: parsed.smsAndEmailRegistration === true,
    };
  } catch {
    throw new AppError({
      status: 503,
      code: 503,
      message: "登录注册策略格式无效",
    });
  }
}

export async function adminVerificationPolicy(service: Service, actor: User | null): Promise<VerificationPolicy> {
  await service.host.requireAdmin(actor);
  return verificationPolicy(service);
}

export async function updateVerificationPolicy(
  service: Service,
  actor: User | null,
  policy: VerificationPolicy,
): Promise<VerificationPolicy> {
  await service.host.requireAdmin(actor);
  if (policy.smsAndEmailRegistration && (policy.smsRegistration || policy.emailRegistration)) {
    throw badAuthRequest("短信+邮箱同时验证不能与单一验证注册同时开启");
  }
  if (policy.emailLogin || policy.emailRegistration || policy.smsAndEmailRegistration) {
    if (!(await emailEnabled(service))) throw badAuthRequest("请先配置并开启邮件服务");
  }
  const scenes: [string, boolean][] = [
    ["login", policy.smsLogin],
    ["register", policy.smsRegistration || policy.smsAndEmailRegistration],
  ];
  for (const [scene, required] of scenes) {
    if (!required) continue;
    if (!(await smsAvailable(service, scene))) {
      throw badAuthRequest(`请先启用短信插件并配置对应场景的短信渠道：${scene}`);
    }
  }
  const value: VerificationPolicy = {
    smsLogin: policy.smsLogin === true,
    emailLogin: policy.emailLogin === true,
    smsRegistration: policy.smsRegistration === true,
    emailRegistration: policy.emailRegistration === true,
    smsAndEmailRegistration: policy.smsAndEmailRegistration === true,
  };
  await saveSetting(service.repo, authPolicyKey, JSON.stringify(value), actor ? actor.id : "");
  return value;
}

export async function smsAvailable(service: Service, scene: string): Promise<boolean> {
  if (!service.sms) return false;
  return service.sms.available(scene);
}

export function policyAllows(policy: VerificationPolicy, purpose: string, method: string): boolean {
  if (purpose === "bind") return method === "sms" || method === "email";
  if (purpose === "login") {
    return (method === "sms" && policy.smsLogin) || (method === "email" && policy.emailLogin);
  }
  if (purpose === "register") {
    if (policy.smsAndEmailRegistration) return method === "sms_email";
    return (method === "sms" && policy.smsRegistration) || (method === "email" && policy.emailRegistration);
  }
  return false;
}

export function policyHash(policy: VerificationPolicy): string {
  return hashToken(JSON.stringify(policy));
}

/** 返回策略开启且发送能力就绪的注册验证方式，与公开设置的过滤口径一致。 */
export async function availableRegistrationMethods(service: Service): Promise<string[]> {
  const policy = await verificationPolicy(service);
  const mailReady = await emailEnabled(service);
  const smsReady = await smsAvailable(service, "register");
  if (policy.smsAndEmailRegistration) {
    return smsReady && mailReady ? ["sms_email"] : [];
  }
  const methods: string[] = [];
  if (policy.smsRegistration && smsReady) methods.push("sms");
  if (policy.emailRegistration && mailReady) methods.push("email");
  return methods;
}
