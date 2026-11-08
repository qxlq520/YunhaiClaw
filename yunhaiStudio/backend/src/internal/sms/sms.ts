// 对应 backend/internal/sms 包中与认证相关的基础能力。
// ACT: 完整 SMS 渠道/记录/发送服务依赖外部短信提供商 SDK，随 sms 包整体迁移时补齐。

import { badAuthRequest } from "@/internal/kernel/errors";

const phonePattern = /^1[3-9][0-9]{9}$/;

export function normalizePhone(value: string): string {
  let phone = value.trim();
  if (phone.startsWith("+86")) phone = phone.slice(3);
  if (!phonePattern.test(phone)) {
    throw badAuthRequest("请输入中国大陆手机号（支持 +86）");
  }
  return `+86${phone}`;
}
