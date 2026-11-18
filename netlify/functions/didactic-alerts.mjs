// Every 5 minutes through the day: didactics alerts for each resident, from their own day.
// See lib/didactic-alerts.js.
import { openStore } from "../../lib/store.js";
import { sendDidacticAlerts } from "../../lib/didactic-alerts.js";

export default async function handler() {
  const result = await sendDidacticAlerts(openStore());
  return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
}

// 09:00 to 03:59 UTC: 4a to 11p in Detroit in winter, 5a to midnight in summer. The earliest
// alert is 30 minutes before a 6a sitting; the latest, the 7p–10p evening-before window.
export const config = { schedule: "*/5 9-23,0-3 * * *" };
