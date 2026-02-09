import { createLogger } from "../../logging.js";
import { startBirdGateway } from "./bird-gateway.js";
import type { TwitterGatewayParams, TwitterGatewayHandle } from "./types.js";

const log = createLogger("twitter");

export function startTwitterGateway(
  params: TwitterGatewayParams,
): TwitterGatewayHandle | null {
  const { config } = params;

  if (config.channels?.twitter?.enabled === false) {
    log.info("Twitter channel disabled in config");
    return null;
  }

  return startBirdGateway(params);
}
