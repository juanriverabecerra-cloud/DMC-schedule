// Background function (up to 15 minutes): reads the uploaded daily-sheet photo with Claude
// and leaves the result in job/<date> for the admin screen to review.
import { openStore } from "../../lib/store.js";
import { isAdmin } from "../../lib/auth.js";
import { readDailyPhoto } from "../../lib/photo-parse.js";

export default async function handler(req) {
  if (req.method !== "POST" || !isAdmin(req)) return new Response("Forbidden", { status: 403 });
  const { date } = await req.json();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return new Response("Bad date", { status: 400 });
  const st = openStore();
  const startedAt = new Date().toISOString();
  await st.setJSON(`job/${date}`, { status: "running", startedAt });
  try {
    const photo = await st.getBytes(`photo/${date}`);
    if (!photo) throw new Error("The photo was not found.");
    const ds = (await st.getJSON("dataset")) || { people: [] };
    const residentNames = [...new Set((ds.people || []).filter((p) => !p.hidden).map((p) => p.last))].sort();
    const result = await readDailyPhoto({ bytes: photo.data, mediaType: photo.contentType, date, residentNames });
    await st.setJSON(`job/${date}`, { status: "done", startedAt, finishedAt: new Date().toISOString(), ...result });
  } catch (err) {
    console.error(err);
    await st.setJSON(`job/${date}`, { status: "error", startedAt, error: err?.message || String(err) });
  }
  return new Response(null, { status: 202 });
}

export const config = { background: true, path: "/bg/parse-photo" };
