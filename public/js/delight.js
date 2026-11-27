// Little celebrations: confetti at real milestones (ACGME's own numbers and the schedule's), one
// line on the day card for real occasions, a hidden About card and a year in review. On for
// everyone, rare by design, never on the OR sheet, Tonight or Call, and only ever about the person
// themselves. The rules are in core/occasions.js; this file shows them.
import { h, toast, openSheet } from "./ui.js";
import { local } from "./api.js";
import { academicYearOf, addDays, diffDays, fmtDate, nowMinutesLocal, parts, range, startOfWeek, MONTH_NAMES } from "../core/dates.js";
import { goldenSummary } from "../core/daysoff.js";
import { weekHours } from "../core/hours.js";
import { examsFor } from "../core/exams.js";
import { occasion, dayMilestones, acgmeNews, acgmeSnapshot, graduationDay, classOn } from "../core/occasions.js";
import { caseLog, allCases } from "./cases.js";

// Motion is still skipped for anyone whose phone asks for less of it; the words stay.
const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- confetti: a short burst, drawn on a canvas that's gone after two seconds ----
export function confetti({ gold = false } = {}) {
  if (calm()) return;
  const canvas = h("canvas", { class: "confetti", "aria-hidden": "true" });
  document.body.append(canvas);
  const dpr = window.devicePixelRatio || 1;
  const w = innerWidth, ht = innerHeight;
  canvas.width = w * dpr;
  canvas.height = ht * dpr;
  const g = canvas.getContext("2d");
  g.scale(dpr, dpr);
  const colors = gold ? ["#f2c14e", "#e0a82e", "#fbe3a1", "#c9971c"] : ["#6ea0ff", "#4ade80", "#f2c14e", "#f0abfc", "#67e8f9", "#fdba74"];
  const bits = Array.from({ length: 120 }, (_, i) => ({
    x: w / 2 + (Math.random() - 0.5) * w * 0.4, y: ht * 0.3, vx: (Math.random() - 0.5) * 10, vy: -4 - Math.random() * 9,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, bw: 6 + Math.random() * 5, bh: 3 + Math.random() * 4, c: colors[i % colors.length],
  }));
  const start = performance.now();
  const step = (now) => {
    const t = (now - start) / 1000;
    g.clearRect(0, 0, w, ht);
    for (const b of bits) {
      b.vy += 0.32; b.x += b.vx; b.y += b.vy; b.vx *= 0.99; b.r += b.vr;
      g.save();
      g.globalAlpha = Math.max(0, 1 - t / 2.2);
      g.translate(b.x, b.y);
      g.rotate(b.r);
      g.fillStyle = b.c;
      g.fillRect(-b.bw / 2, -b.bh / 2, b.bw, b.bh);
      g.restore();
    }
    if (t < 2.2) requestAnimationFrame(step); else canvas.remove();
  };
  requestAnimationFrame(step);
}

// Once ever per key, on this device: a toast (if there's something to say) and, unless it's a
// quiet one, confetti.
export function celebrate(key, text, { gold = false, quiet = false } = {}) {
  const done = local.get("celebrated", []);
  if (done.includes(key)) return false;
  local.set("celebrated", [...done, key].slice(-300));
  if (text) toast(text);
  if (!quiet) confetti({ gold });
  return true;
}

// ---- milestones from ACGME's own numbers (the Log cases button brings them back) ----
export function checkMilestones(pid) {
  if (!pid) return;
  const L = caseLog(pid);
  if (!L.owned || !L.loadedAt) return;
  const waiting = allCases(pid).filter((c) => !c.enteredAt).length;
  const now = { ...acgmeSnapshot(L.minimums, L.acgmeCount?.n ?? null, waiting, null), lines: L.minimums?.lines || [], waiting };
  const saved = local.get("acgmeSeen");
  const seen = saved?.pid === pid ? saved : null;
  const news = acgmeNews(seen, now);
  local.set("acgmeSeen", { pid, ...acgmeSnapshot(L.minimums, L.acgmeCount?.n ?? null, waiting, seen) });
  if (news) celebrate(`acgme:${pid}:${news.key}`, news.said.join(", and "), { gold: news.gold, quiet: news.quiet });
}

// ---- Today: the day's line, and milestones from the schedule ----
// The birthday is kept on this phone only (More › Settings), as "MM-DD".
export const birthday = () => local.get("birthday", null);

export function dayTouch(ctx, pid, date) {
  const { model, state } = ctx;
  if (date !== state.today) return null;
  const exams = examsFor(model, pid, local.get("examPlan"), date).exams;
  return occasion(model, pid, date, { now: nowMinutesLocal(), birthday: birthday(), exams });
}

// Called when Today is drawn for today: a schedule milestone gets its confetti once.
export function todayMilestones(ctx, pid) {
  const { model, state } = ctx;
  if (state.date !== state.today) return;
  for (const m of dayMilestones(model, pid, state.today)) if (celebrate(m.key, m.text, { gold: m.gold })) break;
}

// A birthday picker for More › Settings: month and day, kept on this phone.
export function birthdayPicker(onChange) {
  const [mm, dd] = (birthday() || "-").split("-");
  const month = h("select", { "aria-label": "Birthday month" }, h("option", { value: "" }, "Month"),
    MONTH_NAMES.map((name, i) => h("option", { value: String(i + 1).padStart(2, "0"), selected: mm === String(i + 1).padStart(2, "0") }, name)));
  const day = h("select", { "aria-label": "Birthday day" }, h("option", { value: "" }, "Day"),
    Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).map((v) => h("option", { value: v, selected: dd === v }, String(Number(v)))));
  const save = () => {
    if (month.value && day.value) local.set("birthday", `${month.value}-${day.value}`);
    else if (!month.value && !day.value) local.del("birthday");
    onChange?.();
  };
  month.addEventListener("change", save);
  day.addEventListener("change", save);
  return h("div", { class: "bday" }, month, day);
}

// ---- your year: from July 1 up to a day ----
export function yearStats(ctx, pid, upTo = ctx.state.today) {
  const { model, state } = ctx;
  const from = `${academicYearOf(upTo)}-07-01`;
  const out = { from, upTo, call24: 0, call12: 0, nights: 0, late: 0, golden: goldenSummary(model, pid, state.today).past, busiest: null, mda: null };
  const mdas = new Map();
  for (const date of range(from, upTo)) {
    const d = model.day(pid, date);
    if (d.call === "H1" || d.call === "24") out.call24++;
    else if (d.call === "H2") out.call12++;
    else if (d.call === "NF") out.nights++;
    if (d.late) out.late++;
    // The attending in their room, from the OR sheets the app has kept.
    for (const r of d.roles || []) {
      if (r.kind !== "room") continue;
      for (const part of String(r.room?.mda || "").split("/")) {
        const name = part.replace(/\([^)]*\)/g, "").trim();
        if (name && !/^(x|crna|tbd)$/i.test(name)) mdas.set(name, (mdas.get(name) || 0) + 1);
      }
    }
  }
  for (let ws = startOfWeek(from); ws <= upTo; ws = addDays(ws, 7)) {
    const wk = weekHours(model, pid, ws);
    if (wk?.known && (!out.busiest || wk.hours > out.busiest.hours)) out.busiest = { start: ws, hours: Math.round(wk.hours) };
  }
  const top = [...mdas].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 2) out.mda = { name: top[0], days: top[1] };
  return out;
}

const tile = (value, label) => h("div", { class: "stat" }, h("b", null, value), h("span", null, label));

function yearBlock(ctx, pid, s) {
  const L = caseLog(pid);
  const lines = L.minimums?.lines || [];
  return [
    h("div", { class: "stats" }, tile(s.call24, "24-hr calls"), tile(s.call12, "12-hr calls"), tile(s.nights, "nights")),
    h("div", { class: "stats" }, tile(s.late, "late days"), tile(s.golden, "golden weekends"), tile(L.acgmeCount?.n ?? "—", "cases in ACGME")),
    h("ul", { class: "facts small", style: { margin: "12px 0 0" } },
      lines.length ? h("li", { class: "info" }, `ACGME minimums met: ${lines.filter((l) => l.total >= l.minimum).length} of ${lines.length}`) : null,
      s.busiest ? h("li", { class: "info" }, `Busiest week: ${fmtDate(s.busiest.start)}, about ${s.busiest.hours} hours`) : null,
      s.mda ? h("li", { class: "info" }, `The MDA you were with most on the OR sheets: ${s.mda.name} (${s.mda.days} days)`) : null),
  ];
}

// The hidden card: tap the "Schedule synced" line under More seven times.
export function openAbout(ctx) {
  const { model, state } = ctx;
  const pid = state.me;
  const p = pid && model.person(pid);
  const body = h("div", { class: "card-pad about" });
  if (p) {
    const grad = graduationDay(classOn(model, pid, state.today), state.today);
    const s = yearStats(ctx, pid);
    body.append(
      h("div", { class: "stats" },
        tile(diffDays(s.from, state.today), "days since July 1"),
        grad ? tile(Math.max(0, diffDays(state.today, grad)).toLocaleString(), `days to graduation`) : null),
      grad ? h("p", { class: "tiny muted", style: { margin: "6px 0 14px" } }, `Graduation day: ${fmtDate(grad, "year")}.`) : null,
      h("h4", { class: "case-sec-title" }, "This year so far"),
      ...yearBlock(ctx, pid, s));
  }
  body.append(h("p", { class: "about-sign" }, "DMC Schedule. Built by residents, for residents."));
  openSheet("About", body);
}

// Counts taps on an element; the seventh within a few seconds opens the About card.
export function aboutTaps(ctx) {
  let taps = 0, last = 0;
  return () => {
    const now = Date.now();
    taps = now - last < 1500 ? taps + 1 : 1;
    last = now;
    if (taps >= 7) { taps = 0; openAbout(ctx); }
  };
}

// Late June: the year in numbers, on Today.
export function yearReviewCard(ctx, pid) {
  const { model, state } = ctx;
  const { m, d } = parts(state.today);
  const p = model.person(pid);
  if (state.date !== state.today || m !== 6 || d < 15 || !p || !graduationDay(p.cls, state.today)) return null;
  const s = yearStats(ctx, pid);
  return h("section", { class: "card card-pad year-review" },
    h("h3", { class: "card-title" }, `Your ${p.cls} year`, h("span", { class: "right" }, h("a", { href: "#", onclick: (e) => { e.preventDefault(); openSheet(`Your ${p.cls} year`, h("div", { class: "card-pad" }, ...yearBlock(ctx, pid, s))); } }, "See it all ›"))),
    h("div", { class: "stats" }, tile(s.call24 + s.call12, "calls"), tile(s.nights, "nights"), tile(s.golden, "golden weekends")));
}

// ---- loading, when it's slow ----
const LOADING = ["Preoxygenating…", "Checking the machine…", "Titrating to effect…", "Waiting for the surgeon…", "Confirming NPO status…"];
export const loadingLine = () => LOADING[Math.floor(Math.random() * LOADING.length)];

