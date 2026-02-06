import type { ChannelId, ChannelMeta, ChannelCapabilities } from "./types.core.js";
import type {
  ChannelConfigAdapter,
  ChannelOutboundAdapter,
  ChannelGatewayAdapter,
  ChannelSecurityAdapter,
  ChannelGroupAdapter,
  ChannelMentionAdapter,
  ChannelStreamingAdapter,
  ChannelThreadingAdapter,
} from "./types.adapters.js";

export type ChannelPlugin<ResolvedAccount = unknown> = {
  id: ChannelId;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;
  config: ChannelConfigAdapter<ResolvedAccount>;
  outbound?: ChannelOutboundAdapter;
  gateway?: ChannelGatewayAdapter<ResolvedAccount>;
  security?: ChannelSecurityAdapter<ResolvedAccount>;
  groups?: ChannelGroupAdapter;
  mentions?: ChannelMentionAdapter;
  streaming?: ChannelStreamingAdapter;
  threading?: ChannelThreadingAdapter;
};
