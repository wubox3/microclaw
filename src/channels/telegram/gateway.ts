import { createLogger } from "../../logging.js";
import { startTelegramPollingGateway } from "./polling-gateway.js";
import type { TelegramGatewayParams, TelegramGatewayHandle } from "./types.js";

const log = createLogger("telegram");

export function startTelegramGateway(
  params: TelegramGatewayParams,
): TelegramGatewayHandle | null {
  const { config } = params;

  if (config.channels?.telegram?.enabled === false) {
    log.info("Telegram channel disabled in config");
    return null;
  }

  return startTelegramPollingGateway(params);
}
