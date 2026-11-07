// Reminders for things only a resident can do. "Later" hides one for a few days, and it keeps
// coming back until it's done.
import { addDays } from "./dates.js";

const SNOOZE_DAYS = 3;

// Interns don't have the Duty hours card or a rating to give, so they have nothing pending.
export function pendingReminders({ cls, hasHours, hasRated }) {
  if (!cls || cls === "PGY-1") return [];
  return [!hasHours && "hours", !hasRated && "rate"].filter(Boolean);
}

// One at a time, so Today never fills up with to-dos.
export const nextReminder = (pending, snoozed, today) => pending.find((key) => !(snoozed?.[key] > today)) || null;
export const snoozeReminder = (snoozed, key, today) => ({ ...snoozed, [key]: addDays(today, SNOOZE_DAYS) });
