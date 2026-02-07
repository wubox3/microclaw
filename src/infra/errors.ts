export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code: string, statusCode = 500) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ConfigError extends AppError {
  constructor(message: string) {
    super(message, "CONFIG_ERROR", 500);
    this.name = "ConfigError";
  }
}

export class ChannelError extends AppError {
  constructor(message: string, channelId: string) {
    super(`[${channelId}] ${message}`, "CHANNEL_ERROR", 500);
    this.name = "ChannelError";
  }
}

export class MemoryError extends AppError {
  constructor(message: string) {
    super(message, "MEMORY_ERROR", 500);
    this.name = "MemoryError";
  }
}

export function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? err.message;
  }
  return String(err);
}
