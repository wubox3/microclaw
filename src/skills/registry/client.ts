import {
  RegistrySkillInfoSchema,
  RegistrySearchResponseSchema,
  RegistryVersionListSchema,
  type RegistrySkillInfo,
  type RegistrySearchResponse,
  type RegistryVersionList,
} from "./types.js";

const DEFAULT_REGISTRY_URL = "https://www.eclaw.ai";
const INFO_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export function resolveRegistryUrl(): string {
  return process.env.ECLAW_REGISTRY?.trim() || DEFAULT_REGISTRY_URL;
}

async function fetchJson<T>(
  url: string,
  schema: { parse: (data: unknown) => T },
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Registry request failed: ${response.status} ${response.statusText} (${url})`);
    }
    const body = (await response.json()) as unknown;
    return schema.parse(body);
  } finally {
    clearTimeout(timer);
  }
}

export async function searchSkills(params: {
  query: string;
  limit?: number;
}): Promise<RegistrySearchResponse> {
  const base = resolveRegistryUrl();
  const url = new URL("/api/skills/search", base);
  url.searchParams.set("q", params.query);
  if (params.limit !== undefined) {
    url.searchParams.set("limit", String(params.limit));
  }
  return fetchJson(url.toString(), RegistrySearchResponseSchema, INFO_TIMEOUT_MS);
}

export async function getSkillInfo(slug: string): Promise<RegistrySkillInfo> {
  const base = resolveRegistryUrl();
  const url = new URL(`/api/skills/${encodeURIComponent(slug)}`, base);
  return fetchJson(url.toString(), RegistrySkillInfoSchema, INFO_TIMEOUT_MS);
}

export async function getSkillVersions(slug: string): Promise<RegistryVersionList> {
  const base = resolveRegistryUrl();
  const url = new URL(`/api/skills/${encodeURIComponent(slug)}/versions`, base);
  return fetchJson(url.toString(), RegistryVersionListSchema, INFO_TIMEOUT_MS);
}

export async function downloadSkillZip(params: {
  slug: string;
  version: string;
}): Promise<Buffer> {
  const base = resolveRegistryUrl();
  const url = new URL(
    `/api/skills/${encodeURIComponent(params.slug)}/versions/${encodeURIComponent(params.version)}/download`,
    base,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        `Download failed: ${response.status} ${response.statusText} (${params.slug}@${params.version})`,
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timer);
  }
}
