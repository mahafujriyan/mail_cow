type Fields = Record<string, unknown>;

const SECRET_KEY = /password|token|secret|authorization|cookie|csrf|set-cookie/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(entry);
  }
  return output;
}

function write(level: "info" | "warn" | "error", message: string, fields?: Fields) {
  const payload = {
    time: new Date().toISOString(),
    level,
    message,
    ...(fields ? (redact(fields) as Fields) : {}),
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info(message: string, fields?: Fields) {
    write("info", message, fields);
  },
  warn(message: string, fields?: Fields) {
    write("warn", message, fields);
  },
  error(message: string, fields?: Fields) {
    write("error", message, fields);
  },
};
