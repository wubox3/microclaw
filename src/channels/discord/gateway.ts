import { createLogger } from "../../logging.js";
import { startDiscordPollingGateway } from "./polling-gateway.js";
import type { DiscordGatewayParams, DiscordGatewayHandle } from "./types.js";

const log = createLogger("discord");

export function startDiscordGateway(
  params: DiscordGatewayParams,
): DiscordGatewayHandle | null {
  const { config } = params;

  if (config.channels?.discord?.enabled === false) {
    log.info("Discord channel disabled in config");
    return null;
  }

  return startDiscordPollingGateway(params);
}
