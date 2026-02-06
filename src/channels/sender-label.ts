import type { SenderIdentity } from "./sender-identity.js";

export function formatSenderLabel(sender: SenderIdentity): string {
  if (sender.displayName) {
    return sender.displayName;
  }
  return sender.senderId;
}

export function formatSenderWithChannel(sender: SenderIdentity): string {
  const label = formatSenderLabel(sender);
  return `${label} (${sender.channelId})`;
}
