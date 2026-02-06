import { describe, it, expect, vi } from "vitest";

vi.mock("./compat/media.js", () => ({
  getImageMetadata: vi.fn(),
  resizeToJpeg: vi.fn(),
}));

import {
  normalizeBrowserScreenshot,
  DEFAULT_BROWSER_SCREENSHOT_MAX_SIDE,
  DEFAULT_BROWSER_SCREENSHOT_MAX_BYTES,
} from "./screenshot.js";
import { getImageMetadata, resizeToJpeg } from "./compat/media.js";

const mockedGetMetadata = vi.mocked(getImageMetadata);
const mockedResize = vi.mocked(resizeToJpeg);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("screenshot constants", () => {
  it("exports DEFAULT_BROWSER_SCREENSHOT_MAX_SIDE", () => {
    expect(DEFAULT_BROWSER_SCREENSHOT_MAX_SIDE).toBe(2000);
  });

  it("exports DEFAULT_BROWSER_SCREENSHOT_MAX_BYTES", () => {
    expect(DEFAULT_BROWSER_SCREENSHOT_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
// normalizeBrowserScreenshot
// ---------------------------------------------------------------------------

describe("normalizeBrowserScreenshot", () => {
  it("returns original buffer when size is under limits", async () => {
    const buf = Buffer.alloc(100);
    mockedGetMetadata.mockResolvedValueOnce({ width: 800, height: 600 });

    const result = await normalizeBrowserScreenshot(buf);
    expect(result.buffer).toBe(buf);
    expect(result.contentType).toBeUndefined();
  });

  it("resizes when image exceeds maxBytes", async () => {
    const largeBuf = Buffer.alloc(6 * 1024 * 1024);
    const smallBuf = Buffer.alloc(1024);
    mockedGetMetadata.mockResolvedValueOnce({ width: 800, height: 600 });
    mockedResize.mockResolvedValue(smallBuf);

    const result = await normalizeBrowserScreenshot(largeBuf);
    expect(result.buffer).toBe(smallBuf);
    expect(result.contentType).toBe("image/jpeg");
  });

  it("resizes when image exceeds maxSide", async () => {
    const buf = Buffer.alloc(100);
    const resizedBuf = Buffer.alloc(50);
    mockedGetMetadata.mockResolvedValueOnce({ width: 3000, height: 2000 });
    mockedResize.mockResolvedValue(resizedBuf);

    const result = await normalizeBrowserScreenshot(buf);
    expect(result.buffer).toBe(resizedBuf);
    expect(result.contentType).toBe("image/jpeg");
  });

  it("uses custom maxSide and maxBytes options", async () => {
    const buf = Buffer.alloc(500);
    const resizedBuf = Buffer.alloc(50);
    mockedGetMetadata.mockResolvedValueOnce({ width: 600, height: 400 });
    mockedResize.mockResolvedValue(resizedBuf);

    const result = await normalizeBrowserScreenshot(buf, { maxSide: 500, maxBytes: 100 });
    expect(result.buffer).toBe(resizedBuf);
    expect(result.contentType).toBe("image/jpeg");
  });

  it("throws when image cannot be reduced below maxBytes", async () => {
    const largeBuf = Buffer.alloc(6 * 1024 * 1024);
    const stillLargeBuf = Buffer.alloc(6 * 1024 * 1024);
    mockedGetMetadata.mockResolvedValueOnce({ width: 800, height: 600 });
    mockedResize.mockResolvedValue(stillLargeBuf);

    await expect(normalizeBrowserScreenshot(largeBuf)).rejects.toThrow(
      "Browser screenshot could not be reduced below",
    );
  });

  it("handles image with 0 dimensions but large bytes", async () => {
    const largeBuf = Buffer.alloc(6 * 1024 * 1024);
    const smallBuf = Buffer.alloc(1024);
    mockedGetMetadata.mockResolvedValueOnce({ width: 0, height: 0 });
    mockedResize.mockResolvedValue(smallBuf);

    const result = await normalizeBrowserScreenshot(largeBuf);
    expect(result.buffer).toBe(smallBuf);
    expect(result.contentType).toBe("image/jpeg");
  });

  it("tries multiple quality/size combinations to fit", async () => {
    const largeBuf = Buffer.alloc(6 * 1024 * 1024);
    const smallBuf = Buffer.alloc(1024);
    mockedGetMetadata.mockResolvedValueOnce({ width: 2000, height: 1500 });

    let callCount = 0;
    mockedResize.mockImplementation(async () => {
      callCount++;
      // First few calls return still-too-large buffer, then one that fits
      if (callCount < 3) return Buffer.alloc(6 * 1024 * 1024);
      return smallBuf;
    });

    const result = await normalizeBrowserScreenshot(largeBuf);
    expect(result.buffer).toBe(smallBuf);
    expect(result.contentType).toBe("image/jpeg");
    expect(callCount).toBeGreaterThanOrEqual(3);
  });
});
