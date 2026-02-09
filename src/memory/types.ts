export type MemoryChunk = {
  id: number;
  fileId: number;
  content: string;
  startLine: number;
  endLine: number;
  hash: string;
};

export type MemoryFile = {
  id: number;
  path: string;
  source: string;
  hash: string;
  updatedAt: number;
};

export type MemorySearchResult = {
  chunkId: number;
  fileId: number;
  filePath: string;
  source: string;
  content: string;
  snippet: string;
  startLine: number;
  endLine: number;
  vectorScore: number;
  textScore: number;
  combinedScore: number;
};

export type MemorySearchParams = {
  query: string;
  limit?: number;
  source?: string;
  vectorWeight?: number;
  keywordWeight?: number;
};

export type MemoryRecordCounts = {
  files: number;
  chunks: number;
  chatMessages: number;
};

export type MemoryProviderStatus = {
  provider: string;
  model: string;
  dimensions: number;
  ready: boolean;
  counts?: MemoryRecordCounts;
};

export type EmbeddingResult = {
  embedding: number[];
  model: string;
  dimensions: number;
};

export type ChatMessageRecord = {
  id: number;
  channelId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  memoryFileId: number | null;
  createdAt: number;
};

export type UserProfile = {
  name?: string;
  location?: string;
  timezone?: string;
  occupation?: string;
  interests: string[];
  preferences: string[];
  communicationStyle?: string;
  favoriteFoods: string[];
  restaurants: string[];
  coffeePlaces: string[];
  clubs: string[];
  shoppingPlaces: string[];
  workPlaces: string[];
  dailyPlaces: string[];
  exerciseRoutes: string[];
  keyFacts: string[];
  lastUpdated: string;
};

export type PlanningPreferences = {
  structurePreferences: string[];
  detailLevelPreferences: string[];
  valuedPlanElements: string[];
  architectureApproaches: string[];
  scopePreferences: string[];
  presentationFormat: string[];
  approvedPlanPatterns: string[];
  planningInsights: string[];
  lastUpdated: string;
};

export type ProgrammingPlanning = {
  confirmedPlans: string[];
  modifiedPatterns: string[];
  discardedReasons: string[];
  planStructure: string[];
  scopePreferences: string[];
  detailLevel: string[];
  reviewPatterns: string[];
  implementationFlow: string[];
  planningInsights: string[];
  lastUpdated: string;
};

export type EventPlanning = {
  preferredTimes: string[];
  preferredDays: string[];
  recurringSchedules: string[];
  venuePreferences: string[];
  calendarHabits: string[];
  planningStyle: string[];
  eventTypes: string[];
  schedulingInsights: string[];
  lastUpdated: string;
};

export type ProgrammingSkills = {
  languages: string[];
  frameworks: string[];
  architecturePatterns: string[];
  codingStylePreferences: string[];
  testingApproach: string[];
  toolsAndLibraries: string[];
  approvedPatterns: string[];
  buildAndDeployment: string[];
  editorAndEnvironment: string[];
  keyInsights: string[];
  lastUpdated: string;
};

export type MemorySearchManager = {
  search: (params: MemorySearchParams) => Promise<MemorySearchResult[]>;
  getStatus: () => Promise<MemoryProviderStatus>;
  getRecordCounts: () => Promise<MemoryRecordCounts>;
  syncFiles: (dir: string) => Promise<{ added: number; updated: number; removed: number }>;
  saveExchange: (params: {
    channelId: string;
    userMessage: string;
    assistantMessage: string;
    timestamp: number;
  }) => Promise<void>;
  loadChatHistory: (params: {
    channelId?: string;
    limit?: number;
    before?: number;
  }) => Promise<ChatMessageRecord[]>;
  getUserProfile: () => UserProfile | undefined;
  saveUserProfile: (profile: UserProfile) => void;
  updateUserProfile: (llmClient: import("../agent/llm-client.js").LlmClient) => Promise<void>;
  getProgrammingSkills: () => ProgrammingSkills | undefined;
  saveProgrammingSkills: (skills: ProgrammingSkills) => void;
  updateProgrammingSkills: (llmClient: import("../agent/llm-client.js").LlmClient) => Promise<void>;
  getPlanningPreferences: () => PlanningPreferences | undefined;
  savePlanningPreferences: (prefs: PlanningPreferences) => void;
  updatePlanningPreferences: (llmClient: import("../agent/llm-client.js").LlmClient) => Promise<void>;
  getProgrammingPlanning: () => ProgrammingPlanning | undefined;
  saveProgrammingPlanning: (planning: ProgrammingPlanning) => void;
  updateProgrammingPlanning: (llmClient: import("../agent/llm-client.js").LlmClient) => Promise<void>;
  getEventPlanning: () => EventPlanning | undefined;
  saveEventPlanning: (planning: EventPlanning) => void;
  updateEventPlanning: (llmClient: import("../agent/llm-client.js").LlmClient) => Promise<void>;
  gccStore?: import("./gcc-store.js").GccStore;
  close: () => void | Promise<void>;
};
