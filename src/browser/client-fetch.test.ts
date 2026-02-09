import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setBrowserControlBaseUrl, fetchBrowserJson } from "./client-fetch.js";

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  globalThis.fetch = mockFetch;
  setBrowserControlBaseUrl("http://127.0.0.1:12200");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockJsonResponse(data: unknown, ok = true, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function mockErrorResponse(status: number, body = "error") {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  });
}

// ---------------------------------------------------------------------------
// setBrowserControlBaseUrl
// ---------------------------------------------------------------------------

describe("setBrowserControlBaseUrl", () => {
  it("strips trailing slash", async () => {
    setBrowserControlBaseUrl("http://localhost:9000/");
    mockJsonResponse({ ok: true });
    await fetchBrowserJson("/test");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:9000/test",
      expect.any(Object),
    );
  });

  it("sets base URL for subsequent requests", async () => {
    setBrowserControlBaseUrl("http://custom:8080");
    mockJsonResponse({ ok: true });
    await fetchBrowserJson("/status");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://custom:8080/status",
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// fetchBrowserJson
// ---------------------------------------------------------------------------

describe("fetchBrowserJson", () => {
  it("returns parsed JSON on success", async () => {
    mockJsonResponse({ status: "running" });
    const result = await fetchBrowserJson<{ status: string }>("/agent/status");
    expect(result).toEqual({ status: "running" });
  });

  it("throws enhanced error on HTTP error", async () => {
    mockErrorResponse(500, "Internal Server Error");
    await expect(fetchBrowserJson("/agent/status")).rejects.toThrow(
      "Can't reach the EClaw browser control service",
    );
  });

  it("enhances timeout errors with helpful message", async () => {
    mockFetch.mockRejectedValueOnce(new Error("The operation timed out"));
    await expect(fetchBrowserJson("/agent/status")).rejects.toThrow(
      "timed out",
    );
  });

  it("uses absolute URL when provided", async () => {
    mockJsonResponse({ ok: true });
    await fetchBrowserJson("http://other-host:9222/json");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://other-host:9222/json",
      expect.any(Object),
    );
  });

  it("prepends base URL for relative path with leading slash", async () => {
    mockJsonResponse({ ok: true });
    await fetchBrowserJson("/tabs");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:12200/tabs",
      expect.any(Object),
    );
  });

  it("prepends base URL with slash for relative path without leading slash", async () => {
    mockJsonResponse({ ok: true });
    await fetchBrowserJson("tabs");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:12200/tabs",
      expect.any(Object),
    );
  });

  it("passes custom timeoutMs", async () => {
    mockJsonResponse({ ok: true });
    await fetchBrowserJson("/test", { timeoutMs: 10000 });
    expect(mockFetch).toHaveBeenCalled();
  });

  it("uses default 5000ms timeout", async () => {
    mockJsonResponse({ ok: true });
    await fetchBrowserJson("/test");
    expect(mockFetch).toHaveBeenCalled();
  });

  it("enhances abort errors with timeout message", async () => {
    mockFetch.mockRejectedValueOnce(new Error("AbortError: signal is aborted"));
    await expect(fetchBrowserJson("/test")).rejects.toThrow("timed out");
  });

  it("wraps non-timeout errors", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(fetchBrowserJson("/test")).rejects.toThrow(
      "Can't reach the EClaw browser control service",
    );
  });
});
