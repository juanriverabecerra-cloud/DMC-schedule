// Program events (More › Events): the holiday party, grand rounds, a review conference... read
// from the program office's emails (lib/mail-intake.js). Today shows the next ones too.
import { h, icon, card, emptyState, openSheet } from "../ui.js";
import { addDays, diffDays, fmtDate, fmtMonth, fmtTime, monthKey, relDay } from "../../core/dates.js";

const KIND = { social: "Social", lecture: "Lecture", didactic: "Didactics", conference: "Conference", deadline: "Deadline", meeting: "Meeting", other: "Event" };
const minutes = (t) => { const [hh, mm] = String(t).split(":").map(Number); return hh * 60 + (mm || 0); };
export const eventTime = (e) => (e.start ? `${fmtTime(minutes(e.start))}${e.end ? `–${fmtTime(minutes(e.end))}` : ""}` : "All day");
const whenWord = (e, today) => {
  const n = diffDays(today, e.date);
  return n <= 1 && n >= -1 ? relDay(e.date, today) : n > 0 ? `in ${n} days` : `${-n} days ago`;
};

export function openEventSheet(ctx, e) {
  const { today } = ctx.state;
  openSheet(e.title, h("div", { class: "card-pad" },
    h("p", { style: { margin: "0 0 6px", fontWeight: 650 } }, `${fmtDate(e.date, "long")} · ${eventTime(e)}`),
    e.place ? h("p", { class: "small", style: { margin: "0 0 6px" } }, e.place) : null,
    e.who ? h("p", { class: "small", style: { margin: "0 0 6px" } }, h("b", null, "For "), e.who) : null,
    e.note ? h("p", { class: "small muted", style: { margin: "0 0 10px" } }, e.note) : null,
    e.rsvpBy ? h("p", { class: "small", style: { margin: "0 0 10px", color: e.rsvpBy < today ? "var(--muted)" : "var(--warn)" } },
      h("b", null, "RSVP by "), `${fmtDate(e.rsvpBy, "long")}${e.rsvpBy >= today ? ` (${whenWord({ date: e.rsvpBy }, today)})` : " (passed)"}`) : null,
    h("div", { class: "btnrow" },
      e.link ? h("a", { class: "btn sm primary", href: e.link, target: "_blank", rel: "noopener" }, icon(/zoom/i.test(e.link) ? "video" : "link"), /zoom/i.test(e.link) ? "Join Zoom" : "Open the link") : null,
      e.rsvpLink && e.rsvpLink !== e.link ? h("a", { class: "btn sm", href: e.rsvpLink, target: "_blank", rel: "noopener" }, icon("check"), "RSVP") : null),
    h("p", { class: "tiny muted", style: { margin: "12px 0 0" } }, `From ${e.from || "the program office"}'s email${e.subject ? `: “${e.subject}”` : ""}. It's in your calendar feed too.`)));
}

function eventRow(ctx, e) {
  const { today } = ctx.state;
  return h("li", { class: "row tap", onclick: () => openEventSheet(ctx, e) },
    h("div", { style: { width: "64px", flex: "none" } },
      h("div", { style: { fontWeight: 700, fontSize: "13px" } }, diffDays(today, e.date) < 7 ? relDay(e.date, today) : fmtDate(e.date, "md")),
      h("div", { class: "tiny muted" }, eventTime(e))),
    h("div", { class: "main" },
      h("div", { class: "name" }, e.title),
      h("div", { class: "sub" }, [e.who ? `For ${e.who}` : "", e.place, KIND[e.kind], e.rsvpBy && e.rsvpBy >= today ? `RSVP by ${fmtDate(e.rsvpBy, "md")}` : ""].filter(Boolean).join(" · "))),
    icon("right"));
}

export function renderEvents(ctx) {
  const { model, state } = ctx;
  const root = h("div");
  const ahead = model.events(state.today);
  if (!ahead.length) {
    root.append(emptyState("event", "No events coming up", "Parties, lectures and conferences from the program office's emails show up here."));
    return root;
  }
  const byMonth = new Map();
  for (const e of ahead) { const m = monthKey(e.date); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(e); }
  for (const [m, list] of byMonth) root.append(card(fmtMonth(m), h("ul", { class: "list" }, list.map((e) => eventRow(ctx, e))), { pad: false }));
  root.append(h("p", { class: "disclaimer span-all" }, "Read from the program office's emails as they arrive. Times are Eastern."));
  return root;
}

// Today: an event today or tomorrow, or an RSVP due in the next three days.
export function eventsTodayCard(ctx) {
  const { model, state } = ctx;
  if (state.date !== state.today) return null;
  const soon = model.events(state.today, addDays(state.today, 1), state.me);
  const rsvp = model.events(state.today, undefined, state.me).filter((e) => e.rsvpBy && e.rsvpBy >= state.today && e.rsvpBy <= addDays(state.today, 3) && !soon.includes(e));
  if (!soon.length && !rsvp.length) return null;
  return card("Events", h("ul", { class: "list" },
    soon.map((e) => eventRow(ctx, e)),
    rsvp.map((e) => h("li", { class: "row tap", onclick: () => openEventSheet(ctx, e) },
      h("div", { class: "avatar", style: { "--c": "var(--warn)" } }, icon("event")),
      h("div", { class: "main" }, h("div", { class: "name" }, `RSVP for ${e.title}`), h("div", { class: "sub" }, `Due ${diffDays(state.today, e.rsvpBy) <= 1 ? relDay(e.rsvpBy, state.today).toLowerCase() : fmtDate(e.rsvpBy)}`)),
      icon("right")))), { pad: false, right: h("a", { href: "#/events" }, "All ›") });
}
