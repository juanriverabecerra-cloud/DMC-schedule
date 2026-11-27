// Little celebrations: confetti at real milestones (ACGME's own numbers and the schedule's), one
// line on the day card for real occasions, a hidden About card and a year in review. On for
// everyone, rare by design, never on the OR sheet, Tonight or Call, and only ever about the person
// themselves. The rules are in core/occasions.js; this file shows them.
import { h, toast, openSheet } from "./ui.js";
import { local } from "./api.js";
import { academicYearOf, addDays, diffDays, fmtDate, nowMinutesLocal, parts, range, startOfWeek } from "../core/dates.js";
import { goldenSummary } from "../core/daysoff.js";
import { weekHours } from "../core/hours.js";
import { examsFor } from "../core/exams.js";
import { occasion, dayMilestones, acgmeNews, acgmeSnapshot, graduationDay, classOn } from "../core/occasions.js";
import { caseLog, allCases } from "./cases.js";

// Motion is still skipped for anyone whose phone asks for less of it; the words stay.
const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
// A birthday line was offered for a day and taken out: forget any birthday a phone kept.
if (typeof localStorage !== "undefined") local.del("birthday");

// ---- confetti: full screen, and plenty of it ----
// Paper that flips as it falls, dots, curled streamers and stars, on one canvas over the whole
// screen (tab bar and sheets included) that goes away with the last piece. Five ways to throw it
// (STYLES); taps go straight through.
const PALETTE = ["#6ea0ff", "#4ade80", "#f2c14e", "#f0abfc", "#67e8f9", "#fdba74", "#f87171", "#ffffff"];
const GOLD = ["#f2c14e", "#e0a82e", "#fbe3a1", "#c9971c", "#fff4d0", "#b8860b"];
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function piece(x, y, vx, vy, colors, o = {}) {
  return {
    x, y, vx, vy, delay: o.delay || 0, life: o.life || 0, sway: o.sway || 0,
    rot: rand(0, 6.28), vr: rand(-0.3, 0.3), tilt: rand(0, 6.28), vt: rand(0.06, 0.2), phase: rand(0, 6.28),
    size: rand(7, 13) * (o.scale || 1), color: pick(colors), shape: pick(o.shapes || ["rect", "rect", "rect", "rect", "circle", "streamer", "star"]),
    twinkle: !!o.twinkle,
    // Every piece its own weight and top speed, so a falling cloud never moves as one flat edge.
    weight: rand(0.65, 1.35), term: rand(0.45, 1.4),
  };
}

// Each style: where the pieces start and how they move (gravity, air, how fast they can fall).
export const STYLES = {
  // Two cannons in the bottom corners, two volleys each, sprayed wide and high across the screen.
  cannons: (w, ht, colors) => {
    const reach = Math.sqrt(ht / 800);
    const pieces = [0, 1].flatMap((side) => [0, 0.45].flatMap((at) => Array.from({ length: 250 }, () => {
      const a = rand(0.04, 0.85), v = rand(19, 40) * reach;
      return piece(side ? w + 10 : -10, ht + rand(0, 30), (side ? -1 : 1) * Math.sin(a) * v, -Math.cos(a) * v, colors, { delay: at + rand(0, 0.25), sway: 0.7, scale: 1.15 });
    })));
    return { pieces, gravity: 0.42, drag: 0.982, terminal: 5.5 };
  },
  // A downpour over the whole screen at once: pieces start stacked above it and keep coming.
  rain: (w, ht, colors) => ({
    pieces: Array.from({ length: 680 }, () => piece(rand(-20, w + 20), rand(-ht * 1.3, -10), rand(-1, 1), rand(4, 7), colors, { sway: 1.4 })),
    gravity: 0.08, drag: 0.995, terminal: 7,
  }),
  // Six bursts across the screen, one after another, sparks that twinkle and fade as they fall.
  fireworks: (w, ht, colors) => ({
    pieces: Array.from({ length: 6 }, (_, i) => {
      const cx = rand(0.12, 0.88) * w, cy = rand(0.1, 0.55) * ht, at = i * 0.32;
      return Array.from({ length: 150 }, () => {
        const a = rand(0, 6.28), v = rand(4, 13) * rand(0.85, 1);
        return piece(cx, cy, Math.cos(a) * v, Math.sin(a) * v, colors, { delay: at, life: rand(1.6, 2.4), shapes: ["circle", "star", "star", "rect"], scale: 1, twinkle: true });
      });
    }).flat(),
    gravity: 0.1, drag: 0.972, terminal: 4.5,
  }),
  // One big burst from the middle that fills the screen, then drifts down.
  bang: (w, ht, colors) => {
    const reach = Math.sqrt((w * w + ht * ht) / (390 * 390 + 844 * 844));
    return {
      // Not a perfect circle: each piece's lift and speed vary, so no ring or line shows.
      pieces: Array.from({ length: 520 }, () => {
        const a = rand(0, 6.28), v = rand(6, 27) * reach;
        return piece(w / 2 + rand(-24, 24), ht * 0.42 + rand(-24, 24), Math.cos(a) * v * rand(0.7, 1.1), Math.sin(a) * v * rand(0.6, 1.1) - rand(2, 9), colors, { sway: 0.8 });
      }),
      gravity: 0.3, drag: 0.968, terminal: 4.5,
    };
  },
  // Gold everywhere: gold paper, streamers and twinkling stars over the whole screen, and a burst
  // from the top that reaches the corners.
  gold: (w, ht) => ({
    pieces: [
      ...Array.from({ length: 600 }, () => piece(rand(-20, w + 20), rand(-ht * 1.3, -10), rand(-1.2, 1.2), rand(4, 6.5), GOLD, { sway: 1.6, twinkle: true, shapes: ["rect", "rect", "star", "star", "streamer", "circle"] })),
      ...Array.from({ length: 160 }, () => { const a = rand(0.25, 2.9), v = rand(6, 18); return piece(w / 2 + rand(-30, 30), rand(-30, 0), Math.cos(a) * v * rand(0.7, 1.1), Math.sin(a) * v * rand(0.4, 1.2) + rand(0, 3), GOLD, { twinkle: true, shapes: ["star", "circle", "rect"] }); }),
    ],
    gravity: 0.09, drag: 0.99, terminal: 6.5,
  }),
};

function draw(g, p, t) {
  g.save();
  g.translate(p.x, p.y);
  g.rotate(p.rot);
  let alpha = p.life ? Math.min(1, Math.max(0, (p.life - t) / 0.6)) : 1;
  if (p.twinkle) alpha *= 0.55 + 0.45 * Math.sin(t * 14 + p.phase);
  g.globalAlpha = alpha;
  g.fillStyle = p.color;
  g.strokeStyle = p.color;
  const s = p.size;
  if (p.shape === "rect") {
    g.scale(1, Math.cos(p.tilt)); // paper turning over as it falls
    g.fillRect(-s / 2, -s * 0.3, s, s * 0.6);
  } else if (p.shape === "circle") {
    g.beginPath(); g.arc(0, 0, s * 0.32, 0, 6.28); g.fill();
  } else if (p.shape === "streamer") {
    g.lineWidth = 2.4; g.lineCap = "round";
    g.beginPath(); g.moveTo(-s, 0); g.quadraticCurveTo(0, Math.sin(p.tilt) * s, s, 0); g.stroke();
  } else {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? s * 0.22 : s * 0.55, a = (i * Math.PI) / 5;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath(); g.fill();
  }
  g.restore();
}

export function confetti({ style = "bang", gold = false } = {}) {
  if (calm() || typeof document === "undefined") return;
  const canvas = h("canvas", { class: "confetti", "aria-hidden": "true" });
  document.body.append(canvas);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = innerWidth, ht = innerHeight;
  canvas.width = w * dpr;
  canvas.height = ht * dpr;
  const g = canvas.getContext("2d");
  g.scale(dpr, dpr);
  const { pieces, gravity, drag, terminal } = (STYLES[style] || STYLES.bang)(w, ht, gold ? GOLD : PALETTE);
  const start = performance.now();
  let last = start;
  const step = (now) => {
    const t = (now - start) / 1000;
    const dt = Math.min(2, Math.max(0.5, (now - last) / 16.7));
    last = now;
    g.clearRect(0, 0, w, ht);
    let alive = 0;
    for (const p of pieces) {
      if (t < p.delay) { alive++; continue; }
      const age = t - p.delay;
      if (p.life && age > p.life) continue;
      // Paper falls slower while it's flat to the air than edge-on: the flutter of real confetti.
      const flat = p.shape === "rect" ? 0.55 + 0.45 * Math.abs(Math.sin(p.tilt)) : 1;
      const top = terminal * p.term * flat;
      p.vy += gravity * p.weight * dt;
      if (p.vy > top) p.vy += (top - p.vy) * 0.2;
      p.vx *= drag ** dt;
      if (p.vy < 0) p.vy *= drag ** dt;
      p.x += (p.vx + Math.sin(age * 3 + p.phase) * p.sway) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.tilt += p.vt * dt;
      if (p.y > ht + 40 || p.x < -80 || p.x > w + 80) { if (p.vy > 0 || p.y > ht + 40) continue; }
      alive++;
      draw(g, p, age);
    }
    if (alive && t < 9) requestAnimationFrame(step); else canvas.remove();
  };
  requestAnimationFrame(step);
}

// Once ever per key, on this device: a toast (if there's something to say) and, unless it's a
// quiet one, confetti.
export function celebrate(key, text, { gold = false, quiet = false, style = "bang" } = {}) {
  const done = local.get("celebrated", []);
  if (done.includes(key)) return false;
  local.set("celebrated", [...done, key].slice(-300));
  if (text) toast(text);
  if (!quiet) confetti({ style, gold });
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
  if (news) celebrate(`acgme:${pid}:${news.key}`, news.said.join(", and "), { gold: news.gold, quiet: news.quiet, style: news.style });
}

// ---- Today: the day's line, and milestones from the schedule ----
export function dayTouch(ctx, pid, date) {
  const { model, state } = ctx;
  if (date !== state.today) return null;
  const exams = examsFor(model, pid, local.get("examPlan"), date).exams;
  return occasion(model, pid, date, { now: nowMinutesLocal(), exams });
}

// Called when Today is drawn for today: a schedule milestone gets its confetti once.
export function todayMilestones(ctx, pid) {
  const { model, state } = ctx;
  if (state.date !== state.today) return;
  for (const m of dayMilestones(model, pid, state.today)) if (celebrate(m.key, m.text, { gold: m.gold, style: m.style })) break;
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

