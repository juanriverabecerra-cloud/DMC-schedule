// Every 15 minutes through the day: case log nudges (see lib/caselog-nudges.js) and RSVP reminders
// (lib/rsvp-alerts.js), together so there's one schedule to pay for.
import { openStore } from "../../lib/store.js";
import { sendCaseNudges } from "../../lib/caselog-nudges.js";
import { sendRsvpAlerts } from "../../lib/rsvp-alerts.js";

export default async function handler() {
  const st = openStore();
  const cases = await sendCaseNudges(st).catch((err) => ({ error: err.message }));
  const rsvp = await sendRsvpAlerts(st).catch((err) => ({ error: err.message }));
  return new Response(JSON.stringify({ cases, rsvp }), { headers: { "content-type": "application/json" } });
}

// 11:00 to 03:59 UTC: 7a to 11p in Detroit in summer, 6a to 10p in winter. The earliest nudge is
// 7:30 the morning after an overnight shift; the latest, an hour after the 11-to-9 OB shift ends.
export const config = { schedule: "*/15 11-23,0-3 * * *" };
