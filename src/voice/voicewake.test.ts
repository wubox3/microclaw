import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadVoiceWakeConfig,
  setVoiceWakeTriggers,
  defaultVoiceWakeTriggers,
} from "./voicewake.js";

// ---------------------------------------------------------------------------
// Test setup - use temp directory for each test
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "voicewake-test-"));
});

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

// ---------------------------------------------------------------------------
// defaultVoiceWakeTriggers
// ---------------------------------------------------------------------------

describe("defaultVoiceWakeTriggers", () => {
  it("returns default triggers", () => {
    const triggers = defaultVoiceWakeTriggers();
    expect(triggers).toEqual(["eclaw", "claude", "computer"]);
  });

  it("returns a new array each time", () => {
    const a = defaultVoiceWakeTriggers();
    const b = defaultVoiceWakeTriggers();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// loadVoiceWakeConfig
// ---------------------------------------------------------------------------

describe("loadVoiceWakeConfig", () => {
  it("returns defaults when no config file exists", async () => {
    const config = await loadVoiceWakeConfig(testDir);
    expect(config.triggers).toEqual(["eclaw", "claude", "computer"]);
    expect(config.updatedAtMs).toBe(0);
  });

  it("loads saved triggers from file", async () => {
    await setVoiceWakeTriggers(["hey assistant", "ok google"], testDir);
    const config = await loadVoiceWakeConfig(testDir);
    expect(config.triggers).toEqual(["hey assistant", "ok google"]);
    expect(config.updatedAtMs).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// setVoiceWakeTriggers
// ---------------------------------------------------------------------------

describe("setVoiceWakeTriggers", () => {
  it("saves and returns sanitized triggers", async () => {
    const config = await setVoiceWakeTriggers(["  Hello  ", "WORLD"], testDir);
    expect(config.triggers).toEqual(["hello", "world"]);
    expect(config.updatedAtMs).toBeGreaterThan(0);
  });

  it("filters empty strings", async () => {
    const config = await setVoiceWakeTriggers(["valid", "", "  ", "also valid"], testDir);
    expect(config.triggers).toEqual(["valid", "also valid"]);
  });

  it("falls back to defaults when all triggers are empty", async () => {
    const config = await setVoiceWakeTriggers(["", "  "], testDir);
    expect(config.triggers).toEqual(["eclaw", "claude", "computer"]);
  });

  it("persists triggers across loads", async () => {
    await setVoiceWakeTriggers(["custom trigger"], testDir);
    const loaded = await loadVoiceWakeConfig(testDir);
    expect(loaded.triggers).toEqual(["custom trigger"]);
  });

  it("handles concurrent writes safely", async () => {
    const results = await Promise.all([
      setVoiceWakeTriggers(["first"], testDir),
      setVoiceWakeTriggers(["second"], testDir),
      setVoiceWakeTriggers(["third"], testDir),
    ]);

    // All should succeed
    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result.triggers.length).toBe(1);
      expect(result.updatedAtMs).toBeGreaterThan(0);
    }

    // Final state should be deterministic (last write wins)
    const final = await loadVoiceWakeConfig(testDir);
    expect(final.triggers.length).toBe(1);
  });

  it("lowercases all triggers", async () => {
    const config = await setVoiceWakeTriggers(["EClaw", "CLAUDE", "Computer"], testDir);
    expect(config.triggers).toEqual(["eclaw", "claude", "computer"]);
  });
});
