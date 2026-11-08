// 对应 backend/internal/app/auth_bridge.go 与 settings.go 的设置密钥、限流部分。
// 供 auth.Service 使用的宿主实现。

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { Host } from "@/internal/auth/authService";
import { forbidden, unauthorized } from "@/internal/kernel/errors";
import { userRoleAdmin } from "@/internal/model/models";
import type { User } from "@/internal/model/modelsIdentity";

const encryptedSettingPrefix = "enc:v1:";
const settingsKeyFileName = ".settings-key";

export interface AuthHostOptions {
  dataDir: string;
  brandName: string;
}

export function createAuthHost(options: AuthHostOptions): Host {
  const requests = new Map<string, { count: number; resetAt: number }>();
  const now = () => Date.now();
  return {
    requireAdmin(user: User | null): void {
      if (!user) throw unauthorized("请先登录");
      if (user.role !== userRoleAdmin) throw forbidden("需要管理员权限");
    },
    encryptSecret(value: string): string {
      return encryptSettingSecret(options.dataDir, value);
    },
    decryptSecret(value: string): string {
      return decryptSettingSecret(options.dataDir, value);
    },
    settingsEncryptionKey(): Uint8Array {
      return readSettingsEncryptionKey(options.dataDir);
    },
    brandName(): string {
      return options.brandName;
    },
    // 签到奖励、邀请关系与活跃统计随 app 包迁移接入，当前保持空实现。
    ensureSignupBonus: () => undefined,
    bindReferral: () => undefined,
    recordActivity: () => undefined,
    // ACT: 进程内固定窗口限流；多进程或重启后计数不共享，后续由 platform 包替换。
    allowRequest(key: string, limit: number, windowMs: number): boolean {
      const current = now();
      const entry = requests.get(key);
      if (!entry || entry.resetAt <= current) {
        requests.set(key, { count: 1, resetAt: current + windowMs });
        return true;
      }
      if (entry.count >= limit) return false;
      entry.count += 1;
      return true;
    },
    requestRetryAfter(key: string, windowMs: number): number {
      const entry = requests.get(key);
      if (!entry) return 0;
      const remaining = entry.resetAt - now();
      if (remaining <= 0 || remaining > windowMs) return 0;
      return remaining;
    },
  };
}

export function readSettingsEncryptionKey(dataDir: string): Buffer {
  const path = join(dataDir, settingsKeyFileName);
  const existing = readKeyIfValid(path);
  if (existing) return existing;
  mkdirSync(dataDir, { recursive: true, mode: 0o750 });
  const key = randomBytes(32);
  let file: number;
  try {
    file = openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const current = readKeyWithRetry(path);
      if (current) return current;
    }
    throw error;
  }
  try {
    writeSync(file, key);
  } finally {
    closeSync(file);
  }
  return key;
}

function readKeyWithRetry(path: string): Buffer {
  // 其他进程可能刚创建文件但尚未写完，短暂重试后仍无效则报错。
  for (let attempt = 0; attempt < 11; attempt += 1) {
    const key = readKeyIfValid(path);
    if (key) return key;
    if (attempt < 10) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  throw new Error("存储加密密钥长度无效");
}

function readKeyIfValid(path: string): Buffer | null {
  try {
    const data = readFileSync(path);
    return data.length === 32 ? data : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function encryptSettingSecret(dataDir: string, value: string): string {
  if (value === "") return "";
  const key = readSettingsEncryptionKey(dataDir);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const payload = Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
  return `${encryptedSettingPrefix}${payload.toString("base64").replace(/=+$/, "")}`;
}

export function decryptSettingSecret(dataDir: string, value: string): string {
  if (!value.startsWith(encryptedSettingPrefix)) return value;
  const payload = Buffer.from(value.slice(encryptedSettingPrefix.length), "base64");
  if (payload.length < 28) throw new Error("设置密文长度无效");
  const key = readSettingsEncryptionKey(dataDir);
  const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(payload.length - 16));
  try {
    return Buffer.concat([decipher.update(payload.subarray(12, payload.length - 16)), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("设置密文解密失败，请检查存储加密密钥");
  }
}
