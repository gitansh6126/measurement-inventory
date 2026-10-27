// Structured JSON lines on stdout/stderr; the process manager ships them.
type Level = "info" | "warn" | "error";

function write(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, env: process.env.APP_ENV, msg, ...fields });
  if (level === "error") console.error(line);
  else if (process.env.APP_ENV !== "TEST") console.log(line);
}

export const log = {
  info: (msg: string, fields?: Record<string, unknown>) => write("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write("error", msg, fields),
};
