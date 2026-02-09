import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveRegistryUrl,
  searchSkills,
  getSkillInfo,
  getSkillVersions,
  downloadSkillZip,
} from "./client.js";

const originalEnv = process.env.ECLAW_REGISTRY;

beforeEach(() => {
  delete process.env.ECLAW_REGISTRY;
});

afterEach(() => {
  if (originalEnv !== undefined) {
    process.env.ECLAW_REGISTRY = originalEnv;
  } else {
    delete process.env.ECLAW_REGISTRY;
  }
  vi.restoreAllMocks();
});

describe("resolveRegistryUrl", () => {
  it("returns default when ECLAW_REGISTRY is not set", () => {
    expect(resolveRegistryUrl()).toBe("https://www.eclaw.ai");
  });

  it("returns env var value when set", () => {
    process.env.ECLAW_REGISTRY = "https://custom.registry.dev";
    expect(resolveRegistryUrl()).toBe("https://custom.registry.dev");
  });

  it("trims whitespace from env var", () => {
    process.env.ECLAW_REGISTRY = "  https://custom.registry.dev  ";
    expect(resolveRegistryUrl()).toBe("https://custom.registry.dev");
  });
});

describe("searchSkills", () => {
  it("parses valid search response", async () => {
    const mockResponse = {
      results: [
        { slug: "calendar", name: "Calendar", description: "A calendar skill", latestVersion: "1.0.0" },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const result = await searchSkills({ query: "calendar" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].slug).toBe("calendar");
  });

  it("includes limit parameter when provided", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );

    await searchSkills({ query: "test", limit: 5 });
    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("limit=5");
  });

  it("throws on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not found", { status: 404, statusText: "Not Found" }),
    );
    await expect(searchSkills({ query: "missing" })).rejects.toThrow("Registry request failed: 404");
  });
});

describe("getSkillInfo", () => {
  it("parses valid skill info", async () => {
    const mockInfo = {
      slug: "calendar",
      name: "Calendar",
      description: "A calendar skill",
      latestVersion: "2.1.0",
      author: "eclaw",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockInfo), { status: 200 }),
    );

    const result = await getSkillInfo("calendar");
    expect(result.slug).toBe("calendar");
    expect(result.latestVersion).toBe("2.1.0");
  });
});

describe("getSkillVersions", () => {
  it("parses version list", async () => {
    const mockVersions = {
      versions: [
        { version: "1.0.0", createdAt: "2026-01-01" },
        { version: "2.0.0", createdAt: "2026-02-01" },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockVersions), { status: 200 }),
    );

    const result = await getSkillVersions("calendar");
    expect(result.versions).toHaveLength(2);
  });
});

describe("downloadSkillZip", () => {
  it("returns buffer from response", async () => {
    const content = Buffer.from("PK\x03\x04fake-zip-data");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(content, { status: 200 }),
    );

    const result = await downloadSkillZip({ slug: "calendar", version: "1.0.0" });
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("throws on download failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Server Error", { status: 500, statusText: "Internal Server Error" }),
    );
    await expect(downloadSkillZip({ slug: "bad", version: "1.0.0" })).rejects.toThrow("Download failed: 500");
  });
});
