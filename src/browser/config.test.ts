import { describe, it, expect } from "vitest";
import {
  parseHttpUrl,
  resolveBrowserConfig,
  resolveProfile,
  shouldStartLocalBrowserServer,
} from "./config.js";
import type { BrowserConfig } from "./types.js";

// ---------------------------------------------------------------------------
// parseHttpUrl
// ---------------------------------------------------------------------------

describe("parseHttpUrl", () => {
  it("parses valid http URL", () => {
    const result = parseHttpUrl("http://localhost:9222", "test");
    expect(result.port).toBe(9222);
    expect(result.normalized.endsWith("/")).toBe(false);
  });

  it("parses valid https URL", () => {
    const result = parseHttpUrl("https://remote.host:8443/path", "test");
    expect(result.port).toBe(8443);
    expect(result.parsed.protocol).toBe("https:");
  });

  it("throws for invalid protocol", () => {
    expect(() => parseHttpUrl("ftp://host:21", "test")).toThrow("must be http(s)");
  });

  it("uses default port 80 for http", () => {
    const result = parseHttpUrl("http://localhost", "test");
    expect(result.port).toBe(80);
  });

  it("uses default port 443 for https", () => {
    const result = parseHttpUrl("https://localhost", "test");
    expect(result.port).toBe(443);
  });

  it("strips trailing slash from normalized", () => {
    const result = parseHttpUrl("http://localhost:9222/", "test");
    expect(result.normalized.endsWith("/")).toBe(false);
  });

  it("trims whitespace", () => {
    const result = parseHttpUrl("  http://localhost:9222  ", "test");
    expect(result.port).toBe(9222);
  });

  it("throws for completely invalid URL", () => {
    expect(() => parseHttpUrl("not-a-url", "test")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolveBrowserConfig
// ---------------------------------------------------------------------------

describe("resolveBrowserConfig", () => {
  it("returns defaults when config is undefined", () => {
    const resolved = resolveBrowserConfig(undefined);
    expect(resolved.enabled).toBe(true);
    expect(resolved.evaluateEnabled).toBe(true);
    expect(resolved.headless).toBe(false);
    expect(resolved.noSandbox).toBe(false);
    expect(resolved.attachOnly).toBe(false);
    expect(resolved.controlPort).toBe(12200);
  });

  it("respects enabled flag", () => {
    const resolved = resolveBrowserConfig({ enabled: false });
    expect(resolved.enabled).toBe(false);
  });

  it("respects headless flag", () => {
    const resolved = resolveBrowserConfig({ headless: true });
    expect(resolved.headless).toBe(true);
  });

  it("respects noSandbox flag", () => {
    const resolved = resolveBrowserConfig({ noSandbox: true });
    expect(resolved.noSandbox).toBe(true);
  });

  it("normalizes valid hex color", () => {
    const resolved = resolveBrowserConfig({ color: "#ff0000" });
    expect(resolved.color).toBe("#FF0000");
  });

  it("falls back to default for invalid hex color", () => {
    const resolved = resolveBrowserConfig({ color: "notacolor" });
    expect(resolved.color).toBe("#FF4500");
  });

  it("adds # prefix if missing from color", () => {
    const resolved = resolveBrowserConfig({ color: "00FF00" });
    expect(resolved.color).toBe("#00FF00");
  });

  it("uses default color for empty string", () => {
    const resolved = resolveBrowserConfig({ color: "" });
    expect(resolved.color).toBe("#FF4500");
  });

  it("normalizes timeout values", () => {
    const resolved = resolveBrowserConfig({ remoteCdpTimeoutMs: 3000 });
    expect(resolved.remoteCdpTimeoutMs).toBe(3000);
    expect(resolved.remoteCdpHandshakeTimeoutMs).toBeGreaterThanOrEqual(6000);
  });

  it("uses fallback for negative timeout", () => {
    const resolved = resolveBrowserConfig({ remoteCdpTimeoutMs: -100 });
    expect(resolved.remoteCdpTimeoutMs).toBe(1500);
  });

  it("creates default eclaw profile when none configured", () => {
    const resolved = resolveBrowserConfig(undefined);
    expect(resolved.profiles.eclaw).toBeDefined();
    expect(resolved.profiles.eclaw.cdpPort).toBeTypeOf("number");
  });

  it("creates chrome extension profile automatically", () => {
    const resolved = resolveBrowserConfig(undefined);
    expect(resolved.profiles.chrome).toBeDefined();
    expect(resolved.profiles.chrome.driver).toBe("extension");
  });

  it("resolves cdp host as loopback by default", () => {
    const resolved = resolveBrowserConfig(undefined);
    expect(resolved.cdpIsLoopback).toBe(true);
    expect(resolved.cdpHost).toBe("127.0.0.1");
  });

  it("parses custom cdpUrl", () => {
    const resolved = resolveBrowserConfig({ cdpUrl: "http://192.168.1.100:9222" });
    expect(resolved.cdpHost).toBe("192.168.1.100");
    expect(resolved.cdpIsLoopback).toBe(false);
  });

  it("strips executablePath whitespace", () => {
    const resolved = resolveBrowserConfig({ executablePath: "  /usr/bin/chrome  " });
    expect(resolved.executablePath).toBe("/usr/bin/chrome");
  });

  it("converts empty executablePath to undefined", () => {
    const resolved = resolveBrowserConfig({ executablePath: "  " });
    expect(resolved.executablePath).toBeUndefined();
  });

  it("uses custom defaultProfile", () => {
    const cfg: BrowserConfig = {
      defaultProfile: "custom",
      profiles: {
        custom: { cdpPort: 18800 },
      },
    };
    const resolved = resolveBrowserConfig(cfg);
    expect(resolved.defaultProfile).toBe("custom");
  });
});

// ---------------------------------------------------------------------------
// resolveProfile
// ---------------------------------------------------------------------------

describe("resolveProfile", () => {
  it("resolves profile with cdpPort", () => {
    const resolved = resolveBrowserConfig({
      profiles: { test: { cdpPort: 18800, color: "#0066CC" } },
    });
    const profile = resolveProfile(resolved, "test");
    expect(profile).not.toBeNull();
    expect(profile!.cdpPort).toBe(18800);
    expect(profile!.color).toBe("#0066CC");
    expect(profile!.driver).toBe("eclaw");
  });

  it("resolves profile with cdpUrl", () => {
    const resolved = resolveBrowserConfig({
      profiles: { remote: { cdpUrl: "http://192.168.1.100:9222" } },
    });
    const profile = resolveProfile(resolved, "remote");
    expect(profile).not.toBeNull();
    expect(profile!.cdpPort).toBe(9222);
    expect(profile!.cdpHost).toBe("192.168.1.100");
    expect(profile!.cdpIsLoopback).toBe(false);
  });

  it("returns null for missing profile", () => {
    const resolved = resolveBrowserConfig(undefined);
    expect(resolveProfile(resolved, "nonexistent")).toBeNull();
  });

  it("resolves extension driver", () => {
    const resolved = resolveBrowserConfig(undefined);
    const profile = resolveProfile(resolved, "chrome");
    expect(profile).not.toBeNull();
    expect(profile!.driver).toBe("extension");
  });

  it("throws when profile has neither cdpPort nor cdpUrl", () => {
    const resolved = resolveBrowserConfig({
      profiles: { invalid: {} },
    });
    expect(() => resolveProfile(resolved, "invalid")).toThrow(
      'Profile "invalid" must define cdpPort or cdpUrl.',
    );
  });

  it("uses resolved config color when profile has no color", () => {
    const resolved = resolveBrowserConfig({
      color: "#FF0000",
      profiles: { test: { cdpPort: 18800 } },
    });
    const profile = resolveProfile(resolved, "test");
    expect(profile).not.toBeNull();
    expect(profile!.color).toBe("#FF0000");
  });
});

// ---------------------------------------------------------------------------
// shouldStartLocalBrowserServer
// ---------------------------------------------------------------------------

describe("shouldStartLocalBrowserServer", () => {
  it("returns true", () => {
    const resolved = resolveBrowserConfig(undefined);
    expect(shouldStartLocalBrowserServer(resolved)).toBe(true);
  });
});
