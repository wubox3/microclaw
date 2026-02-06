import type { ChannelOutboundAdapter, ChannelId } from "../types.js";

const outboundAdapters = new Map<string, ChannelOutboundAdapter>();

export function registerOutboundAdapter(channelId: string, adapter: ChannelOutboundAdapter): void {
  outboundAdapters.set(channelId, adapter);
}

export function getOutboundAdapter(channelId: ChannelId): ChannelOutboundAdapter | undefined {
  return outboundAdapters.get(String(channelId));
}
