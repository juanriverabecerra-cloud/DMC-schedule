// Pieces shared by several screens: OR assignment details, the day sheet, upcoming events,
// and the calendar subscription card.
import { h, icon, card, dayChips, personRow, openSheet, copyText, toast, notice, callChip, numberButtons } from "../ui.js";
import { fmtDate, addDays, relDay, monthKey, fmtMonth, diffDays, dow, DOW_SHORT } from "../../core/dates.js";
import { headline } from "../../core/model.js";
import { SITES } from "../../core/codes.js";
import { swapCandidates, swappableShift } from "../../core/swap.js";
import { api, local } from "../api.js";

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

export function roomSummary(room) {
  return [room.surgeon, room.time, room.cases ? `${room.cases} case${room.cases === "1" ? "" : "s"}` : ""].filter(Boolean).join(" · ");
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
      h("div", { class: "name" }, h("span", { class: "n" }, room.surgeon || `OR ${room.or}`), room.time ? h("span", { class: "pill" }, room.time) : null),
      h("div", { class: "roomline" }, [
        room.cases ? `${room.cases} case${room.cases === "1" ? "" : "s"}` : null,
        room.mda ? h("span", null, "MDA ", h("b", null, room.mda)) : null,
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
    if (r.kind === "opsc") items.push(h("li", { class: "row" }, h("div", { class: "main" }, h("div", { class: "name" }, `OPSC${r.roomCount ? ` · ${r.roomCount} rooms` : ""}`), r.mdas?.length ? h("div", { class: "sub" }, `MDAs: ${r.mdas.join(", ")}`) : null)));
    if (r.kind === "ob") items.push(h("li", { class: "row" }, h("div", { class: "main" }, h("div", { class: "name" }, "OB @ Hutzel"), r.mda ? h("div", { class: "sub" }, `MDA: ${r.mda}`) : null)));
    if (r.kind === "pat") {
      const pat = model.dir.place(/^pat clinic/i);
      items.push(h("li", { class: "row" }, h("div", { class: "main" }, h("div", { class: "name" }, "PAT clinic"),
        d.alsoBreaks ? h("div", { class: "sub" }, "Your post today; you're also pulled for breaks below") : null,
        pat ? h("div", { class: "callchips" }, callChip(model.dir, "PAT clinic", pat.numbers)) : null)));
    }
    if (r.kind === "night") items.push(h("li", { class: "row" }, h("div", { class: "main" }, h("div", { class: "name" }, "Night coverage"))));
  }
  return items;
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
    else if (d.call === "10-7") { kind = "senior"; label = "CA-3 10a–7p"; }
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
  return out.slice(0, max);
}

export function upcomingList(ctx, pid, from) {
  const items = upcoming(ctx.model, pid, from);
  if (!items.length) return h("p", { class: "muted small", style: { margin: "0 16px 14px" } }, "Nothing notable in the next few weeks of uploaded schedules.");
  return h("ul", { class: "list" }, items.map((e) => h("li", { class: "row tap", onclick: () => ctx.setDate(e.date) },
    h("div", { style: { width: "64px", flex: "none" } },
      h("div", { style: { fontWeight: 700, fontSize: "13px" } }, diffDays(ctx.state.today, e.date) < 7 ? relDay(e.date, ctx.state.today) : DOW_SHORT[dow(e.date)]),
      h("div", { class: "tiny muted" }, fmtDate(e.date, "md"))),
    h("div", { class: "main" },
      h("div", { class: "chips" }, h("span", { class: `chip ${e.kind === "rot" ? "info" : e.kind}` }, e.label)),
      e.end && e.end !== e.date ? h("div", { class: "sub" }, `${fmtDate(e.date)} – ${fmtDate(e.end)}`) : e.sub ? h("div", { class: "sub" }, e.sub) : null),
  )));
}

// A future day's sheet that's read live from the board runner's workbook and not final yet.
export function draftNote(ctx, date) {
  const sheet = ctx.model.ds.daily?.[date];
  if (!sheet?.draft || date <= ctx.state.today) return null;
  const at = sheet.sheetAt ? new Date(sheet.sheetAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  return notice("warn", "info", h("b", null, "Still being finalized. "), `Rooms can change${at ? `; last update ${at}` : ""}.`);
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

export function subscribeCard(ctx, pid) {
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
  return card("Calendar", h("div", null,
    h("p", { class: "small muted", style: { margin: "0 0 10px" } }, "Subscribe once and every shift, OR assignment and who's on tonight shows up in your phone's calendar."),
    toggle,
    holder));
}
