import { describe, it, expect } from "vitest";
import { formatCliCommand } from "./cli-format.js";

describe("formatCliCommand", () => {
  it("returns command string unchanged", () => {
    expect(formatCliCommand("ls -la /tmp")).toBe("ls -la /tmp");
  });

  it("handles empty string", () => {
    expect(formatCliCommand("")).toBe("");
  });
});
