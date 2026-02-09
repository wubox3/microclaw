import type { SkillDefinition } from "../../src/skill-sdk/index.js";
import { createBirdTool } from "./src/bird-tool.js";

const skill: SkillDefinition = {
  id: "bird",
  name: "Bird (X/Twitter CLI)",
  description: "X/Twitter CLI for reading, searching, posting, and engagement via cookies",
  register: (api) => {
    api.registerTool(createBirdTool());
    api.logger.info("Bird (X/Twitter CLI) tool registered");
  },
};

export default skill;
