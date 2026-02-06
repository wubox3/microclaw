import { Logger } from "tslog";

export type LogLevel = "silly" | "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export function createLogger(name: string, minLevel?: LogLevel): Logger<unknown> {
  return new Logger({
    name,
    minLevel: minLevel === "debug" ? 2 : minLevel === "info" ? 3 : minLevel === "warn" ? 4 : 3,
    prettyLogTemplate: "{{dateIsoStr}} {{logLevelName}} [{{name}}] ",
  });
}

export const logger = createLogger("microclaw");
