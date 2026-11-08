// 对应 backend/internal/emailidentity/email.go
// 定义邮箱等价性，用于唯一性校验。

/**
 * 保留各服务商本地部分的大小写，仅归一化 Gmail 别名。
 * 它不是账号查找键：已有账号可以共享同一邮箱。
 */
export function canonicalEmail(value: string): string {
  let email = value.trim().toLowerCase();
  const index = email.indexOf("@");
  if (index < 0) return email;
  const local = email.slice(0, index);
  const domain = email.slice(index + 1);
  if (domain !== "gmail.com" && domain !== "googlemail.com") return email;
  const base = local.split("+")[0];
  email = `${base.replace(/\./g, "")}@gmail.com`;
  return email;
}
