import { createLogger } from "../../logging.js";
import { startImsgGateway } from "./imsg-gateway.js";
import type { ImessageGatewayParams, ImessageGatewayHandle } from "./types.js";

const log = createLogger("imessage");

export function startImessageGateway(
  params: ImessageGatewayParams,
): ImessageGatewayHandle | null {
  const { config } = params;

  if (config.channels?.imessage?.enabled === false) {
    log.info("iMessage channel disabled in config");
    return null;
  }

  return startImsgGateway(params);
}
