import YAML from "yaml";
import JSON5 from "json5";
import type {
  EClawSkillMetadata,
  ParsedSkillFrontmatter,
  SkillInstallSpec,
  SkillInvocationPolicy,
  SkillEntry,
} from "./types.js";
import type { Skill } from "./skill-loader.js";

const MANIFEST_KEY = "eclaw";

type ParsedFrontmatter = Record<string, string>;

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function coerceFrontmatterValue(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function parseYamlFrontmatter(block: string): ParsedFrontmatter | null {
  try {
    const parsed = YAML.parse(block) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const result: ParsedFrontmatter = {};
    for (const [rawKey, value] of Object.entries(parsed as Record<string, unknown>)) {
      const key = rawKey.trim();
      if (!key) {
        continue;
      }
      const coerced = coerceFrontmatterValue(value);
      if (coerced === undefined) {
        continue;
      }
      result[key] = coerced;
    }
    return result;
  } catch {
    return null;
  }
}

function extractMultiLineValue(
  lines: string[],
  startIndex: number,
): { value: string; linesConsumed: number } {
  const startLine = lines[startIndex];
  const match = startLine.match(/^([\w-]+):\s*(.*)$/);
  if (!match) {
    return { value: "", linesConsumed: 1 };
  }

  const inlineValue = match[2].trim();
  if (inlineValue) {
    return { value: inlineValue, linesConsumed: 1 };
  }

  const valueLines: string[] = [];
  let i = startIndex + 1;

  while (i < lines.length) {
    const line = lines[i];
    if (line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t")) {
      break;
    }
    valueLines.push(line);
    i++;
  }

  const combined = valueLines.join("\n").trim();
  return { value: combined, linesConsumed: i - startIndex };
}

function parseLineFrontmatter(block: string): ParsedFrontmatter {
  const frontmatter: ParsedFrontmatter = {};
  const lines = block.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (!match) {
      i++;
      continue;
    }

    const key = match[1];
    const inlineValue = match[2].trim();

    if (!key) {
      i++;
      continue;
    }

    if (!inlineValue && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      if (nextLine.startsWith(" ") || nextLine.startsWith("\t")) {
        const { value, linesConsumed } = extractMultiLineValue(lines, i);
        if (value) {
          frontmatter[key] = value;
        }
        i += linesConsumed;
        continue;
      }
    }

    const value = stripQuotes(inlineValue);
    if (value) {
      frontmatter[key] = value;
    }
    i++;
  }

  return frontmatter;
}

function parseFrontmatterBlock(content: string): ParsedFrontmatter {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) {
    return {};
  }
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) {
    return {};
  }
  const block = normalized.slice(4, endIndex);

  const lineParsed = parseLineFrontmatter(block);
  const yamlParsed = parseYamlFrontmatter(block);
  if (yamlParsed === null) {
    return lineParsed;
  }

  const merged: ParsedFrontmatter = { ...yamlParsed };
  for (const [key, value] of Object.entries(lineParsed)) {
    if (value.startsWith("{") || value.startsWith("[")) {
      merged[key] = value;
    }
  }
  return merged;
}

export function parseFrontmatter(content: string): ParsedSkillFrontmatter {
  return parseFrontmatterBlock(content);
}

function normalizeStringList(input: unknown): string[] {
  if (!input) {
    return [];
  }
  if (Array.isArray(input)) {
    return input.map((value) => String(value).trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

function parseInstallSpec(input: unknown): SkillInstallSpec | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  const kindRaw =
    typeof raw.kind === "string" ? raw.kind : typeof raw.type === "string" ? raw.type : "";
  const kind = kindRaw.trim().toLowerCase();
  if (kind !== "brew" && kind !== "node" && kind !== "go" && kind !== "uv" && kind !== "download") {
    return undefined;
  }

  const spec: SkillInstallSpec = { kind };

  if (typeof raw.id === "string") spec.id = raw.id;
  if (typeof raw.label === "string") spec.label = raw.label;
  const bins = normalizeStringList(raw.bins);
  if (bins.length > 0) spec.bins = bins;
  const osList = normalizeStringList(raw.os);
  if (osList.length > 0) spec.os = osList;
  if (typeof raw.formula === "string") spec.formula = raw.formula;
  if (typeof raw.package === "string") spec.package = raw.package;
  if (typeof raw.module === "string") spec.module = raw.module;
  if (typeof raw.url === "string") spec.url = raw.url;
  if (typeof raw.archive === "string") spec.archive = raw.archive;
  if (typeof raw.extract === "boolean") spec.extract = raw.extract;
  if (typeof raw.stripComponents === "number") spec.stripComponents = raw.stripComponents;
  if (typeof raw.targetDir === "string") spec.targetDir = raw.targetDir;

  return spec;
}

function getFrontmatterValue(frontmatter: ParsedSkillFrontmatter, key: string): string | undefined {
  const raw = frontmatter[key];
  return typeof raw === "string" ? raw : undefined;
}

function parseBooleanValue(value: string | undefined): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "no" || normalized === "0") {
    return false;
  }
  return undefined;
}

function parseFrontmatterBool(value: string | undefined, fallback: boolean): boolean {
  const parsed = parseBooleanValue(value);
  return parsed === undefined ? fallback : parsed;
}

export function resolveEClawMetadata(
  frontmatter: ParsedSkillFrontmatter,
): EClawSkillMetadata | undefined {
  const raw = getFrontmatterValue(frontmatter, "metadata");
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON5.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    const metadataRaw = parsed[MANIFEST_KEY];
    if (!metadataRaw || typeof metadataRaw !== "object") {
      return undefined;
    }
    const metadataObj = metadataRaw as Record<string, unknown>;
    const requiresRaw =
      typeof metadataObj.requires === "object" && metadataObj.requires !== null
        ? (metadataObj.requires as Record<string, unknown>)
        : undefined;
    const installRaw = Array.isArray(metadataObj.install) ? (metadataObj.install as unknown[]) : [];
    const install = installRaw
      .map((entry) => parseInstallSpec(entry))
      .filter((entry): entry is SkillInstallSpec => Boolean(entry));
    const osRaw = normalizeStringList(metadataObj.os);
    return {
      always: typeof metadataObj.always === "boolean" ? metadataObj.always : undefined,
      emoji: typeof metadataObj.emoji === "string" ? metadataObj.emoji : undefined,
      homepage: typeof metadataObj.homepage === "string" ? metadataObj.homepage : undefined,
      skillKey: typeof metadataObj.skillKey === "string" ? metadataObj.skillKey : undefined,
      primaryEnv: typeof metadataObj.primaryEnv === "string" ? metadataObj.primaryEnv : undefined,
      os: osRaw.length > 0 ? osRaw : undefined,
      requires: requiresRaw
        ? {
            bins: normalizeStringList(requiresRaw.bins),
            anyBins: normalizeStringList(requiresRaw.anyBins),
            env: normalizeStringList(requiresRaw.env),
            config: normalizeStringList(requiresRaw.config),
          }
        : undefined,
      install: install.length > 0 ? install : undefined,
    };
  } catch {
    return undefined;
  }
}

export function resolveSkillInvocationPolicy(
  frontmatter: ParsedSkillFrontmatter,
): SkillInvocationPolicy {
  return {
    userInvocable: parseFrontmatterBool(getFrontmatterValue(frontmatter, "user-invocable"), true),
    disableModelInvocation: parseFrontmatterBool(
      getFrontmatterValue(frontmatter, "disable-model-invocation"),
      false,
    ),
  };
}

export function resolveSkillKey(skill: Skill, entry?: SkillEntry): string {
  return entry?.metadata?.skillKey ?? skill.name;
}
