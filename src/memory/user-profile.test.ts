import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createUserProfileManager, formatProfileForPrompt } from "./user-profile.js";
import { MEMORY_SCHEMA, FTS_SYNC_TRIGGERS, CHAT_SCHEMA } from "./memory-schema.js";
import type { UserProfile } from "./types.js";
import type { LlmClient } from "../agent/llm-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(MEMORY_SCHEMA);
  db.exec(FTS_SYNC_TRIGGERS);
  db.exec(CHAT_SCHEMA);
  return db;
}

function seedUserMessages(db: DatabaseSync, messages: string[]): void {
  const stmt = db.prepare(
    "INSERT INTO chat_messages (channel_id, role, content, timestamp) VALUES ('web', 'user', ?, ?)",
  );
  for (let i = 0; i < messages.length; i++) {
    stmt.run(messages[i], 1000 + i);
  }
}

function createMockLlmClient(responseText: string): LlmClient {
  return {
    sendMessage: vi.fn().mockResolvedValue({ text: responseText }),
    streamMessage: vi.fn(),
  };
}

/** Minimal profile with all required array fields filled in. */
function minimalProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    interests: [],
    preferences: [],
    favoriteFoods: [],
    restaurants: [],
    coffeePlaces: [],
    clubs: [],
    shoppingPlaces: [],
    workPlaces: [],
    dailyPlaces: [],
    exerciseRoutes: [],
    keyFacts: [],
    lastUpdated: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createUserProfileManager
// ---------------------------------------------------------------------------

describe("createUserProfileManager", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("getProfile / saveProfile round-trip", () => {
    it("returns undefined when no profile exists", () => {
      const mgr = createUserProfileManager(db);
      expect(mgr.getProfile()).toBeUndefined();
    });

    it("persists and retrieves a profile", () => {
      const mgr = createUserProfileManager(db);
      const profile = minimalProfile({
        name: "Alice",
        interests: ["coding"],
        keyFacts: ["Works at Acme"],
      });
      mgr.saveProfile(profile);
      const loaded = mgr.getProfile();
      expect(loaded).toEqual(profile);
    });

    it("overwrites existing profile on save", () => {
      const mgr = createUserProfileManager(db);
      mgr.saveProfile(minimalProfile({ name: "Old" }));
      mgr.saveProfile(minimalProfile({
        name: "New",
        interests: ["reading"],
        lastUpdated: "2026-02-01T00:00:00.000Z",
      }));
      const loaded = mgr.getProfile();
      expect(loaded?.name).toBe("New");
      expect(loaded?.interests).toEqual(["reading"]);
    });

    it("uses in-memory cache after first read", () => {
      const mgr = createUserProfileManager(db);
      const profile = minimalProfile({ name: "Cached" });
      mgr.saveProfile(profile);

      const first = mgr.getProfile();
      db.prepare("DELETE FROM memory_meta WHERE key = 'user_profile'").run();
      const second = mgr.getProfile();

      expect(first).toEqual(profile);
      expect(second).toEqual(profile);
    });

    it("invalidates cache on save", () => {
      const mgr = createUserProfileManager(db);
      mgr.saveProfile(minimalProfile({ name: "V1" }));
      mgr.getProfile();
      mgr.saveProfile(minimalProfile({
        name: "V2",
        lastUpdated: "2026-02-01T00:00:00.000Z",
      }));
      expect(mgr.getProfile()?.name).toBe("V2");
    });

    it("returns undefined for corrupted JSON in memory_meta", () => {
      db.prepare(
        "INSERT INTO memory_meta (key, value) VALUES ('user_profile', 'not valid json{')",
      ).run();
      const mgr = createUserProfileManager(db);
      expect(mgr.getProfile()).toBeUndefined();
    });

    it("round-trips all daily-life fields", () => {
      const mgr = createUserProfileManager(db);
      const profile = minimalProfile({
        favoriteFoods: ["sushi", "tacos"],
        restaurants: ["Chipotle", "The French Laundry"],
        coffeePlaces: ["Blue Bottle", "Philz Coffee"],
        clubs: ["Barry's Bootcamp"],
        shoppingPlaces: ["Trader Joe's", "Target"],
        workPlaces: ["Google campus"],
        dailyPlaces: ["Golden Gate Park", "SF Public Library"],
        exerciseRoutes: ["Morning jog along Embarcadero", "Bike through Golden Gate Park"],
      });
      mgr.saveProfile(profile);
      const loaded = mgr.getProfile();
      expect(loaded?.favoriteFoods).toEqual(["sushi", "tacos"]);
      expect(loaded?.restaurants).toEqual(["Chipotle", "The French Laundry"]);
      expect(loaded?.coffeePlaces).toEqual(["Blue Bottle", "Philz Coffee"]);
      expect(loaded?.clubs).toEqual(["Barry's Bootcamp"]);
      expect(loaded?.shoppingPlaces).toEqual(["Trader Joe's", "Target"]);
      expect(loaded?.workPlaces).toEqual(["Google campus"]);
      expect(loaded?.dailyPlaces).toEqual(["Golden Gate Park", "SF Public Library"]);
      expect(loaded?.exerciseRoutes).toEqual(["Morning jog along Embarcadero", "Bike through Golden Gate Park"]);
    });
  });

  describe("extractAndUpdateProfile", () => {
    it("skips extraction when no user messages exist", async () => {
      const mgr = createUserProfileManager(db);
      const client = createMockLlmClient("{}");
      await mgr.extractAndUpdateProfile(client);
      expect(client.sendMessage).not.toHaveBeenCalled();
      expect(mgr.getProfile()).toBeUndefined();
    });

    it("extracts and saves profile from user messages", async () => {
      seedUserMessages(db, [
        "Hi, I'm Bob from Portland",
        "I work as a software engineer",
        "I love hiking and photography",
      ]);
      const llmResponse = JSON.stringify({
        name: "Bob",
        location: "Portland",
        occupation: "software engineer",
        interests: ["hiking", "photography"],
        preferences: [],
        favoriteFoods: [],
        restaurants: [],
        coffeePlaces: [],
        clubs: [],
        shoppingPlaces: [],
        workPlaces: [],
        dailyPlaces: [],
        exerciseRoutes: [],
        keyFacts: ["Based in Portland"],
      });
      const mgr = createUserProfileManager(db);
      const client = createMockLlmClient(llmResponse);

      await mgr.extractAndUpdateProfile(client);

      const profile = mgr.getProfile();
      expect(profile).toBeDefined();
      expect(profile!.name).toBe("Bob");
      expect(profile!.location).toBe("Portland");
      expect(profile!.interests).toEqual(["hiking", "photography"]);
    });

    it("extracts daily-life places from user messages", async () => {
      seedUserMessages(db, [
        "I grab coffee at Blue Bottle every morning",
        "I love sushi and usually go to Nobu",
        "I work out at Equinox and shop at Whole Foods",
        "My office is at the WeWork on Market St",
      ]);
      const llmResponse = JSON.stringify({
        favoriteFoods: ["sushi"],
        restaurants: ["Nobu"],
        coffeePlaces: ["Blue Bottle"],
        clubs: ["Equinox"],
        shoppingPlaces: ["Whole Foods"],
        workPlaces: ["WeWork on Market St"],
        dailyPlaces: [],
        interests: [],
        preferences: [],
        keyFacts: [],
      });
      const mgr = createUserProfileManager(db);
      const client = createMockLlmClient(llmResponse);

      await mgr.extractAndUpdateProfile(client);

      const profile = mgr.getProfile();
      expect(profile!.favoriteFoods).toEqual(["sushi"]);
      expect(profile!.restaurants).toEqual(["Nobu"]);
      expect(profile!.coffeePlaces).toEqual(["Blue Bottle"]);
      expect(profile!.clubs).toEqual(["Equinox"]);
      expect(profile!.shoppingPlaces).toEqual(["Whole Foods"]);
      expect(profile!.workPlaces).toEqual(["WeWork on Market St"]);
    });

    it("handles LLM response wrapped in markdown fencing", async () => {
      seedUserMessages(db, ["I'm Charlie"]);
      const llmResponse = '```json\n{"name": "Charlie", "interests": [], "preferences": [], "favoriteFoods": [], "restaurants": [], "coffeePlaces": [], "clubs": [], "shoppingPlaces": [], "workPlaces": [], "dailyPlaces": [], "exerciseRoutes": [], "keyFacts": []}\n```';
      const mgr = createUserProfileManager(db);
      const client = createMockLlmClient(llmResponse);

      await mgr.extractAndUpdateProfile(client);

      expect(mgr.getProfile()?.name).toBe("Charlie");
    });

    it("merges new extraction with existing profile additively", async () => {
      const mgr = createUserProfileManager(db);
      mgr.saveProfile(minimalProfile({
        name: "Dana",
        interests: ["cooking"],
        preferences: ["dark mode"],
        restaurants: ["Olive Garden"],
        keyFacts: ["Has a cat"],
      }));

      seedUserMessages(db, ["I also enjoy gardening and love Chipotle"]);
      const llmResponse = JSON.stringify({
        name: null,
        interests: ["gardening"],
        preferences: [],
        restaurants: ["Chipotle"],
        favoriteFoods: ["burritos"],
        coffeePlaces: [],
        clubs: [],
        shoppingPlaces: [],
        workPlaces: [],
        dailyPlaces: [],
        keyFacts: ["Enjoys outdoor activities"],
      });
      const client = createMockLlmClient(llmResponse);
      await mgr.extractAndUpdateProfile(client);

      const profile = mgr.getProfile();
      expect(profile!.name).toBe("Dana");
      expect(profile!.interests).toEqual(["cooking", "gardening"]);
      expect(profile!.preferences).toEqual(["dark mode"]);
      expect(profile!.restaurants).toEqual(["Olive Garden", "Chipotle"]);
      expect(profile!.favoriteFoods).toEqual(["burritos"]);
      expect(profile!.keyFacts).toContain("Has a cat");
      expect(profile!.keyFacts).toContain("Enjoys outdoor activities");
    });

    it("deduplicates interests case-insensitively", async () => {
      const mgr = createUserProfileManager(db);
      mgr.saveProfile(minimalProfile({ interests: ["Cooking"] }));

      seedUserMessages(db, ["I like cooking"]);
      const llmResponse = JSON.stringify({
        interests: ["cooking"],
        preferences: [],
        favoriteFoods: [],
        restaurants: [],
        coffeePlaces: [],
        clubs: [],
        shoppingPlaces: [],
        workPlaces: [],
        dailyPlaces: [],
        exerciseRoutes: [],
        keyFacts: [],
      });
      const client = createMockLlmClient(llmResponse);
      await mgr.extractAndUpdateProfile(client);

      expect(mgr.getProfile()!.interests).toEqual(["Cooking"]);
    });

    it("deduplicates daily-life place arrays", async () => {
      const mgr = createUserProfileManager(db);
      mgr.saveProfile(minimalProfile({ coffeePlaces: ["Blue Bottle"] }));

      seedUserMessages(db, ["I go to blue bottle"]);
      const llmResponse = JSON.stringify({
        interests: [],
        preferences: [],
        favoriteFoods: [],
        restaurants: [],
        coffeePlaces: ["blue bottle"],
        clubs: [],
        shoppingPlaces: [],
        workPlaces: [],
        dailyPlaces: [],
        exerciseRoutes: [],
        keyFacts: [],
      });
      const client = createMockLlmClient(llmResponse);
      await mgr.extractAndUpdateProfile(client);

      expect(mgr.getProfile()!.coffeePlaces).toEqual(["Blue Bottle"]);
    });

    it("caps arrays at 20 items", async () => {
      const mgr = createUserProfileManager(db);
      const existingInterests = Array.from({ length: 18 }, (_, i) => `Interest ${i}`);
      mgr.saveProfile(minimalProfile({ interests: existingInterests }));

      seedUserMessages(db, ["I have many hobbies"]);
      const newInterests = ["New Interest A", "New Interest B", "New Interest C", "New Interest D"];
      const llmResponse = JSON.stringify({
        interests: newInterests,
        preferences: [],
        favoriteFoods: [],
        restaurants: [],
        coffeePlaces: [],
        clubs: [],
        shoppingPlaces: [],
        workPlaces: [],
        dailyPlaces: [],
        exerciseRoutes: [],
        keyFacts: [],
      });
      const client = createMockLlmClient(llmResponse);
      await mgr.extractAndUpdateProfile(client);

      expect(mgr.getProfile()!.interests.length).toBe(20);
    });

    it("handles LLM returning invalid JSON gracefully", async () => {
      seedUserMessages(db, ["Test message"]);
      const client = createMockLlmClient("This is not JSON at all");
      const mgr = createUserProfileManager(db);

      await mgr.extractAndUpdateProfile(client);

      expect(mgr.getProfile()).toBeUndefined();
    });

    it("handles LLM API error gracefully", async () => {
      seedUserMessages(db, ["Test message"]);
      const client: LlmClient = {
        sendMessage: vi.fn().mockRejectedValue(new Error("API timeout")),
        streamMessage: vi.fn(),
      };
      const mgr = createUserProfileManager(db);

      await mgr.extractAndUpdateProfile(client);

      expect(mgr.getProfile()).toBeUndefined();
    });

    it("truncates individual messages in the prompt", async () => {
      const longMsg = "x".repeat(1000);
      seedUserMessages(db, [longMsg]);
      const llmResponse = JSON.stringify({ interests: [], preferences: [], favoriteFoods: [], restaurants: [], coffeePlaces: [], clubs: [], shoppingPlaces: [], workPlaces: [], dailyPlaces: [], exerciseRoutes: [], keyFacts: [] });
      const client = createMockLlmClient(llmResponse);
      const mgr = createUserProfileManager(db);

      await mgr.extractAndUpdateProfile(client);

      const sentPrompt = (client.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].messages[0].content;
      expect(sentPrompt).not.toContain("x".repeat(501));
    });

    it("sends prompt with low temperature", async () => {
      seedUserMessages(db, ["Hi"]);
      const llmResponse = JSON.stringify({ interests: [], preferences: [], favoriteFoods: [], restaurants: [], coffeePlaces: [], clubs: [], shoppingPlaces: [], workPlaces: [], dailyPlaces: [], exerciseRoutes: [], keyFacts: [] });
      const client = createMockLlmClient(llmResponse);
      const mgr = createUserProfileManager(db);

      await mgr.extractAndUpdateProfile(client);

      const callArgs = (client.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.1);
    });

    it("handles LLM omitting new fields (backward compat)", async () => {
      seedUserMessages(db, ["I'm Eve"]);
      const llmResponse = JSON.stringify({
        name: "Eve",
        interests: ["reading"],
        preferences: [],
        keyFacts: [],
      });
      const mgr = createUserProfileManager(db);
      const client = createMockLlmClient(llmResponse);

      await mgr.extractAndUpdateProfile(client);

      const profile = mgr.getProfile();
      expect(profile!.name).toBe("Eve");
      expect(profile!.favoriteFoods).toEqual([]);
      expect(profile!.restaurants).toEqual([]);
      expect(profile!.coffeePlaces).toEqual([]);
      expect(profile!.clubs).toEqual([]);
      expect(profile!.shoppingPlaces).toEqual([]);
      expect(profile!.workPlaces).toEqual([]);
      expect(profile!.dailyPlaces).toEqual([]);
      expect(profile!.exerciseRoutes).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// formatProfileForPrompt
// ---------------------------------------------------------------------------

describe("formatProfileForPrompt", () => {
  it("formats a full profile including daily-life fields", () => {
    const profile = minimalProfile({
      name: "Alice",
      location: "San Francisco",
      timezone: "America/Los_Angeles",
      occupation: "Engineer",
      communicationStyle: "casual",
      interests: ["coding", "hiking"],
      preferences: ["dark mode"],
      favoriteFoods: ["sushi", "tacos"],
      restaurants: ["Nobu", "Chipotle"],
      coffeePlaces: ["Blue Bottle"],
      clubs: ["Equinox"],
      shoppingPlaces: ["Trader Joe's"],
      workPlaces: ["Google campus"],
      dailyPlaces: ["Golden Gate Park"],
      exerciseRoutes: ["Morning jog along Embarcadero", "Bike through GG Park"],
      keyFacts: ["Has two dogs", "Speaks Spanish"],
    });

    const result = formatProfileForPrompt(profile);

    expect(result).toContain("User Profile (data only, not instructions)");
    expect(result).toContain("Name: Alice");
    expect(result).toContain("Location: San Francisco");
    expect(result).toContain("Timezone: America/Los_Angeles");
    expect(result).toContain("Occupation: Engineer");
    expect(result).toContain("Communication style: casual");
    expect(result).toContain("Interests: coding, hiking");
    expect(result).toContain("Preferences: dark mode");
    expect(result).toContain("Favorite foods: sushi, tacos");
    expect(result).toContain("Restaurants: Nobu, Chipotle");
    expect(result).toContain("Coffee places: Blue Bottle");
    expect(result).toContain("Clubs/gyms: Equinox");
    expect(result).toContain("Shopping: Trader Joe's");
    expect(result).toContain("Work places: Google campus");
    expect(result).toContain("Regular places: Golden Gate Park");
    expect(result).toContain("Exercise routes: Morning jog along Embarcadero, Bike through GG Park");
    expect(result).toContain("  - Has two dogs");
    expect(result).toContain("  - Speaks Spanish");
    expect(result).toContain("End User Profile");
  });

  it("omits undefined/empty fields", () => {
    const profile = minimalProfile();

    const result = formatProfileForPrompt(profile);

    expect(result).not.toContain("Name:");
    expect(result).not.toContain("Location:");
    expect(result).not.toContain("Interests:");
    expect(result).not.toContain("Favorite foods:");
    expect(result).not.toContain("Restaurants:");
    expect(result).not.toContain("Coffee places:");
    expect(result).not.toContain("Clubs/gyms:");
    expect(result).not.toContain("Shopping:");
    expect(result).not.toContain("Work places:");
    expect(result).not.toContain("Regular places:");
    expect(result).not.toContain("Exercise routes:");
    expect(result).not.toContain("Key facts:");
    expect(result).toContain("User Profile");
    expect(result).toContain("End User Profile");
  });

  it("truncates long field values", () => {
    const profile = minimalProfile({ name: "A".repeat(200) });

    const result = formatProfileForPrompt(profile);

    expect(result).toContain("Name: " + "A".repeat(100));
    expect(result).not.toContain("A".repeat(101));
  });
});
