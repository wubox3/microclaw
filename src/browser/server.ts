import type { Server } from "node:http";
import express from "express";
import type { BrowserRouteRegistrar } from "./routes/types.js";
import type { BrowserConfig } from "./types.js";
import { createSubsystemLogger } from "./compat/logging.js";
import { resolveBrowserConfig, resolveProfile } from "./config.js";
import { ensureChromeExtensionRelayServer } from "./extension-relay.js";
import { registerBrowserRoutes } from "./routes/index.js";
import { type BrowserServerState, createBrowserRouteContext } from "./server-context.js";
import { setBrowserControlBaseUrl } from "./client-fetch.js";

let state: BrowserServerState | null = null;
let startingPromise: Promise<BrowserServerState | null> | null = null;
let generation = 0;
const log = createSubsystemLogger("browser");
const logServer = log.child("server");

export type StartBrowserServerOptions = {
  browserConfig?: BrowserConfig;
};

export async function startBrowserServer(
  options?: StartBrowserServerOptions,
): Promise<BrowserServerState | null> {
  const myGeneration = ++generation;
  if (state) {
    return state;
  }
  if (startingPromise) {
    return await startingPromise;
  }

  const doStart = async (): Promise<BrowserServerState | null> => {
  if (state) {
    return state;
  }

  const resolved = resolveBrowserConfig(options?.browserConfig);
  if (!resolved.enabled) {
    return null;
  }

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const ctx = createBrowserRouteContext({
    getState: () => state,
  });
  registerBrowserRoutes(app as unknown as BrowserRouteRegistrar, ctx);

  const port = resolved.controlPort;
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(port, "127.0.0.1", () => resolve(s));
    s.once("error", reject);
  }).catch((err) => {
    logServer.error(`EClaw browser server failed to bind 127.0.0.1:${port}: ${String(err)}`);
    return null;
  });

  if (!server) {
    return null;
  }

  if (myGeneration !== generation) {
    // A stop was called during our startup, abort and clean up
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    return state; // will be null
  }

  state = {
    server,
    port,
    resolved,
    profiles: new Map(),
  };

  setBrowserControlBaseUrl(`http://127.0.0.1:${port}`);

  // If any profile uses the Chrome extension relay, start the local relay server
  for (const name of Object.keys(resolved.profiles)) {
    const profile = resolveProfile(resolved, name);
    if (!profile || profile.driver !== "extension") {
      continue;
    }
    await ensureChromeExtensionRelayServer({ cdpUrl: profile.cdpUrl }).catch((err) => {
      logServer.warn(`Chrome extension relay init failed for profile "${name}": ${String(err)}`);
    });
  }

  logServer.info(`Browser control listening on http://127.0.0.1:${port}/`);
  return state;
  };

  startingPromise = doStart().then(
    (result) => {
      // Only clear the guard on failure so successful starts are cached
      if (!result) startingPromise = null;
      return result;
    },
    (err) => {
      startingPromise = null;
      throw err;
    },
  );
  return await startingPromise;
}

export async function stopBrowserServer(): Promise<void> {
  generation++;
  const current = state;
  if (!current) {
    return;
  }

  const ctx = createBrowserRouteContext({
    getState: () => state,
  });

  try {
    for (const name of Object.keys(current.resolved.profiles)) {
      try {
        await ctx.forProfile(name).stopRunningBrowser();
      } catch {
        // ignore
      }
    }
  } catch (err) {
    logServer.warn(`EClaw browser stop failed: ${String(err)}`);
  }

  if (current.server) {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 5000);
      current.server?.close(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  try {
    const mod = await import("./pw-ai.js");
    await mod.closePlaywrightBrowserConnection();
  } catch {
    // ignore
  }

  // Nullify state and startingPromise AFTER Playwright cleanup is complete
  // so a subsequent startBrowserServer doesn't return a stale cached promise
  state = null;
  startingPromise = null;
}
