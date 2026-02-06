import type { AgentTool, AgentToolResult } from "./types.js";
import type { WebMonitor } from "../channels/web/monitor.js";
import type { CanvasStateRef, A2uiMessage, A2uiComponent } from "../canvas-host/types.js";

const VALID_A2UI_KINDS = new Set(["beginRendering", "surfaceUpdate", "dataModelUpdate", "deleteSurface"]);

export type CanvasToolDeps = {
  readonly webMonitor: WebMonitor;
  readonly canvasState: CanvasStateRef;
};

function validateA2uiMessages(messages: unknown[]): A2uiMessage[] {
  const valid: A2uiMessage[] = [];
  for (const msg of messages) {
    if (typeof msg !== "object" || msg === null) continue;
    const m = msg as Record<string, unknown>;
    if (typeof m.kind !== "string" || !VALID_A2UI_KINDS.has(m.kind)) continue;
    if (typeof m.surfaceId !== "string") continue;
    if (m.kind === "surfaceUpdate" && (typeof m.root !== "object" || m.root === null)) continue;
    if (m.kind === "dataModelUpdate" && (typeof m.data !== "object" || m.data === null)) continue;
    valid.push(m as A2uiMessage);
  }
  return valid;
}

export function createCanvasTool(deps: CanvasToolDeps): AgentTool {
  const { webMonitor, canvasState } = deps;

  function broadcast(message: Record<string, unknown>): void {
    webMonitor.broadcast(JSON.stringify(message));
  }

  return {
    name: "canvas",
    description: `Control the visual canvas panel in the web UI. Use this to display interactive content to the user.

Actions:
- "present": Show the canvas panel (must be called before other actions)
- "hide": Hide the canvas panel
- "update": Display raw HTML in the canvas (provide "html" param)
- "eval": Execute JavaScript in the canvas context (provide "code" param)
- "a2ui_push": Render structured A2UI components (provide "messages" array)
- "a2ui_reset": Clear all A2UI content

For A2UI, each message in the "messages" array should have a "kind" and "surfaceId". Use "beginRendering" to start, then "surfaceUpdate" with a "root" component tree.

Component types: text, button, card, image, list, tabs, text-field, checkbox, slider, divider, row, column, modal.

Example a2ui_push message:
[{"kind":"beginRendering","surfaceId":"main"},{"kind":"surfaceUpdate","surfaceId":"main","root":{"type":"card","children":[{"type":"text","props":{"text":"Hello!","variant":"h2"}},{"type":"button","id":"greet","props":{"label":"Click me"}}]}}]`,
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["present", "hide", "update", "eval", "a2ui_push", "a2ui_reset"],
          description: "The canvas action to perform",
        },
        html: {
          type: "string",
          description: "HTML content for 'update' action",
        },
        code: {
          type: "string",
          description: "JavaScript code for 'eval' action",
        },
        messages: {
          type: "array",
          description: "A2UI messages for 'a2ui_push' action",
          items: { type: "object" },
        },
      },
      required: ["action"],
    },

    execute: async (params): Promise<AgentToolResult> => {
      const action = params.action as string;

      switch (action) {
        case "present": {
          canvasState.update((s) => ({ ...s, visible: true }));
          broadcast({ type: "canvas_present" });
          return { content: "Canvas panel is now visible." };
        }

        case "hide": {
          canvasState.update((s) => ({ ...s, visible: false }));
          broadcast({ type: "canvas_hide" });
          return { content: "Canvas panel is now hidden." };
        }

        case "update": {
          const html = params.html;
          if (typeof html !== "string") {
            return { content: "Error: 'html' parameter required for update action.", isError: true };
          }
          canvasState.update((s) => ({ ...s, lastHtml: html }));
          broadcast({ type: "canvas_update", html });
          return { content: "Canvas updated with HTML content." };
        }

        case "eval": {
          return { content: "Error: 'eval' action is disabled for security reasons. Use 'update' with HTML or 'a2ui_push' with structured components instead.", isError: true };
        }

        case "a2ui_push": {
          const messages = params.messages;
          if (!Array.isArray(messages)) {
            return { content: "Error: 'messages' array required for a2ui_push action.", isError: true };
          }
          const validMessages = validateA2uiMessages(messages);
          if (validMessages.length === 0) {
            return { content: "Error: no valid A2UI messages in array. Each message needs 'kind' and 'surfaceId'.", isError: true };
          }
          // Update canvas state immutably
          canvasState.update((s) => {
            const newSurfaces = new Map(s.surfaces);
            for (const msg of validMessages) {
              if (msg.kind === "surfaceUpdate" && msg.surfaceId) {
                newSurfaces.set(msg.surfaceId, (msg as { root: A2uiComponent }).root);
              } else if (msg.kind === "deleteSurface" && msg.surfaceId) {
                newSurfaces.delete(msg.surfaceId);
              }
            }
            return { ...s, surfaces: newSurfaces };
          });
          broadcast({ type: "canvas_a2ui", messages: validMessages });
          return { content: `Pushed ${validMessages.length} A2UI message(s) to canvas.` };
        }

        case "a2ui_reset": {
          canvasState.update(() => ({
            visible: true,
            surfaces: new Map(),
            lastHtml: null,
          }));
          broadcast({ type: "canvas_a2ui_reset" });
          return { content: "Canvas A2UI state reset." };
        }

        default:
          return { content: `Unknown canvas action: ${action}`, isError: true };
      }
    },
  };
}
