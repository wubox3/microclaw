import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBrowserTool } from "./browser-tool.js";

// ---------------------------------------------------------------------------
// Mock the client-fetch module
// ---------------------------------------------------------------------------

vi.mock("./client-fetch.js", () => ({
  fetchBrowserJson: vi.fn(),
}));

import { fetchBrowserJson } from "./client-fetch.js";

const mockFetchBrowserJson = vi.mocked(fetchBrowserJson);

beforeEach(() => {
  mockFetchBrowserJson.mockReset();
});

// ---------------------------------------------------------------------------
// createBrowserTool structure
// ---------------------------------------------------------------------------

describe("createBrowserTool", () => {
  it("returns tool with correct name", () => {
    const tool = createBrowserTool();
    expect(tool.name).toBe("browser");
  });

  it("returns tool with description", () => {
    const tool = createBrowserTool();
    expect(tool.description).toContain("Chrome browser");
  });

  it("has action as required field in schema", () => {
    const tool = createBrowserTool();
    expect(tool.input_schema.required).toContain("action");
  });

  it("schema lists all action types", () => {
    const tool = createBrowserTool();
    const actionProp = (tool.input_schema.properties as Record<string, { enum?: string[] }>).action;
    expect(actionProp.enum).toContain("status");
    expect(actionProp.enum).toContain("start");
    expect(actionProp.enum).toContain("stop");
    expect(actionProp.enum).toContain("navigate");
    expect(actionProp.enum).toContain("snapshot");
    expect(actionProp.enum).toContain("screenshot");
    expect(actionProp.enum).toContain("tabs");
    expect(actionProp.enum).toContain("profiles");
    expect(actionProp.enum).toContain("act");
  });
});

// ---------------------------------------------------------------------------
// execute — error cases
// ---------------------------------------------------------------------------

describe("execute — error handling", () => {
  it("returns error for missing action", async () => {
    const tool = createBrowserTool();
    const result = await tool.execute({});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Missing required parameter: action");
  });

  it("returns error for unknown action", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockResolvedValueOnce(undefined as never);
    const result = await tool.execute({ action: "bogus" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Unknown browser action");
  });

  it("returns error when fetch fails", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockRejectedValueOnce(new Error("connection refused"));
    const result = await tool.execute({ action: "status" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("connection refused");
  });
});

// ---------------------------------------------------------------------------
// execute — action dispatch
// ---------------------------------------------------------------------------

describe("execute — status", () => {
  it("calls GET /", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockResolvedValueOnce({ running: true });
    const result = await tool.execute({ action: "status" });
    expect(mockFetchBrowserJson).toHaveBeenCalledWith(
      "/",
    );
    expect(result.content).toContain("running");
  });

  it("includes profile query param", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockResolvedValueOnce({ running: true });
    await tool.execute({ action: "status", profile: "test" });
    expect(mockFetchBrowserJson).toHaveBeenCalledWith(
      "/?profile=test",
    );
  });
});

describe("execute — start", () => {
  it("calls POST /start with body", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockResolvedValueOnce({ started: true });
    await tool.execute({ action: "start", url: "https://example.com", headless: true });
    expect(mockFetchBrowserJson).toHaveBeenCalledWith(
      "/start",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("https://example.com"),
      }),
    );
  });
});

describe("execute — stop", () => {
  it("calls POST /stop", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockResolvedValueOnce({ stopped: true });
    await tool.execute({ action: "stop" });
    expect(mockFetchBrowserJson).toHaveBeenCalledWith(
      "/stop",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("execute — navigate", () => {
  it("calls POST /navigate with url and targetId", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockResolvedValueOnce({ ok: true });
    await tool.execute({ action: "navigate", url: "https://example.com", targetId: "tab1" });
    expect(mockFetchBrowserJson).toHaveBeenCalledWith(
      "/navigate",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("https://example.com"),
      }),
    );
  });
});

describe("execute — snapshot", () => {
  it("calls GET /snapshot with query params", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockResolvedValueOnce({ snapshot: "<html>content</html>" });
    const result = await tool.execute({ action: "snapshot", targetId: "tab1", maxChars: 5000 });
    expect(mockFetchBrowserJson).toHaveBeenCalledWith(
      expect.stringContaining("/snapshot"),
      expect.objectContaining({ timeoutMs: 15000 }),
    );
    expect(result.content).toBe("<html>content</html>");
  });

  it("falls back to formatted result when snapshot field missing", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockResolvedValueOnce({ data: "other" });
    const result = await tool.execute({ action: "snapshot" });
    expect(result.content).toContain("other");
  });
});

describe("execute — screenshot", () => {
  it("calls POST /screenshot", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockResolvedValueOnce({ image: "base64data" });
    await tool.execute({ action: "screenshot", targetId: "tab1" });
    expect(mockFetchBrowserJson).toHaveBeenCalledWith(
      "/screenshot",
      expect.objectContaining({ timeoutMs: 15000 }),
    );
  });
});

describe("execute — tabs", () => {
  it("calls GET /tabs", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockResolvedValueOnce([{ targetId: "t1" }]);
    await tool.execute({ action: "tabs" });
    expect(mockFetchBrowserJson).toHaveBeenCalledWith("/tabs");
  });
});

describe("execute — profiles", () => {
  it("calls GET /profiles", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockResolvedValueOnce([{ name: "default" }]);
    await tool.execute({ action: "profiles" });
    expect(mockFetchBrowserJson).toHaveBeenCalledWith("/profiles");
  });
});

describe("execute — act", () => {
  it("calls POST /act with commands", async () => {
    const tool = createBrowserTool();
    const commands = [{ kind: "click", ref: "E123" }];
    mockFetchBrowserJson.mockResolvedValueOnce({ ok: true });
    await tool.execute({ action: "act", commands, targetId: "tab1" });
    expect(mockFetchBrowserJson).toHaveBeenCalledWith(
      "/act",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("click"),
        timeoutMs: 30000,
      }),
    );
  });
});

describe("execute — open", () => {
  it("calls POST /tabs/open with url", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockResolvedValueOnce({ ok: true });
    await tool.execute({ action: "open", url: "https://example.com" });
    expect(mockFetchBrowserJson).toHaveBeenCalledWith(
      "/tabs/open",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("https://example.com"),
      }),
    );
  });
});

describe("execute — focus", () => {
  it("calls POST /tabs/focus with targetId", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockResolvedValueOnce({ ok: true });
    await tool.execute({ action: "focus", targetId: "tab1" });
    expect(mockFetchBrowserJson).toHaveBeenCalledWith(
      "/tabs/focus",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });
});

describe("execute — close", () => {
  it("calls DELETE /tabs/:targetId", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockResolvedValueOnce({ ok: true });
    await tool.execute({ action: "close", targetId: "tab1" });
    expect(mockFetchBrowserJson).toHaveBeenCalledWith(
      "/tabs/tab1",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });
});

describe("execute — console", () => {
  it("calls GET /console with query params", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockResolvedValueOnce([{ text: "log output" }]);
    await tool.execute({ action: "console", targetId: "tab1", profile: "test" });
    expect(mockFetchBrowserJson).toHaveBeenCalledWith(
      expect.stringContaining("/console"),
    );
  });
});

describe("execute — pdf", () => {
  it("calls POST /pdf with targetId", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockResolvedValueOnce({ ok: true });
    await tool.execute({ action: "pdf", targetId: "tab1" });
    expect(mockFetchBrowserJson).toHaveBeenCalledWith(
      "/pdf",
      expect.objectContaining({
        method: "POST",
        timeoutMs: 30000,
      }),
    );
  });
});

describe("execute — upload", () => {
  it("calls POST /hooks/file-chooser with paths and targetId", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockResolvedValueOnce({ ok: true });
    await tool.execute({ action: "upload", paths: ["/file.txt"], targetId: "tab1" });
    expect(mockFetchBrowserJson).toHaveBeenCalledWith(
      "/hooks/file-chooser",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("file.txt"),
      }),
    );
  });
});

describe("execute — dialog", () => {
  it("calls POST /hooks/dialog with accept and promptText", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockResolvedValueOnce({ ok: true });
    await tool.execute({ action: "dialog", accept: true, promptText: "response", targetId: "tab1" });
    expect(mockFetchBrowserJson).toHaveBeenCalledWith(
      "/hooks/dialog",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("response"),
      }),
    );
  });
});

describe("execute — formatResult", () => {
  it("formats string result directly", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockResolvedValueOnce("plain text response");
    const result = await tool.execute({ action: "status" });
    expect(result.content).toBe("plain text response");
  });

  it("formats object result as JSON", async () => {
    const tool = createBrowserTool();
    mockFetchBrowserJson.mockResolvedValueOnce({ key: "value" });
    const result = await tool.execute({ action: "status" });
    expect(JSON.parse(result.content)).toEqual({ key: "value" });
  });
});
