import { describe, it, expect } from "vitest";
import {
  isValidProfileName,
  allocateCdpPort,
  getUsedPorts,
  allocateColor,
  getUsedColors,
  PROFILE_COLORS,
  CDP_PORT_RANGE_START,
  CDP_PORT_RANGE_END,
} from "./profiles.js";

// ---------------------------------------------------------------------------
// isValidProfileName
// ---------------------------------------------------------------------------

describe("isValidProfileName", () => {
  it("accepts simple lowercase name", () => {
    expect(isValidProfileName("default")).toBe(true);
  });

  it("accepts name with digits", () => {
    expect(isValidProfileName("profile1")).toBe(true);
  });

  it("accepts name with hyphens", () => {
    expect(isValidProfileName("my-profile")).toBe(true);
  });

  it("accepts name starting with digit", () => {
    expect(isValidProfileName("1profile")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidProfileName("")).toBe(false);
  });

  it("rejects name longer than 64 characters", () => {
    expect(isValidProfileName("a".repeat(65))).toBe(false);
  });

  it("accepts name exactly 64 characters", () => {
    expect(isValidProfileName("a".repeat(64))).toBe(true);
  });

  it("rejects uppercase letters", () => {
    expect(isValidProfileName("Profile")).toBe(false);
  });

  it("rejects special characters", () => {
    expect(isValidProfileName("my_profile")).toBe(false);
    expect(isValidProfileName("my.profile")).toBe(false);
    expect(isValidProfileName("my profile")).toBe(false);
  });

  it("rejects name starting with hyphen", () => {
    expect(isValidProfileName("-profile")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// allocateCdpPort
// ---------------------------------------------------------------------------

describe("allocateCdpPort", () => {
  it("returns first port in range when none used", () => {
    expect(allocateCdpPort(new Set())).toBe(CDP_PORT_RANGE_START);
  });

  it("skips used ports", () => {
    const used = new Set([CDP_PORT_RANGE_START, CDP_PORT_RANGE_START + 1]);
    expect(allocateCdpPort(used)).toBe(CDP_PORT_RANGE_START + 2);
  });

  it("returns null when all ports used", () => {
    const used = new Set<number>();
    for (let p = CDP_PORT_RANGE_START; p <= CDP_PORT_RANGE_END; p++) {
      used.add(p);
    }
    expect(allocateCdpPort(used)).toBeNull();
  });

  it("uses custom range", () => {
    expect(allocateCdpPort(new Set(), { start: 5000, end: 5010 })).toBe(5000);
  });

  it("returns null when start > end", () => {
    expect(allocateCdpPort(new Set(), { start: 5010, end: 5000 })).toBeNull();
  });

  it("returns null for negative start", () => {
    expect(allocateCdpPort(new Set(), { start: -1, end: 100 })).toBeNull();
  });

  it("returns null for non-finite start", () => {
    expect(allocateCdpPort(new Set(), { start: Infinity, end: 100 })).toBeNull();
  });

  it("returns null for NaN end", () => {
    expect(allocateCdpPort(new Set(), { start: 100, end: NaN })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getUsedPorts
// ---------------------------------------------------------------------------

describe("getUsedPorts", () => {
  it("returns empty set for undefined profiles", () => {
    expect(getUsedPorts(undefined)).toEqual(new Set());
  });

  it("returns empty set for empty profiles", () => {
    expect(getUsedPorts({})).toEqual(new Set());
  });

  it("extracts cdpPort from profiles", () => {
    const profiles = {
      a: { cdpPort: 18800 },
      b: { cdpPort: 18801 },
    };
    expect(getUsedPorts(profiles)).toEqual(new Set([18800, 18801]));
  });

  it("parses port from cdpUrl with explicit port", () => {
    const profiles = {
      a: { cdpUrl: "http://127.0.0.1:9222" },
    };
    expect(getUsedPorts(profiles)).toEqual(new Set([9222]));
  });

  it("uses default port 443 for https without explicit port", () => {
    const profiles = {
      a: { cdpUrl: "https://remote.host/path" },
    };
    expect(getUsedPorts(profiles)).toEqual(new Set([443]));
  });

  it("uses default port 80 for http without explicit port", () => {
    const profiles = {
      a: { cdpUrl: "http://remote.host/path" },
    };
    expect(getUsedPorts(profiles)).toEqual(new Set([80]));
  });

  it("ignores invalid URLs", () => {
    const profiles = {
      a: { cdpUrl: "not a url" },
    };
    expect(getUsedPorts(profiles)).toEqual(new Set());
  });

  it("prefers cdpPort over cdpUrl when both present", () => {
    const profiles = {
      a: { cdpPort: 18800, cdpUrl: "http://127.0.0.1:9222" },
    };
    expect(getUsedPorts(profiles)).toEqual(new Set([18800]));
  });

  it("skips profiles with empty cdpUrl", () => {
    const profiles = {
      a: { cdpUrl: "  " },
    };
    expect(getUsedPorts(profiles)).toEqual(new Set());
  });
});

// ---------------------------------------------------------------------------
// allocateColor
// ---------------------------------------------------------------------------

describe("allocateColor", () => {
  it("returns first color when none used", () => {
    expect(allocateColor(new Set())).toBe(PROFILE_COLORS[0]);
  });

  it("skips used colors", () => {
    const used = new Set([PROFILE_COLORS[0].toUpperCase()]);
    expect(allocateColor(used)).toBe(PROFILE_COLORS[1]);
  });

  it("cycles when all colors used", () => {
    const used = new Set(PROFILE_COLORS.map((c) => c.toUpperCase()));
    const index = used.size % PROFILE_COLORS.length;
    expect(allocateColor(used)).toBe(PROFILE_COLORS[index]);
  });
});

// ---------------------------------------------------------------------------
// getUsedColors
// ---------------------------------------------------------------------------

describe("getUsedColors", () => {
  it("returns empty set for undefined profiles", () => {
    expect(getUsedColors(undefined)).toEqual(new Set());
  });

  it("returns empty set for empty profiles", () => {
    expect(getUsedColors({})).toEqual(new Set());
  });

  it("extracts and uppercases colors", () => {
    const profiles = {
      a: { color: "#ff4500" },
      b: { color: "#0066CC" },
    };
    expect(getUsedColors(profiles)).toEqual(new Set(["#FF4500", "#0066CC"]));
  });

  it("filters profiles with undefined color", () => {
    const profiles = {
      a: { color: "#FF4500" },
      b: {},
    };
    expect(getUsedColors(profiles)).toEqual(new Set(["#FF4500"]));
  });
});
