import { describe, it, expect } from "vitest";
import { normalizeCdpWsUrl, formatAriaSnapshot, type RawAXNode } from "./cdp.js";

// ---------------------------------------------------------------------------
// normalizeCdpWsUrl
// ---------------------------------------------------------------------------

describe("normalizeCdpWsUrl", () => {
  it("rewrites loopback ws hostname/port/protocol when cdp is remote", () => {
    const result = normalizeCdpWsUrl(
      "ws://localhost:9222/devtools/page/abc",
      "http://remote.example.com:9333",
    );
    const parsed = new URL(result);
    expect(parsed.hostname).toBe("remote.example.com");
    expect(parsed.port).toBe("9333");
    expect(parsed.protocol).toBe("ws:");
  });

  it("upgrades ws to wss when cdp uses https", () => {
    const result = normalizeCdpWsUrl(
      "ws://localhost:9222/devtools/page/abc",
      "https://remote.example.com:443",
    );
    const parsed = new URL(result);
    expect(parsed.protocol).toBe("wss:");
  });

  it("upgrades ws to wss when cdp is https even if ws is already remote", () => {
    const result = normalizeCdpWsUrl(
      "ws://remote.example.com:9222/devtools/page/abc",
      "https://remote.example.com:443",
    );
    expect(new URL(result).protocol).toBe("wss:");
  });

  it("copies credentials from cdp when ws has none", () => {
    const result = normalizeCdpWsUrl(
      "ws://localhost:9222/devtools/page/abc",
      "http://user:pass@remote.example.com:9333",
    );
    const parsed = new URL(result);
    expect(parsed.username).toBe("user");
    expect(parsed.password).toBe("pass");
  });

  it("does not overwrite existing ws credentials", () => {
    const result = normalizeCdpWsUrl(
      "ws://wsuser:wspass@localhost:9222/devtools/page/abc",
      "http://cdpuser:cdppass@remote.example.com:9333",
    );
    const parsed = new URL(result);
    expect(parsed.username).toBe("wsuser");
    expect(parsed.password).toBe("wspass");
  });

  it("merges searchParams from cdp when ws lacks them", () => {
    const result = normalizeCdpWsUrl(
      "ws://localhost:9222/devtools/page/abc",
      "http://remote.example.com:9333?token=abc&foo=bar",
    );
    const parsed = new URL(result);
    expect(parsed.searchParams.get("token")).toBe("abc");
    expect(parsed.searchParams.get("foo")).toBe("bar");
  });

  it("does not overwrite existing searchParams in ws", () => {
    const result = normalizeCdpWsUrl(
      "ws://localhost:9222/devtools/page/abc?token=ws-token",
      "http://remote.example.com:9333?token=cdp-token",
    );
    const parsed = new URL(result);
    expect(parsed.searchParams.get("token")).toBe("ws-token");
  });

  it("does not rewrite when both are loopback", () => {
    const result = normalizeCdpWsUrl(
      "ws://127.0.0.1:9222/devtools/page/abc",
      "http://localhost:9333",
    );
    const parsed = new URL(result);
    expect(parsed.hostname).toBe("127.0.0.1");
    expect(parsed.port).toBe("9222");
  });

  it("does not rewrite when both are remote", () => {
    const result = normalizeCdpWsUrl(
      "ws://remote1.example.com:9222/devtools/page/abc",
      "http://remote2.example.com:9333",
    );
    const parsed = new URL(result);
    expect(parsed.hostname).toBe("remote1.example.com");
    expect(parsed.port).toBe("9222");
  });

  it("uses default port 443 for https cdp without explicit port", () => {
    const result = normalizeCdpWsUrl(
      "ws://localhost:9222/devtools/page/abc",
      "https://remote.example.com",
    );
    const parsed = new URL(result);
    // URL normalizes default ports to empty string; 443 is default for wss
    expect(parsed.port).toBe("");
    expect(parsed.protocol).toBe("wss:");
    expect(parsed.hostname).toBe("remote.example.com");
  });

  it("uses default port 80 for http cdp without explicit port", () => {
    const result = normalizeCdpWsUrl(
      "ws://localhost:9222/devtools/page/abc",
      "http://remote.example.com",
    );
    const parsed = new URL(result);
    // URL normalizes default ports to empty string; 80 is default for ws
    expect(parsed.port).toBe("");
    expect(parsed.hostname).toBe("remote.example.com");
  });
});

// ---------------------------------------------------------------------------
// formatAriaSnapshot
// ---------------------------------------------------------------------------

describe("formatAriaSnapshot", () => {
  it("returns empty array for empty input", () => {
    expect(formatAriaSnapshot([], 100)).toEqual([]);
  });

  it("handles single root node", () => {
    const nodes: RawAXNode[] = [
      { nodeId: "1", role: { value: "button" }, name: { value: "Submit" } },
    ];
    const result = formatAriaSnapshot(nodes, 100);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      ref: "ax1",
      role: "button",
      name: "Submit",
      depth: 0,
    });
  });

  it("traverses tree with children in DFS order", () => {
    const nodes: RawAXNode[] = [
      { nodeId: "root", role: { value: "group" }, name: { value: "Root" }, childIds: ["a", "b"] },
      { nodeId: "a", role: { value: "button" }, name: { value: "A" } },
      { nodeId: "b", role: { value: "link" }, name: { value: "B" } },
    ];
    const result = formatAriaSnapshot(nodes, 100);
    expect(result).toHaveLength(3);
    expect(result[0]?.name).toBe("Root");
    expect(result[0]?.depth).toBe(0);
    expect(result[1]?.name).toBe("A");
    expect(result[1]?.depth).toBe(1);
    expect(result[2]?.name).toBe("B");
    expect(result[2]?.depth).toBe(1);
  });

  it("respects limit parameter", () => {
    const nodes: RawAXNode[] = [
      { nodeId: "root", role: { value: "group" }, name: { value: "Root" }, childIds: ["a", "b", "c"] },
      { nodeId: "a", role: { value: "button" }, name: { value: "A" } },
      { nodeId: "b", role: { value: "link" }, name: { value: "B" } },
      { nodeId: "c", role: { value: "text" }, name: { value: "C" } },
    ];
    const result = formatAriaSnapshot(nodes, 2);
    expect(result).toHaveLength(2);
  });

  it("includes value, description, and backendDOMNodeId when present", () => {
    const nodes: RawAXNode[] = [
      {
        nodeId: "1",
        role: { value: "textbox" },
        name: { value: "Email" },
        value: { value: "test@example.com" },
        description: { value: "Enter your email" },
        backendDOMNodeId: 42,
      },
    ];
    const result = formatAriaSnapshot(nodes, 100);
    expect(result[0]).toMatchObject({
      value: "test@example.com",
      description: "Enter your email",
      backendDOMNodeId: 42,
    });
  });

  it("omits value/description when empty", () => {
    const nodes: RawAXNode[] = [
      { nodeId: "1", role: { value: "button" }, name: { value: "Click" } },
    ];
    const result = formatAriaSnapshot(nodes, 100);
    expect(result[0]?.value).toBeUndefined();
    expect(result[0]?.description).toBeUndefined();
    expect(result[0]?.backendDOMNodeId).toBeUndefined();
  });

  it("selects orphan root (unreferenced node)", () => {
    const nodes: RawAXNode[] = [
      { nodeId: "child", role: { value: "link" }, name: { value: "Child" } },
      { nodeId: "root", role: { value: "group" }, name: { value: "Root" }, childIds: ["child"] },
    ];
    // "root" is not referenced by any childIds, so it should be selected as root
    const result = formatAriaSnapshot(nodes, 100);
    expect(result[0]?.name).toBe("Root");
    expect(result[1]?.name).toBe("Child");
  });

  it("skips missing nodeId references in children", () => {
    const nodes: RawAXNode[] = [
      { nodeId: "root", role: { value: "group" }, name: { value: "Root" }, childIds: ["missing", "a"] },
      { nodeId: "a", role: { value: "button" }, name: { value: "A" } },
    ];
    const result = formatAriaSnapshot(nodes, 100);
    expect(result).toHaveLength(2);
    expect(result[1]?.name).toBe("A");
  });

  it("returns empty array when root has no nodeId", () => {
    const nodes: RawAXNode[] = [
      { role: { value: "button" }, name: { value: "No ID" } },
    ];
    expect(formatAriaSnapshot(nodes, 100)).toEqual([]);
  });

  it("handles axValue edge cases: null, non-object, numeric value", () => {
    const nodes: RawAXNode[] = [
      {
        nodeId: "1",
        role: null as unknown as RawAXNode["role"],
        name: undefined as unknown as RawAXNode["name"],
        value: { value: 42 },
      },
    ];
    const result = formatAriaSnapshot(nodes, 100);
    expect(result[0]?.role).toBe("unknown");
    expect(result[0]?.name).toBe("");
    expect(result[0]?.value).toBe("42");
  });

  it("handles axValue with boolean value", () => {
    const nodes: RawAXNode[] = [
      {
        nodeId: "1",
        role: { value: "checkbox" },
        name: { value: "Accept" },
        value: { value: true },
      },
    ];
    const result = formatAriaSnapshot(nodes, 100);
    expect(result[0]?.value).toBe("true");
  });
});
