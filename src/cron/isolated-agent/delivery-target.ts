import type { ChannelId } from "../../channels/plugins/types.core.js";

export type DeliveryTarget = {
  channel: string;
  to?: string;
  mode: "explicit" | "implicit";
  error?: Error;
};

/**
 * Simplified delivery target resolution for microclaw.
 * In openclaw this resolves against session stores and channel registries.
 * For microclaw we just pass through the requested channel and target.
 */
export function resolveDeliveryTarget(
  jobPayload: {
    channel?: "last" | ChannelId;
    to?: string;
  },
): DeliveryTarget {
  const requestedChannel = typeof jobPayload.channel === "string" ? jobPayload.channel : "web";
  const explicitTo = typeof jobPayload.to === "string" ? jobPayload.to : undefined;

  return {
    channel: requestedChannel === "last" ? "web" : requestedChannel,
    to: explicitTo,
    mode: explicitTo ? "explicit" : "implicit",
  };
}
