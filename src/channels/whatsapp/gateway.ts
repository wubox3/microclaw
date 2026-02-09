import { createLogger } from "../../logging.js";
import { startWacliGateway } from "./wacli-gateway.js";
import type { WhatsAppGatewayParams, WhatsAppGatewayHandle } from "./types.js";

const log = createLogger("whatsapp");

export function startWhatsAppGateway(
  params: WhatsAppGatewayParams,
): WhatsAppGatewayHandle | null {
  const { config } = params;

  if (config.channels?.whatsapp?.enabled === false) {
    log.info("WhatsApp channel disabled in config");
    return null;
  }

  return startWacliGateway(params);
}
