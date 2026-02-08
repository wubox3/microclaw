import { Hono } from "hono";
import { lstat, readFile } from "node:fs/promises";
import { resolve, normalize, extname } from "node:path";
import { generateA2uiPage } from "./a2ui-page.js";

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
};

export function createCanvasRoutes(dataDir: string): Hono {
  const app = new Hono();
  const a2uiHtml = generateA2uiPage();
  const canvasDir = resolve(dataDir, "canvas");

  // Serve the A2UI renderer page with CSP
  app.get("/a2ui", (c) => {
    return new Response(a2uiHtml, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      },
    });
  });

  // Serve files from ~/.microclaw/canvas/ with path traversal protection
  app.get("/files/*", async (c) => {
    const rawPath = c.req.path.replace(/^\/files\//, "");
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(rawPath);
    } catch {
      return c.json({ error: "Invalid path encoding" }, 400);
    }
    if (!decodedPath || decodedPath.includes("..") || decodedPath.startsWith("/")) {
      return c.json({ error: "Invalid path" }, 400);
    }

    const fullPath = resolve(canvasDir, decodedPath);
    const normalizedFull = normalize(fullPath);

    // Ensure resolved path is within canvas directory
    if (!normalizedFull.startsWith(normalize(canvasDir) + "/")) {
      return c.json({ error: "Path traversal denied" }, 403);
    }

    try {
      // Reject symlinks to prevent symlink-following attacks
      const stats = await lstat(normalizedFull);
      if (stats.isSymbolicLink()) {
        return c.json({ error: "Symlinks not allowed" }, 403);
      }
      if (!stats.isFile()) {
        return c.json({ error: "Not a regular file" }, 400);
      }
      const data = await readFile(normalizedFull);
      const ext = extname(normalizedFull).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
      return new Response(data, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(data.length),
          "Cache-Control": "public, max-age=60",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return c.json({ error: "File not found" }, 404);
    }
  });

  return app;
}
