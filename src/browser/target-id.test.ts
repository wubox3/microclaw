import { describe, it, expect } from "vitest";
import { resolveTargetIdFromTabs } from "./target-id.js";

describe("resolveTargetIdFromTabs", () => {
  const tabs = [
    { targetId: "ABC123" },
    { targetId: "ABC456" },
    { targetId: "DEF789" },
  ];

  it("finds exact match", () => {
    const result = resolveTargetIdFromTabs("ABC123", tabs);
    expect(result).toEqual({ ok: true, targetId: "ABC123" });
  });

  it("finds unique case-insensitive prefix", () => {
    const result = resolveTargetIdFromTabs("def", tabs);
    expect(result).toEqual({ ok: true, targetId: "DEF789" });
  });

  it("returns ambiguous for non-unique prefix", () => {
    const result = resolveTargetIdFromTabs("abc", tabs);
    expect(result).toEqual({
      ok: false,
      reason: "ambiguous",
      matches: ["ABC123", "ABC456"],
    });
  });

  it("returns not_found when no match", () => {
    const result = resolveTargetIdFromTabs("XYZ", tabs);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns not_found for empty input", () => {
    const result = resolveTargetIdFromTabs("", tabs);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns not_found for whitespace-only input", () => {
    const result = resolveTargetIdFromTabs("   ", tabs);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns not_found for empty tabs array", () => {
    const result = resolveTargetIdFromTabs("ABC", []);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("trims whitespace from input", () => {
    const result = resolveTargetIdFromTabs("  DEF789  ", tabs);
    expect(result).toEqual({ ok: true, targetId: "DEF789" });
  });

  it("exact match takes precedence over prefix", () => {
    const overlapping = [
      { targetId: "AB" },
      { targetId: "ABC" },
    ];
    const result = resolveTargetIdFromTabs("AB", overlapping);
    expect(result).toEqual({ ok: true, targetId: "AB" });
  });

  it("single prefix match returns ok", () => {
    const single = [{ targetId: "UNIQUE123" }];
    const result = resolveTargetIdFromTabs("unique", single);
    expect(result).toEqual({ ok: true, targetId: "UNIQUE123" });
  });
});
