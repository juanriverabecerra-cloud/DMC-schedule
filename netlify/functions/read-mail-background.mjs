// Background function (up to 15 minutes): reads a program email that was queued by
// /api/mail/<token> (lib/mail-intake.js) with Claude.
//   - A conference schedule PDF is read and saved for its month, unless an admin already saved
//     that month by hand (their reviewed copy wins; an automatic one is replaced by a newer email).
//   - Anything else is read for events (lib/mail-read.js).
import { openStore } from "../../lib/store.js";
import { isMailToken } from "../../lib/auth.js";
import { readMailEvents } from "../../lib/mail-read.js";
import { readDidacticsPdf } from "../../lib/didactics-parse.js";
import { cleanEvent, upsertEvents, noteMail } from "../../lib/mail-intake.js";
import { withDataset, setDidactics, NO_CHANGE } from "../../lib/dataset.js";
import { displayName } from "../../public/core/names.js";
import { todayLocal } from "../../public/core/dates.js";

export async function readQueuedMail(st, id, { readEvents = readMailEvents, readPdf = readDidacticsPdf } = {}) {
  const mail = await st.getJSON(`mailq/${id}`);
  if (!mail) return null;
  const today = todayLocal();
  let line;
  try {
    if (mail.reading?.kind === "didactics") {
      const pdf = await st.getBytes(`mailq/${id}.pdf`);
      if (!pdf) throw new Error("The PDF was not kept.");
      const ds = (await st.getJSON("dataset")) || { people: [] };
      const residents = (ds.people || []).filter((p) => !p.hidden).map((p) => ({ last: p.last, name: displayName(p), cls: p.cls })).sort((a, b) => a.last.localeCompare(b.last));
      const faculty = (ds.directory?.staff || []).map((s) => s.name);
      const { didactics } = await readPdf({ bytes: pdf.data, today, residents, faculty });
      const month = /^\d{4}-\d{2}$/.test(didactics?.month || "") ? didactics.month : String(didactics?.events?.[0]?.date || "").slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Couldn't tell which month the schedule is for.");
      const auto = (await st.getJSON("mail-didactics")) || { months: {} };
      let saved = false;
      await withDataset(st, (d) => {
        if (d.didactics?.[month] && !auto.months[month]) return NO_CHANGE; // an admin's own copy
        setDidactics(d, month, didactics, { hasPdf: true });
        saved = true;
        return true;
      });
      if (saved) {
        await st.setBytes(`didactics-pdf/${month}`, pdf.data, "application/pdf");
        await st.setJSON("mail-didactics", { months: { ...auto.months, [month]: id } });
      }
      line = saved ? `Conference schedule saved for ${month} (${didactics.events?.length || 0} sessions)` : `Conference schedule for ${month} not used: an admin already saved that month`;
    } else {
      const events = (await readEvents(mail)).map((e) => cleanEvent(e, mail)).filter(Boolean);
      if (events.length) await withDataset(st, (d) => (upsertEvents(d, events, today) ? true : NO_CHANGE));
      line = events.length ? `Events: ${events.map((e) => `${e.title} (${e.date})`).join("; ")}` : "No events in it";
    }
  } catch (err) {
    console.error(err);
    line = `Couldn't read it: ${err?.message || err}`;
  }
  await noteMail(st, id, line);
  await st.delete(`mailq/${id}`);
  await st.delete(`mailq/${id}.pdf`);
  return line;
}

export default async function handler(req) {
  if (req.method !== "POST" || !isMailToken(req.headers.get("x-mail-token"))) return new Response("Forbidden", { status: 403 });
  const { id } = await req.json().catch(() => ({}));
  if (!/^[\w-]{6,64}$/.test(id || "")) return new Response("Bad id", { status: 400 });
  await readQueuedMail(openStore(), id);
  return new Response(null, { status: 202 });
}

export const config = { background: true, path: "/bg/read-mail" };
