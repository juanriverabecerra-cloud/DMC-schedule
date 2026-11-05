// Didactics: the monthly conference schedule as an agenda, with one-tap Zoom (link or
// dial-in with the meeting ID and passcode entered for you), what's yours, and conflicts.
import { h, icon, card, notice, emptyState, segmented, avatar, copyText, toast, numberButton } from "../ui.js";
import { local } from "../api.js";
import { fmtDate, fmtRange, fmtTime, fmtMonth, monthKey, addDays, relDay, nowMinutesLocal, DOW_SHORT, dow } from "../../core/dates.js";
import { KINDS, ROLES, SERIES, eventHeadline, isGenericTitle, residentsOf, facultyOf, zoomTelHref, relevantTo } from "../../core/didactics.js";

const KIND_CHIP = { pbld: "senior", lecture: "call24", "grand-rounds": "cardiac", mm: "warn", "board-review": "night", "mock-oral": "ob", "journal-club": "call12", simulation: "call12", other: "info", none: "pc" };

export function kindChip(e) {
  return h("span", { class: `chip ${KIND_CHIP[e.kind] || "info"}` }, KINDS[e.kind]?.label || "Session");
}

export function zoomButtons(z, { compact = false } = {}) {
  if (!z) return null;
  const tel = zoomTelHref(z);
  return h("div", { class: "btnrow zoomrow" },
    z.url ? h("a", { class: `btn${compact ? " sm" : ""} primary`, href: z.url, target: "_blank", rel: "noopener", onclick: (e) => e.stopPropagation() }, icon("video"), "Join Zoom") : null,
    tel ? h("a", { class: `btn${compact ? " sm" : ""}`, href: tel, title: "Calls in and enters the meeting ID and passcode", onclick: (e) => e.stopPropagation() }, icon("phone"), "Dial in") : null);
}

const mineOf = (e, pid) => (pid ? e.people.find((p) => p.pid === pid && (p.role === "presenter" || p.role === "examinee")) : null);

function youBadge(mine, e) {
  if (!mine) return null;
  const text = mine.role === "examinee"
    ? `Your mock oral${mine.start != null ? ` ${fmtRange(mine.start, mine.end ?? e.end)}` : ""}`
    : "You're presenting";
  return h("span", { class: "chip solid", vars: { "--c": "var(--accent)" } }, text);
}

// One session as a card: time, kind, title, who, where, Zoom, objectives.
export function sessionCard(ctx, e, { me = ctx.state.me, showDate = false } = {}) {
  const { model } = ctx;
  const mine = mineOf(e, me);
  const title = e.cancelled ? (e.title && !/^no lecture$/i.test(e.title) ? e.title : "No session this week")
    : isGenericTitle(e) ? KINDS[e.kind]?.long || "Session" : e.title;
  const res = residentsOf(e);
  const fac = facultyOf(e);
  const conflict = mine ? model.didactics.conflict(me, e.date, mine.start ?? e.start) : null;

  return h("section", { class: `card session${mine ? " mine" : ""}${e.cancelled ? " cancelled" : ""}` },
    h("div", { class: "session-head" },
      h("div", { class: "session-time" },
        showDate ? h("span", { class: "tiny muted" }, `${DOW_SHORT[dow(e.date)]} ${fmtDate(e.date, "md")}`) : null,
        h("b", null, e.start != null ? fmtTime(e.start) : "—"),
        e.end != null && !e.cancelled ? h("span", null, fmtTime(e.end)) : null),
      h("div", { class: "main" },
        h("div", { class: "chips" }, kindChip(e), e.cme ? h("span", { class: "chip info" }, "CME") : null, youBadge(mine, e)),
        h("h3", { class: "session-title" }, title),
        !e.cancelled ? h("div", { class: "sub" }, [e.place, e.zoomLink && !e.virtual ? "Zoom too" : null].filter(Boolean).join(" · ")) : null)),
    res.length ? h("ul", { class: "list session-people" }, res.map((p) => h("li", { class: `row tap${p.pid === me ? " me" : ""}`, onclick: () => ctx.go(`p/${p.pid}`) },
      avatar(model, p.pid, "sm"),
      h("div", { class: "main" },
        h("div", { class: "name" }, p.display, p.start != null ? h("span", { class: "muted small" }, ` · ${fmtRange(p.start, p.end ?? e.end)}`) : null),
        p.topic ? h("div", { class: "sub" }, p.topic) : null)))) : null,
    fac.length ? h("div", { class: "session-faculty" }, fac.map((p) => h("div", { class: "facrow" },
      h("span", { class: "muted small" }, `${p.role === "presenter" ? "Speaker" : ROLES[p.role] || "Faculty"}:`),
      h("b", { class: "small" }, p.display),
      p.staff?.numbers?.length ? numberButton(model.dir, model.dir.primary(p.staff.numbers) || p.staff.numbers[0], { compact: true }) : null))) : null,
    conflict ? notice("warn", "alert", conflict) : null,
    !e.cancelled ? zoomButtons(e.zoomLink, { compact: true }) : null,
    e.objectives || e.audience ? h("details", { class: "session-more" },
      h("summary", null, "Objectives"),
      e.audience ? h("p", { class: "small muted" }, `Audience: ${e.audience}`) : null,
      e.objectives ? h("p", { class: "small" }, e.objectives) : null) : null,
    e.note ? h("p", { class: "small muted", style: { margin: "8px 0 0" } }, e.note) : null,
  );
}

// Where a session stands right now (only when looking at today).
function statusOf(e, now, mine) {
  if (e.start == null) return null;
  const start = mine?.start ?? e.start;
  const end = mine?.end ?? e.end ?? start + 60;
  if (now >= end) return { kind: "done", text: "Ended" };
  if (now >= start) return { kind: "live", text: "Live now" };
  const mins = start - now;
  if (mins <= 90) return { kind: "soon", text: `In ${mins} min` };
  return null;
}
const STATUS_CHIP = { live: "gap", soon: "warn", done: "pc" };

// Zoom for a block of sessions: join, one-tap dial-in, and the ID/passcode to copy.
function zoomPanel(z) {
  const code = [z.meetingId ? `ID ${z.meetingId}` : null, z.passcode ? `Passcode ${z.passcode}` : null].filter(Boolean).join(" · ");
  return h("div", { class: "zoompanel" },
    zoomButtons(z),
    code ? h("button", { class: "zp-code", type: "button", title: "Copy meeting ID and passcode", onclick: () => copyText(`${z.meetingId}${z.passcode ? ` / ${z.passcode}` : ""}`) },
      icon("video"), h("span", null, code), icon("link")) : null);
}

// One session inside the Today card: time, what it is, who, and what it's about.
function daySession(ctx, e, { me, now, isToday }) {
  const { model } = ctx;
  const mine = mineOf(e, me);
  const st = isToday ? statusOf(e, now, mine) : null;
  const k = KINDS[e.kind] || KINDS.other;
  const res = residentsOf(e);
  const fac = facultyOf(e);
  // A generic printed title adds nothing next to the kind chip; say what the session is instead.
  const title = !isGenericTitle(e) ? e.title
    : e.kind === "board-review" ? (res.length ? "Resident presentations" : null)
    : k.long !== k.label ? k.long : null;
  const conflict = mine ? model.didactics.conflict(me, e.date, mine.start ?? e.start) : null;
  const who = [];
  if (e.kind === "mock-oral") {
    if (res.length) who.push(h("div", { class: "slots" }, res.map((p) => h("a", { class: `slot${p.pid === me ? " me" : ""}`, href: `#/p/${p.pid}` },
      h("b", null, p.start != null ? fmtRange(p.start, p.end ?? e.end) : ""), ` ${p.display}`))));
  } else if (res.length) {
    who.push(h("div", { class: "who" }, h("span", { class: "muted" }, res.length > 1 ? "Presenting: " : "Presenter: "),
      ...res.flatMap((p, i) => [i ? ", " : "", h("a", { href: `#/p/${p.pid}`, class: p.pid === me ? "me" : "" }, p.display), p.topic ? h("span", { class: "muted" }, ` (${p.topic})`) : ""])));
  }
  for (const p of fac) {
    who.push(h("div", { class: "facrow" },
      h("span", { class: "muted small" }, `${p.role === "presenter" ? "Speaker" : ROLES[p.role] || "Faculty"}:`),
      h("b", { class: "small" }, p.display),
      p.staff?.numbers?.length ? numberButton(model.dir, model.dir.primary(p.staff.numbers) || p.staff.numbers[0], { compact: true }) : null));
  }
  return h("div", { class: `dayses${mine ? " mine" : ""}${st?.kind === "done" ? " done" : ""}` },
    h("div", { class: "timecol" }, e.start != null ? fmtTime(mine?.start ?? e.start) : "—",
      e.end != null ? h("span", null, fmtTime(mine?.end ?? e.end)) : null),
    h("div", { class: "main" },
      h("div", { class: "chips" }, kindChip(e), e.cme ? h("span", { class: "chip info" }, "CME") : null,
        st ? h("span", { class: `chip ${STATUS_CHIP[st.kind]}${st.kind === "live" ? " solid" : ""}`, vars: st.kind === "live" ? { "--c": "var(--gap)" } : null }, st.text) : null,
        youBadge(mine, e)),
      title ? h("div", { class: "name" }, title) : null,
      ...who,
      conflict ? h("div", { class: "tiny", style: { color: "var(--warn)", marginTop: "4px" } }, conflict) : null,
      e.objectives || e.audience ? h("details", { class: "about" }, h("summary", null, "What it's about"),
        e.audience ? h("p", { class: "small muted" }, `For: ${e.audience}`) : null,
        e.objectives ? h("p", { class: "small" }, e.objectives) : null) : null));
}

// Today screen: the day's sessions, only on days that have didactics. Everything needed to
// get on the call (Zoom, dial-in, ID and passcode) and to know what each session is about.
export function didacticsDayCard(ctx) {
  const { model, state } = ctx;
  const D = model.didactics;
  if (!D?.has) return null;
  const me = state.me;
  const date = state.date;
  const all = D.on(date);
  if (!all.length) return null;
  const isToday = date === state.today;
  const now = isToday ? nowMinutesLocal() : 0;
  const sessions = all.filter((e) => !e.cancelled && relevantTo(e, me));

  if (!sessions.length) {
    const off = all.filter((e) => e.cancelled);
    if (!off.length) return null;
    const what = off[0].series !== "other" && SERIES[off[0].series] ? SERIES[off[0].series] : "didactics";
    const reason = off[0].title && !/^no (lecture|session)/i.test(off[0].title) ? ` (${off[0].title})` : "";
    return card("Didactics", h("p", { class: "small muted", style: { margin: 0 } },
      `No ${what} ${isToday ? "today" : `on ${fmtDate(date)}`}${reason}.`),
    { right: h("a", { href: "#/didactics", class: "small" }, "All ›") });
  }

  // Header: when (including everyone's own slots) and where, and whether it's on now.
  const starts = sessions.flatMap((e) => [e.start, ...e.people.map((p) => p.start)]).filter((x) => x != null);
  const ends = sessions.flatMap((e) => [e.end ?? (e.start != null ? e.start + 60 : null), ...e.people.map((p) => p.end)]).filter((x) => x != null);
  const places = [...new Set(sessions.map((e) => e.place).filter(Boolean))];
  const live = isToday ? sessions.map((e) => statusOf(e, now, mineOf(e, me))).find((x) => x && x.kind !== "done") : null;
  const allDone = isToday && sessions.every((e) => statusOf(e, now, mineOf(e, me))?.kind === "done");
  const zooms = [...new Map(sessions.filter((e) => e.zoomLink).map((e) => [e.zoomLink.key, e.zoomLink])).values()];

  const body = h("div", { class: `didday${allDone ? " done" : ""}` },
    h("div", { class: "didday-head" },
      starts.length ? h("b", null, `${fmtTime(Math.min(...starts))}–${fmtTime(Math.max(...ends))}`) : null,
      places.length ? h("span", null, ` · ${places.join(" / ")}`) : null),
    ...sessions.map((e) => daySession(ctx, e, { me, now, isToday })),
    ...(allDone ? [] : zooms.map(zoomPanel)),
  );
  const right = live ? h("span", { class: `chip ${STATUS_CHIP[live.kind]}${live.kind === "live" ? " solid" : ""}`, vars: live.kind === "live" ? { "--c": "var(--gap)" } : null }, live.text)
    : allDone ? h("span", { class: "chip pc" }, "Done for today") : h("a", { href: "#/didactics", class: "small" }, "All ›");
  return card(isToday ? "Didactics today" : `Didactics · ${relDay(date, state.today)}`, body, { right });
}

// One of a resident's own assignments as a list row.
function assignmentRow(ctx, a, { me } = {}) {
  const e = a.event;
  const conflict = me ? ctx.model.didactics.conflict(me, e.date, a.start) : null;
  const name = a.role === "examinee" ? `Mock oral · ${fmtRange(a.start, a.end)}` : a.topic || eventHeadline(e);
  const sub = [a.role === "examinee" ? facultyOf(e)[0]?.display : a.topic ? eventHeadline(e) : null, e.place].filter(Boolean).join(" · ");
  return h("li", { class: "row tap", onclick: () => ctx.go("didactics") },
    h("div", { class: "timecol" }, `${DOW_SHORT[dow(e.date)]} ${fmtDate(e.date, "md")}`),
    h("div", { class: "main" },
      h("div", { class: "name" }, name),
      sub ? h("div", { class: "sub" }, sub) : null,
      conflict ? h("div", { class: "tiny", style: { color: "var(--warn)" } }, conflict) : null));
}

// Profile: a resident's presentations and mock orals.
export function didacticsPersonCard(ctx, pid) {
  const D = ctx.model.didactics;
  if (!D?.has) return null;
  const from = `${monthKey(ctx.state.today)}-01`;
  const list = D.forPerson(pid, from, addDays(from, 92));
  if (!list.length) return null;
  return card("Didactics", h("ul", { class: "list" }, list.map((a) => assignmentRow(ctx, a))), { pad: false });
}

const FILTERS = [["all", "All"], ["wednesday", "Wed"], ["monday", "Mon"], ["friday", "Orals"], ["mine", "Mine"]];

export function renderDidactics(ctx) {
  const { model, state } = ctx;
  const D = model.didactics;
  const root = h("div");
  if (!D?.has) {
    root.append(emptyState("book", "No conference schedule yet", "The monthly didactics PDF shows up here once an admin uploads it (Admin › Didactics)."));
    return root;
  }
  const thisMonth = monthKey(state.today);
  if (!state.didMonth || !D.months.includes(state.didMonth)) {
    state.didMonth = D.months.includes(thisMonth) ? thisMonth : D.months.find((m) => m > thisMonth) || D.months[D.months.length - 1];
  }
  const month = state.didMonth;
  const info = D.info(month);
  const me = state.me;
  const now = nowMinutesLocal();
  const prefs = local.get("didPrefs", { filter: "all" });

  if (D.months.length > 1) {
    root.append(h("div", { style: { marginBottom: "12px" } }, segmented(D.months.map((m) => [m, fmtMonth(m).replace(/ \d+$/, "")]), month, (v) => { state.didMonth = v; ctx.render(); })));
  }

  // Next up: the next session from now that's on your calendar.
  const next = D.upcoming(state.today, now, 40).find((e) => relevantTo(e, me));
  if (next && monthKey(next.date) === month) {
    const mine = mineOf(next, me);
    const startsIn = next.date === state.today && next.start != null && next.start <= now ? "Happening now" : `${relDay(next.date, state.today)} · ${fmtTime(mine?.start ?? next.start)}`;
    root.append(h("section", { class: "card hero didhero", vars: { "--rot": "var(--accent)" } },
      h("div", { class: "eyebrow" }, `Next up · ${startsIn}`),
      h("h2", null, mine ? (mine.role === "examinee" ? "Your mock oral" : `You present: ${mine.topic || eventHeadline(next)}`) : eventHeadline(next)),
      h("div", { class: "subtitle" }, [next.place, residentsOf(next).map((p) => p.display).join(", ")].filter(Boolean).join(" · ")),
      zoomButtons(next.zoomLink)));
  }

  // Your sessions this month.
  if (me) {
    const mineList = D.forPerson(me, `${month}-01`, `${month}-31`);
    if (mineList.length) {
      root.append(card("Your sessions", h("ul", { class: "list" }, mineList.map((a) => assignmentRow(ctx, a, { me }))), { pad: false }));
    }
  }

  const listHolder = h("div");
  function draw() {
    const f = prefs.filter;
    const events = D.month(month).filter((e) => f === "all" || (f === "mine" ? !!mineOf(e, me) : e.series === f));
    listHolder.replaceChildren();
    if (!events.length) { listHolder.append(emptyState("book", f === "mine" ? "Nothing assigned to you" : "No sessions", f === "mine" ? "You're not presenting or examined this month." : "")); return; }
    const byDate = new Map();
    for (const e of events) { if (!byDate.has(e.date)) byDate.set(e.date, []); byDate.get(e.date).push(e); }
    const past = [...byDate.keys()].filter((d) => d < state.today);
    const drawDate = (date) => {
      listHolder.append(h("div", { class: `section-title${date === state.today ? " today" : ""}` },
        fmtDate(date, "long"), ["Today", "Tomorrow"].includes(relDay(date, state.today)) ? h("span", { class: "count" }, relDay(date, state.today)) : null));
      for (const e of byDate.get(date)) listHolder.append(sessionCard(ctx, e));
    };
    if (past.length && !state.didShowPast) {
      listHolder.append(h("button", { class: "btn block sm", style: { margin: "4px 0 8px" }, onclick: () => { state.didShowPast = true; draw(); } }, `Show earlier this month (${past.length} ${past.length === 1 ? "day" : "days"})`));
    }
    for (const date of byDate.keys()) if (state.didShowPast || date >= state.today) drawDate(date);
  }
  const filterHolder = h("div", { style: { margin: "4px 0 6px" } });
  const drawFilters = () => filterHolder.replaceChildren(segmented(FILTERS.filter(([k]) => k !== "mine" || me), prefs.filter, (v) => {
    prefs.filter = v; local.set("didPrefs", prefs); drawFilters(); draw();
  }));
  drawFilters();
  root.append(filterHolder, listHolder);
  draw();

  // Zoom rooms and the original PDF.
  const rooms = D.zoom(month);
  if (rooms.length) {
    root.append(card("Zoom rooms", h("ul", { class: "list" }, rooms.map((z) => h("li", { class: "row zoomroom" },
      h("div", { class: "main" },
        h("div", { class: "name" }, z.label),
        h("div", { class: "sub" }, [z.meetingId ? `ID ${z.meetingId}` : null, z.passcode ? `Passcode ${z.passcode}` : null].filter(Boolean).join(" · ")),
        zoomButtons(z, { compact: true })),
      z.meetingId ? h("button", { class: "iconbtn", "aria-label": `Copy meeting ID and passcode for ${z.label}`, onclick: () => copyText(`${z.meetingId}${z.passcode ? ` / ${z.passcode}` : ""}`) }, icon("link")) : null))), { pad: false }));
  }
  const tail = h("div", { class: "btnrow", style: { marginTop: "4px" } });
  if (info?.hasPdf) {
    tail.append(h("button", { class: "btn", onclick: async () => {
      try {
        const res = await fetch(`/api/didactics/${month}/pdf`, { headers: { "x-passcode": local.get("passcode") || "", "x-admin-key": local.get("adminKey") || "" } });
        if (!res.ok) throw new Error("Couldn't open the PDF");
        window.open(URL.createObjectURL(await res.blob()), "_blank");
      } catch (err) { toast(err.message); }
    } }, icon("image"), "Original PDF"));
  }
  if (tail.children.length) root.append(tail);
  if (info?.notes?.length) root.append(h("p", { class: "disclaimer" }, info.notes.join(" ")));
  root.append(h("p", { class: "disclaimer" }, `Default room: ${info?.location || "see each session"}. Sessions are in your calendar feed too (mock orals only for those examined).`));
  return root;
}
