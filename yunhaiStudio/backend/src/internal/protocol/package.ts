// 对应 backend/internal/protocol/package.go
// 用 Node 内置 zlib 解析 zip 中央目录，保持与原实现的路径白名单、文件数、单文件大小、
// 符号链接和运行时入口校验一致。
// ACT: 只支持 32 位 zip（不支持 zip64），插件包上限 48MB 已足够覆盖实际安装包。

import zlib from "node:zlib";
import { hasAnyPaymentRpcBackend } from "./paymentRpc";
import { manifestFromWire } from "./types";
import type { Manifest } from "./types";
import { validateManifest } from "./manifest";

export const PluginPackageFormat = "yingce.plugin/package-v1";
export const PluginPackageMaxBytes = 48 << 20;
export const PluginManifestMaxBytes = 512 << 10;
const pluginPackageMaxFiles = 256;
const pluginPackageMaxEntry = 16 << 20;

export interface PluginPackage {
  manifest: Manifest;
  manifestRaw: Uint8Array;
  files: Map<string, Uint8Array | null>;
}

export interface PluginPackageInfo {
  manifest: Manifest;
  manifestRaw: Uint8Array;
}

interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compression: number;
  crc32: number;
  localOffset: number;
  externalAttributes: number;
  versionMadeBy: number;
}

export function parsePluginPackage(data: Uint8Array): { value: PluginPackage | null; error: Error | null } {
  return readPluginPackage(data, null);
}

/** 与 ParsePluginPackage 做同样的结构校验，但只解压 manifest.json。 */
export function inspectPluginPackage(data: Uint8Array): { value: PluginPackageInfo | null; error: Error | null } {
  const parsed = readPluginPackage(data, () => false);
  if (parsed.error || !parsed.value) return { value: null, error: parsed.error };
  return { value: { manifest: parsed.value.manifest, manifestRaw: parsed.value.manifestRaw }, error: null };
}

/** 做完全相同的校验，但只解压 keep 返回 true 的条目；其余条目值为 null，仅用于存在性判断。 */
export function parsePluginPackageFiles(
  data: Uint8Array,
  keep: ((name: string) => boolean) | null,
): { value: PluginPackage | null; error: Error | null } {
  return readPluginPackage(data, keep ?? (() => false));
}

function readPluginPackage(data: Uint8Array, keep: ((name: string) => boolean) | null): { value: PluginPackage | null; error: Error | null } {
  if (data.length === 0 || data.length > PluginPackageMaxBytes) {
    return { value: null, error: new Error(`plugin package must be between 1 and ${PluginPackageMaxBytes} bytes`) };
  }
  let entries: ZipEntry[];
  try {
    entries = readCentralDirectory(data);
  } catch (error) {
    return { value: null, error: new Error(`decode plugin package: ${(error as Error).message}`) };
  }
  if (entries.length === 0 || entries.length > pluginPackageMaxFiles) {
    return { value: null, error: new Error(`plugin package must contain between 1 and ${pluginPackageMaxFiles} files`) };
  }
  const files = new Map<string, Uint8Array | null>();
  let manifestRaw: Uint8Array | null = null;
  for (const entry of entries) {
    const validated = validatePluginPackagePath(entry.name);
    if (validated.error || validated.name === null) return { value: null, error: validated.error };
    const name = validated.name;
    if (files.has(name)) return { value: null, error: new Error(`duplicate plugin package file "${name}"`) };
    if (isSymlink(entry)) return { value: null, error: new Error(`plugin package cannot contain symlink "${name}"`) };
    if (entry.uncompressedSize > pluginPackageMaxEntry) {
      return { value: null, error: new Error(`plugin package file "${name}" exceeds ${pluginPackageMaxEntry} bytes`) };
    }
    if (keep !== null && name !== "manifest.json" && !keep(name)) {
      files.set(name, null);
      continue;
    }
    const extracted = extractEntry(data, entry);
    if (extracted.error || !extracted.content) {
      return { value: null, error: new Error(`read plugin package file "${name}": ${extracted.error?.message ?? "empty"}`) };
    }
    if (extracted.content.length > pluginPackageMaxEntry) {
      return { value: null, error: new Error(`plugin package file "${name}" exceeds ${pluginPackageMaxEntry} bytes`) };
    }
    files.set(name, extracted.content);
    if (name === "manifest.json") manifestRaw = extracted.content;
  }
  if (!manifestRaw || manifestRaw.length === 0) return { value: null, error: new Error("plugin package must contain manifest.json") };
  if (manifestRaw.length > PluginManifestMaxBytes) {
    return { value: null, error: new Error(`manifest.json exceeds ${PluginManifestMaxBytes} bytes`) };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(manifestRaw));
  } catch (error) {
    return { value: null, error: new Error(`decode plugin manifest: ${(error as Error).message}`) };
  }
  const manifest = manifestFromWire(raw);
  const manifestError = validateManifest(manifest);
  if (manifestError) return { value: null, error: manifestError };
  const runtimeError = validatePluginPackageRuntime(manifest, files);
  if (runtimeError) return { value: null, error: runtimeError };
  return { value: { manifest, manifestRaw, files }, error: null };
}

function readU16(buffer: Uint8Array, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8);
}

function readU32(buffer: Uint8Array, offset: number): number {
  return (buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16) | (buffer[offset + 3] << 24)) >>> 0;
}

function readCentralDirectory(data: Uint8Array): ZipEntry[] {
  const eocdSignature = 0x06054b50;
  const searchStart = Math.max(0, data.length - 66_000);
  let eocd = -1;
  for (let offset = data.length - 22; offset >= searchStart; offset -= 1) {
    if (readU32(data, offset) === eocdSignature) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip: not a valid zip archive");
  const total = readU16(data, eocd + 10);
  const offset = readU32(data, eocd + 16);
  if (offset === 0xffffffff || total === 0xffff) throw new Error("zip: zip64 is not supported");
  const entries: ZipEntry[] = [];
  let cursor = offset;
  for (let index = 0; index < total; index += 1) {
    if (readU32(data, cursor) !== 0x02014b50) throw new Error("zip: invalid central directory");
    const versionMadeBy = readU16(data, cursor + 4);
    const compression = readU16(data, cursor + 10);
    const crc = readU32(data, cursor + 16);
    const compressedSize = readU32(data, cursor + 20);
    const uncompressedSize = readU32(data, cursor + 24);
    const nameLength = readU16(data, cursor + 28);
    const extraLength = readU16(data, cursor + 30);
    const commentLength = readU16(data, cursor + 32);
    const externalAttributes = readU32(data, cursor + 38);
    const localOffset = readU32(data, cursor + 42);
    const name = new TextDecoder().decode(data.subarray(cursor + 46, cursor + 46 + nameLength));
    entries.push({ name, compressedSize, uncompressedSize, compression, crc32: crc, localOffset, externalAttributes, versionMadeBy });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function isSymlink(entry: ZipEntry): boolean {
  if (entry.versionMadeBy >> 8 !== 3) return false;
  return ((entry.externalAttributes >>> 16) & 0xf000) === 0xa000;
}

function extractEntry(data: Uint8Array, entry: ZipEntry): { content: Uint8Array | null; error: Error | null } {
  if (entry.localOffset + 30 > data.length || readU32(data, entry.localOffset) !== 0x04034b50) {
    return { content: null, error: new Error("zip: invalid local header") };
  }
  const nameLength = readU16(data, entry.localOffset + 26);
  const extraLength = readU16(data, entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > data.length) return { content: null, error: new Error("zip: truncated entry") };
  const raw = data.subarray(start, end);
  let content: Uint8Array;
  if (entry.compression === 0) {
    content = raw;
  } else if (entry.compression === 8) {
    content = zlib.inflateRawSync(raw, { maxOutputLength: pluginPackageMaxEntry + 1 });
  } else {
    return { content: null, error: new Error(`zip: unsupported compression method ${entry.compression}`) };
  }
  if (content.length > pluginPackageMaxEntry) {
    return { content: null, error: new Error(`file exceeds ${pluginPackageMaxEntry} bytes`) };
  }
  if (crc32(content) !== entry.crc32) return { content: null, error: new Error("zip: checksum mismatch") };
  return { content, error: null };
}

let crcTable: Uint32Array | null = null;

function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function cleanPosixPath(value: string): string {
  if (value === "") return ".";
  const rooted = value.startsWith("/");
  const parts: string[] = [];
  for (const segment of value.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length > 0) parts.pop();
      else if (!rooted) parts.push("..");
      continue;
    }
    parts.push(segment);
  }
  const joined = parts.join("/");
  if (rooted) return `/${joined}`;
  return joined || ".";
}

function validatePluginPackagePath(value: string): { name: string | null; error: Error | null } {
  const name = value.trim();
  if (
    name === "" ||
    name.includes("\\") ||
    name.startsWith("/") ||
    cleanPosixPath(name) !== name ||
    name.startsWith("../") ||
    name === ".."
  ) {
    return { name: null, error: new Error(`invalid plugin package path "${name}"`) };
  }
  if (
    name === "manifest.json" ||
    name.startsWith("web/") ||
    name.startsWith("backend/") ||
    name.startsWith("assets/") ||
    name.startsWith("docs/") ||
    name === "README.md" ||
    name === "LICENSE"
  ) {
    return { name, error: null };
  }
  return { name: null, error: new Error(`plugin package path "${name}" is outside the allowed package roots`) };
}

function validatePluginPackageRuntime(manifest: Manifest, files: Map<string, Uint8Array | null>): Error | null {
  const backend = (manifest.runtime?.backend ?? "").trim();
  if (backend === "rpc" || backend === "wasm") {
    const entry = (manifest.runtime?.backendEntry ?? "").trim();
    if (!entry.startsWith("backend/") || cleanPosixPath(entry) !== entry) {
      return new Error("manifest.runtime.backendEntry must point inside backend/");
    }
    if (backend === "rpc") {
      if (!hasAnyPaymentRpcBackend(entry, files)) {
        return new Error(`manifest runtime backend entry "${entry}" is missing a host-executable artifact`);
      }
    } else if (!files.has(entry)) {
      return new Error(`manifest runtime backend entry "${entry}" is missing from package`);
    }
    if (backend === "wasm" && !entry.toLowerCase().endsWith(".wasm")) {
      return new Error("wasm backend entry must have .wasm extension");
    }
  }
  const manifestEntry = (manifest.entry ?? "").trim();
  if (!manifestEntry) {
    if ((manifest.runtime?.web ?? "").trim()) return new Error("manifest.runtime.web requires manifest.entry");
    for (const name of files.keys()) {
      if (name.startsWith("web/")) return new Error("plugin package web files require manifest.entry");
    }
    return null;
  }
  if (!manifestEntry.startsWith("web/") || cleanPosixPath(manifestEntry) !== manifestEntry) {
    return new Error("plugin manifest entry must point inside web/");
  }
  if (!files.has(manifestEntry)) return new Error(`plugin manifest entry "${manifestEntry}" is missing from package`);
  if (manifest.runtime?.web !== "sandbox" && manifest.runtime?.web !== "worker") {
    return new Error("uploaded web plugins require runtime.web sandbox or worker");
  }
  return null;
}
