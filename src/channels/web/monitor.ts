import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type { WebInboundMessage } from "./types.js";
import type { CanvasActionMessage } from "../../canvas-host/types.js";
import { createLogger } from "../../logging.js";

const log = createLogger("web-monitor");

export type WebSocketClient = {
  ws: WebSocket;
  id: string;
  connectedAt: number;
  messageHandler: (data: Buffer | ArrayBuffer | Buffer[]) => void;
  closeHandler: () => void;
  errorHandler: () => void;
};

export type CanvasActionHandler = (clientId: string, action: CanvasActionMessage) => void;

type MessageHandler = (clientId: string, message: WebInboundMessage) => void;

export type WebMonitor = {
  clients: ReadonlyMap<string, WebSocketClient>;
  addClient: (id: string, ws: WebSocket) => void;
  removeClient: (id: string) => void;
  broadcast: (message: string) => void;
  onMessage: (handler: MessageHandler) => () => void;
  onCanvasAction: (handler: CanvasActionHandler) => () => void;
};

export function createWebMonitor(): WebMonitor {
  const clients = new Map<string, WebSocketClient>();
  let messageHandlers: MessageHandler[] = [];
  let canvasActionHandlers: CanvasActionHandler[] = [];

  return {
    clients,
    addClient: (id, ws) => {
      // Single cleanup function with guard to prevent double cleanup from close/error race
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        clients.delete(id);
      };

      const messageHandler = (data: Buffer | ArrayBuffer | Buffer[]) => {
        try {
          const raw = String(data);
          // Defense-in-depth payload size check after String conversion.
          // For production, configure maxPayload on WebSocketServer to reject before buffering.
          const MAX_PAYLOAD_BYTES = 1_048_576;
          if (Buffer.byteLength(raw, "utf-8") > MAX_PAYLOAD_BYTES) {
            return;
          }
          const parsed = JSON.parse(raw) as Record<string, unknown>;

          // Handle canvas action messages
          if (parsed.type === "canvas_action" && typeof parsed.action === "string") {
            // Validate value field size before constructing message
            const MAX_VALUE_SIZE = 10_000;
            const valueStr = JSON.stringify(parsed.value);
            if (valueStr && valueStr.length > MAX_VALUE_SIZE) {
              return; // drop oversized value
            }

            // Freeze the action object to prevent mutation across handlers
            const action: CanvasActionMessage = Object.freeze({
              type: "canvas_action" as const,
              action: parsed.action,
              componentId: typeof parsed.componentId === "string" ? parsed.componentId : undefined,
              value: parsed.value,
              surfaceId: typeof parsed.surfaceId === "string" ? parsed.surfaceId : undefined,
            });

            for (const handler of [...canvasActionHandlers]) {
              try {
                void Promise.resolve(handler(id, action)).catch((err) => {
                  log.error(`Canvas action handler error: ${err instanceof Error ? err.message : String(err)}`);
                });
              } catch (err) {
                log.error(`Canvas action handler sync error: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
            return;
          }

          if (typeof parsed.text !== "string" || parsed.text.trim().length === 0) {
            return;
          }
          const MAX_TEXT_LENGTH = 50_000;
          const msg: WebInboundMessage = {
            id: typeof parsed.id === "string" ? parsed.id : randomUUID(),
            text: parsed.text.slice(0, MAX_TEXT_LENGTH),
            senderId: id,
            senderName: typeof parsed.senderName === "string" ? parsed.senderName : undefined,
            timestamp: Date.now(),
            channelId: typeof parsed.channelId === "string" ? parsed.channelId : undefined,
          };

          for (const handler of [...messageHandlers]) {
            try {
              void Promise.resolve(handler(id, msg)).catch((err) => {
                log.error(`Message handler error: ${err instanceof Error ? err.message : String(err)}`);
              });
            } catch (err) {
              log.error(`Message handler sync error: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        } catch {
          // ignore malformed messages
        }
      };

      // Store specific listener references for targeted cleanup
      const closeHandler = cleanup;
      const errorHandler = cleanup;

      ws.on("message", messageHandler);
      ws.on("close", closeHandler);
      ws.on("error", errorHandler);

      clients.set(id, { ws, id, connectedAt: Date.now(), messageHandler, closeHandler, errorHandler });
    },
    removeClient: (id) => {
      const client = clients.get(id);
      if (client) {
        client.ws.removeListener("message", client.messageHandler);
        client.ws.removeListener("close", client.closeHandler);
        client.ws.removeListener("error", client.errorHandler);
        client.ws.close();
        clients.delete(id);
      }
    },
    broadcast: (message) => {
      for (const client of [...clients.values()]) {
        if (client.ws.readyState === WebSocket.OPEN) {
          try {
            client.ws.send(message);
          } catch {
            // best-effort
          }
        }
      }
    },
    onMessage: (handler) => {
      messageHandlers = [...messageHandlers, handler];
      return () => {
        messageHandlers = messageHandlers.filter((h) => h !== handler);
      };
    },
    onCanvasAction: (handler) => {
      canvasActionHandlers = [...canvasActionHandlers, handler];
      return () => {
        canvasActionHandlers = canvasActionHandlers.filter((h) => h !== handler);
      };
    },
  };
}
