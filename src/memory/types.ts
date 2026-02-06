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

export type MemoryProviderStatus = {
  provider: string;
  model: string;
  dimensions: number;
  ready: boolean;
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

export type MemorySearchManager = {
  search: (params: MemorySearchParams) => Promise<MemorySearchResult[]>;
  getStatus: () => Promise<MemoryProviderStatus>;
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
  close: () => void;
};
