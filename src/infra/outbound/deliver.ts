import type { MicroClawConfig } from "../../config/types.js";
import type { ChannelId, NormalizedChatType } from "../../channels/plugins/types.js";
import { getChannelPlugin } from "../../channels/plugins/index.js";
import { truncate } from "../../utils.js";

export type DeliveryRequest = {
  channelId: ChannelId;
  accountId?: string;
  to: string;
  text: string;
  chatType?: NormalizedChatType;
};

export type DeliveryResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};

export async function deliver(
  config: MicroClawConfig,
  request: DeliveryRequest,
): Promise<DeliveryResult> {
  const plugin = getChannelPlugin(request.channelId);
  if (!plugin) {
    return { ok: false, error: `No plugin found for channel: ${request.channelId}` };
  }

  if (!plugin.outbound?.sendText) {
    return { ok: false, error: `Channel ${request.channelId} does not support outbound text` };
  }

  const chunkLimit = plugin.outbound.textChunkLimit ?? 4000;
  const text = truncate(request.text, chunkLimit);

  try {
    const result = await plugin.outbound.sendText({
      config,
      accountId: request.accountId,
      to: request.to,
      text,
      chatType: request.chatType,
    });
    return result;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
