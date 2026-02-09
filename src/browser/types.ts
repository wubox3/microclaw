export type BrowserProfileConfig = {
  cdpPort?: number;
  cdpUrl?: string;
  color?: string;
  driver?: "eclaw" | "extension";
};

export type BrowserConfig = {
  enabled?: boolean;
  evaluateEnabled?: boolean;
  controlPort?: number;
  cdpUrl?: string;
  headless?: boolean;
  noSandbox?: boolean;
  attachOnly?: boolean;
  executablePath?: string;
  color?: string;
  defaultProfile?: string;
  remoteCdpTimeoutMs?: number;
  remoteCdpHandshakeTimeoutMs?: number;
  profiles?: Record<string, BrowserProfileConfig>;
};

export type EClawConfig = {
  browser?: BrowserConfig;
  [key: string]: unknown;
};

// Alias for compatibility with openclaw config references
export type OpenClawConfig = EClawConfig;
