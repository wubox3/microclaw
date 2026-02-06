import type { SkillDefinition } from "../../src/skill-sdk/index.js";
import { createSignalPlugin } from "./src/channel.js";

const skill: SkillDefinition = {
  id: "signal",
  name: "Signal Channel",
  description: "Signal via signal-cli linked device",
  register: (api) => {
    api.registerChannel(createSignalPlugin());
    api.logger.info("Signal channel registered");
  },
};

export default skill;
