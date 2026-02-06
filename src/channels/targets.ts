import type { ChannelId } from "./plugins/types.js";

export type ChannelTarget = {
  channelId: ChannelId;
  accountId?: string;
  to: string;
};

export function formatTarget(target: ChannelTarget): string {
  const parts = [target.channelId];
  if (target.accountId) {
    parts.push(target.accountId);
  }
  parts.push(target.to);
  return parts.join(":");
}

export function parseTarget(raw: string): ChannelTarget | null {
  const parts = raw.split(":");
  if (parts.length < 2) {
    return null;
  }
  if (parts.length === 2) {
    return { channelId: parts[0]!, to: parts[1]! };
  }
  return {
    channelId: parts[0]!,
    accountId: parts[1]!,
    to: parts.slice(2).join(":"),
  };
}
