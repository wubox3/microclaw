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

export function createLogger(name: string, minLevel?: LogLevel): Logger<unknown> {
  return new Logger({
    name,
    minLevel: minLevel ? LOG_LEVEL_MAP[minLevel] : 3,
    prettyLogTemplate: "{{dateIsoStr}} {{logLevelName}} [{{name}}] ",
  });
}

export const logger = createLogger("microclaw");
