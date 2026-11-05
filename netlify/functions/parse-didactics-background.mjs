// Background function (up to 15 minutes): reads an uploaded conference-schedule PDF with
// Claude and leaves the result in job/<id> for the admin screen to review. The PDF waits in
// inbox/<id> until the admin saves the month.
import { openStore } from "../../lib/store.js";
import { isAdmin } from "../../lib/auth.js";
import { readDidacticsPdf } from "../../lib/didactics-parse.js";
import { displayName } from "../../public/core/names.js";
import { todayLocal } from "../../public/core/dates.js";

export default async function handler(req) {
  if (req.method !== "POST" || !isAdmin(req)) return new Response("Forbidden", { status: 403 });
  const { id } = await req.json();
  if (!/^[\w-]{6,64}$/.test(id || "")) return new Response("Bad id", { status: 400 });
  const st = openStore();
  const startedAt = new Date().toISOString();
  await st.setJSON(`job/${id}`, { status: "running", startedAt });
  try {
    const pdf = await st.getBytes(`inbox/${id}`);
    if (!pdf) throw new Error("The PDF was not found.");
    const ds = (await st.getJSON("dataset")) || { people: [] };
    const residents = (ds.people || []).filter((p) => !p.hidden)
      .map((p) => ({ last: p.last, name: displayName(p), cls: p.cls }))
      .sort((a, b) => a.last.localeCompare(b.last));
    const faculty = (ds.directory?.staff || []).map((s) => s.name);
    const result = await readDidacticsPdf({ bytes: pdf.data, today: todayLocal(), residents, faculty });
    await st.setJSON(`job/${id}`, { status: "done", startedAt, finishedAt: new Date().toISOString(), ...result });
  } catch (err) {
    console.error(err);
    await st.setJSON(`job/${id}`, { status: "error", startedAt, error: err?.message || String(err) });
  }
  return new Response(null, { status: 202 });
}

export const config = { background: true, path: "/bg/parse-didactics" };
