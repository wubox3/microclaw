import { describe, it, expect } from "vitest";
import { rawDataToString } from "./ws.js";

describe("rawDataToString", () => {
  it("returns string input unchanged", () => {
    expect(rawDataToString("hello")).toBe("hello");
  });

  it("converts Buffer to string", () => {
    const buf = Buffer.from("buffer data", "utf-8");
    expect(rawDataToString(buf)).toBe("buffer data");
  });

  it("converts ArrayBuffer to string", () => {
    const encoder = new TextEncoder();
    const ab = encoder.encode("arraybuffer").buffer;
    expect(rawDataToString(ab)).toBe("arraybuffer");
  });

  it("concatenates array of Buffers", () => {
    const chunks = [Buffer.from("hello "), Buffer.from("world")];
    expect(rawDataToString(chunks)).toBe("hello world");
  });

  it("handles array of non-Buffer items by converting each", () => {
    const ab = new TextEncoder().encode("part").buffer;
    const chunks = [ab];
    expect(rawDataToString(chunks)).toBe("part");
  });

  it("falls back to String() for non-standard input", () => {
    expect(rawDataToString(12345)).toBe("12345");
  });
});
