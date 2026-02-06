export type WebInboundMessage = {
  id: string;
  text: string;
  senderId: string;
  senderName?: string;
  timestamp: number;
  channelId?: string;
};

export type WebOutboundMessage = {
  id: string;
  text: string;
  role: "assistant" | "system";
  timestamp: number;
  isStreaming?: boolean;
};
