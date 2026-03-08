import { AsyncLocalStorage } from "node:async_hooks";

export type RoomdLogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

const LOG_LEVEL_PRIORITY: Record<RoomdLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const contextStore = new AsyncLocalStorage<LogFields>();

function parseLogLevel(value: string | undefined): RoomdLogLevel {
  switch (value?.trim().toLowerCase()) {
    case "debug":
    case "info":
    case "warn":
    case "error":
      return value.trim().toLowerCase() as RoomdLogLevel;
    default:
      return "debug";
  }
}

const configuredLevel = parseLogLevel(process.env.ROOMD_LOG_LEVEL);

export interface RoomdLogger {
  child(bindings: LogFields): RoomdLogger;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

class JsonRoomdLogger implements RoomdLogger {
  constructor(private readonly bindings: LogFields = {}) {}

  child(bindings: LogFields): RoomdLogger {
    return new JsonRoomdLogger({ ...this.bindings, ...omitUndefined(bindings) });
  }

  debug(message: string, fields?: LogFields): void {
    this.emit("debug", message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.emit("info", message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.emit("warn", message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.emit("error", message, fields);
  }

  private emit(level: RoomdLogLevel, message: string, fields?: LogFields): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[configuredLevel]) {
      return;
    }

    const payload = {
      ts: new Date().toISOString(),
      level,
      msg: message,
      ...this.bindings,
      ...(contextStore.getStore() ?? {}),
      ...(fields ? omitUndefined(fields) : {}),
    };
    const line = JSON.stringify(payload);

    if (level === "warn") {
      console.warn(line);
      return;
    }
    if (level === "error") {
      console.error(line);
      return;
    }
    console.log(line);
  }
}

const rootLogger = new JsonRoomdLogger({ service: "roomd" });

export function getRoomdLogger(bindings: LogFields = {}): RoomdLogger {
  return rootLogger.child(bindings);
}

export function getLogContext(): LogFields {
  return contextStore.getStore() ?? {};
}

export function runWithLogContext<T>(
  context: LogFields,
  callback: () => T,
): T {
  const current = contextStore.getStore() ?? {};
  return contextStore.run({ ...current, ...omitUndefined(context) }, callback);
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return {
    message: String(error),
  };
}

function omitUndefined(fields: LogFields): LogFields {
  const result: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}
