import type { MicroClawConfig } from "../config/types.js";
import type { AuthCredentials } from "../infra/auth.js";
import type { MemorySearchManager } from "./types.js";
import { createMemoryManager } from "./manager.js";

let instance: MemorySearchManager | null = null;

export function getMemorySearchManager(params: {
  config: MicroClawConfig;
  dataDir: string;
  auth: AuthCredentials;
}): MemorySearchManager {
  if (!instance) {
    instance = createMemoryManager(params);
  }
  return instance;
}

export function closeMemorySearchManager(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
