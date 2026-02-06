import type { SkillDefinition } from "../../src/skill-sdk/index.js";
import { createSlackPlugin } from "./src/channel.js";

const skill: SkillDefinition = {
  id: "slack",
  name: "Slack Channel",
  description: "Slack Bot with Socket Mode",
  register: (api) => {
    api.registerChannel(createSlackPlugin());
    api.logger.info("Slack channel registered");
  },
};

export default skill;
