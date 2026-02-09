import { execSync } from "node:child_process";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { accessSync, constants } from "node:fs";
import { createLogger } from "../../logging.js";
import { formatError } from "../../infra/errors.js";
import type { EClawConfig } from "../../config/types.js";
import type {
  TwitterGatewayParams,
  TwitterGatewayHandle,
  BirdMention,
} from "./types.js";

const log = createLogger("twitter");

const CHANNEL_ID = "twitter";
const MAX_TEXT_LENGTH = 280;
const POLL_INTERVAL_MS = 30000;
const INITIAL_POLL_DELAY_MS = 2000;
const HISTORY_LIMIT = 50;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 120000;

const TWITTER_URL_PATTERN = /^https:\/\/(twitter\.com|x\.com)\/\w+\/status\/\d+/;

function isExecutable(path: string): boolean {
  try {
    accessSync(resolve(path), constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveBirdBin(config: EClawConfig): string | null {
  const channelCfg = config.channels?.twitter;
  if (channelCfg?.binPath) {
    const resolved = resolve(channelCfg.binPath);
    if (isExecutable(resolved)) return resolved;
    log.warn(`Configured binPath is not executable: ${resolved}`);
    return null;
  }
  if (process.env.BIRD_PATH) {
    const resolved = resolve(process.env.BIRD_PATH);
    if (isExecutable(resolved)) return resolved;
    log.warn(`BIRD_PATH is not executable: ${resolved}`);
    return null;
  }
  try {
    const found = execSync("which bird", { encoding: "utf8", timeout: 5000 }).trim();
    return found || null;
  } catch {
    return null;
  }
}

async function runBirdCommand(
  binPath: string,
  args: readonly string[],
  timeoutMs = 30000,
): Promise<string | null> {
  return new Promise<string | null>((res) => {
    const child = spawn(binPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        res(stdout);
      } else {
        log.warn(`bird ${args[0]} failed (exit ${code}): ${stderr.slice(0, 200)}`);
        res(null);
      }
    });

    child.on("error", (err) => {
      log.warn(`bird ${args[0]} error: ${formatError(err)}`);
      res(null);
    });
  });
}

export function startBirdGateway(
  params: TwitterGatewayParams,
): TwitterGatewayHandle | null {
  const { config, agent, webMonitor, memoryManager } = params;

  const birdBin = resolveBirdBin(config);
  if (!birdBin) {
    log.info("bird binary not found, skipping (install: brew install steipete/tap/bird)");
    return null;
  }
  const validBin: string = birdBin;
  log.info(`Using bird at ${validBin}`);

  // Check if TWITTER_COOKIES is set
  if (!process.env.TWITTER_COOKIES?.trim()) {
    log.info("TWITTER_COOKIES not set, skipping Twitter gateway");
    return null;
  }

  const allowFrom = config.channels?.twitter?.allowFrom;
  const processingMentions = new Set<string>();
  const seenTweetIds = new Set<string>();
  let stopped = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let botHandle = "";

  function broadcastToUi(msg: {
    from: string;
    text: string;
    senderName: string;
    timestamp: number;
    isFromSelf: boolean;
  }): void {
    webMonitor.broadcast(JSON.stringify({
      type: "channel_message",
      channelId: CHANNEL_ID,
      from: msg.from,
      text: msg.text,
      senderName: msg.senderName,
      timestamp: msg.timestamp,
      isFromSelf: msg.isFromSelf,
    }));
  }

  function isAllowed(
    handle: string,
    filterList: string[] | undefined,
  ): boolean {
    if (!filterList || filterList.length === 0) return true;
    const normalized = handle.replace(/^@/, "").toLowerCase();
    return filterList.some((entry) => entry.replace(/^@/, "").toLowerCase() === normalized);
  }

  async function sendReply(tweetUrl: string, text: string): Promise<boolean> {
    if (!TWITTER_URL_PATTERN.test(tweetUrl)) {
      log.warn(`Invalid tweet URL format, refusing to reply: ${tweetUrl.slice(0, 100)}`);
      return false;
    }

    const truncated = text.length > MAX_TEXT_LENGTH
      ? text.slice(0, MAX_TEXT_LENGTH - 3) + "..."
      : text;

    const result = await runBirdCommand(validBin, [
      "reply", tweetUrl, truncated,
    ], 30000);

    return result !== null;
  }

  async function handleMention(
    mention: BirdMention,
  ): Promise<void> {
    const tweetId = mention.id;
    if (processingMentions.has(tweetId)) {
      return;
    }
    processingMentions.add(tweetId);

    try {
      const senderHandle = mention.author.handle;
      const senderName = mention.author.name || senderHandle;
      const text = mention.text;
      const timestamp = new Date(mention.created_at).getTime();
      if (Number.isNaN(timestamp)) {
        log.warn(`Invalid created_at for mention ${tweetId}, skipping`);
        return;
      }

      broadcastToUi({
        from: senderHandle,
        text,
        senderName,
        timestamp,
        isFromSelf: true,
      });

      const historyMessages: Array<{ role: "user" | "assistant"; content: string; timestamp: number }> = [];
      if (memoryManager) {
        try {
          const history = await memoryManager.loadChatHistory({
            channelId: CHANNEL_ID,
            limit: HISTORY_LIMIT,
          });
          for (const msg of history) {
            historyMessages.push({ role: msg.role, content: msg.content, timestamp: msg.timestamp });
          }
        } catch {
          // History loading is non-fatal
        }
      }

      const response = await agent.chat({
        messages: [
          ...historyMessages,
          { role: "user", content: `@${senderHandle}: ${text}`, timestamp },
        ],
        channelId: CHANNEL_ID,
      });

      if (response.text) {
        const sent = await sendReply(mention.url, response.text);
        if (sent) {
          broadcastToUi({
            from: "assistant",
            text: response.text,
            senderName: "EClaw",
            timestamp: Date.now(),
            isFromSelf: false,
          });
        } else {
          log.warn(`Failed to reply to tweet ${mention.url}`);
        }
      }

      if (memoryManager && response.text) {
        memoryManager.saveExchange({
          channelId: CHANNEL_ID,
          userMessage: `@${senderHandle}: ${text}`,
          assistantMessage: response.text,
          timestamp,
        }).catch((err) => {
          log.warn(`Failed to persist exchange: ${formatError(err)}`);
        });
      }
    } catch (err) {
      log.error(`Mention handling failed: ${formatError(err)}`);
    } finally {
      processingMentions.delete(tweetId);
    }
  }

  async function pollMentions(): Promise<void> {
    if (stopped) return;

    try {
      const output = await runBirdCommand(validBin, [
        "mentions", "--json", "-n", "10",
      ]);

      if (!output) return;

      let mentions: ReadonlyArray<BirdMention>;
      try {
        const parsed = JSON.parse(output);
        // bird may wrap in { tweets: [...] } or return array directly
        mentions = Array.isArray(parsed) ? parsed : (parsed.tweets ?? parsed.data ?? []);
      } catch {
        log.warn("Failed to parse bird mentions output");
        return;
      }

      for (const mention of mentions) {
        if (!mention.id || !mention.text) continue;
        if (seenTweetIds.has(mention.id)) continue;

        seenTweetIds.add(mention.id);

        // Skip own tweets
        if (mention.author?.handle?.toLowerCase() === botHandle.toLowerCase()) continue;

        if (!isAllowed(mention.author?.handle ?? "", allowFrom)) {
          log.info(`Mention from @${mention.author?.handle} blocked by allowFrom filter`);
          continue;
        }

        log.info(`New mention from @${mention.author?.handle}: ${mention.text.slice(0, 50)}`);

        handleMention(mention).catch((err: unknown) => {
          log.error(`handleMention error: ${formatError(err)}`);
        });
      }

      // Cap seen IDs
      if (seenTweetIds.size > 500) {
        const toRemove = [...seenTweetIds].slice(0, 250);
        for (const id of toRemove) {
          seenTweetIds.delete(id);
        }
      }

      reconnectAttempts = 0;
    } catch (err) {
      log.warn(`Poll error: ${formatError(err)}`);
      reconnectAttempts += 1;

      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        log.error(`Exceeded ${MAX_RECONNECT_ATTEMPTS} poll failures, stopping`);
        stopped = true;
        return;
      }

      const delay = Math.min(
        BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts - 1),
        MAX_RECONNECT_DELAY_MS,
      );
      log.info(`Retrying poll in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  async function startPolling(): Promise<void> {
    // Verify auth
    const whoamiOutput = await runBirdCommand(validBin, ["whoami", "--json"]);
    if (!whoamiOutput) {
      log.error("Failed to verify Twitter auth (bird whoami failed), gateway not started");
      return;
    }

    try {
      const whoami = JSON.parse(whoamiOutput);
      botHandle = whoami.handle || whoami.screen_name || whoami.username || "";
      const displayName = whoami.name || botHandle;
      log.info(`Bot verified: @${botHandle} (${displayName})`);
    } catch {
      log.error("Failed to parse bird whoami output, gateway not started");
      return;
    }

    // Seed seen IDs from initial mentions to skip old ones
    const initialOutput = await runBirdCommand(validBin, ["mentions", "--json", "-n", "10"]);
    if (initialOutput) {
      try {
        const parsed = JSON.parse(initialOutput);
        const initial: ReadonlyArray<BirdMention> = Array.isArray(parsed) ? parsed : (parsed.tweets ?? parsed.data ?? []);
        for (const m of initial) {
          if (m.id) seenTweetIds.add(m.id);
        }
      } catch {
        // Non-fatal
      }
    }

    log.info(`Polling started (${POLL_INTERVAL_MS / 1000}s interval)`);

    const tick = async () => {
      await pollMentions();
      if (!stopped) {
        pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
        pollTimer.unref();
      }
    };

    pollTimer = setTimeout(tick, INITIAL_POLL_DELAY_MS);
    pollTimer.unref();
  }

  startPolling().catch((err) => {
    log.error(`Twitter gateway startup failed: ${formatError(err)}`);
  });

  log.info("Twitter gateway starting...");

  return {
    stop: () => {
      stopped = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      log.info("Twitter gateway stopped");
    },
  };
}
