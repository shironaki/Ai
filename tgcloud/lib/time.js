import { CONFIG } from "./config.js";

export function validTimeZone(value) {
  if (typeof value !== "string" || value.length > 80) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(0); return true; } catch { return false; }
}
export function effectiveTimeZone(value) {
  return validTimeZone(value) ? value : validTimeZone(CONFIG.TIME_ZONE) ? CONFIG.TIME_ZONE : "UTC";
}
export function calendarDate(at, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: effectiveTimeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at));
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function localTimestamp(at, timeZone) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: effectiveTimeZone(timeZone), day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));
}
export async function personalTimeZone(store, userId) {
  const row = await store.getChecked(`assistant:settings:user:${userId}`);
  if (!row.ok) throw Error("timezone_storage_unavailable");
  return { timeZone: effectiveTimeZone(row.value?.timezone), explicit: validTimeZone(row.value?.timezone) };
}
