import { createServer } from "node:net";

export function isPortAvailable(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function ensurePortAvailable(port: number): Promise<void> {
  const available = await isPortAvailable(port);
  if (!available) {
    throw new Error(`Port ${port} is already in use.`);
  }
}

export async function findAvailablePort(
  start: number,
  end: number,
  host = "127.0.0.1",
): Promise<number> {
  for (let port = start; port <= end; port++) {
    if (await isPortAvailable(port, host)) {
      return port;
    }
  }
  throw new Error(`No available port in range ${start}-${end}`);
}
