import { describe, it, expect } from "vitest";
import { parseBooleanValue } from "./boolean.js";

describe("parseBooleanValue", () => {
  it("returns true for boolean true", () => {
    expect(parseBooleanValue(true)).toBe(true);
  });

  it("returns false for boolean false", () => {
    expect(parseBooleanValue(false)).toBe(false);
  });

  it("returns true for 'true'", () => {
    expect(parseBooleanValue("true")).toBe(true);
  });

  it("returns true for '1'", () => {
    expect(parseBooleanValue("1")).toBe(true);
  });

  it("returns true for 'yes'", () => {
    expect(parseBooleanValue("yes")).toBe(true);
  });

  it("returns true for 'on'", () => {
    expect(parseBooleanValue("on")).toBe(true);
  });

  it("returns false for 'false'", () => {
    expect(parseBooleanValue("false")).toBe(false);
  });

  it("returns false for '0'", () => {
    expect(parseBooleanValue("0")).toBe(false);
  });

  it("returns false for 'no'", () => {
    expect(parseBooleanValue("no")).toBe(false);
  });

  it("returns false for 'off'", () => {
    expect(parseBooleanValue("off")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(parseBooleanValue("TRUE")).toBe(true);
    expect(parseBooleanValue("False")).toBe(false);
    expect(parseBooleanValue("YES")).toBe(true);
    expect(parseBooleanValue("OFF")).toBe(false);
  });

  it("trims whitespace", () => {
    expect(parseBooleanValue("  true  ")).toBe(true);
    expect(parseBooleanValue("  false  ")).toBe(false);
  });

  it("returns undefined for empty string", () => {
    expect(parseBooleanValue("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only string", () => {
    expect(parseBooleanValue("   ")).toBeUndefined();
  });

  it("returns undefined for non-string non-boolean", () => {
    expect(parseBooleanValue(42)).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(parseBooleanValue(null)).toBeUndefined();
  });

  it("returns undefined for unrecognized string", () => {
    expect(parseBooleanValue("maybe")).toBeUndefined();
  });

  it("uses custom truthy options", () => {
    expect(parseBooleanValue("oui", { truthy: ["oui"] })).toBe(true);
    expect(parseBooleanValue("true", { truthy: ["oui"] })).toBeUndefined();
  });

  it("uses custom falsy options", () => {
    expect(parseBooleanValue("non", { falsy: ["non"] })).toBe(false);
    expect(parseBooleanValue("false", { falsy: ["non"] })).toBeUndefined();
  });
});
