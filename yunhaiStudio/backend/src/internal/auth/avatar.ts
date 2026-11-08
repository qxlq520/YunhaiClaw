// 对应 backend/internal/auth/avatar.go
// 头像上传、系统头像选择与读取。

import { createHash } from "node:crypto";
import sharp from "sharp";
import { badAuthRequest, forbidden, notFound, unauthorized, wrapAppError } from "@/internal/kernel/errors";
import { userStatusActive } from "@/internal/model/models";
import type { User } from "@/internal/model/modelsIdentity";
import { userById } from "@/internal/repository/account";
import { updateUserAvatar, userAvatar } from "@/internal/repository/userAvatar";
import { profileAvatarUrl, type AuthUser, type Service } from "./authService";

export const maxProfileAvatarBytes = 5 << 20;
export const maxProfileAvatarPixels = 16_000_000;
export const maxProfileAvatarSide = 512;

export async function avatarActor(service: Service, actor: User | null): Promise<User> {
  if (!actor || actor.id === "") throw unauthorized("请先登录");
  if (actor.status !== userStatusActive) throw forbidden("该账号已被禁用");
  const user = await userById(service.repo, actor.id);
  if (!user) throw unauthorized("登录状态已失效");
  if (user.status !== userStatusActive) throw forbidden("该账号已被禁用");
  return user;
}

export async function updateProfileAvatar(service: Service, actor: User | null, data: Uint8Array | null): Promise<AuthUser> {
  const user = await avatarActor(service, actor);
  if (!data || data.length === 0) throw badAuthRequest("请选择头像图片");
  if (data.length > maxProfileAvatarBytes) throw badAuthRequest("头像图片不能超过 5 MiB");
  const normalized = await normalizeProfileAvatar(data);
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 32);
  return saveProfileAvatar(service, user, normalized, hash, "");
}

export async function useDefaultProfileAvatar(service: Service, actor: User | null): Promise<AuthUser> {
  return selectDefaultProfileAvatar(service, actor, "person");
}

const defaultPresets = new Set(["person", "director", "camera", "cat", "rabbit", "robot", "rocket", "sparkles"]);

export async function selectDefaultProfileAvatar(
  service: Service,
  actor: User | null,
  preset: string,
): Promise<AuthUser> {
  const user = await avatarActor(service, actor);
  if (!defaultPresets.has(preset)) throw badAuthRequest("请选择有效的系统头像");
  return saveProfileAvatar(service, user, null, "", preset);
}

async function saveProfileAvatar(
  service: Service,
  user: User,
  data: Uint8Array | null,
  version: string,
  preset: string,
): Promise<AuthUser> {
  // 先读取第三方身份元数据，避免身份查询失败时头像已经写入却返回失败。
  const result = await service.publicAuthUser(user);
  let updated: User;
  try {
    updated = await updateUserAvatar(service.repo, user.id, data, version, preset, new Date().toISOString());
  } catch (error) {
    if (error instanceof Error && error.message === "avatar owner is not active") {
      throw forbidden("该账号已被禁用或不存在");
    }
    throw error;
  }
  const merged: AuthUser = {
    ...result,
    avatarMode: updated.avatarMode,
    avatarPreset: updated.avatarPreset,
    updatedAt: updated.updatedAt,
  };
  merged.avatarUrl = updated.avatarMode === "custom" ? profileAvatarUrl(updated) : undefined;
  return merged;
}

export async function profileAvatarContent(service: Service, actor: User | null, targetUserId: string): Promise<Uint8Array> {
  const user = await avatarActor(service, actor);
  if (targetUserId !== user.id) throw forbidden("无权读取其他用户头像");
  if (user.avatarMode !== "custom") throw notFound("未设置自定义头像");
  const avatar = await userAvatar(service.repo, user.id);
  if (!avatar) throw notFound("头像图片不存在");
  return avatar;
}

/**
 * ACT: Go 手写 bilinear 采样与 PNG 编码；Node 无内置图像编解码，使用 sharp（libvips）。
 * 行为等价：只接受 PNG/JPEG、限制 1600 万像素、居中裁正方形、最长边 512、统一转 PNG。
 */
export async function normalizeProfileAvatar(data: Uint8Array): Promise<Uint8Array> {
  let meta;
  try {
    meta = await sharp(data, { limitInputPixels: maxProfileAvatarPixels, failOn: "error" }).metadata();
  } catch {
    throw badAuthRequest("头像仅支持有效的 PNG 或 JPEG 图片");
  }
  if (meta.format !== "png" && meta.format !== "jpeg") {
    throw badAuthRequest("头像仅支持有效的 PNG 或 JPEG 图片");
  }
  if (!meta.width || !meta.height) throw badAuthRequest("头像图片已损坏");
  if (meta.width * meta.height > maxProfileAvatarPixels) throw badAuthRequest("头像图片不能超过 1600 万像素");
  const side = Math.min(meta.width, meta.height, maxProfileAvatarSide);
  try {
    const output = await sharp(data)
      .resize(side, side, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();
    return new Uint8Array(output);
  } catch (error) {
    throw wrapAppError(400, "头像图片已损坏", error);
  }
}
