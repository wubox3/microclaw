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
  "aside", "label", "button", "select", "option",
  "fieldset", "legend", "progress", "meter",
]);

const ALLOWED_ATTRS = new Set([
  "class", "id", "title", "alt", "src", "href", "width", "height",
  "colspan", "rowspan", "target", "rel", "type", "placeholder", "value",
  "disabled", "checked", "readonly", "min", "max", "step", "name", "for",
  "open", "data-a2ui-id", "data-surface", "role", "aria-label", "aria-hidden",
]);

function decodeHtmlEntitiesOnce(str: string): string {
  return str
    .replace(/&NewLine;/gi, "\n")
    .replace(/&Tab;/gi, "\t")
    .replace(/&colon;/gi, ":")
    .replace(/&sol;/gi, "/")
    .replace(/&bsol;/gi, "\\")
    .replace(/&period;/gi, ".")
    .replace(/&lpar;/gi, "(")
    .replace(/&rpar;/gi, ")")
    .replace(/&#x([0-9a-fA-F]+);?/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function decodeHtmlEntities(str: string): string {
  // Multi-pass decode to prevent double-encode bypass (e.g. &amp;#106;avascript:)
  let prev = str;
  for (let i = 0; i < 3; i++) {
    const decoded = decodeHtmlEntitiesOnce(prev);
    if (decoded === prev) break;
    prev = decoded;
  }
  return prev;
}

function encodeHtmlAttrValue(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildBracketPattern(tags: Set<string>): RegExp {
  return new RegExp(String.raw`<(?!\/?(${[...tags].join("|")})\b)`, "gi");
}

function sanitizeHtml(raw: string): string {
  // Strip null bytes before any other processing to prevent parser confusion
  let html = raw.replace(/\0/g, "");

  // Strip remaining control characters that can confuse HTML parsers
  html = html.replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, "");

  // Strip HTML comments first to prevent comment-based bypasses
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  html = html.replace(/<!--/g, "").replace(/-->/g, "");

  // Strip script/style/noscript content entirely (not just tags)
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  html = html.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "");

  // Strip event handlers and dangerous URI schemes (multi-pass for nested evasion)
  // Use robust patterns that match control characters within scheme names
  for (let pass = 0; pass < 3; pass++) {
    const prev = html;
    html = html
      .replace(/\bon\w+\s*=/gi, "x-removed=")
      .replace(/j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi, "removed:")
      .replace(/v\s*b\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi, "removed:");
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
      // data-a2ui-id and data-surface are already in ALLOWED_ATTRS (no separate set needed)
      if (ALLOWED_ATTRS.has(attrName)) {
        // Extra safety: strip dangerous URIs from href/src
        // Decode HTML entities first to prevent &#106;avascript: bypass
        if (attrName === "href" || attrName === "src") {
          const decoded = decodeHtmlEntities(attrValue);
          if (/^\s*(javascript|vbscript|data)\s*:/i.test(decoded)) {
            continue;
          }
        }
        attrs.push(` ${attrName}="${encodeHtmlAttrValue(attrValue)}"`);
      }
    }
    // Enforce rel="noopener noreferrer" on <a> tags with target attribute
    if (lower === "a") {
      const hasTarget = attrs.some((a) => a.trimStart().startsWith("target="));
      if (hasTarget) {
        const relIdx = attrs.findIndex((a) => a.trimStart().startsWith("rel="));
        if (relIdx >= 0) {
          attrs[relIdx] = ` rel="noopener noreferrer"`;
        } else {
          attrs.push(` rel="noopener noreferrer"`);
        }
      }
    }
    const selfClose = match.trimEnd().endsWith("/>") ? " /" : "";
    return `<${lower}${attrs.join("")}${selfClose}>`;
  });

  // Strip remaining angle brackets not part of allowed tags
  html = html.replace(buildBracketPattern(ALLOWED_TAGS), String.fromCharCode(38) + "lt;");

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
      const action = params.action;
      if (typeof action !== "string") {
        return { content: "Error: action parameter must be a string.", isError: true };
      }

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
          // Update canvas state immutably: canvasState.update() receives the old
          // state and returns a new object. We create a new Map from the old
          // surfaces and apply mutations to the *new* Map only, so the previous
          // state object is never modified.
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
