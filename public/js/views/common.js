// Pieces shared by several screens: OR assignment details, the day sheet, upcoming events,
// and the calendar subscription card.
import { h, icon, card, dayChips, personRow, openSheet, copyText, toast, notice, callChip, numberButtons, smsHref } from "../ui.js";
import { fmtDate, addDays, relDay, monthKey, fmtMonth, diffDays, dow, DOW_SHORT, fmtTime, nowMinutesLocal, todayLocal } from "../../core/dates.js";
import { headline } from "../../core/model.js";
import { openEventSheet } from "./events.js";
import { SITES } from "../../core/codes.js";
import { cleanAttending, inCharge, mdaNames, mdaText, spotOf, SPOTS } from "../../core/attendings.js";
import { isMobile } from "../../core/directory.js";
import { eventPicture, holidayOf } from "../../core/decor.js";
import { swapCandidates, swappableShift } from "../../core/swap.js";
import { api, local } from "../api.js";
import { meStatus } from "../me.js";

// Techs change rooms every day, so no tech belongs to an OR: any room reaches the whole list.
// The one you called today stays on top, since they're likely covering your area.
export function openTechSheet(ctx) {
  const { model, state } = ctx;
  const techs = model.dir.techs();
  const saved = local.get("lastTech");
  const recent = saved?.date === state.today ? saved.id : null;
  const list = [...techs].sort((a, b) => (b.id === recent) - (a.id === recent));
  const rows = list.map((t) => {
    const row = h("li", { class: "row" },
      h("div", { class: "avatar", style: { "--c": "var(--accent)" } }, t.name[0]),
      h("div", { class: "main" },
        h("div", { class: "name" }, h("span", { class: "n" }, t.name)),
        t.id === recent ? h("div", { class: "sub" }, "You called earlier today") : null),
      h("div", { class: "numrow", style: { marginTop: 0, flex: "none" } }, numberButtons(model.dir, t.numbers)));
    // Capture: the call button stops the click from reaching the row.
    row.addEventListener("click", (e) => { if (e.target.closest("a.numbtn")) local.set("lastTech", { date: state.today, id: t.id }); }, true);
    return row;
  });
  openSheet("Anesthesia techs", h("div", null,
    h("p", { class: "small muted", style: { margin: "0 0 8px" } }, "Techs change rooms every day, so call whoever's free."),
    h("ul", { class: "list" }, rows)));
}

export const techChip = (ctx, label = "Tech") => h("button", {
  class: "numbtn", type: "button", "aria-label": "Anesthesia techs", onclick: (e) => { e.stopPropagation(); openTechSheet(ctx); },
}, icon("phone"), label);

// Call chips under an OR row: the room phone, its MDA, a tech and the residents in it.
export function roomCallChips(ctx, room, { residents = false } = {}) {
  const { model } = ctx;
  const dir = model.dir;
  const chips = [];
  const rm = dir.room(room.or);
  if (rm) chips.push(callChip(dir, `OR ${room.or}`, rm.numbers));
  for (const part of String(room.mda || "").split("/")) {
    const s = dir.staff(part);
    if (s) chips.push(callChip(dir, s.last || s.name, s.numbers));
  }
  if (dir.techs().length) chips.push(techChip(ctx));
  if (residents) {
    for (const x of room.staffIds || []) {
      const r = x.id && dir.resident(x.id);
      if (r) chips.push(callChip(dir, model.person(x.id).last, r.numbers));
    }
  }
  const list = chips.filter(Boolean);
  return list.length ? h("div", { class: "callchips" }, list) : null;
}

// A room in one line, the MDA first: they're who the day is spent with. The surgeon follows.
export function roomSummary(room) {
  return [mdaText(room.mda) ? `MDA ${mdaText(room.mda)}` : "", room.surgeon ? `Surgeon ${room.surgeon}` : "", room.time, room.cases ? `${room.cases} case${room.cases === "1" ? "" : "s"}` : ""].filter(Boolean).join(" · ");
}

function staffLine(ctx, room) {
  if (room.crna) return "CRNA";
  return room.staffIds.map((s) => (s.id ? ctx.model.name(s.id) : s.name)).join(" & ") || "—";
}

// Rooms and roles from the daily OR sheet for one resident-day.
export function assignmentList(ctx, d) {
  const { model } = ctx;
  const items = [];
  const roomRow = (room, extra) => h("li", { class: "row" },
    h("div", { class: "avatar", style: { borderRadius: "12px", "--c": "var(--accent)" } }, room.or),
    h("div", { class: "main" },
      // The MDA names the row; the surgeon is one of the room's details.
      h("div", { class: "name" }, h("span", { class: "n" }, mdaText(room.mda) ? `MDA ${mdaText(room.mda)}` : `OR ${room.or}`), room.time ? h("span", { class: "pill" }, room.time) : null),
      h("div", { class: "roomline" }, [
        room.surgeon ? h("span", null, "Surgeon ", h("b", null, room.surgeon)) : null,
        room.cases ? `${room.cases} case${room.cases === "1" ? "" : "s"}` : null,
        h("span", null, room.crna ? "CRNA room" : h("b", null, staffLine(ctx, room))),
        room.ja ? h("span", null, "JA ", h("b", null, room.jaIds.map((s) => (s.id ? model.name(s.id) : s.name)).join(", "))) : null,
        room.breaks ? h("span", null, "Breaks ", h("b", null, room.breakIds.map((s) => (s.id ? model.name(s.id) : s.name)).join(", "))) : null,
      ].filter(Boolean).flatMap((x, i) => (i ? [" · ", x] : [x]))),
      extra ? h("div", { class: "tiny muted", style: { marginTop: "2px" } }, extra) : null,
      roomCallChips(ctx, room),
    ),
  );
  for (const r of d.roles) {
    if (r.kind === "room") items.push(roomRow(r.room));
    if (r.kind === "breaks") for (const room of r.rooms) items.push(roomRow(room, d.alsoBreaks ? "Also giving breaks here" : "You give breaks here"));
    if (r.kind === "ja") for (const room of r.rooms) items.push(roomRow(room, "You're the junior attending"));
    if (r.kind === "opsc" && !spotOf(d)) items.push(h("li", { class: "row" }, h("div", { class: "main" }, h("div", { class: "name" }, `OPSC${r.roomCount ? ` · ${r.roomCount} rooms` : ""}`), r.mdas?.length ? h("div", { class: "sub" }, `MDAs: ${r.mdas.join(", ")}`) : null)));
    if (r.kind === "ob") items.push(h("li", { class: "row" }, h("div", { class: "main" }, h("div", { class: "name" }, "OB @ Hutzel"), r.mda ? h("div", { class: "sub" }, `MDA: ${r.mda}`) : null)));
    if (r.kind === "pat") {
      const pat = model.dir.place(/^pat clinic/i);
      items.push(h("li", { class: "row" }, h("div", { class: "main" }, h("div", { class: "name" }, "PAT clinic"),
        d.alsoBreaks ? h("div", { class: "sub" }, "Your post today; you're also pulled for breaks below") : null,
        pat ? h("div", { class: "callchips" }, callChip(model.dir, "PAT clinic", pat.numbers)) : null)));
    }
    if (r.kind === "night") items.push(h("li", { class: "row" }, h("div", { class: "main" }, h("div", { class: "name" }, "Night coverage"))));
    // Cath lab, EP lab, CT...: the place, its MDA (with their numbers) and who else is there.
    if (r.kind === "proc") {
      const p = r.proc;
      const others = [...p.staffIds, ...p.jaIds].filter((s) => s.id !== d.pid).map((s) => (s.id ? model.name(s.id) : s.name));
      items.push(h("li", { class: "row" },
        h("div", { class: "avatar", style: { borderRadius: "12px", "--c": "var(--accent)" } }, icon("heart")),
        h("div", { class: "main" },
          h("div", { class: "name" }, h("span", { class: "n" }, p.name), p.count && p.count !== "0" ? h("span", { class: "pill" }, `${p.count} case${p.count === "1" ? "" : "s"}`) : null),
          h("div", { class: "roomline" }, [
            r.asJa ? "You're the JA" : null,
            p.mda ? h("span", null, "MDA ", h("b", null, p.mda)) : null,
            others.length ? h("span", null, "With ", h("b", null, others.join(", "))) : null,
          ].filter(Boolean).flatMap((x, i) => (i ? [" · ", x] : [x]))),
          mdaChips(ctx, p.mda))));
    }
    // Where the board runner's list puts them when no room or block does (NORA, cath lab...). The
    // PACU, OPSC and the VA get their own card instead (spotCard).
    if (r.kind === "where" && !spotOf(d)) {
      items.push(h("li", { class: "row" },
        h("div", { class: "main" },
          h("div", { class: "name" }, r.where),
          h("div", { class: "sub" }, [r.mda ? `MDA ${r.mda}` : "", "From the board runner's list"].filter(Boolean).join(" · ")),
          mdaChips(ctx, r.mda))));
    }
  }
  // The Late/Call column, when the call sheet doesn't already say so.
  if (d.sheetCall && !d.late && !d.call) {
    items.push(h("li", { class: "row" }, h("div", { class: "main" }, h("div", { class: "name" }, d.sheetCall), h("div", { class: "sub" }, "Late/Call on today's sheet"))));
  }
  // Notes at the bottom of the sheet that mention them.
  for (const text of d.sheetNotes || []) {
    items.push(h("li", { class: "row" }, h("div", { class: "avatar", style: { "--c": "var(--warn)" } }, icon("info")),
      h("div", { class: "main" }, h("div", { class: "sub" }, "Note on the sheet"), h("div", { class: "name", style: { fontWeight: 550 } }, text))));
  }
  return items;
}

// Call buttons for an MDA named on the sheet, from the directory ("Rivers" or "Lakeside/ Hill").
export function mdaChips(ctx, names) {
  const { model } = ctx;
  const chips = String(names || "").split("/").map((n) => n.replace(/\([^)]*\)/g, "").trim()).filter(Boolean)
    .map((n) => ({ n, staff: model.dir.staff(n) })).filter((x) => x.staff?.numbers?.length)
    .map((x) => callChip(model.dir, `MDA ${x.n}`, x.staff.numbers));
  return chips.length ? h("div", { class: "callchips" }, chips) : null;
}

// The evening before: text or call your attending (residents usually check in about the plan),
// and the room's full details. A text comes already started; nothing is sent until they send it.
export function tomorrowActions(ctx, pid, date, role) {
  const { model } = ctx;
  const dir = model.dir;
  const room = role?.room || role?.rooms?.[0];
  if (!room) return null;
  const me = model.person(pid);
  const first = me?.preferred || me?.first || "";
  const pills = [];
  if (role.kind === "room") {
    for (const part of String(room.mda || "").split("/")) {
      const s = dir.staff(part);
      if (!s) continue;
      const last = s.last || s.name;
      const mobile = (s.numbers || []).find(isMobile);
      const dial = mobile ? dir.dial(mobile) : null;
      const message = `Hi Dr. ${last}, it's ${first}. I'm your resident in OR ${room.or} tomorrow${room.time ? ` (${room.time} start)` : ""}.`;
      if (dial) pills.push(h("a", { class: "numbtn", href: smsHref(dial, message), onclick: (e) => e.stopPropagation() }, icon("message"), `Text ${last}`));
      const call = callChip(dir, `Call ${last}`, s.numbers);
      if (call) pills.push(call);
    }
  }
  pills.push(h("button", { class: "numbtn", type: "button", onclick: (e) => { e.stopPropagation(); openDaySheet(ctx, pid, date); } }, icon("info"), `OR ${room.or} details`));
  return h("div", { class: "callchips", style: { marginTop: "10px" } }, pills);
}

// Residents this person works with today, from the daily sheet.
export function teammates(ctx, d) {
  const ids = new Map();
  const add = (id, why) => { if (id && id !== d.pid && !ids.has(id)) ids.set(id, why); };
  for (const r of d.roles) {
    if (r.kind === "room") {
      r.with.forEach((s) => add(s.id, `In OR ${r.or} with you`));
      r.room.jaIds.forEach((s) => add(s.id, `JA for OR ${r.or}`));
      r.room.breakIds.forEach((s) => add(s.id, `Breaks for OR ${r.or}`));
    }
    if (r.kind === "breaks" || r.kind === "ja") {
      for (const room of r.rooms) {
        room.staffIds.forEach((s) => add(s.id, `In OR ${room.or}`));
        if (r.kind === "breaks") room.jaIds.forEach((s) => add(s.id, `JA for OR ${room.or}`));
        if (r.kind === "ja") room.breakIds.forEach((s) => add(s.id, `Breaks for OR ${room.or}`));
      }
    }
  }
  return [...ids].map(([id, why]) => ({ id, why }));
}

// Notable things coming up for a resident (calls, late days, nights, vacation, rotation changes).
export function upcoming(model, pid, from, days = 45, max = 7) {
  const out = [];
  let prevRot = model.rotationFor(pid, monthKey(from));
  let run = null;
  const flush = () => { if (run) { out.push(run); run = null; } };
  for (let i = 1; i <= days && out.length < max; i++) {
    const date = addDays(from, i);
    const d = model.day(pid, date);
    const rot = model.rotationFor(pid, monthKey(date));
    if (date.endsWith("-01") && rot && rot !== prevRot) { flush(); out.push({ date, kind: "rot", label: `Starts ${rot}`, sub: fmtMonth(monthKey(date)) }); }
    prevRot = rot;
    let kind = null, label = null;
    if (d.call === "NF") { kind = "night"; label = "Night float"; }
    else if (d.call === "10-7") { kind = "senior"; label = "CA-3 10p–7a"; }
    else if (d.status === "vacation") { kind = "vac"; label = "Vacation"; }
    else if (d.call === "H1" || d.call === "24") { kind = "call24"; label = d.call === "H1" ? "H1 · 24-hr call" : "24-hr call"; }
    else if (d.call === "H2") { kind = "call12"; label = "H2 · 12-hr call"; }
    else if (d.late) { kind = "late"; label = "Late till 6p"; }
    else if (d.status === "postcall") { kind = "pc"; label = "Post-call"; }
    else if (d.status === "holiday") { kind = "pc"; label = "Holiday (CRNA coverage)"; }
    const groupable = ["night", "senior", "vac"].includes(kind);
    if (groupable && run && run.kind === kind && addDays(run.end, 1) === date) { run.end = date; continue; }
    if (kind === "vac" && run?.kind === "vac" && diffDays(run.end, date) <= 3) { run.end = date; continue; }
    flush();
    if (!kind) continue;
    if (groupable) run = { date, end: date, kind, label };
    else out.push({ date, kind, label, sub: d.status === "work" && kind !== "call24" && kind !== "call12" ? headline(d) : "" });
  }
  flush();
  // Program events from the office's emails, in date order with the rest.
  const events = model.events(addDays(from, 1), addDays(from, days), pid).map((e) => ({ date: e.date, kind: "event", label: e.title, sub: [e.start ? fmtTime(Number(e.start.slice(0, 2)) * 60 + Number(e.start.slice(3))) : "", e.place].filter(Boolean).join(" · "), event: e }));
  return [...out, ...events].sort((a, b) => a.date.localeCompare(b.date)).slice(0, max);
}

// Today's "Coming up": shifts, rotation changes and program events, plus (from `extra`) the next
// golden weekend and exam, each once, in date order. `after` leaves out shifts through that day
// (the week strip above already shows them); events always show, since the strip doesn't.
export function upcomingList(ctx, pid, from, { extra = [], after = "" } = {}) {
  const { today } = ctx.state;
  // The extras always make the list, however far off: an exam months away is still worth a line.
  const near = upcoming(ctx.model, pid, from, 45, 10).filter((e) => e.kind === "event" || e.kind === "rot" || !after || e.date > after).slice(0, 7);
  const items = [...near, ...extra].sort((a, b) => a.date.localeCompare(b.date));
  if (!items.length) return h("p", { class: "muted small", style: { margin: "0 16px 14px" } }, "Nothing notable in the next few weeks of uploaded schedules.");
  const open = (e) => (e.event ? openEventSheet(ctx, e.event) : e.to ? ctx.go(e.to) : ctx.setDate(e.date));
  return h("ul", { class: "list" }, items.map((e) => h("li", { class: "row tap", onclick: () => open(e) },
    h("div", { style: { width: "64px", flex: "none" } },
      h("div", { style: { fontWeight: 700, fontSize: "13px" } }, diffDays(today, e.date) < 7 ? relDay(e.date, today) : DOW_SHORT[dow(e.date)]),
      h("div", { class: "tiny muted" }, fmtDate(e.date, "md"))),
    h("div", { class: "main" },
      // An event's title is a name, not a status: it gets its own line and wraps (two lines at
      // most) instead of a one-line chip that runs off the card.
      // A party or a meal gets its picture in place of the calendar icon; a holiday shows its own.
      e.kind === "event"
        ? h("div", { class: "evt" }, eventPicture(e.event) ? h("span", { class: "decor-icon", "aria-hidden": "true" }, eventPicture(e.event)) : icon("event"), h("span", null, e.label))
        : h("div", { class: "chips" }, h("span", { class: `chip ${e.kind === "rot" || e.kind === "exam" ? "info" : e.kind}` }, holidayOf(e.date) && e.kind === "pc" ? `${holidayOf(e.date).emoji} ` : "", e.label)),
      e.end && e.end !== e.date ? h("div", { class: "sub" }, `${fmtDate(e.date)} – ${fmtDate(e.end)}`) : e.sub ? h("div", { class: "sub" }, e.sub) : null),
    // How far off, for the things people count down to.
    e.countdown ? h("b", { class: "small countdown" }, e.countdown) : e.kind === "event" || e.to ? icon("right") : null,
  )));
}

// Who's running the board that day: the MDA from the Egress tab, the resident beside them, and
// one tap to the board runner's phones. Shown on Today (on an OR or call day), the Board and
// Tonight. Nothing when the day's sheet doesn't name them (a sheet read from a photo).
export function runnerName(model, runner) {
  if (!runner?.mda) return "";
  return model.dir.staff(runner.mda.name)?.name || runner.mda.name;
}
// The day's board runner (MDA, with the resident beside them) and the MDA on call tonight, each
// one tap from a call. `d`: the resident's day, so an OB resident sees OB's on-call MDA. `call`:
// false where the screen lists the on-call attendings itself (Tonight).
export function runnerCard(ctx, date, { when, span = false, d = null, call = true } = {}) {
  const { model } = ctx;
  const dl = model.daily(date);
  const who = inCharge(dl, d);
  const runner = dl?.runner;
  const onCall = call ? who?.call : null;
  if (!runner?.mda && !runner?.resident && !onCall) return null;
  const el = h("section", { class: `card runner${span ? " span-all" : ""}` },
    runner?.mda || runner?.resident ? runnerBlock(ctx, date, runner, when) : null,
    onCall ? callBlock(ctx, date, onCall, who.ob) : null);
  el.dataset.call = onCall ? "1" : "";
  return el;
}

function runnerBlock(ctx, date, runner, when) {
  const { model, state } = ctx;
  const dir = model.dir;
  const res = runner.resident;
  const resName = res ? (res.id ? model.name(res.id) : res.name) : "";
  const mdaPhone = dir.place(/^mda board runner/i);
  const resPhone = dir.place(/^resident board runner/i);
  const day = when ?? (date === state.today ? "today" : relDay(date, state.today).toLowerCase());
  const pills = [
    runner.mda && mdaPhone ? callChip(dir, "Board runner", mdaPhone.numbers) : null,
    resName && resPhone ? callChip(dir, "Resident BR", resPhone.numbers) : null,
  ].filter(Boolean);
  return h("div", { class: "runner-top" },
    h("div", { class: "avatar", style: { "--c": "var(--accent)" } }, icon("grid")),
    h("div", { class: "main" },
      h("div", { class: "eyebrow" }, `Board runner${day ? ` · ${day}` : ""}`),
      h("div", { class: "runner-name" }, runner.mda ? runnerName(model, runner) : resName),
      runner.mda && (resName || runner.mda.note) ? h("div", { class: "sub" }, [runner.mda.note, resName ? `Resident: ${resName}` : ""].filter(Boolean).join(" · ")) : null),
    pills.length ? h("div", { class: "runner-calls" }, pills) : null);
}

// The MDA on call that night (H1 for the main OR, OB 14 at Hutzel), with their own numbers.
function callBlock(ctx, date, a, ob) {
  const { model, state } = ctx;
  const dir = model.dir;
  const staff = dir.staff(a.name, { site: ob ? "hutzel" : "harper" });
  const night = date === state.today ? "tonight" : `${relDay(date, state.today).toLowerCase()} night`;
  const obLine = ob ? dir.place(/^mda ob$/i) : null;
  const pills = [
    ...(staff ? numberButtons(dir, staff.numbers) : []),
    obLine ? callChip(dir, "MDA OB", obLine.numbers) : null,
  ].filter(Boolean);
  return h("div", { class: "runner-top" },
    h("div", { class: "avatar", style: { "--c": "var(--call24)" } }, icon("moon")),
    h("div", { class: "main" },
      h("div", { class: "eyebrow" }, `${ob ? "OB MDA" : "MDA"} on call · ${night}`),
      h("div", { class: "runner-name" }, staff?.name || a.name),
      a.note ? h("div", { class: "sub" }, a.note) : null),
    pills.length ? h("div", { class: "runner-calls" }, pills) : null);
}

// A day the OR sheet doesn't place them by room (PACU, OPSC, the VA): what that means, and the
// people who matter instead: OPSC's MDAs, the VA's anesthesiologists, Harper's board runner and the
// MDA on call, and who else is there that day. Each with one tap to call.
export function spotCard(ctx, d, date) {
  const spot = spotOf(d);
  if (!spot) return null;
  const { model, state } = ctx;
  const dir = model.dir;
  const dl = model.daily(date);
  const info = SPOTS[spot];
  const rows = [];
  const person = (name, sub, numbers, { lead = false } = {}) => rows.push(h("li", { class: `row contact${lead ? " runner" : ""}` },
    h("div", { class: "avatar", style: lead ? { "--c": "var(--accent)" } : null }, name.replace(/^dr\.?\s+/i, "").slice(0, 2).toUpperCase()),
    h("div", { class: "main" },
      h("div", { class: "name" }, h("span", { class: "n" }, name)),
      sub ? h("div", { class: "sub" }, sub) : null,
      numbers?.length ? h("div", { class: "numrow" }, numberButtons(dir, numbers)) : null)));

  if (spot === "OPSC") {
    // The MDAs in OPSC's box on the sheet, and anyone the Egress tab puts in an OPSC slot.
    const names = [...(dl?.sheet?.opsc?.mdas || []).flatMap(mdaNames)];
    for (const a of dl?.attendings || []) if (a.kind === "site" && /opsc/i.test(a.where) && !names.includes(a.name)) names.push(a.name);
    const rooms = dl?.sheet?.opsc?.rooms;
    for (const n of names) {
      const s = dir.staff(n);
      person(s?.name || n, `OPSC MDA${rooms ? ` · ${rooms} rooms today` : ""}`, s?.numbers);
    }
  }
  if (spot === "VA") {
    for (const s of dir.raw.staff.filter((x) => x.site === "va")) person(s.name, "VA anesthesiologist", s.numbers);
  }

  // Others there that day: classmates on the same rotation, or sent there by the board runner.
  const others = model.roster(date).filter((x) => x.pid !== d.pid && spotOf(x) === spot).map((x) => model.name(x.pid));

  const places = {
    PACU: [[/^pacu harper/i, "PACU desk"], [/^pacu resident/i, "PACU resident line"]],
    OPSC: [[/^pacu outpatient/i, "OPSC PACU"]],
    VA: [],
  }[spot].map(([re, label]) => { const p = dir.place(re); return p ? callChip(dir, label, p.numbers) : null; }).filter(Boolean);

  // Harper's board runner and the MDA on call: not the VA's, unless they're on call at Harper.
  const charge = spot !== "VA" || d.call ? runnerCard(ctx, date, { d }) : null;
  const sheetOut = !!dl;
  return [
    h("section", { class: "card" },
      h("div", { class: "card-pad", style: { paddingBottom: rows.length ? "4px" : undefined } },
        h("h3", { class: "card-title" }, info.title, h("span", { class: "right muted" }, "no daily sheet")),
        h("p", { class: "small", style: { margin: "0 0 8px" } }, info.line),
        others.length ? h("p", { class: "small muted", style: { margin: "0 0 8px" } }, `Also there${date === state.today ? " today" : ""}: ${others.join(", ")}`) : null,
        places.length ? h("div", { class: "callchips", style: { margin: "0 0 6px" } }, places) : null,
        spot === "VA" && !rows.length ? h("p", { class: "tiny muted", style: { margin: 0 } }, "The phone directory has no VA numbers yet.") : null,
        spot !== "VA" && !sheetOut ? h("p", { class: "tiny muted", style: { margin: 0 } }, "The board runner and the MDA on call show here once the day's sheet is posted.") : null),
      rows.length ? h("ul", { class: "list" }, rows) : null),
    charge,
  ].filter(Boolean);
}

// ---- the day's attendings (MDAs) ----
// Every attending on the day's sheet and where they are: rooms, procedure areas, OPSC, Meyers, OB,
// the Egress list's sites, and their call slot. The board runner comes first, marked; then the
// rest by their first room, and post-call last.
export function mdasToday(model, dl) {
  if (!dl) return [];
  const all = new Map();
  const each = (raw, fn) => {
    for (const part of String(raw ?? "").replace(/\([^)]*\)/g, " ").split("/")) {
      const name = cleanAttending(part.replace(/^\s*dr\.?\s+/i, "")).name;
      if (!name || name.length < 2 || /^(x|crna|tbd)$/i.test(name)) continue;
      const k = name.toLowerCase();
      if (!all.has(k)) all.set(k, { name, places: [], roles: [], rooms: [], runner: false, postcall: false });
      fn(all.get(k));
    }
  };
  const place = (m, w) => { if (w && !m.places.includes(w)) m.places.push(w); };
  if (dl.runner?.mda) each(dl.runner.mda.name, (m) => { m.runner = true; });
  for (const room of dl.rooms) each(room.mda, (m) => { place(m, `OR ${room.or}`); m.rooms.push(parseInt(room.or, 10) || 90); });
  for (const p of dl.sheet.procedures || []) if (p.mda && p.count !== "0") each(p.mda, (m) => place(m, p.name));
  each(dl.sheet.meyers?.mda, (m) => place(m, "Meyers lab"));
  each(dl.sheet.ob?.mda, (m) => place(m, "OB"));
  for (const x of dl.sheet.opsc?.mdas || []) each(x, (m) => place(m, "OPSC"));
  for (const a of dl.attendings || []) {
    if (a.kind === "runner") continue;
    each(a.name, (m) => {
      if (a.kind === "site") place(m, a.where);
      else if (!m.roles.includes(a.label)) m.roles.push(a.label);
      if (a.kind === "postcall") m.postcall = true;
    });
  }
  const rank = (m) => (m.runner ? -1 : m.rooms.length ? Math.min(...m.rooms) : m.postcall && !m.places.length ? 999 : 100);
  return [...all.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// One attending: where they are today, with their numbers; the board runner with its phone too.
export function mdaRow(ctx, m) {
  const dir = ctx.model.dir;
  const staff = dir.staff(m.name);
  const runnerPhone = m.runner ? dir.place(/^mda board runner/i) : null;
  const where = [m.roles.join(" · "), m.places.join(", ")].filter(Boolean).join(" · ");
  const calls = [runnerPhone ? callChip(dir, "Board runner", runnerPhone.numbers) : null, ...(staff ? numberButtons(dir, staff.numbers) : [])].filter(Boolean);
  return h("li", { class: `row contact${m.runner ? " runner" : ""}` },
    h("div", { class: "avatar", style: m.runner ? { "--c": "var(--accent)" } : null }, m.runner ? icon("grid") : m.name.slice(0, 2).toUpperCase()),
    h("div", { class: "main" },
      h("div", { class: "name" }, h("span", { class: "n" }, staff?.name || m.name), m.runner ? h("span", { class: "pill", style: { "--c": "var(--accent)" } }, "Board runner") : null),
      h("div", { class: "sub" }, m.runner ? ["Running the board", where].filter(Boolean).join(" · ") : where || "On the sheet"),
      calls.length ? h("div", { class: "numrow" }, calls) : null));
}

// A moment as the app writes times (4:12p), with the day when it isn't today.
export function clockAt(iso, today) {
  const at = new Date(iso);
  const day = todayLocal(at);
  const time = fmtTime(nowMinutesLocal(at));
  return day === today ? time : day === addDays(today, -1) ? `yesterday ${time}` : `${DOW_SHORT[dow(day)]} ${time}`;
}

// A future day's sheet that's read live from the board runner's workbook and not final yet; once
// phones have been told it's out, when that was, and when it last changed if it has since.
export function draftNote(ctx, date) {
  const { today } = ctx.state;
  const sheet = ctx.model.ds.daily?.[date];
  if (!sheet || date < today) return null;
  if (sheet.draft && date > today) {
    const note = notice("warn", "info", h("b", null, "Still being finalized. "), `Rooms can change${sheet.sheetAt ? `; last update ${clockAt(sheet.sheetAt, today)}` : ""}.`);
    note.classList.add("span-all"); // above both columns on a wide screen
    return note;
  }
  const posted = postedLine(ctx, date);
  return posted ? h("p", { class: "sheet-stamp span-all" }, icon("check"), h("span", null, ...posted)) : null;
}

// "OR sheet posted 4:12p", with " · updated 4:31p" when it changed after phones were told.
export function postedLine(ctx, date, lead = "OR sheet posted") {
  const sheet = ctx.model.ds.daily?.[date];
  if (!sheet?.postedAt || sheet.draft) return null;
  const { today } = ctx.state;
  const edited = sheet.editedAt && Date.parse(sheet.editedAt) - Date.parse(sheet.postedAt) > 60000;
  return [`${lead} ${clockAt(sheet.postedAt, today)}`, edited ? h("b", null, ` · updated ${clockAt(sheet.editedAt, today)}`) : null];
}

export function openDaySheet(ctx, pid, date) {
  const { model } = ctx;
  const d = model.day(pid, date);
  const body = h("div");
  const site = SITES[d.site]?.name;
  body.append(
    h("section", { class: "card hero", vars: { "--rot": d.color } },
      h("div", { class: "eyebrow" }, `${model.name(pid)} · ${fmtDate(date, "long")}`),
      h("h2", { style: { fontSize: "21px" } }, headline(d)),
      h("div", { class: "subtitle" }, [d.rotation || d.label, site].filter(Boolean).join(" · ")),
      h("div", { class: "chips" }, dayChips(d)),
      d.raw && d.raw !== d.code ? h("p", { class: "tiny muted", style: { margin: "8px 0 0" } }, `Call sheet: "${d.raw}"`) : null,
    ),
  );
  const rooms = assignmentList(ctx, d);
  if (rooms.length) body.append(card("Daily OR sheet", h("ul", { class: "list" }, rooms), { pad: false }));
  const shift = swappableShift(d);
  if (shift) {
    const holder = h("div");
    const btn = h("button", { class: "btn block", onclick: () => {
      btn.remove();
      const cands = swapCandidates(model, pid, date);
      holder.append(cands.length
        ? card(`Could cover ${shift.label.toLowerCase()}`, h("ul", { class: "list" }, cands.slice(0, 8).map((c) =>
          personRow(ctx, model.day(c.pid, date), {
            sub: `${c.status} · ~${c.projected} h that week · ${c.calls} call/late this month${c.reasons.length ? ` · ${c.reasons.join(", ")}` : ""}`,
            chips: false,
          }))), { pad: false })
        : notice("warn", "info", "No same-class resident is clearly free for this shift."));
      holder.append(h("p", { class: "disclaimer" }, "Suggestions only: same class, free that day, not around nights or 24-hr call, and under ~80 estimated hours that week. Swaps go through the schedule email."));
    } }, icon("swap"), "Who could swap this shift?");
    holder.append(btn);
    // Your own shift: post it for your class, and the app writes the email once someone agrees.
    if (pid === ctx.state.me && date >= ctx.state.today && ["CA-1", "CA-2", "CA-3"].includes(model.person(pid)?.cls)) {
      holder.append(h("button", { class: "btn primary block", style: { marginTop: "8px" }, onclick: () => ctx.go(`swaps/new/${date}`) }, icon("swap"), "Ask for a swap"));
    }
    body.append(holder);
  }
  openSheet(fmtDate(date, "long"), body);
}

export const subscribeCard = (ctx, pid) => card("Calendar", subscribeBody(ctx, pid));

// The calendar feed: subscribe, or, once their calendar app has read it, when it last did.
export function subscribeBody(ctx, pid) {
  const holder = h("div");
  let feed = null;
  const withDid = () => local.get("calDidactics", true);
  const suffix = () => (withDid() ? "" : "?d=0");
  function showLinks() {
    const url = feed.url + suffix(), webcal = feed.webcal + suffix();
    const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
    holder.replaceChildren(
      h("div", { class: "btnrow", style: { marginBottom: "8px" } },
        h("a", { class: "btn primary", href: webcal }, icon("calendar"), "Apple / Outlook"),
        h("a", { class: "btn", href: google, target: "_blank", rel: "noopener" }, "Google Calendar")),
      h("button", { class: "btn block sm", onclick: () => copyText(url) }, icon("link"), "Copy feed link"),
      h("p", { class: "disclaimer" }, "Your calendar app re-checks the feed on its own. Apple refreshes about hourly. Google can take up to a day, so new daily sheets may show up late there. Anyone with this link can see the feed, so share it only with people you trust."),
    );
  }
  const btn = h("button", { class: "btn block", onclick: async () => {
    btn.disabled = true;
    try {
      feed = await api(`/api/caltoken/${pid}`);
      showLinks();
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  } }, icon("calendar"), "Add to my calendar");
  holder.append(btn);
  const toggle = ctx.model.didactics?.has ? h("label", { class: "checkline" },
    h("input", { type: "checkbox", checked: withDid(), onchange: (e) => { local.set("calDidactics", e.target.checked); if (feed) showLinks(); } }),
    h("span", null, "Include didactics: conferences, board review, and your own presentations and mock orals (with Zoom links). Changing this after subscribing needs a new subscription.")) : null;
  const seen = pid === ctx.state.me ? meStatus(pid)?.calendarAt : null;
  return h("div", null,
    seen ? h("p", { class: "small cal-on" }, icon("check"), h("span", null, `Your calendar is subscribed. It last checked ${clockAt(seen, ctx.state.today)}. Add it to another calendar below.`))
      : h("p", { class: "small muted", style: { margin: "0 0 10px" } }, "Subscribe once and every shift, OR assignment and who's on tonight shows up in your phone's calendar."),
    toggle,
    holder);
}
