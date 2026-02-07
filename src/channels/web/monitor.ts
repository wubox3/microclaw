import { WebSocket } from "ws";
import type { WebInboundMessage } from "./types.js";
import type { CanvasActionMessage } from "../../canvas-host/types.js";

export type WebSocketClient = {
  ws: WebSocket;
  id: string;
  connectedAt: number;
};

export type CanvasActionHandler = (clientId: string, action: CanvasActionMessage) => void;

export type WebMonitor = {
  clients: Map<string, WebSocketClient>;
  addClient: (id: string, ws: WebSocket) => void;
  removeClient: (id: string) => void;
  broadcast: (message: string) => void;
  onMessage: (handler: (clientId: string, message: WebInboundMessage) => void) => () => void;
  onCanvasAction: (handler: CanvasActionHandler) => () => void;
};

export function createWebMonitor(): WebMonitor {
  const clients = new Map<string, WebSocketClient>();
  const messageHandlers: Array<(clientId: string, message: WebInboundMessage) => void> = [];
  const canvasActionHandlers: CanvasActionHandler[] = [];

  return {
    clients,
    addClient: (id, ws) => {
      clients.set(id, { ws, id, connectedAt: Date.now() });
      ws.on("message", (data) => {
        try {
          const raw = String(data);
          // Reject payloads over 1MB to prevent abuse
          const MAX_PAYLOAD_BYTES = 1_048_576;
          if (Buffer.byteLength(raw, 'utf-8') > MAX_PAYLOAD_BYTES) {
            return;
          }
          const parsed = JSON.parse(raw) as Record<string, unknown>;

          // Handle canvas action messages
          if (parsed.type === "canvas_action" && typeof parsed.action === "string") {
            const action: CanvasActionMessage = {
              type: "canvas_action",
              action: parsed.action,
              componentId: typeof parsed.componentId === "string" ? parsed.componentId : undefined,
              value: parsed.value,
              surfaceId: typeof parsed.surfaceId === "string" ? parsed.surfaceId : undefined,
            };
            for (const handler of [...canvasActionHandlers]) {
              try {
                // Wrap in Promise.resolve to catch async handler rejections
                void Promise.resolve(handler(id, action)).catch(() => {});
              } catch {
                // Prevent one handler failure from blocking others
              }
            }
            return;
          }

          if (typeof parsed.text !== "string" || parsed.text.trim().length === 0) {
            return;
          }
          const MAX_TEXT_LENGTH = 50_000;
          const msg: WebInboundMessage = {
            id: typeof parsed.id === "string" ? parsed.id : String(Date.now()),
            text: parsed.text.slice(0, MAX_TEXT_LENGTH),
            senderId: id,
            senderName: typeof parsed.senderName === "string" ? parsed.senderName : undefined,
            timestamp: Date.now(),
            channelId: typeof parsed.channelId === "string" ? parsed.channelId : undefined,
          };
          for (const handler of [...messageHandlers]) {
            try {
              // Wrap in Promise.resolve to catch async handler rejections
              void Promise.resolve(handler(id, msg)).catch(() => {});
            } catch {
              // Prevent one handler failure from blocking others
            }
          }
        } catch {
          // ignore malformed messages
        }
      });
      ws.on("close", () => {
        clients.delete(id);
      });
      ws.on("error", () => {
        // Prevent uncaught error from crashing the process.
        // The close event will handle cleanup.
        clients.delete(id);
      });
    },
    removeClient: (id) => {
      const client = clients.get(id);
      if (client) {
        client.ws.removeAllListeners("message");
        client.ws.removeAllListeners("close");
        client.ws.removeAllListeners("error");
        client.ws.close();
        clients.delete(id);
      }
    },
    broadcast: (message) => {
      for (const client of clients.values()) {
        if (client.ws.readyState === WebSocket.OPEN) {
          try {
            client.ws.send(message);
          } catch {
            // Ignore per-client send failures to avoid aborting broadcast
          }
        }
      }
    },
    onMessage: (handler) => {
      messageHandlers.push(handler);
      return () => {
        const idx = messageHandlers.indexOf(handler);
        if (idx >= 0) messageHandlers.splice(idx, 1);
      };
    },
    onCanvasAction: (handler) => {
      canvasActionHandlers.push(handler);
      return () => {
        const idx = canvasActionHandlers.indexOf(handler);
        if (idx >= 0) canvasActionHandlers.splice(idx, 1);
      };
    },
  };
}
