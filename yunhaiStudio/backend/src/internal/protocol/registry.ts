// 对应 backend/internal/protocol/registry.go

import type { Adapter } from "./adapter";
import { loadManifest } from "./manifest";
import type { Capability, Metadata, Surface } from "./types";

export class Registry {
  private readonly adapters = new Map<string, Adapter>();

  constructor(adapters: Adapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: Adapter | null): void {
    if (!adapter) throw new Error("protocol adapter is nil");
    const metadata = adapter.Metadata();
    metadata.id = metadata.id.trim();
    metadata.version = metadata.version.trim();
    if (!metadata.id || !metadata.version) throw new Error("protocol adapter metadata requires id and version");
    if (this.adapters.has(metadata.id)) throw new Error(`protocol adapter "${metadata.id}" is already registered`);
    this.adapters.set(metadata.id, adapter);
  }

  /** 从在线注册表移除一个已安装协议；持久化由调用方负责。 */
  unregister(id: string): boolean {
    return this.adapters.delete(id.trim());
  }

  registerManifest(data: Uint8Array): void {
    const { adapter, error } = loadManifest(data);
    if (error || !adapter) throw error ?? new Error("plugin manifest is invalid");
    this.register(adapter);
  }

  get(id: string): Adapter | null {
    return this.adapters.get(id.trim()) ?? null;
  }

  resolve(id: string): Adapter | null {
    const adapter = this.get(id);
    if (adapter) return adapter;
    const target = id.trim();
    for (const candidate of this.adapters.values()) {
      for (const alias of candidate.Metadata().legacyAliases ?? []) {
        if (alias.trim() === target) return candidate;
      }
    }
    return null;
  }

  list(surface: Surface | "", capability: Capability | "", includeUnavailable: boolean): Metadata[] {
    const items: Metadata[] = [];
    for (const adapter of this.adapters.values()) {
      const metadata = adapter.Metadata();
      if (!includeUnavailable && (!metadata.enabled || (metadata.unavailableReason ?? "") !== "")) continue;
      if (capability && !metadata.categories.includes(capability)) continue;
      if (surface && !metadata.scopes.includes(surface)) continue;
      items.push(metadata);
    }
    return items.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  }

  isCapability(id: string, capability: Capability): boolean {
    const adapter = this.resolve(id);
    if (!adapter) return false;
    const metadata = adapter.Metadata();
    return metadata.enabled && !(metadata.unavailableReason ?? "") && metadata.categories.includes(capability);
  }
}
