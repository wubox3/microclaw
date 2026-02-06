import type { SkillDefinition } from "../../src/skill-sdk/index.js";
import { createIMessagePlugin } from "./src/channel.js";

const skill: SkillDefinition = {
  id: "imessage",
  name: "iMessage Channel",
  description: "iMessage integration (macOS only)",
  register: (api) => {
    api.registerChannel(createIMessagePlugin());
    api.logger.info("iMessage channel registered");
  },
};

export default skill;
