import { describe, it, expect } from "vitest";
import { extractErrorCode, formatErrorMessage } from "./errors.js";

describe("extractErrorCode", () => {
  it("returns code from Error with code property", () => {
    const err = Object.assign(new Error("fail"), { code: "ECONNREFUSED" });
    expect(extractErrorCode(err)).toBe("ECONNREFUSED");
  });

  it("returns code from plain object with code property", () => {
    expect(extractErrorCode({ code: "TIMEOUT" })).toBe("TIMEOUT");
  });

  it("returns undefined for string input", () => {
    expect(extractErrorCode("some error")).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(extractErrorCode(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(extractErrorCode(undefined)).toBeUndefined();
  });

  it("returns undefined when code is not a string", () => {
    expect(extractErrorCode({ code: 42 })).toBeUndefined();
  });

  it("returns undefined for object without code", () => {
    expect(extractErrorCode({ message: "fail" })).toBeUndefined();
  });
});

describe("formatErrorMessage", () => {
  it("returns message from Error instance", () => {
    expect(formatErrorMessage(new Error("something broke"))).toBe("something broke");
  });

  it("returns string input as-is", () => {
    expect(formatErrorMessage("raw error")).toBe("raw error");
  });

  it("stringifies number input", () => {
    expect(formatErrorMessage(404)).toBe("404");
  });

  it("stringifies null", () => {
    expect(formatErrorMessage(null)).toBe("null");
  });

  it("stringifies undefined", () => {
    expect(formatErrorMessage(undefined)).toBe("undefined");
  });
});
