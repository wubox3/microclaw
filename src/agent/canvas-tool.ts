import type { AgentTool, AgentToolResult } from "./types.js";
import type { WebMonitor } from "../channels/web/monitor.js";
import type { CanvasStateRef, A2uiMessage, A2uiComponent } from "../canvas-host/types.js";

const VALID_A2UI_KINDS = new Set(["beginRendering", "surfaceUpdate", "dataModelUpdate", "deleteSurface"]);

/**
 * Strip dangerous HTML content that could enable XSS via prompt injection.
 * Uses an allowlist approach: only permitted tags survive; everything else
 * is escaped. Event handlers and dangerous URI schemes are always stripped.
 * Multi-pass to handle nested/split tag reconstruction attacks.
 */
const ALLOWED_TAGS = new Set([
  "div", "span", "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tfoot",
  "tr", "th", "td", "caption", "colgroup", "col", "strong", "em", "b", "i",
  "u", "s", "del", "ins", "code", "pre", "blockquote", "a", "img", "sub",
  "sup", "small", "mark", "abbr", "time", "details", "summary", "figure",
  "figcaption", "section", "article", "header", "footer", "nav", "main",
  "aside", "label", "input", "button", "select", "option", "textarea",
  "fieldset", "legend", "progress", "meter",
]);

const ALLOWED_ATTRS = new Set([
  "class", "id", "style", "title", "alt", "src", "href", "width", "height",
  "colspan", "rowspan", "target", "rel", "type", "placeholder", "value",
  "disabled", "checked", "readonly", "min", "max", "step", "name", "for",
  "open", "data-a2ui-id", "data-surface", "role", "aria-label", "aria-hidden",
]);

function sanitizeHtml(raw: string): string {
  // Strip event handlers and dangerous URI schemes (multi-pass for nested evasion)
  let html = raw;
  for (let pass = 0; pass < 3; pass++) {
    const prev = html;
    html = html
      .replace(/\bon\w+\s*=/gi, "data-removed-handler=")
      .replace(/javascript\s*:/gi, "removed:")
      .replace(/vbscript\s*:/gi, "removed:")
      .replace(/data\s*:\s*text\/html/gi, "removed:");
    if (html === prev) break;
  }

  // Strip non-allowed tags while keeping their text content
  // Match opening tags, closing tags, and self-closing tags
  html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/gi, (match, tagName: string) => {
    const lower = tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) {
      return ""; // strip the tag entirely
    }
    // For allowed tags, strip non-allowed attributes
    if (match.startsWith("</")) {
      return `</${lower}>`;
    }
    const attrs: string[] = [];
    const attrRegex = /\s+([a-zA-Z][a-zA-Z0-9_-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(match)) !== null) {
      const attrName = attrMatch[1]!.toLowerCase();
      const attrValue = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
      if (ALLOWED_ATTRS.has(attrName) || attrName.startsWith("data-")) {
        // Extra safety: strip dangerous URIs from href/src
        if ((attrName === "href" || attrName === "src") &&
            /^\s*(javascript|vbscript|data\s*:\s*text\/html)\s*:/i.test(attrValue)) {
          continue;
        }
        attrs.push(` ${attrName}="${attrValue.replace(/"/g, "&quot;")}"`);
      }
    }
    const selfClose = match.trimEnd().endsWith("/>") ? " /" : "";
    return `<${lower}${attrs.join("")}${selfClose}>`;
  });

  return html;
}

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
          enum: ["present", "hide", "update", "a2ui_push", "a2ui_reset"],
          description: "The canvas action to perform",
        },
        html: {
          type: "string",
          description: "HTML content for 'update' action",
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
          const safeHtml = sanitizeHtml(html);
          canvasState.update((s) => ({ ...s, lastHtml: safeHtml }));
          broadcast({ type: "canvas_update", html: safeHtml });
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
              if (msg.kind === "beginRendering" && msg.surfaceId) {
                if (!newSurfaces.has(msg.surfaceId)) {
                  newSurfaces.set(msg.surfaceId, { type: "container" } as A2uiComponent);
                }
              } else if (msg.kind === "surfaceUpdate" && msg.surfaceId) {
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
          return { content: "Unknown canvas action", isError: true };
      }
    },
  };
}
