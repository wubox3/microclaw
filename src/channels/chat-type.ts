import type { NormalizedChatType } from "./plugins/types.js";

export function isGroupChat(chatType: NormalizedChatType): boolean {
  return chatType === "group" || chatType === "channel" || chatType === "thread";
}

export function isDirectChat(chatType: NormalizedChatType): boolean {
  return chatType === "direct";
}

export function formatChatType(chatType: NormalizedChatType): string {
  switch (chatType) {
    case "direct": return "Direct Message";
    case "group": return "Group";
    case "channel": return "Channel";
    case "thread": return "Thread";
  }
}
