import crypto from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import fs from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";

const MEDIA_DIR = join(tmpdir(), "microclaw", "media");

type Sharp = typeof import("sharp");

async function loadSharp(): Promise<(buffer: Buffer) => ReturnType<Sharp>> {
  const mod = (await import("sharp")) as unknown as { default?: Sharp };
  const sharp = mod.default ?? (mod as unknown as Sharp);
  return (buffer) => sharp(buffer, { failOnError: false });
}

// --- Media store exports (used by agent.snapshot) ---

export async function ensureMediaDir(): Promise<string> {
  if (!existsSync(MEDIA_DIR)) {
    mkdirSync(MEDIA_DIR, { recursive: true });
  }
  return MEDIA_DIR;
}

export type SavedMedia = {
  id: string;
  path: string;
  size: number;
  contentType?: string;
};

export async function saveMediaBuffer(
  buffer: Buffer,
  contentType?: string,
  subdir = "inbound",
  maxBytes = 5 * 1024 * 1024,
  _originalFilename?: string,
): Promise<SavedMedia> {
  if (buffer.byteLength > maxBytes) {
    throw new Error(`Media exceeds ${(maxBytes / (1024 * 1024)).toFixed(0)}MB limit`);
  }
  const dir = join(MEDIA_DIR, subdir);
  await fs.mkdir(dir, { recursive: true });
  const uuid = crypto.randomUUID();
  const ext = contentType === "image/jpeg" ? ".jpg" : contentType === "image/png" ? ".png" : "";
  const id = `${uuid}${ext}`;
  const dest = join(dir, id);
  await fs.writeFile(dest, buffer);
  return { id, path: dest, size: buffer.byteLength, contentType };
}

// --- Image ops exports (used by screenshot.ts) ---

export type ImageMetadata = {
  width: number;
  height: number;
};

export async function getImageMetadata(buffer: Buffer): Promise<ImageMetadata | null> {
  try {
    const sharp = await loadSharp();
    const meta = await sharp(buffer).metadata();
    const width = Number(meta.width ?? 0);
    const height = Number(meta.height ?? 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    return { width, height };
  } catch {
    return null;
  }
}

export async function resizeToJpeg(params: {
  buffer: Buffer;
  maxSide: number;
  quality: number;
  withoutEnlargement?: boolean;
}): Promise<Buffer> {
  const sharp = await loadSharp();
  return await sharp(params.buffer)
    .rotate()
    .resize({
      width: params.maxSide,
      height: params.maxSide,
      fit: "inside",
      withoutEnlargement: params.withoutEnlargement !== false,
    })
    .jpeg({ quality: params.quality, mozjpeg: true })
    .toBuffer();
}

// --- Basic screenshot storage ---

export function storeScreenshot(data: Buffer, filename?: string): string {
  if (!existsSync(MEDIA_DIR)) {
    mkdirSync(MEDIA_DIR, { recursive: true });
  }
  // Sanitize filename to prevent path traversal
  const rawName = filename ?? `screenshot-${Date.now()}.png`;
  const safeName = rawName.replace(/[/\\:\0]/g, "_");
  const filePath = join(MEDIA_DIR, safeName);
  // Verify resolved path stays within MEDIA_DIR
  const resolved = resolvePath(filePath);
  if (!resolved.startsWith(resolvePath(MEDIA_DIR) + "/") && resolved !== resolvePath(MEDIA_DIR)) {
    throw new Error("Screenshot filename escapes media directory");
  }
  writeFileSync(filePath, data);
  return filePath;
}

export function loadScreenshot(filePath: string): Buffer {
  // Validate that the path is within the media directory
  const resolved = resolvePath(filePath);
  if (!resolved.startsWith(resolvePath(MEDIA_DIR) + "/")) {
    throw new Error("Screenshot path must be within media directory");
  }
  return readFileSync(resolved);
}
