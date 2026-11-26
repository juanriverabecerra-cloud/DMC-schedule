import { h, icon, card, dayChips, personRow, notice, emptyState } from "../ui.js";
import { local } from "../api.js";
import { todayLayout } from "../../core/layout.js";
import { eventsTodayCard } from "./events.js";
import { fmtDate, addDays, startOfWeek, DOW_LETTER, parts, monthKey, addMonths, fmtMonth } from "../../core/dates.js";
import { headline } from "../../core/model.js";
import { SITES } from "../../core/codes.js";
import { weekHours, hoursReport } from "../../core/hours.js";
import { actualFor, hoursBasis } from "../logged.js";
import { dayGaps } from "../../core/gaps.js";
import { assignmentList, teammates, upcomingList, subscribeCard, openDaySheet, draftNote, postedLine, runnerCard, runnerName, tomorrowActions } from "./common.js";
import { didacticsDayCard } from "./didactics.js";
import { quickContacts, contactRow } from "./call.js";
import { installCard, reminderCard } from "./reminders.js";
import { swapsTodayCard } from "./requests.js";
import { inboxTodayCard } from "./inbox.js";
import { aheadItems } from "./exams.js";
import { calendarSubscribed } from "../me.js";
import { casesTodayCard, procedureShortcut } from "./cases.js";

function shortCode(d) {
  if (d.call === "NF") return "NF";
  if (d.call === "10-7") return "10–7";
  if (d.call === "H1") return "H1";
  if (d.call === "H2") return "H2";
  if (d.status === "vacation") return "Vac";
  if (d.status === "postcall") return "PC";
  if (d.status === "holiday") return "Hol";
  if (d.status === "off") return "Off";
  if (d.status === "work") return d.code || d.raw || "•";
  return "";
}

function markColor(d) {
  if (d.call === "NF") return "var(--night)";
  if (d.call === "H1" || d.call === "24") return "var(--call24)";
  if (d.call === "H2") return "var(--call12)";
  if (d.call === "10-7") return "var(--senior)";
  if (d.late) return "var(--late)";
  if (d.status === "vacation") return "var(--vac)";
  return "transparent";
}

export function weekStrip(ctx, pid) {
  const { model, state } = ctx;
  const ws = startOfWeek(state.date);
  return h("div", { class: "week" }, Array.from({ length: 7 }, (_, i) => {
    const date = addDays(ws, i);
    const d = model.day(pid, date);
    return h("button", {
      class: `wday${date === state.date ? " sel" : ""}${date === state.today ? " today" : ""}`,
      vars: { "--c": markColor(d) },
      "aria-label": `${fmtDate(date, "long")}: ${headline(d)}`,
      onclick: () => ctx.setDate(date),
    }, h("span", { class: "l" }, DOW_LETTER[i]), h("span", { class: "d" }, parts(date).d), h("span", { class: "c" }, shortCode(d)), h("i", { class: "bar" }));
  }));
}

export function hoursCard(ctx, pid) {
  const { model, state } = ctx;
  const actual = pid === state.me ? actualFor(model, pid) : null; // real hours are only ever your own
  const wk = weekHours(model, pid, state.date, { actual });
  if (!wk || !wk.known) return null;
  const pct = Math.min(100, (wk.hours / 90) * 100);
  const color = wk.hours > 80 ? "var(--gap)" : wk.hours > 70 ? "var(--warn)" : "var(--accent)";
  const rep = hoursReport(model, pid, startOfWeek(state.date), addDays(startOfWeek(state.date), 6), { actual });
  const flags = rep.flags.filter((f) => f.level !== "info");
  return h("section", { class: "card card-pad", onclick: () => ctx.go("hours"), style: { cursor: "pointer" } },
    h("h3", { class: "card-title" }, "Duty hours this week", h("span", { class: "right muted" }, hoursBasis(actual, wk))),
    h("div", { class: "bignum" }, Math.round(wk.hours), h("small", null, "h of 80")),
    h("div", { class: "meter", style: { marginTop: "8px" } }, h("i", { style: { width: `${pct}%`, background: color } }), h("span", { class: "limit", style: { left: `${(80 / 90) * 100}%` } })),
    h("div", { class: "stats" },
      h("div", { class: "stat" }, h("b", null, wk.avg4 !== null ? Math.round(wk.avg4) : "—"), h("span", null, "4-wk avg")),
      h("div", { class: "stat" }, h("b", null, wk.daysOff), h("span", null, "days off")),
      h("div", { class: "stat" }, h("b", null, flags.length || "None"), h("span", null, "alerts"))),
    flags.length ? h("div", { class: "chips", style: { marginTop: "10px" } }, flags.slice(0, 2).map((f) => h("span", { class: `chip ${f.level}` }, f.text))) : null,
  );
}

function tonightMini(ctx, { runner = true } = {}) {
  const t = ctx.model.tonight(ctx.state.date);
  const names = (list) => list.map((d) => ctx.model.person(d.pid)?.last || ctx.model.name(d.pid)).join(", ");
  const rows = [
    ["late", "Late till 6p", t.late],
    ["senior", "10a–7p", t.senior],
    ["night", "Night float", t.night],
    ["call24", "24-hr call", t.call24],
    ["call12", "12-hr call", t.call12],
    ["cardiac", "Cardiac call", t.cardiac],
  ].filter(([, , list]) => list.length).map(([cls, label, list]) => [cls, label, names(list)]);
  // Who's running the board, unless Today already shows them in their own card.
  if (runner && t.runner?.mda) rows.unshift(["info", "Board runner", runnerName(ctx.model, t.runner)]);
  // Attendings on call tonight, from the daily sheet's egress list.
  for (const a of t.mdaCall) rows.push(["info", `MDA ${a.label.replace(/ call$/, "")}`, a.name]);
  if (!rows.length) return null;
  return h("section", { class: "card card-pad", onclick: () => ctx.go("tonight"), style: { cursor: "pointer" } },
    h("h3", { class: "card-title" }, "Who's on", h("span", { class: "right" }, "See all ›")),
    h("div", { class: "stack" }, rows.map(([cls, label, who]) =>
      h("div", { style: { display: "flex", gap: "10px", alignItems: "center" } },
        h("span", { class: `chip ${cls}`, style: { minWidth: "104px", justifyContent: "center" } }, label),
        h("span", { class: "small", style: { fontWeight: 600 } }, who)))),
  );
}

export function renderToday(ctx) {
  const { model, state } = ctx;
  const root = h("div");
  if (!state.me || !model.person(state.me)) {
    root.append(
      installCard(ctx) || "",
      notice("", "user", "Choose who you are to see your own day. ", h("a", { href: "#/pick" }, "Pick yourself")),
      didacticsDayCard(ctx) || "",
      tonightMini(ctx) || emptyState("calendar", "No schedule for this day", "Upload a call sheet in Admin."),
    );
    return root;
  }
  const pid = state.me;
  const d = model.day(pid, state.date);
  const p = model.person(pid);
  // Admins: a sick call or this week's swaps, before anything else.
  const requests = state.date === state.today ? inboxTodayCard(ctx) : null;
  if (requests) root.append(requests);
  // One card at a time: getting onto the Home Screen comes first, since alerts depend on it.
  const reminder = installCard(ctx) || reminderCard(ctx);
  if (reminder) root.append(reminder);
  // Swaps waiting on you come before your own day: someone's waiting on an answer.
  const swapNews = state.date === state.today ? swapsTodayCard(ctx) : null;
  if (swapNews) root.append(swapNews);

  if (!model.hasCall(state.date) && d.source !== "intern") {
    root.append(notice("warn", "info", `The ${fmtMonth(monthKey(state.date))} call sheet hasn't been uploaded yet${d.rotation ? `. Planned rotation: ${d.rotation}.` : "."}`));
  }

  const draft = draftNote(ctx, state.date);
  if (draft) root.append(draft);

  // Everything else is in the order the resident chose (Arrange, under More); each piece only
  // shows when it has something.
  const { order, hidden } = todayLayout(local.get("todayLayout"));
  const tomorrow = addDays(state.today, 1);
  const mates = teammates(ctx, d);
  let runnerShown = false;
  const sections = {
    day: () => {
      const site = SITES[d.site]?.name;
      const sub = [d.roles.length ? d.rotation || d.label : (d.rotation && d.rotation !== d.label ? d.rotation : ""), site].filter(Boolean).join(" · ");
      return h("section", { class: "card hero", vars: { "--rot": d.color }, onclick: () => openDaySheet(ctx, pid, state.date), style: { cursor: "pointer" } },
        h("div", { class: "eyebrow" }, `${fmtDate(state.date, "long")}`),
        h("h2", null, headline(d)),
        sub ? h("div", { class: "subtitle" }, sub) : null,
        h("div", { class: "chips" }, dayChips(d)),
        d.late ? h("p", { class: "small muted", style: { margin: "10px 0 0" } }, "You're the late resident: finish at your site, then help at Harper until 6p.") : null,
        d.call === "24" ? h("p", { class: "small muted", style: { margin: "10px 0 0" } }, "24-hour call tonight (6a–6a), same as H1.") : null,
        d.code === "11-9" && !d.call ? h("p", { class: "small muted", style: { margin: "10px 0 0" } }, "11 to 9 rotation: OB at Hutzel, Monday to Friday, 11a–9p.") : null,
      );
    },
    or: () => {
      const rooms = assignmentList(ctx, d);
      if (rooms.length) return card(state.date === tomorrow ? "Tomorrow's OR sheet" : "OR sheet", h("ul", { class: "list" }, rooms), { pad: false });
      if (state.date === tomorrow && !model.daily(tomorrow) && d.status === "work" && ["harper", "opsc", "hutzel"].includes(d.site)) {
        return h("p", { class: "disclaimer", style: { margin: "-4px 4px 12px" } }, "Tomorrow's room assignments usually come out this evening.");
      }
      return null;
    },
    // On a day at the main OR or OPSC, or on call: who's running the board, one tap to call.
    // Not for night float, who starts at 6p, after the day's board runner.
    runner: () => {
      const relevant = d.status === "work" && d.call !== "NF" && (d.roles.length || ["harper", "opsc"].includes(d.site) || d.call || d.late);
      const el = relevant ? runnerCard(ctx, state.date) : null;
      runnerShown = !!el;
      return el;
    },
    // After an OR day: the day's cases, already laid out from the sheet, one tap away.
    cases: () => [casesTodayCard(ctx), procedureShortcut(ctx)],
    // The sheet is posted the evening before: surface tomorrow's assignment while looking at today.
    tomorrow: () => {
      if (state.date !== state.today || !model.daily(tomorrow)) return null;
      const t = model.day(pid, tomorrow);
      if (!t.roles.length) return null;
      const first = t.roles.find((r) => r.room || r.rooms);
      const room = first?.room || first?.rooms?.[0];
      return h("section", { class: "card hero", vars: { "--rot": t.color }, onclick: () => ctx.setDate(tomorrow), style: { cursor: "pointer" } },
        h("div", { class: "eyebrow" }, `Tomorrow · ${fmtDate(tomorrow, "long")}`),
        h("h2", { style: { fontSize: "20px" } }, headline(t)),
        room ? h("div", { class: "subtitle" }, [room.time ? `Starts ${room.time}` : "", room.mda ? `MDA ${room.mda}` : "", room.cases ? `${room.cases} case${room.cases === "1" ? "" : "s"}` : ""].filter(Boolean).join(" · ")) : null,
        h("div", { class: "chips" }, dayChips(t, { withTime: false })),
        tomorrowActions(ctx, pid, tomorrow, first),
        // Whether tomorrow's sheet is out yet, and since when.
        model.ds.daily[tomorrow]?.draft ? h("p", { class: "small muted", style: { margin: "10px 0 0" } }, "Still being finalized: rooms can change.")
          : postedLine(ctx, tomorrow, "Posted") ? h("p", { class: "small muted", style: { margin: "10px 0 0" } }, ...postedLine(ctx, tomorrow, "Posted")) : null);
    },
    didactics: () => didacticsDayCard(ctx),
    events: () => eventsTodayCard(ctx),
    team: () => (mates.length ? card("Working with", h("ul", { class: "list" }, mates.map((m) => personRow(ctx, model.day(m.id, state.date), { sub: m.why, chips: false }))), { pad: false }) : null),
    quick: () => {
      const quick = quickContacts(ctx, pid, state.date).filter((x) => !mates.some((m) => `res:${m.id}` === x.key) && !(runnerShown && /board runner/i.test(x.title))).slice(0, 5);
      return quick.length ? card("Quick call", h("ul", { class: "list" }, quick.map((x) => contactRow(ctx, x))), { pad: false, right: h("a", { href: "#/call" }, "All numbers ›") }) : null;
    },
    tonight: () => tonightMini(ctx, { runner: !runnerShown }),
    week: () => card("This week", weekStrip(ctx, pid), { pad: false }),
    gaps: () => {
      const gaps = dayGaps(model, state.date).filter((g) => g.level === "gap" && (g.people || []).length === 0);
      return gaps.length && p.cls !== "PGY-1" ? notice("gap", "alert", h("b", null, "Coverage gap: "), gaps.map((g) => g.title).join("; "), " ", h("a", { href: "#/gaps" }, "Details")) : null;
    },
    hours: () => hoursCard(ctx, pid),
    // Shifts, events, the next golden weekend and exam: one list. The week strip already shows
    // this week's shifts, so the list picks up after it when the strip is on.
    coming: () => card("Coming up", upcomingList(ctx, pid, state.date, {
      extra: state.date === state.today ? aheadItems(ctx, pid) : [],
      after: hidden.includes("week") ? "" : addDays(startOfWeek(state.date), 6),
    }), { pad: false }),
    next: () => {
      const next = addMonths(monthKey(state.date), 1);
      const nextRot = model.rotationFor(pid, next);
      return nextRot ? h("section", { class: "card card-pad" },
        h("h3", { class: "card-title" }, `Next month · ${fmtMonth(next)}`),
        h("div", { style: { display: "flex", alignItems: "center", gap: "10px" } },
          h("span", { class: "dotc", vars: { "--c": model.day(pid, `${next}-15`).color } }),
          h("b", null, nextRot))) : null;
    },
    // Until their calendar app has read the feed once; after that it's under More and My schedule.
    calendar: () => (calendarSubscribed(pid) ? null : subscribeCard(ctx, pid)),
  };
  for (const key of order) {
    if (hidden.includes(key)) continue;
    for (const el of [sections[key]?.()].flat()) if (el) root.append(el);
  }
  root.append(h("div", { class: "arrange-link span-all" }, h("a", { href: "#/layout" }, icon("arrange"), "Arrange this screen")));
  return root;
}
