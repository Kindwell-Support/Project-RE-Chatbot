/**
 * Minimal structural logger type. Fastify's request.log satisfies it, so the
 * server passes request-scoped structured logging into the persistence helpers.
 * The console fallback keeps them usable standalone (scripts, tests).
 */
export interface Logger {
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export const consoleLogger: Logger = {
  warn: (obj, msg) => console.warn(msg, obj),
  error: (obj, msg) => console.error(msg, obj),
};
