import { mkdirSync, existsSync, realpathSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { MicroClawConfig } from "../config/types.js";
import type { AuthCredentials } from "../infra/auth.js";
import type { MemorySearchManager, MemorySearchParams, MemorySearchResult, MemoryProviderStatus, MemoryRecordCounts, UserProfile, ProgrammingSkills, PlanningPreferences, ProgrammingPlanning, EventPlanning } from "./types.js";
import { createUserProfileManager } from "./user-profile.js";
import { createProgrammingSkillsManager } from "./programming-skills.js";
import { createPlanningPreferencesManager } from "./planning-preferences.js";
import { createGccStore, type GccStore } from "./gcc-store.js";
import { createGccProgrammingSkillsManager } from "./gcc-programming-skills.js";
import { createGccProgrammingPlanningManager } from "./gcc-programming-planning.js";
import { createGccEventPlanningManager } from "./gcc-event-planning.js";
import { createLogger } from "../logging.js";
import { openDatabase, closeDatabase } from "./sqlite.js";
import { MEMORY_SCHEMA, FTS_SYNC_TRIGGERS, CHAT_SCHEMA, GCC_SCHEMA } from "./memory-schema.js";
import { resolveMemoryBackendConfig } from "./backend-config.js";
import { createAnthropicEmbeddingProvider, providerKey, type EmbeddingProvider } from "./embeddings.js";
import { createChatPersistence } from "./chat-persistence.js";
import { vectorSearch, keywordSearch } from "./manager-search.js";
import { mergeSearchResults } from "./hybrid.js";
import { syncMemoryFiles } from "./sync-memory-files.js";

const memLog = createLogger("memory-manager");

export function createMemoryManager(params: {
  config: MicroClawConfig;
  dataDir: string;
  auth: AuthCredentials;
}): MemorySearchManager {
  const backendConfig = resolveMemoryBackendConfig(params.config, params.dataDir);

  if (!existsSync(backendConfig.dataDir)) {
    mkdirSync(backendConfig.dataDir, { recursive: true });
  }

  const db = openDatabase(backendConfig.dbPath);
  db.exec(MEMORY_SCHEMA);
  db.exec(FTS_SYNC_TRIGGERS);
  db.exec(CHAT_SCHEMA);
  db.exec(GCC_SCHEMA);

  // Embeddings require a Voyage API key (separate from Anthropic key)
  let embeddingProvider: EmbeddingProvider | undefined;
  let pKey: string | undefined;

  const voyageApiKey = process.env.VOYAGE_API_KEY;
  if (voyageApiKey) {
    embeddingProvider = createAnthropicEmbeddingProvider(voyageApiKey);
    pKey = providerKey(embeddingProvider);
  }

  const chatPersistence = createChatPersistence({ db, embeddingProvider });
  const profileManager = createUserProfileManager(db);
  const skillsManager = createProgrammingSkillsManager(db);
  const planningManager = createPlanningPreferencesManager(db);

  // GCC-backed memory managers
  const gccStore = createGccStore(db);
  const gccSkillsManager = createGccProgrammingSkillsManager(db, gccStore);
  const gccPlanningManager = createGccProgrammingPlanningManager(db, gccStore);
  const gccEventPlanningManager = createGccEventPlanningManager(db, gccStore);

  // Migrate legacy data to GCC on first run
  try {
    const legacySkills = skillsManager.getSkills();
    if (legacySkills && !gccStore.getHeadSnapshot("programming_skills")) {
      gccStore.migrateFromLegacy("programming_skills", legacySkills as unknown as Record<string, unknown>);
      memLog.info("Migrated legacy programming_skills to GCC");
    }
  } catch (err) {
    memLog.warn(`Legacy skills migration skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const legacyPlanning = planningManager.getPreferences();
    if (legacyPlanning && !gccStore.getHeadSnapshot("programming_planning")) {
      // Map old PlanningPreferences fields to new ProgrammingPlanning
      const migratedPlanning: Record<string, unknown> = {
        confirmedPlans: legacyPlanning.approvedPlanPatterns ?? [],
        modifiedPatterns: [],
        discardedReasons: [],
        planStructure: legacyPlanning.structurePreferences ?? [],
        scopePreferences: legacyPlanning.scopePreferences ?? [],
        detailLevel: legacyPlanning.detailLevelPreferences ?? [],
        reviewPatterns: [],
        implementationFlow: [],
        planningInsights: legacyPlanning.planningInsights ?? [],
        lastUpdated: legacyPlanning.lastUpdated,
      };
      gccStore.migrateFromLegacy("programming_planning", migratedPlanning);
      memLog.info("Migrated legacy planning_preferences to GCC programming_planning");
    }
  } catch (err) {
    memLog.warn(`Legacy planning migration skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
  const countAllStmt = db.prepare(
    "SELECT (SELECT COUNT(*) FROM memory_files) AS files, (SELECT COUNT(*) FROM memory_chunks) AS chunks, (SELECT COUNT(*) FROM chat_messages) AS chatMessages",
  );
  let closed = false;

  // Operation counter to prevent close() from destroying db while ops are in-flight
  let activeOps = 0;
  let activeOpsResolve: (() => void) | null = null;

  function trackAsyncOp<T>(fn: () => Promise<T>): Promise<T> {
    if (closed) { throw new Error("Memory manager is closed"); }
    activeOps++;
    return fn().finally(() => {
      activeOps--;
      if (activeOps === 0 && activeOpsResolve) {
        const resolve = activeOpsResolve;
        activeOpsResolve = null;
        resolve();
      }
    });
  }

  return {
    search: async (searchParams: MemorySearchParams): Promise<MemorySearchResult[]> => {
      return trackAsyncOp(async () => {
      if (!searchParams.query || searchParams.query.trim() === "") {
        return [];
      }

      const vectorWeight = searchParams.vectorWeight ?? backendConfig.vectorWeight;
      const keywordWeight = searchParams.keywordWeight ?? backendConfig.keywordWeight;
      const limit = searchParams.limit ?? backendConfig.maxResults;

      // Run keyword search
      const keywordResults = keywordSearch(db, searchParams.query, {
        limit: limit * 2,
        source: searchParams.source,
      });

      // Generate query embedding and run vector search (only if API key available)
      let vectorResults: import("./hybrid.js").VectorSearchResult[] = [];
      if (embeddingProvider && pKey) {
        try {
          const embedResults = await embeddingProvider.embed([searchParams.query]);
          if (embedResults.length > 0) {
            vectorResults = vectorSearch(db, embedResults[0]!.embedding, pKey, {
              limit: limit * 2,
              source: searchParams.source,
            });
          }
        } catch (err) {
          memLog.warn(`Vector search embedding failed, falling back to keyword-only: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return mergeSearchResults({
        vectorResults,
        keywordResults,
        vectorWeight: embeddingProvider ? vectorWeight : 0,
        keywordWeight: embeddingProvider ? keywordWeight : 1,
        limit,
      });
      });
    },

    getRecordCounts: async (): Promise<MemoryRecordCounts> => {
      if (closed) {
        return { files: 0, chunks: 0, chatMessages: 0 };
      }
      const row = countAllStmt.get() as { files: number; chunks: number; chatMessages: number };
      return { files: row.files, chunks: row.chunks, chatMessages: row.chatMessages };
    },

    getStatus: async (): Promise<MemoryProviderStatus> => ({
      provider: embeddingProvider ? "anthropic" : "keyword-only",
      model: embeddingProvider?.model ?? "none",
      dimensions: embeddingProvider?.dimensions ?? 0,
      ready: !closed,
    }),

    syncFiles: async (dir: string) => {
      return trackAsyncOp(async () => {
      // Validate path to prevent directory traversal (handles case-insensitive filesystems)
      let resolved: string;
      let dataRoot: string;
      try {
        resolved = realpathSync(resolvePath(dir));
        dataRoot = realpathSync(resolvePath(backendConfig.dataDir));
      } catch {
        // Fall back to resolve if paths don't exist yet
        resolved = resolvePath(dir);
        dataRoot = resolvePath(backendConfig.dataDir);
      }
      if (resolved !== dataRoot && !resolved.startsWith(dataRoot + "/")) {
        throw new Error("syncFiles directory must be within the configured data directory");
      }
      return syncMemoryFiles(db, resolved);
      });
    },

    saveExchange: async (params) => {
      return trackAsyncOp(async () => chatPersistence.saveExchange(params));
    },

    loadChatHistory: async (params) => {
      return trackAsyncOp(async () => chatPersistence.loadHistory(params));
    },

    getUserProfile: (): UserProfile | undefined => {
      if (closed) return undefined;
      return profileManager.getProfile();
    },

    saveUserProfile: (profile: UserProfile): void => {
      if (closed) return;
      profileManager.saveProfile(profile);
    },

    updateUserProfile: async (llmClient) => {
      return trackAsyncOp(async () => profileManager.extractAndUpdateProfile(llmClient));
    },

    getProgrammingSkills: (): ProgrammingSkills | undefined => {
      if (closed) return undefined;
      return skillsManager.getSkills();
    },

    saveProgrammingSkills: (skills: ProgrammingSkills): void => {
      if (closed) return;
      skillsManager.saveSkills(skills);
    },

    updateProgrammingSkills: async (llmClient) => {
      return trackAsyncOp(async () => skillsManager.extractAndUpdateSkills(llmClient));
    },

    getPlanningPreferences: (): PlanningPreferences | undefined => {
      if (closed) return undefined;
      return planningManager.getPreferences();
    },

    savePlanningPreferences: (prefs: PlanningPreferences): void => {
      if (closed) return;
      planningManager.savePreferences(prefs);
    },

    updatePlanningPreferences: async (llmClient) => {
      return trackAsyncOp(async () => planningManager.extractAndUpdatePreferences(llmClient));
    },

    getProgrammingPlanning: (): ProgrammingPlanning | undefined => {
      if (closed) return undefined;
      return gccPlanningManager.getPlanning();
    },

    saveProgrammingPlanning: (planning: ProgrammingPlanning): void => {
      if (closed) return;
      gccPlanningManager.savePlanning(planning);
    },

    updateProgrammingPlanning: async (llmClient) => {
      return trackAsyncOp(async () => gccPlanningManager.extractAndUpdatePlanning(llmClient));
    },

    getEventPlanning: (): EventPlanning | undefined => {
      if (closed) return undefined;
      return gccEventPlanningManager.getEventPlanning();
    },

    saveEventPlanning: (planning: EventPlanning): void => {
      if (closed) return;
      gccEventPlanningManager.saveEventPlanning(planning);
    },

    updateEventPlanning: async (llmClient) => {
      return trackAsyncOp(async () => gccEventPlanningManager.extractAndUpdateEventPlanning(llmClient));
    },

    gccStore,

    close: async () => {
      if (closed) return;
      closed = true;
      if (activeOps > 0) {
        await new Promise<void>(resolve => { activeOpsResolve = resolve; });
      }
      await chatPersistence.close();
      closeDatabase(db);
    },
  };
}
