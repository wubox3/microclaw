import { createLogger } from "../../logging.js";
import { startSlackPollingGateway } from "./polling-gateway.js";
import type { SlackGatewayParams, SlackGatewayHandle } from "./types.js";

const log = createLogger("slack");

export function startSlackGateway(
  params: SlackGatewayParams,
): SlackGatewayHandle | null {
  const { config } = params;

  if (config.channels?.slack?.enabled === false) {
    log.info("Slack channel disabled in config");
    return null;
  }

  return startSlackPollingGateway(params);
}
