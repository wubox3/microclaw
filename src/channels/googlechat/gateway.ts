import { createLogger } from "../../logging.js";
import { startGoogleChatWebhookGateway } from "./webhook-gateway.js";
import type { GoogleChatGatewayParams, GoogleChatGatewayHandle } from "./types.js";

const log = createLogger("googlechat");

export function startGoogleChatGateway(
  params: GoogleChatGatewayParams,
): GoogleChatGatewayHandle | null {
  const { config } = params;

  if (config.channels?.googlechat?.enabled === false) {
    log.info("Google Chat channel disabled in config");
    return null;
  }

  return startGoogleChatWebhookGateway(params);
}
