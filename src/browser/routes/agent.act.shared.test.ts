import { describe, it, expect } from "vitest";
import {
  ACT_KINDS,
  isActKind,
  parseClickButton,
  parseClickModifiers,
} from "./agent.act.shared.js";

// ---------------------------------------------------------------------------
// ACT_KINDS
// ---------------------------------------------------------------------------

describe("ACT_KINDS", () => {
  it("contains exactly 12 action kinds", () => {
    expect(ACT_KINDS).toHaveLength(12);
  });

  it("includes all expected kinds", () => {
    const expected = [
      "click", "close", "drag", "evaluate", "fill", "hover",
      "scrollIntoView", "press", "resize", "select", "type", "wait",
    ];
    for (const kind of expected) {
      expect(ACT_KINDS).toContain(kind);
    }
  });
});

// ---------------------------------------------------------------------------
// isActKind
// ---------------------------------------------------------------------------

describe("isActKind", () => {
  it("returns true for all valid kinds", () => {
    for (const kind of ACT_KINDS) {
      expect(isActKind(kind)).toBe(true);
    }
  });

  it("returns false for invalid string", () => {
    expect(isActKind("invalid")).toBe(false);
    expect(isActKind("CLICK")).toBe(false);
    expect(isActKind("Click")).toBe(false);
  });

  it("returns false for non-string types", () => {
    expect(isActKind(123)).toBe(false);
    expect(isActKind(null)).toBe(false);
    expect(isActKind(undefined)).toBe(false);
    expect(isActKind({})).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isActKind("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseClickButton
// ---------------------------------------------------------------------------

describe("parseClickButton", () => {
  it("returns 'left' for left", () => {
    expect(parseClickButton("left")).toBe("left");
  });

  it("returns 'right' for right", () => {
    expect(parseClickButton("right")).toBe("right");
  });

  it("returns 'middle' for middle", () => {
    expect(parseClickButton("middle")).toBe("middle");
  });

  it("returns undefined for other strings", () => {
    expect(parseClickButton("primary")).toBeUndefined();
    expect(parseClickButton("")).toBeUndefined();
    expect(parseClickButton("Left")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseClickModifiers
// ---------------------------------------------------------------------------

describe("parseClickModifiers", () => {
  it("accepts all valid modifiers", () => {
    const valid = ["Alt", "Control", "ControlOrMeta", "Meta", "Shift"];
    for (const mod of valid) {
      const result = parseClickModifiers([mod]);
      expect(result.error).toBeUndefined();
      expect(result.modifiers).toEqual([mod]);
    }
  });

  it("returns error for invalid modifier", () => {
    const result = parseClickModifiers(["InvalidMod"]);
    expect(result.error).toMatch(/modifiers must be/);
  });

  it("returns undefined modifiers for empty array", () => {
    const result = parseClickModifiers([]);
    expect(result.modifiers).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("returns error when mixed valid and invalid", () => {
    const result = parseClickModifiers(["Alt", "BadModifier"]);
    expect(result.error).toBeDefined();
  });

  it("accepts multiple valid modifiers", () => {
    const result = parseClickModifiers(["Alt", "Shift", "Control"]);
    expect(result.error).toBeUndefined();
    expect(result.modifiers).toEqual(["Alt", "Shift", "Control"]);
  });
});
