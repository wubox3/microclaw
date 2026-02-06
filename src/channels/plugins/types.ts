export type {
  ChannelId,
  ChatChannelId,
  NormalizedChatType,
  ChannelMeta,
  ChannelCapabilities,
  ChannelAccountSnapshot,
  ChannelGroupContext,
  ChannelThreadingContext,
  ChannelLogSink,
} from "./types.core.js";

export type {
  ChannelOutboundContext,
  ChannelConfigAdapter,
  ChannelOutboundAdapter,
  ChannelGatewayAdapter,
  ChannelSecurityAdapter,
  ChannelGroupAdapter,
  ChannelMentionAdapter,
  ChannelStreamingAdapter,
  ChannelThreadingAdapter,
} from "./types.adapters.js";

export type { ChannelPlugin } from "./types.plugin.js";
