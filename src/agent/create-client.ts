import type { EClawConfig } from "../config/types.js";
import type { AuthCredentials } from "../infra/auth.js";
import type { LlmClient } from "./llm-client.js";
import { createAnthropicClient } from "./client.js";
import { createOpenRouterClient } from "./openrouter-client.js";
import { requireEnv } from "../infra/env.js";

export type CreateLlmClientParams = {
  config: EClawConfig;
  auth: AuthCredentials;
};

export function createLlmClient(params: CreateLlmClientParams): LlmClient {
  const provider = params.config.agent?.provider ?? "anthropic";

  if (provider === "openrouter") {
    const apiKey = requireEnv("OPENROUTER_API_KEY");
    return createOpenRouterClient({
      apiKey,
      model: params.config.agent?.model,
      maxTokens: params.config.agent?.maxTokens,
    });
  }

  if (provider === "anthropic") {
    return createAnthropicClient({
      auth: params.auth,
      model: params.config.agent?.model,
      maxTokens: params.config.agent?.maxTokens,
    });
  }

  throw new Error(
    `Unsupported LLM provider: "${provider}". Supported: "anthropic", "openrouter".`,
  );
}
