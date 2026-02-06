import { createLogger } from "../../logging.js";

export type SubsystemLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
  child: (name: string) => SubsystemLogger;
};

export function createSubsystemLogger(name: string): SubsystemLogger {
  const log = createLogger(name);

  function makeLogger(prefix: string): SubsystemLogger {
    const inner = createLogger(prefix);
    return {
      info: (msg: string) => inner.info(msg),
      warn: (msg: string) => inner.warn(msg),
      error: (msg: string) => inner.error(msg),
      debug: (msg: string) => inner.debug(msg),
      child: (childName: string) => makeLogger(`${prefix}.${childName}`),
    };
  }

  return {
    info: (msg: string) => log.info(msg),
    warn: (msg: string) => log.warn(msg),
    error: (msg: string) => log.error(msg),
    debug: (msg: string) => log.debug(msg),
    child: (childName: string) => makeLogger(`${name}.${childName}`),
  };
}
