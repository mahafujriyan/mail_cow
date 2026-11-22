export function formatWhen(value: string | null, timeZone: string, language: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = ymd(date, timeZone) === ymd(now, timeZone);
  const yesterday = ymd(date, timeZone) === ymd(new Date(now.getTime() - 86_400_000), timeZone);
  const locale = language === "es" ? "es" : "en";
  if (sameDay) {
    return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone }).format(date);
  }
  if (yesterday) return language === "es" ? "Ayer" : "Yesterday";
  const sameYear = year(date, timeZone) === year(now, timeZone);
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    timeZone,
  }).format(date);
}

export function formatFull(value: string | null, timeZone: string, language: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language === "es" ? "es" : "en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

export function dayGroup(value: string | null, timeZone: string, language: string) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  if (ymd(date, timeZone) === ymd(now, timeZone)) return language === "es" ? "Hoy" : "Today";
  if (ymd(date, timeZone) === ymd(new Date(now.getTime() - 86_400_000), timeZone)) {
    return language === "es" ? "Ayer" : "Yesterday";
  }
  return new Intl.DateTimeFormat(language === "es" ? "es" : "en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(date);
}

function ymd(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function year(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric" }).format(date);
}
