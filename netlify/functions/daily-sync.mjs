// Every 3 minutes through the day: re-read the board runner's workbook and update the daily sheet.
// Phones are only alerted when it has settled; see lib/daily-sync.js.
import { openStore } from "../../lib/store.js";
import { syncDaily } from "../../lib/daily-sync.js";

export default async function handler() {
  await syncDaily(openStore());
  return new Response("ok");
}

// 10:00 to 04:59 UTC: about 5a to midnight in Detroit.
export const config = { schedule: "*/3 10-23,0-4 * * *" };
