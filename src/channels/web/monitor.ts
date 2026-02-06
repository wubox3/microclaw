import type { WebSocket } from "ws";
import type { WebInboundMessage } from "./types.js";

export type WebSocketClient = {
  ws: WebSocket;
  id: string;
  connectedAt: number;
};

export type WebMonitor = {
  clients: Map<string, WebSocketClient>;
  addClient: (id: string, ws: WebSocket) => void;
  removeClient: (id: string) => void;
  broadcast: (message: string) => void;
  onMessage: (handler: (clientId: string, message: WebInboundMessage) => void) => void;
};

export function createWebMonitor(): WebMonitor {
  const clients = new Map<string, WebSocketClient>();
  const messageHandlers: Array<(clientId: string, message: WebInboundMessage) => void> = [];

  return {
    clients,
    addClient: (id, ws) => {
      clients.set(id, { ws, id, connectedAt: Date.now() });
      ws.on("message", (data) => {
        try {
          const parsed = JSON.parse(String(data)) as WebInboundMessage;
          const msg: WebInboundMessage = {
            ...parsed,
            senderId: id,
            timestamp: Date.now(),
          };
          for (const handler of messageHandlers) {
            handler(id, msg);
          }
        } catch {
          // ignore malformed messages
        }
      });
      ws.on("close", () => {
        clients.delete(id);
      });
    },
    removeClient: (id) => {
      const client = clients.get(id);
      if (client) {
        client.ws.close();
        clients.delete(id);
      }
    },
    broadcast: (message) => {
      for (const client of clients.values()) {
        if (client.ws.readyState === 1) {
          client.ws.send(message);
        }
      }
    },
    onMessage: (handler) => {
      messageHandlers.push(handler);
    },
  };
}
