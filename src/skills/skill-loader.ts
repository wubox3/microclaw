import fs from "node:fs";
import path from "node:path";

export type Skill = {
  name: string;
  description?: string;
  filePath: string;
  baseDir: string;
  source: string;
  content: string;
};

export function loadSkillsFromDir(params: {
  dir: string;
  source: string;
}): { skills: Skill[] } {
  const { dir, source } = params;
  const skills: Skill[] = [];

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return { skills };
  }

  for (const entry of entries) {
    if (entry.startsWith(".")) {
      continue;
    }
    const fullPath = path.join(dir, entry);

    // Check if it's a directory containing SKILL.md
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        const skillMdPath = path.join(fullPath, "SKILL.md");
        try {
          const content = fs.readFileSync(skillMdPath, "utf-8");
          const { name, description, body } = parseSkillMd(content, entry);
          skills.push({
            name,
            description,
            filePath: skillMdPath,
            baseDir: fullPath,
            source,
            content: body,
          });
        } catch {
          // No SKILL.md in this directory, skip
        }
        continue;
      }
      // Top-level .md files are also valid skills
      if (stat.isFile() && entry.endsWith(".md")) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const baseName = entry.replace(/\.md$/, "");
          const { name, description, body } = parseSkillMd(content, baseName);
          skills.push({
            name,
            description,
            filePath: fullPath,
            baseDir: dir,
            source,
            content: body,
          });
        } catch {
          // Ignore unreadable files
        }
      }
    } catch {
      // Ignore stat errors
    }
  }

  return { skills };
}

function parseSkillMd(
  content: string,
  fallbackName: string,
): { name: string; description?: string; body: string } {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  let name = fallbackName;
  let description: string | undefined;
  let body = normalized;

  // Extract frontmatter if present
  if (normalized.startsWith("---")) {
    const endIndex = normalized.indexOf("\n---", 3);
    if (endIndex !== -1) {
      const frontmatterBlock = normalized.slice(4, endIndex);
      body = normalized.slice(endIndex + 4).trim();

      // Parse simple key: value pairs from frontmatter
      for (const line of frontmatterBlock.split("\n")) {
        const match = line.match(/^([\w-]+):\s*(.+)$/);
        if (match) {
          const key = match[1].toLowerCase();
          const value = match[2].trim().replace(/^["']|["']$/g, "");
          if (key === "name") {
            name = value;
          } else if (key === "description") {
            description = value;
          }
        }
      }
    }
  }

  return { name, description, body };
}

function sanitizeSkillContent(content: string): string {
  return content
    .replace(/<\/system-reminder>/gi, "&lt;/system-reminder&gt;")
    .replace(/<\/skill>/gi, "&lt;/skill&gt;")
    .replace(/<system-reminder>/gi, "&lt;system-reminder&gt;");
}

function sanitizeSkillName(name: string): string {
  return name.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) {
    return "";
  }

  const parts: string[] = [];
  parts.push("<system-reminder>");
  parts.push("The following skills are available:");
  parts.push("");

  for (const skill of skills) {
    parts.push(`<skill name="${sanitizeSkillName(skill.name)}">`);
    if (skill.description) {
      parts.push(`Description: ${sanitizeSkillContent(skill.description)}`);
    }
    parts.push(sanitizeSkillContent(skill.content));
    parts.push("</skill>");
    parts.push("");
  }

  parts.push("</system-reminder>");
  return parts.join("\n");
}
