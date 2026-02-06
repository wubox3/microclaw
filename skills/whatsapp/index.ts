import type { SkillDefinition } from "../../src/skill-sdk/index.js";
import { createWhatsAppPlugin } from "./src/channel.js";

const skill: SkillDefinition = {
  id: "whatsapp",
  name: "WhatsApp Channel",
  description: "WhatsApp Web channel integration via Baileys",
  register: (api) => {
    api.registerChannel(createWhatsAppPlugin());
    api.logger.info("WhatsApp channel registered");
  },
};

export default skill;
