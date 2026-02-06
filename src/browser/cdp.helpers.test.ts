import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./extension-relay.js", () => ({
  getChromeExtensionRelayAuthHeaders: vi.fn(() => ({})),
}));

import {
  isLoopbackHost,
  appendCdpPath,
  getHeadersWithAuth,
  fetchJson,
  fetchOk,
} from "./cdp.helpers.js";
import { getChromeExtensionRelayAuthHeaders } from "./extension-relay.js";

const mockedGetRelayHeaders = vi.mocked(getChromeExtensionRelayAuthHeaders);

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  globalThis.fetch = mockFetch;
  mockedGetRelayHeaders.mockReturnValue({});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// isLoopbackHost
// ---------------------------------------------------------------------------

describe("isLoopbackHost", () => {
  it("returns true for localhost", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
  });

  it("returns true for 127.0.0.1", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
  });

  it("returns true for 0.0.0.0", () => {
    expect(isLoopbackHost("0.0.0.0")).toBe(true);
  });

  it("returns true for [::1]", () => {
    expect(isLoopbackHost("[::1]")).toBe(true);
  });

  it("returns true for ::1", () => {
    expect(isLoopbackHost("::1")).toBe(true);
  });

  it("returns true for [::]", () => {
    expect(isLoopbackHost("[::]")).toBe(true);
  });

  it("returns true for ::", () => {
    expect(isLoopbackHost("::")).toBe(true);
  });

  it("returns false for non-loopback host", () => {
    expect(isLoopbackHost("example.com")).toBe(false);
    expect(isLoopbackHost("192.168.1.1")).toBe(false);
  });

  it("handles whitespace and case insensitivity", () => {
    expect(isLoopbackHost("  Localhost  ")).toBe(true);
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// appendCdpPath
// ---------------------------------------------------------------------------

describe("appendCdpPath", () => {
  it("appends path to base URL", () => {
    const result = appendCdpPath("http://localhost:9222", "/json/version");
    expect(result).toBe("http://localhost:9222/json/version");
  });

  it("handles trailing slash on base URL", () => {
    const result = appendCdpPath("http://localhost:9222/", "/json/list");
    expect(result).toBe("http://localhost:9222/json/list");
  });

  it("adds leading slash to path if missing", () => {
    const result = appendCdpPath("http://localhost:9222", "json/version");
    expect(result).toBe("http://localhost:9222/json/version");
  });

  it("preserves existing base path segments", () => {
    const result = appendCdpPath("http://localhost:9222/api", "/json/version");
    expect(result).toBe("http://localhost:9222/api/json/version");
  });
});

// ---------------------------------------------------------------------------
// getHeadersWithAuth
// ---------------------------------------------------------------------------

describe("getHeadersWithAuth", () => {
  it("adds Basic auth header from URL credentials", () => {
    const headers = getHeadersWithAuth("http://user:pass@localhost:9222");
    const expected = Buffer.from("user:pass").toString("base64");
    expect(headers.Authorization).toBe(`Basic ${expected}`);
  });

  it("preserves existing Authorization header", () => {
    const headers = getHeadersWithAuth("http://user:pass@localhost:9222", {
      Authorization: "Bearer token123",
    });
    expect(headers.Authorization).toBe("Bearer token123");
  });

  it("returns no auth header when no credentials in URL", () => {
    const headers = getHeadersWithAuth("http://localhost:9222");
    expect(headers.Authorization).toBeUndefined();
  });

  it("merges relay headers with provided headers", () => {
    mockedGetRelayHeaders.mockReturnValue({ "x-relay": "token" });
    const headers = getHeadersWithAuth("http://localhost:9222", { "x-custom": "val" });
    expect(headers["x-relay"]).toBe("token");
    expect(headers["x-custom"]).toBe("val");
  });

  it("provided headers override relay headers", () => {
    mockedGetRelayHeaders.mockReturnValue({ "x-relay": "relay-value" });
    const headers = getHeadersWithAuth("http://localhost:9222", { "x-relay": "override" });
    expect(headers["x-relay"]).toBe("override");
  });
});

// ---------------------------------------------------------------------------
// fetchJson
// ---------------------------------------------------------------------------

describe("fetchJson", () => {
  it("returns parsed JSON on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ browser: "Chrome" }),
    });
    const result = await fetchJson<{ browser: string }>("http://localhost:9222/json/version");
    expect(result).toEqual({ browser: "Chrome" });
  });

  it("throws on HTTP error response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });
    await expect(fetchJson("http://localhost:9222/json/version")).rejects.toThrow("HTTP 404");
  });

  it("throws on timeout (abort)", async () => {
    mockFetch.mockRejectedValueOnce(new DOMException("The operation was aborted", "AbortError"));
    await expect(fetchJson("http://localhost:9222/json/version", 10)).rejects.toThrow();
  });

  it("passes auth headers from getHeadersWithAuth", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });
    await fetchJson("http://user:pass@localhost:9222/json/version");
    const callHeaders = mockFetch.mock.calls[0]?.[1]?.headers;
    expect(callHeaders?.Authorization).toMatch(/^Basic /);
  });
});

// ---------------------------------------------------------------------------
// fetchOk
// ---------------------------------------------------------------------------

describe("fetchOk", () => {
  it("resolves on successful response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
    });
    await expect(fetchOk("http://localhost:9222/")).resolves.toBeUndefined();
  });

  it("throws on HTTP error response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });
    await expect(fetchOk("http://localhost:9222/")).rejects.toThrow("HTTP 500");
  });
});
