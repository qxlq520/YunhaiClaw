// 对应 backend/internal/protocol/documentation.go
// Go 用 embed 打包 docs/*.md；TS 在运行时从同目录 docs/ 读取。
// ACT: 打包成单文件 esbuild 产物时需把 docs/ 一起拷贝到产物旁，否则文档为空。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Metadata, Parameter } from "./types";

const docsDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "docs");

/** 填充内置协议的参考文档。 */
export function attachDocumentation(info: Metadata | null): void {
  if (!info || (info.documentation ?? "").trim()) return;
  let document: string;
  try {
    document = fs.readFileSync(path.join(docsDirectory, `${info.id}.md`), "utf8");
  } catch {
    return;
  }
  info.documentation = renderBuiltinDocumentation(info, document);
}

export function renderBuiltinDocumentation(info: Metadata, document: string): string {
  let result = document;
  const replacements: Record<string, string> = {
    "{{NAME}}": info.name,
    "{{OPERATIONS}}": renderOperations(info),
    "{{PARAMETERS}}": renderParameters(info.parameters ?? []),
    "{{CONTRACT}}": renderRuntimeContract(info),
  };
  for (const [marker, replacement] of Object.entries(replacements)) {
    result = result.replaceAll(marker, replacement);
  }
  return `${result.trim()}\n`;
}

function renderOperations(info: Metadata): string {
  const lines = ["| 阶段 | 方法与相对路径 | 请求类型 | 宿主行为 |", "| --- | --- | --- | --- |"];
  lines.push(
    operationRow(
      "创建",
      info.create ?? "",
      firstNonEmpty(info.contentType ?? "", "application/json"),
      "提交请求；同步协议直接解析结果，异步协议读取任务 ID",
    ),
  );
  if ((info.poll ?? "").trim()) lines.push(operationRow("轮询", info.poll as string, "application/json", "查询状态，成功后提取媒体地址"));
  if ((info.cancel ?? "").trim()) lines.push(operationRow("取消", info.cancel as string, "application/json", "取消仍在运行的任务"));
  return lines.join("\n").trim();
}

function renderParameters(parameters: Parameter[]): string {
  if (parameters.length === 0) {
    return "> 当前适配器没有声明可配置参数；这不表示上游没有参数，只表示宿主尚未建立稳定映射。";
  }
  const lines = ["| 宿主字段 | 类型 | 必填 | 实际上游映射 | 说明 |", "| --- | --- | --- | --- | --- |"];
  for (const parameter of parameters) {
    let description = (parameter.description ?? "").trim();
    if ((parameter.values?.length ?? 0) > 0) {
      description = `${description} 可选值：${(parameter.values ?? []).join("、")}。`.trim();
    }
    lines.push(
      `| \`${markdownCell(parameter.name)}\` | \`${markdownCell(parameter.type)}\` | ${yesNo(Boolean(parameter.required))} | \`${markdownCell(
        firstNonEmpty(parameter.mapping ?? "", "未映射"),
      )}\` | ${markdownCell(firstNonEmpty(description, "由当前协议适配器按请求类型转换。"))} |`,
    );
  }
  return lines.join("\n").trim();
}

function renderRuntimeContract(info: Metadata): string {
  const lines = [
    "## 宿主运行时合同",
    "",
    "- Base URL 只填写协议服务根地址，表中的相对路径由适配器拼接；不要把同一路径重复写进 Base URL。",
    "- 密钥由后端渠道中转读取，插件详情和浏览器请求不保存密钥。Bearer、供应商签名或专用版本头以本文鉴权章节为准。",
    "- 模型名来自渠道模型配置并原样发送。此插件不暗改模型名，也不根据名称猜测价格、额度或能力。",
    "- HTTP 非 2xx、非 JSON 响应、缺少任务 ID、成功状态却没有可识别结果都会作为真实错误向上返回。",
  ];
  if ((info.poll ?? "").trim()) {
    lines.push(
      "- 异步状态统一为：`queued/pending/created/submitted` -> 等待，`running/processing/in_progress` -> 处理中，`succeeded/completed/done` -> 成功，`failed/error/expired/cancelled` -> 失败。",
      "- 轮询频率应遵守上游速率限制；媒体 URL 通常有有效期，成功后应立即进入宿主资源保存流程。",
    );
  }
  lines.push(
    "- 参考素材只接受上游可访问的 HTTP(S) URL 或带 MIME 前缀的 data URL；裸 Base64、登录后才能访问的链接和 Cookie 保护地址不可用。",
    "- 插件只保证下方“当前实现”明确列出的字段。上游新增能力不会自动获得宿主支持，必须补适配、解析和测试。",
  );
  return lines.join("\n").trim();
}

function operationRow(phase: string, value: string, contentType: string, purpose: string): string {
  const trimmed = value.trim();
  const space = trimmed.indexOf(" ");
  const method = space >= 0 ? trimmed.slice(0, space) : "";
  const operationPath = space >= 0 ? trimmed.slice(space + 1) : trimmed;
  return `| ${phase} | \`${markdownCell(method)} ${markdownCell(operationPath)}\` | \`${markdownCell(contentType)}\` | ${purpose} |`;
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function yesNo(value: boolean): string {
  return value ? "是" : "否";
}

function firstNonEmpty(...values: string[]): string {
  for (const value of values) {
    if (value.trim()) return value;
  }
  return "";
}
