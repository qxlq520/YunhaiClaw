export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Config {
  level: LogLevel;
  format: "text" | "json";
}

const levelWeight: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let config: Config = { level: "info", format: "text" };

const labels: Record<LogLevel, string> = { debug: "DEBUG", info: "INFO", warn: "WARN", error: "ERROR" };

export function configFromEnv(): Config {
  const rawLevel = (process.env.CANVAS_LOG_LEVEL ?? "info").trim().toLowerCase();
  if (!(rawLevel in levelWeight)) throw new Error("CANVAS_LOG_LEVEL 必须是 debug、info、warn 或 error");
  const format = (process.env.CANVAS_LOG_FORMAT ?? "text").trim().toLowerCase();
  if (format !== "text" && format !== "json") throw new Error("CANVAS_LOG_FORMAT 必须是 text 或 json");
  return { level: rawLevel as LogLevel, format };
}

function write(level: LogLevel, message: string, attributes: Record<string, unknown> = {}): void {
  if (levelWeight[level] < levelWeight[config.level]) return;
  const timestamp = new Date().toISOString();
  if (config.format === "json") {
    console.log(JSON.stringify({ time: timestamp, level: labels[level], msg: message, ...attributes }));
    return;
  }
  const extras = Object.entries(attributes)
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" ");
  console.log(`${timestamp} ${labels[level]} ${message}${extras ? ` ${extras}` : ""}`);
}

export function setup(value: Config): void {
  config = value;
}

export const logger = {
  debug: (message: string, attributes?: Record<string, unknown>) => write("debug", message, attributes),
  info: (message: string, attributes?: Record<string, unknown>) => write("info", message, attributes),
  warn: (message: string, attributes?: Record<string, unknown>) => write("warn", message, attributes),
  error: (message: string, attributes?: Record<string, unknown>) => write("error", message, attributes),
};

export function accessLog(redact: (path: string) => string) {
  return (req: { method: string; url: string }, res: { statusCode: number }, next: () => void, startedAt: number) => {
    const path = redact(req.url.split("?")[0]);
    const pathname = req.url.split("?")[0];
    const isQuery = req.method === "GET" || req.method === "HEAD";
    const level: LogLevel = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : isQuery ? "debug" : "info";
    write(level, "http request", { method: req.method, path: pathname || path, status: res.statusCode, durationMs: Date.now() - startedAt });
    next();
  };
}
