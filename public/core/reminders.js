// Reminders for things only a resident can do. "Later" hides one for a few days, and it keeps
// coming back until it's done.
import { addDays } from "./dates.js";

const SNOOZE_DAYS = 3;

// Interns don't have the Duty hours card or a rating to give, so only alerts apply to them.
// `alerts` is this device's alert status: "off" or "install" (iPhone Safari) can still be done.
export function pendingReminders({ cls, hasHours, hasRated, alerts }) {
  if (!cls) return [];
  const wantsAlerts = alerts === "off" || alerts === "install";
  if (cls === "PGY-1") return wantsAlerts ? ["alerts"] : [];
  return [!hasHours && "hours", !hasRated && "rate", wantsAlerts && "alerts"].filter(Boolean);
}

// One at a time, so Today never fills up with to-dos.
export const nextReminder = (pending, snoozed, today) => pending.find((key) => !(snoozed?.[key] > today)) || null;
export const snoozeReminder = (snoozed, key, today) => ({ ...snoozed, [key]: addDays(today, SNOOZE_DAYS) });
