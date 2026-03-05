function pad(value) {
  return String(value).padStart(2, "0");
}

export function validateDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

export function parseDateKeyUtc(dateKey) {
  if (!validateDateKey(dateKey)) return null;
  const [year, month, day] = dateKey.split("-").map((item) => Number(item));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  return new Date(Date.UTC(year, month - 1, day));
}

export function toDateKey(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const matched = String(value).match(/\d{4}-\d{2}-\d{2}/);
  return matched ? matched[0] : String(value).slice(0, 10);
}

export function shiftDateKey(dateKey, deltaDays) {
  const base = parseDateKeyUtc(dateKey);
  if (!base) return "";
  base.setUTCDate(base.getUTCDate() + Number(deltaDays || 0));
  const y = base.getUTCFullYear();
  const m = pad(base.getUTCMonth() + 1);
  const d = pad(base.getUTCDate());
  return `${y}-${m}-${d}`;
}

export function getWeekStartDateKey(dateKey) {
  const date = parseDateKeyUtc(dateKey);
  if (!date) return "";
  const weekDay = date.getUTCDay();
  const offset = weekDay === 0 ? 6 : weekDay - 1;
  return shiftDateKey(dateKey, -offset);
}

export function getTodayDateKeyByTimeZone(timeZone = "Asia/Shanghai") {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(new Date());
}

export function enumerateDateKeys(startDateKey, endDateKey) {
  if (!validateDateKey(startDateKey) || !validateDateKey(endDateKey) || startDateKey > endDateKey) {
    return [];
  }
  const result = [];
  let cursor = startDateKey;
  while (cursor <= endDateKey) {
    result.push(cursor);
    cursor = shiftDateKey(cursor, 1);
  }
  return result;
}

