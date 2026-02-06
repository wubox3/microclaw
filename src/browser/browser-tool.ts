import type { AgentTool, AgentToolResult } from "../agent/types.js";
import { fetchBrowserJson } from "./client-fetch.js";

type BrowserAction =
  | "status"
  | "start"
  | "stop"
  | "profiles"
  | "tabs"
  | "open"
  | "focus"
  | "close"
  | "snapshot"
  | "screenshot"
  | "navigate"
  | "console"
  | "pdf"
  | "upload"
  | "dialog"
  | "act";

function formatResult(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  return JSON.stringify(data, null, 2);
}

async function executeBrowserAction(
  action: BrowserAction,
  params: Record<string, unknown>,
): Promise<AgentToolResult> {
  const profile = params.profile as string | undefined;
  const profileQuery = profile ? `?profile=${encodeURIComponent(profile)}` : "";

  try {
    switch (action) {
      case "status": {
        const result = await fetchBrowserJson(`/agent/status${profileQuery}`);
        return { content: formatResult(result) };
      }

      case "start": {
        const result = await fetchBrowserJson(`/agent/start${profileQuery}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            headless: params.headless,
            url: params.url,
          }),
        });
        return { content: formatResult(result) };
      }

      case "stop": {
        const result = await fetchBrowserJson(`/agent/stop${profileQuery}`, {
          method: "POST",
        });
        return { content: formatResult(result) };
      }

      case "profiles": {
        const result = await fetchBrowserJson("/profiles");
        return { content: formatResult(result) };
      }

      case "tabs": {
        const result = await fetchBrowserJson(`/tabs${profileQuery}`);
        return { content: formatResult(result) };
      }

      case "open": {
        const result = await fetchBrowserJson(`/tabs/open${profileQuery}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: params.url }),
        });
        return { content: formatResult(result) };
      }

      case "focus": {
        const targetId = params.targetId as string;
        const result = await fetchBrowserJson(`/tabs/focus${profileQuery}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetId }),
        });
        return { content: formatResult(result) };
      }

      case "close": {
        const targetId = params.targetId as string;
        const result = await fetchBrowserJson(`/tabs/close${profileQuery}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetId }),
        });
        return { content: formatResult(result) };
      }

      case "snapshot": {
        const qs = new URLSearchParams();
        if (profile) qs.set("profile", profile);
        if (params.targetId) qs.set("targetId", String(params.targetId));
        if (params.maxChars) qs.set("maxChars", String(params.maxChars));
        const qStr = qs.toString() ? `?${qs.toString()}` : "";
        const result = await fetchBrowserJson<{ snapshot?: string }>(`/agent/snapshot${qStr}`, {
          timeoutMs: 15000,
        });
        return { content: result.snapshot ?? formatResult(result) };
      }

      case "screenshot": {
        const qs = new URLSearchParams();
        if (profile) qs.set("profile", profile);
        if (params.targetId) qs.set("targetId", String(params.targetId));
        const qStr = qs.toString() ? `?${qs.toString()}` : "";
        const result = await fetchBrowserJson(`/agent/screenshot${qStr}`, {
          timeoutMs: 15000,
        });
        return { content: formatResult(result) };
      }

      case "navigate": {
        const result = await fetchBrowserJson(`/agent/navigate${profileQuery}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: params.url,
            targetId: params.targetId,
          }),
          timeoutMs: 30000,
        });
        return { content: formatResult(result) };
      }

      case "console": {
        const qs = new URLSearchParams();
        if (profile) qs.set("profile", profile);
        if (params.targetId) qs.set("targetId", String(params.targetId));
        const qStr = qs.toString() ? `?${qs.toString()}` : "";
        const result = await fetchBrowserJson(`/agent/console${qStr}`);
        return { content: formatResult(result) };
      }

      case "pdf": {
        const result = await fetchBrowserJson(`/agent/pdf${profileQuery}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetId: params.targetId }),
          timeoutMs: 30000,
        });
        return { content: formatResult(result) };
      }

      case "upload": {
        const result = await fetchBrowserJson(`/agent/upload${profileQuery}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paths: params.paths,
            targetId: params.targetId,
          }),
        });
        return { content: formatResult(result) };
      }

      case "dialog": {
        const result = await fetchBrowserJson(`/agent/dialog${profileQuery}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accept: params.accept,
            promptText: params.promptText,
            targetId: params.targetId,
          }),
        });
        return { content: formatResult(result) };
      }

      case "act": {
        const result = await fetchBrowserJson(`/agent/act${profileQuery}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            commands: params.commands,
            targetId: params.targetId,
          }),
          timeoutMs: 30000,
        });
        return { content: formatResult(result) };
      }

      default:
        return { content: `Unknown browser action: ${action}`, isError: true };
    }
  } catch (err) {
    return {
      content: `Browser action "${action}" failed: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}

export function createBrowserTool(): AgentTool {
  return {
    name: "browser",
    description: `Control a Chrome browser to navigate websites, interact with page elements, take screenshots, and read page content. Actions:
- status: Get browser status
- start: Launch browser (optional: url, headless)
- stop: Close browser
- profiles: List browser profiles
- tabs: List open tabs
- open: Open new tab (url)
- focus: Focus a tab (targetId)
- close: Close a tab (targetId)
- snapshot: Get accessibility snapshot of page content (targetId, maxChars)
- screenshot: Capture screenshot (targetId)
- navigate: Navigate to URL (url, targetId)
- console: Get console logs (targetId)
- pdf: Generate PDF of page (targetId)
- upload: Upload files to file input (paths[], targetId)
- dialog: Handle dialog (accept, promptText, targetId)
- act: Execute interaction commands on page elements (commands[])

For act commands, each command is an object with "kind" plus parameters:
- click: {kind:"click", ref:"E123"} - Click element by ref
- type: {kind:"type", ref:"E123", text:"hello"} - Type text into element
- press: {kind:"press", key:"Enter"} - Press keyboard key
- hover: {kind:"hover", ref:"E123"} - Hover over element
- scroll: {kind:"scrollIntoView", ref:"E123"} - Scroll element into view
- select: {kind:"select", ref:"E123", value:"option1"} - Select dropdown option
- drag: {kind:"drag", startRef:"E1", endRef:"E2"} - Drag between elements`,

    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "status", "start", "stop", "profiles", "tabs",
            "open", "focus", "close", "snapshot", "screenshot",
            "navigate", "console", "pdf", "upload", "dialog", "act",
          ],
          description: "The browser action to perform",
        },
        url: {
          type: "string",
          description: "URL for navigate, open, or start actions",
        },
        targetId: {
          type: "string",
          description: "Target tab ID for tab-specific actions",
        },
        profile: {
          type: "string",
          description: "Browser profile name (optional, defaults to default profile)",
        },
        headless: {
          type: "boolean",
          description: "Run browser in headless mode (for start action)",
        },
        maxChars: {
          type: "number",
          description: "Max characters for snapshot (default 80000)",
        },
        commands: {
          type: "array",
          description: "Array of interaction commands for act action",
          items: { type: "object" },
        },
        paths: {
          type: "array",
          description: "File paths for upload action",
          items: { type: "string" },
        },
        accept: {
          type: "boolean",
          description: "Accept or dismiss dialog",
        },
        promptText: {
          type: "string",
          description: "Text to enter in prompt dialog",
        },
      },
      required: ["action"],
    },

    execute: async (params: Record<string, unknown>): Promise<AgentToolResult> => {
      const action = params.action as BrowserAction;
      if (!action) {
        return { content: "Missing required parameter: action", isError: true };
      }
      return executeBrowserAction(action, params);
    },
  };
}
