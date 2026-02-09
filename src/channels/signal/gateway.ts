import { createLogger } from "../../logging.js";
import { startSignalPollingGateway } from "./polling-gateway.js";
import type { SignalGatewayParams, SignalGatewayHandle } from "./types.js";

const log = createLogger("signal");

export function startSignalGateway(
  params: SignalGatewayParams,
): SignalGatewayHandle | null {
  const { config } = params;

  if (config.channels?.signal?.enabled === false) {
    log.info("Signal channel disabled in config");
    return null;
  }

  return startSignalPollingGateway(params);
}
