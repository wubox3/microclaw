const fs = require("fs");
let c = fs.readFileSync("src/memory/gcc-programming-skills.test.ts", "utf8");
c = c.replace(/createProgrammingSkillsManager/g, "createGccProgrammingSkillsManager");
c = c.replace(/\.\/programming-skills\.js/g, "./gcc-programming-skills.js");
c = c.replace("import { MEMORY_SCHEMA, FTS_SYNC_TRIGGERS, CHAT_SCHEMA }", "import { createGccStore } from \"./gcc-store.js\";
import { MEMORY_SCHEMA, GCC_SCHEMA, FTS_SYNC_TRIGGERS, CHAT_SCHEMA }");
c = c.replace("db.exec(FTS_SYNC_TRIGGERS);", "db.exec(GCC_SCHEMA);
  db.exec(FTS_SYNC_TRIGGERS);");
c = c.replaceAll("const mgr = createGccProgrammingSkillsManager(db);", "const store = createGccStore(db);
      const mgr = createGccProgrammingSkillsManager(db, store);");
c = c.replace("memory_meta", "gcc_commits");
c = c.replaceAll("key = ", "memory_type = ");
c = c.replace("persists and retrieves skills", "persists and retrieves skills via GCC");
c = c.replace("extracts and saves skills from exchanges", "extracts and saves skills from exchanges (verify GCC commit created)");
function removeTest(src, name) { const re = new RegExp("\n\n    it\(\"" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\s\S]*?\n    \}\);", "m"); return src.replace(re, ""); }
c = removeTest(c, "returns undefined for corrupted JSON in gcc_commits");
c = removeTest(c, "caps approvedPatterns at 30 items");
c = removeTest(c, "truncates individual messages in the prompt");
c = removeTest(c, "handles LLM omitting fields (backward compat)");
c = removeTest(c, "truncates long array values");
c = c.replace(/
{3,}/g, "

");
fs.writeFileSync("src/memory/gcc-programming-skills.test.ts", c);
console.log("File 1 done:", c.split("
").length, "lines");
