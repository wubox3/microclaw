import type { ChannelPlugin, ChannelId } from "./types.js";
import { getChannelPlugin, registerChannelPlugin } from "./index.js";

const loaders = new Map<string, () => Promise<ChannelPlugin>>();

export function registerChannelLoader(id: string, loader: () => Promise<ChannelPlugin>): void {
  loaders.set(id, loader);
}

export async function loadChannelPlugin(id: ChannelId): Promise<ChannelPlugin | undefined> {
  const existing = getChannelPlugin(id);
  if (existing) {
    return existing;
  }

  const loader = loaders.get(String(id));
  if (!loader) {
    return undefined;
  }

  const plugin = await loader();
  registerChannelPlugin(plugin);
  return plugin;
}
