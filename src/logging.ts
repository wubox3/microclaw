import { Logger } from "tslog";

export type LogLevel = "silly" | "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LOG_LEVEL_MAP: Record<LogLevel, number> = {
  silly: 0,
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fatal: 6,
};

const VALID_LOG_LEVELS = new Set(Object.keys(LOG_LEVEL_MAP));

function resolveLogLevel(envLevel: string | undefined): number {
  if (envLevel && VALID_LOG_LEVELS.has(envLevel)) {
    return LOG_LEVEL_MAP[envLevel as LogLevel];
  }
  return LOG_LEVEL_MAP.info;
}

export function createLogger(name: string, minLevel?: LogLevel): Logger<unknown> {
  return new Logger({
    name,
    minLevel: minLevel ? LOG_LEVEL_MAP[minLevel] : resolveLogLevel(process.env.LOG_LEVEL),
    prettyLogTemplate: "{{dateIsoStr}} {{logLevelName}} [{{name}}] ",
  });
}

export const logger = createLogger("microclaw");
