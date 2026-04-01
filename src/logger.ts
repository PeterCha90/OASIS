import type { OasisConfig } from "./types.js";

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;

export interface OasisLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Create a logger that respects the configured log level.
 * If a plugin logger is provided (from api.logger), wrap it.
 * Otherwise, fall back to console.
 */
export function createLogger(
  config: OasisConfig,
  pluginLogger?: OasisLogger
): OasisLogger {
  const minLevel = LOG_LEVELS[config.logLevel];
  const base = pluginLogger ?? {
    debug: (msg: string) => console.debug(msg),
    info: (msg: string) => console.info(msg),
    warn: (msg: string) => console.warn(msg),
    error: (msg: string) => console.error(msg),
  };

  return {
    debug: (msg) => {
      if (minLevel <= LOG_LEVELS.debug) base.debug(msg);
    },
    info: (msg) => {
      if (minLevel <= LOG_LEVELS.info) base.info(msg);
    },
    warn: (msg) => {
      if (minLevel <= LOG_LEVELS.warn) base.warn(msg);
    },
    error: (msg) => {
      if (minLevel <= LOG_LEVELS.error) base.error(msg);
    },
  };
}
