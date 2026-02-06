import type { SkillDefinition } from "../../src/skill-sdk/index.js";
import { createTelegramPlugin } from "./src/channel.js";

const skill: SkillDefinition = {
  id: "telegram",
  name: "Telegram Channel",
  description: "Telegram Bot API channel integration",
  register: (api) => {
    api.registerChannel(createTelegramPlugin());
    api.logger.info("Telegram channel registered");
  },
};

export default skill;
