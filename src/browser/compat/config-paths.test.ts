import { describe, it, expect } from "vitest";
import {
  CONFIG_DIR,
  resolveGatewayPort,
  DEFAULT_BROWSER_CONTROL_PORT,
  deriveDefaultBrowserControlPort,
  deriveDefaultBrowserCdpPortRange,
} from "./config-paths.js";

describe("CONFIG_DIR", () => {
  it("contains .microclaw", () => {
    expect(CONFIG_DIR).toContain(".microclaw");
  });

  it("is an absolute path", () => {
    expect(CONFIG_DIR.startsWith("/") || CONFIG_DIR.match(/^[A-Z]:\\/)).toBeTruthy();
  });
});

describe("resolveGatewayPort", () => {
  it("returns undefined with no args", () => {
    expect(resolveGatewayPort()).toBeUndefined();
  });

  it("returns undefined regardless of config", () => {
    expect(resolveGatewayPort({ port: 8080 })).toBeUndefined();
  });
});

describe("DEFAULT_BROWSER_CONTROL_PORT", () => {
  it("equals 12200", () => {
    expect(DEFAULT_BROWSER_CONTROL_PORT).toBe(12200);
  });
});

describe("deriveDefaultBrowserControlPort", () => {
  it("returns 12200", () => {
    expect(deriveDefaultBrowserControlPort()).toBe(12200);
  });

  it("returns 12200 regardless of base port", () => {
    expect(deriveDefaultBrowserControlPort(9000)).toBe(12200);
  });
});

describe("deriveDefaultBrowserCdpPortRange", () => {
  it("returns start: 12210, end: 12299", () => {
    const range = deriveDefaultBrowserCdpPortRange();
    expect(range).toEqual({ start: 12210, end: 12299 });
  });

  it("returns same range regardless of control port", () => {
    const range = deriveDefaultBrowserCdpPortRange(9999);
    expect(range).toEqual({ start: 12210, end: 12299 });
  });
});
