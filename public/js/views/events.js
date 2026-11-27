// Program events (More › Events): the holiday party, grand rounds, a review conference... read
// from the program office's emails (lib/mail-intake.js). Today shows the next ones too.
import { h, icon, card, emptyState, openSheet, closeSheet, toast, safely } from "../ui.js";
import { addDays, diffDays, fmtDate, fmtMonth, fmtTime, monthKey, relDay } from "../../core/dates.js";
import { eventPicture } from "../../core/decor.js";
import { rsvpFor, rsvpsDue, leftWord } from "../../core/rsvp.js";
import { rsvpDone, markRsvp } from "../me.js";

const KIND = { social: "Social", lecture: "Lecture", didactic: "Didactics", conference: "Conference", deadline: "Deadline", meeting: "Meeting", other: "Event" };
const minutes = (t) => { const [hh, mm] = String(t).split(":").map(Number); return hh * 60 + (mm || 0); };
export const eventTime = (e) => (e.start ? `${fmtTime(minutes(e.start))}${e.end ? `–${fmtTime(minutes(e.end))}` : ""}` : "All day");

export function openEventSheet(ctx, e) {
  const { today } = ctx.state;
  openSheet(e.title, h("div", { class: "card-pad" },
    h("p", { style: { margin: "0 0 6px", fontWeight: 650 } }, `${fmtDate(e.date, "long")} · ${eventTime(e)}`),
    e.place ? h("p", { class: "small", style: { margin: "0 0 6px" } }, e.place) : null,
    e.who ? h("p", { class: "small", style: { margin: "0 0 6px" } }, h("b", null, "For "), e.who) : null,
    e.note ? h("p", { class: "small muted", style: { margin: "0 0 10px" } }, e.note) : null,
    rsvpLine(ctx, e),
    h("div", { class: "btnrow" },
      e.link ? h("a", { class: "btn sm primary", href: e.link, target: "_blank", rel: "noopener" }, icon(/zoom/i.test(e.link) ? "video" : "link"), /zoom/i.test(e.link) ? "Join Zoom" : "Open the link") : null,
      e.rsvpLink && e.rsvpLink !== e.link ? h("a", { class: "btn sm", href: e.rsvpLink, target: "_blank", rel: "noopener" }, icon("check"), "RSVP") : null,
      replyButton(ctx, e)),
    h("p", { class: "tiny muted", style: { margin: "12px 0 0" } }, `From ${e.from || "the program office"}'s email${e.subject ? `: “${e.subject}”` : ""}. It's in your calendar feed too.`)));
}

// The RSVP, as the event sheet says it: by when (or that a reply is asked for), and whether you have.
function rsvpLine(ctx, e) {
  const { today, me } = ctx.state;
  const r = rsvpFor(e, today);
  if (!r) return null;
  const done = me && rsvpDone(me).has(e.id);
  const text = done ? "You've replied." : r.passed ? `Replies closed ${fmtDate(r.by, "long")}.`
    : r.implied ? `This asks for a reply. Best by ${fmtDate(r.by, "long")} (${leftWord(r.left)}).` : `RSVP by ${fmtDate(r.by, "long")} (${leftWord(r.left)}).`;
  return h("p", { class: "small", style: { margin: "0 0 10px", color: done || r.passed ? "var(--muted)" : "var(--warn)", fontWeight: 600 } }, text);
}

// "I've replied" (or undo it): the reminders for it stop, here and on the lock screen.
export function replyButton(ctx, e, { label = "I've replied" } = {}) {
  const { today, me } = ctx.state;
  const r = rsvpFor(e, today);
  if (!me || !r || r.passed) return null;
  const done = rsvpDone(me).has(e.id);
  return h("button", { class: `btn sm${done ? " ghost" : ""}`, onclick: safely(async (ev) => {
    ev.stopPropagation();
    await markRsvp(me, e.id, !done);
    toast(done ? "Marked as not replied" : "Got it: no more reminders for this one");
    closeSheet();
    ctx.render();
  }) }, icon(done ? "x" : "check"), done ? "Undo replied" : label);
}

function eventRow(ctx, e) {
  const { today } = ctx.state;
  const r = rsvpFor(e, today);
  const replied = r && ctx.state.me && rsvpDone(ctx.state.me).has(e.id);
  const rsvpWord = !r ? "" : replied ? "Replied" : r.passed ? "RSVP closed" : r.implied ? `Reply by ${fmtDate(r.by, "md")}` : `RSVP by ${fmtDate(r.by, "md")}`;
  return h("li", { class: "row tap", onclick: () => openEventSheet(ctx, e) },
    h("div", { style: { width: "64px", flex: "none" } },
      h("div", { style: { fontWeight: 700, fontSize: "13px" } }, diffDays(today, e.date) < 7 ? relDay(e.date, today) : fmtDate(e.date, "md")),
      h("div", { class: "tiny muted" }, eventTime(e))),
    h("div", { class: "main" },
      h("div", { class: "name" }, eventPicture(e) ? h("span", { class: "decor-icon", "aria-hidden": "true" }, eventPicture(e)) : null, e.title),
      h("div", { class: "sub" }, [e.who ? `For ${e.who}` : "", e.place, KIND[e.kind]].filter(Boolean).join(" · ")),
      rsvpWord ? h("span", { class: `pill rsvp${replied ? " done" : r.passed ? " closed" : ""}` }, rsvpWord) : null),
    icon("right"));
}

export function renderEvents(ctx, arg) {
  const { model, state } = ctx;
  const root = h("div");
  const ahead = model.events(state.today);
  // An RSVP alert opens its event.
  if (arg) {
    const e = ahead.find((x) => x.id === arg);
    history.replaceState(null, "", "#/events");
    if (e) setTimeout(() => openEventSheet(ctx, e));
  }
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

// Today: an event today or tomorrow. (Replies owed have their own card, rsvpTodayCard.)
export function eventsTodayCard(ctx) {
  const { model, state } = ctx;
  if (state.date !== state.today) return null;
  const soon = model.events(state.today, addDays(state.today, 1), state.me);
  if (!soon.length) return null;
  return card("Events", h("ul", { class: "list" }, soon.map((e) => eventRow(ctx, e))), { pad: false, right: h("a", { href: "#/events" }, "All ›") });
}

// The replies you still owe, within a week of their deadline: near the top of Today, with the
// RSVP link and "I've replied", until you've said you have.
export function rsvpTodayCard(ctx) {
  const { model, state } = ctx;
  if (state.date !== state.today || !state.me) return null;
  const due = rsvpsDue(model.events(state.today, addDays(state.today, 120), state.me), state.today, { done: rsvpDone(state.me) });
  if (!due.length) return null;
  return h("section", { class: "card card-pad reminder rsvp-card" },
    h("div", { class: "avatar", style: { "--c": due[0].r.left <= 1 ? "var(--warn)" : "var(--accent)" } }, icon("event")),
    h("div", { class: "main" }, due.slice(0, 2).map(({ e, r }) => h("div", { class: "rsvp-item" },
      h("div", { class: "name" }, eventPicture(e) ? h("span", { class: "decor-icon", "aria-hidden": "true" }, eventPicture(e)) : null, `RSVP for ${e.title}`),
      h("div", { class: "small muted" }, [r.left <= 0 ? (r.implied ? "Best to reply today" : "Last day to reply") : `${r.implied ? "Best to reply" : "Due"} ${r.left === 1 ? "tomorrow" : `by ${fmtDate(r.by)}, ${leftWord(r.left)}`}`, `the event is ${fmtDate(e.date)}`].join(" · ")),
      h("div", { class: "btnrow" },
        r.link ? h("a", { class: "btn sm primary", href: r.link, target: "_blank", rel: "noopener" }, icon("check"), "RSVP") : h("button", { class: "btn sm primary", onclick: () => openEventSheet(ctx, e) }, "See how"),
        replyButton(ctx, e)))),
      due.length > 2 ? h("a", { class: "small", href: "#/events" }, `${due.length - 2} more waiting for a reply ›`) : null));
}

// For More and the tab dot: replies owed within three days.
export const rsvpsSoon = (ctx) => (ctx.state.me ? rsvpsDue(ctx.model.events(ctx.state.today, addDays(ctx.state.today, 120), ctx.state.me), ctx.state.today, { done: rsvpDone(ctx.state.me), days: 3 }) : []);
