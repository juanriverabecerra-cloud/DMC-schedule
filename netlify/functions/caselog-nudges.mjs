// Every 15 minutes through the day: case log nudges (see lib/caselog-nudges.js).
import { openStore } from "../../lib/store.js";
import { sendCaseNudges } from "../../lib/caselog-nudges.js";

export default async function handler() {
  const result = await sendCaseNudges(openStore());
  return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
}

// 11:00 to 03:59 UTC: 7a to 11p in Detroit in summer, 6a to 10p in winter. The earliest nudge is
// 7:30 the morning after an overnight shift; the latest, an hour after the 11-to-9 OB shift ends.
export const config = { schedule: "*/15 11-23,0-3 * * *" };
