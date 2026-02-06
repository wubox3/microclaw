import type { SkillDefinition } from "../../src/skill-sdk/index.js";
import { createDiscordPlugin } from "./src/channel.js";

const skill: SkillDefinition = {
  id: "discord",
  name: "Discord Channel",
  description: "Discord Bot API channel integration",
  register: (api) => {
    api.registerChannel(createDiscordPlugin());
    api.logger.info("Discord channel registered");
  },
};

export default skill;
