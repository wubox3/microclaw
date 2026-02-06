import type { ChannelPlugin, ChannelId } from "./types.js";

const pluginCache = new Map<string, ChannelPlugin>();

export function registerChannelPlugin(plugin: ChannelPlugin): void {
  pluginCache.set(String(plugin.id), plugin);
}

export function getChannelPlugin(id: ChannelId): ChannelPlugin | undefined {
  return pluginCache.get(String(id));
}

export function listChannelPlugins(): ChannelPlugin[] {
  return Array.from(pluginCache.values());
}

export function clearChannelPlugins(): void {
  pluginCache.clear();
}
