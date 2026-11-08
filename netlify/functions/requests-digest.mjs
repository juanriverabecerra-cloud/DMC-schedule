// Once a day in the evening: one summary alert to admins of swaps and no-call lists that came in
// since the last one. Nothing new, nothing sent. Sick calls already went out when they happened.
import { openStore } from "../../lib/store.js";
import { sendDigest } from "../../lib/reqlog.js";

export default async function handler() {
  const result = await sendDigest(openStore());
  return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
}

// 23:00 UTC: 6p in Detroit in winter, 7p in summer.
export const config = { schedule: "0 23 * * *" };
