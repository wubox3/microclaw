import type { SkillDefinition } from "../../src/skill-sdk/index.js";
import { createGoogleChatPlugin } from "./src/channel.js";

const skill: SkillDefinition = {
  id: "googlechat",
  name: "Google Chat Channel",
  description: "Google Workspace Chat app with HTTP webhook",
  register: (api) => {
    api.registerChannel(createGoogleChatPlugin());
    api.logger.info("Google Chat channel registered");
  },
};

export default skill;
