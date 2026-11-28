// Turns the stored dataset into answers: where is a resident on a date, what are their
// hours, who is on tonight. Shared by the app (browser) and the calendar feed (server).
import { CODES, CALL_CODES, FRIDAY_24, SITES, GROUP_COLORS, normCode, rotationCode, classCode, classRotation, mergeSettings, fillFamily, isHolidayText } from "./codes.js";
import { dow, monthKey, parts, addMonths, addDays, ymd, isFixedHoliday } from "./dates.js";
import { createMatcher, displayName, splitNames, isCrnaMark } from "./names.js";
import { createDirectory } from "./directory.js";
import { createDidactics } from "./didactics.js";
import { attendingsOf, mdaText } from "./attendings.js";

const VAC_RE = /^vac(ation)?\b/i;
const OFF_RE = /^(loa|off)\b/i;
const CALL_SET = new Set(["H1", "H2", "NF", "10-7"]);

// Role words written in a name cell of the daily sheet (e.g. Breaks: "PAT") mean whoever
// holds that role that day.
export const ROLE_WORDS = {
  "pat": "PAT", "pat resident": "PAT",
  "nora": "NORA", "nora resident": "NORA",
  "board runner": "BD",
  "pacu": "PACU", "ap": "AP", "acute pain": "AP",
  "11-9": "11-9", "11 to 9": "11-9",
};
export const roleWord = (name) => ROLE_WORDS[String(name ?? "").trim().toLowerCase()] || null;
const KEEP_POST = new Set(Object.values(ROLE_WORDS));
export const NOT_A_NAME = /^(same team|cardiac team|night team|tbd\b)/i;

export const BOARD_ORDER = [
  "Harper Main OR", "Procedures", "OPSC", "NORA", "PACU", "PAT", "Acute Pain", "Cardiac", "Neuro / ACC", "Thoracic", "Vascular",
  "Basic Anesthesia", "Board Runner", "Junior Attending", "9-ICU", "Obstetrics", "VA", "Pediatrics", "Regional",
  "Sinai-Grace ICU", "Chronic Pain", "Elective", "CA-3 10p–7a", "On call", "Night float", "Interns (off-service)",
  "Other", "Post-call", "Vacation", "Off", "No schedule",
];

export const CLASS_ORDER = ["CA-3", "CA-2", "CA-1", "PGY-1"];

export function createModel(ds) {
  const S = mergeSettings(ds.settings);
  const people = (ds.people || []).filter((p) => !p.hidden && !p.former).sort((a, b) =>
    (CLASS_ORDER.indexOf(a.cls) - CLASS_ORDER.indexOf(b.cls)) || a.last.localeCompare(b.last));
  const byId = new Map((ds.people || []).map((p) => [p.id, p]));
  const match = createMatcher(people);
  const cache = new Map();
  const dailyCache = new Map();
  const holidayCache = new Map();
  const months = Object.keys(ds.months || {}).sort();
  const internWeeks = Object.keys(ds.interns?.weeks || {}).sort();

  const fillTag = (hex) => (hex ? S.fillTags[hex.toUpperCase()] || fillFamily(hex) : null);
  // The class someone was in that month, not the class they're in now.
  const classAt = (pid, month) => ds.months?.[month]?.rows?.[pid]?.cls || byId.get(pid)?.cls;

  function holidays(month) {
    if (holidayCache.has(month)) return holidayCache.get(month);
    const set = new Set();
    const m = ds.months?.[month];
    if (m) {
      const rows = Object.values(m.rows);
      const [y, mo] = month.split("-").map(Number);
      for (let d = 1; d <= (m.days || 31); d++) {
        const blanks = rows.filter((r) => !r.days[d]?.t && fillTag(r.days[d]?.f) === "off").length;
        const empty = rows.filter((r) => !r.days[d]?.t).length / (rows.length || 1);
        // A holiday can be spelled down the column, one letter per resident.
        const words = rows.filter((r) => isHolidayText(r.days[d]?.t) || /^[HOLIDAY]$/.test(r.days[d]?.t || "")).length;
        // Or written once across a blank column ("LABOR DAY HOLIDAY"), or left blank on a set holiday.
        const fixed = isFixedHoliday(ymd(y, mo, d));
        if (rows.length && (blanks / rows.length >= 0.6 || words >= 5 || (words >= 1 && empty >= 0.5) || (fixed && empty >= 0.6))) set.add(d);
      }
    }
    holidayCache.set(month, set);
    return set;
  }

  // Rotation name as residents know it (a CA-1 on "Obstetrics" is on the "11 to 9" rotation).
  function rotationFor(pid, month) {
    const cls = classAt(pid, month);
    const row = ds.months?.[month]?.rows?.[pid];
    if (row?.rotation) return classRotation(row.rotation, cls);
    const planned = ds.rotations?.[pid]?.[month];
    if (planned) return classRotation(planned, cls);
    return classRotation(ds.months?.[addMonths(month, -1)]?.rows?.[pid]?.next || null, cls);
  }

  function colorFor(rotation, group) {
    return GROUP_COLORS[group] || (ds.rotationColors?.[rotation] ? `#${ds.rotationColors[rotation]}` : "#b0b8c4");
  }

  // A peach block counts as vacation when "Vac" is written near it, or when it runs for days
  // (some months color the block and write nothing).
  function hasVacNear(row, d) {
    for (let k = -3; k <= 3; k++) if (VAC_RE.test(row.days[d + k]?.t || "")) return true;
    const peach = (n) => fillTag(row.days[n]?.f) === "off";
    let run = 1;
    for (let k = d - 1; peach(k); k--) run++;
    for (let k = d + 1; peach(k); k++) run++;
    return run >= 3;
  }

  // The call-sheet cell for the day before, including across the end of a month.
  function cellBefore(pid, date) {
    const prev = addDays(date, -1);
    return ds.months?.[monthKey(prev)]?.rows?.[pid]?.days?.[parts(prev).d] || null;
  }

  function after24(pid, date) {
    const cell = cellBefore(pid, date);
    if (!cell) return false;
    const key = normCode(cell.t);
    return key === "H1" || (fillTag(cell.f) === "call24" && !CALL_SET.has(key));
  }

  function internDay(pid, date) {
    let week = null;
    for (const start of internWeeks) {
      const w = ds.interns.weeks[start];
      if (start <= date && date <= w.end) { week = w; break; }
    }
    const text = week?.rows?.[pid];
    if (!text) return null;
    const t = text.trim();
    if (/^vacation/i.test(t)) return { status: "vacation", raw: t, label: "Vacation" };
    if (/^loa$/i.test(t)) return { status: "off", raw: t, label: "Leave of absence" };
    if (/^clinic$/i.test(t)) return { status: "work", raw: t, code: "PAT", label: "PAT clinic", site: "harper", group: "PAT" };
    if (/^pain$/i.test(t)) return { status: "work", raw: t, code: "AP", label: "Pain", site: "harper", group: "Acute Pain" };
    return { status: "work", raw: t, label: t, site: "offservice", group: "Off-service" };
  }

  function baseDay(pid, date) {
    const p = byId.get(pid);
    const month = monthKey(date);
    const { d } = parts(date);
    const wd = dow(date);
    const weekend = wd === 0 || wd === 6;
    const rotation = rotationFor(pid, month);
    const rcode = rotationCode(rotation);
    const group = rcode ? CODES[rcode].group : (rotation ? "Other" : null);
    const info = {
      pid, date, dow: wd, weekend, source: "none", rotation, rotationCode: rcode,
      raw: "", code: rcode, label: rcode ? CODES[rcode].label : rotation || "", site: rcode ? CODES[rcode].site : null,
      group, color: colorFor(rotation, group), status: "unknown", call: null,
      late: false, cardiac: false, covering: false, changed: false, noCall: false, shifts: [], roles: [],
    };

    const row = ds.months?.[month]?.rows?.[pid];
    if (!row) {
      if (p?.cls === "PGY-1") {
        const iv = internDay(pid, date);
        if (iv) {
          Object.assign(info, { source: "intern", code: iv.code || null, label: iv.label, raw: iv.raw, status: iv.status,
            site: iv.site || null, group: iv.group || "Off-service" });
          info.color = GROUP_COLORS[info.group] || "#b0b8c4";
        }
        return info;
      }
      if (rotation) info.status = "planned";
      return info;
    }

    info.source = "call";
    const cell = row.days[d] || {};
    const raw = (cell.t || "").trim();
    const key = classCode(normCode(raw), classAt(pid, month));
    const tag = fillTag(cell.f);
    info.raw = raw;
    info.covering = !!cell.b;
    info.changed = !!cell.r;
    info.cardiac = tag === "cardiac";

    if (VAC_RE.test(raw)) {
      Object.assign(info, { status: "vacation", label: "Vacation" });
    } else if (key === "PC") {
      Object.assign(info, { status: "postcall", label: "Post-call day off" });
    } else if (OFF_RE.test(raw)) {
      Object.assign(info, { status: "off", label: "Off" });
    } else if (isHolidayText(raw) || (holidays(month).has(d) && /^[HOLIDAY]$/.test(raw))) {
      Object.assign(info, { status: "holiday", label: "Holiday (CRNA coverage)" });
    } else if (/^no call/i.test(raw)) {
      info.noCall = true;
      if (weekend) Object.assign(info, { status: "off", label: "Off (no call)" });
      else info.status = "work";
    } else if (CALL_SET.has(key)) {
      info.call = key;
      info.status = "work";
      info.label = CALL_CODES[key].label;
      info.site = "harper"; // the CA-3 10p–7a is on the sheet's night coverage at Harper
    } else if (!raw) {
      if (holidays(month).has(d)) Object.assign(info, { status: "holiday", label: "Holiday (CRNA coverage)" });
      else if (tag === "off") Object.assign(info, { status: hasVacNear(row, d) ? "vacation" : "off", label: hasVacNear(row, d) ? "Vacation" : "Off" });
      else if (weekend) Object.assign(info, { status: "off", label: "Off" });
      else if (normCode(cellBefore(pid, date)?.t) === "NF") Object.assign(info, { status: "postcall", label: "Off after night float" });
      else if (normCode(cellBefore(pid, date)?.t) === "10-7") Object.assign(info, { status: "postcall", label: "Off after the night shift" });
      else if (after24(pid, date)) Object.assign(info, { status: "postcall", label: "Post-call day off" });
      else info.status = "work";
    } else {
      const c = CODES[key];
      info.status = "work";
      info.code = c ? key : info.code;
      info.label = c ? c.label : raw;
      info.site = c ? c.site : info.site;
      info.group = c ? c.group : info.group;
      if (c) info.color = GROUP_COLORS[c.group] || info.color;
    }

    if (info.status === "work" && !info.call) {
      if (tag === "late") info.late = true;
      if (tag === "call24") { info.call = "24"; info.site = info.site || "harper"; }
    }
    // Something listed the morning after a 24 (a SIM session, an exam) isn't a full workday:
    // it's counted as the 4 hours ACGME allows for education, and shown as something to check.
    if (info.status === "work" && !info.call && raw && after24(pid, date)) info.afterCall = raw;
    info.shifts = shiftsFor(info);
    return info;
  }

  function shiftsFor(info) {
    if (info.status !== "work") return [];
    if (info.afterCall) return [{ start: 360, end: 600, kind: "day", label: info.afterCall }];
    if (info.call && CALL_CODES[info.call]) {
      const c = CALL_CODES[info.call];
      return [{ start: c.start, end: c.end, kind: c.kind, label: c.label }];
    }
    if (info.call === "24") return [{ ...FRIDAY_24 }];
    const hrs = S.codeHours[info.code] || CODES[info.code]?.hours || S.dayHours;
    let [start, end] = hrs;
    if (info.late) end = Math.max(end, S.lateEnd);
    return [{ start, end, kind: info.late ? "late" : "day", label: info.late ? "Late (until 6p)" : info.label }];
  }

  function daily(date) {
    if (dailyCache.has(date)) return dailyCache.get(date);
    const sheet = ds.daily?.[date];
    if (!sheet) { dailyCache.set(date, null); return null; }
    const prefer = new Set(people.filter((p) => {
      const b = baseDay(p.id, date);
      return b.status === "work" && ["harper", "opsc", "hutzel"].includes(b.site);
    }).map((p) => p.id));
    const roles = new Map();
    const unmatched = [];
    const add = (id, role) => { if (!roles.has(id)) roles.set(id, []); roles.get(id).push(role); };
    // Who holds a role today: for PAT, the sheet's own PAT box first, then the call sheet.
    const roleIds = (code) => {
      if (code === "PAT") {
        const listed = (sheet.pat || []).flatMap(splitNames).filter((n) => !roleWord(n))
          .map((n) => match(n, { prefer })).filter((id) => id && byId.get(id)?.cls !== "PGY-1");
        if (listed.length) return [...new Set(listed)];
      }
      const holders = people.filter((p) => {
        if (p.cls === "PGY-1") return false;
        const b = baseDay(p.id, date);
        return b.status === "work" && b.code === code && b.call !== "NF";
      });
      // Acute Pain usually sends its most senior resident who isn't on a call shift that day.
      if (code === "AP") {
        const free = holders.filter((p) => !baseDay(p.id, date).call);
        const senior = free.map((p) => p.cls).sort().at(-1);
        return free.filter((p) => p.cls === senior).map((p) => p.id);
      }
      const junior = holders.map((p) => p.cls).sort()[0];
      return holders.filter((p) => p.cls === junior).map((p) => p.id);
    };
    const resolve = (text, where) => splitNames(text).filter((n) => !isCrnaMark(n) && !NOT_A_NAME.test(n)).flatMap((name) => {
      const role = roleWord(name);
      if (role) {
        const ids = roleIds(role);
        if (!ids.length) { unmatched.push({ name, where }); return [{ name, id: null }]; }
        return ids.map((id) => ({ name, id, role }));
      }
      const id = match(name, { prefer });
      if (!id) unmatched.push({ name, where });
      return [{ name, id }];
    });

    const rooms = sheet.rooms.map((r) => ({
      ...r,
      crna: isCrnaMark(r.staff),
      staffIds: resolve(r.staff, `OR ${r.or}`),
      jaIds: resolve(r.ja, `OR ${r.or} JA`),
      breakIds: resolve(r.breaks, `OR ${r.or} breaks`),
    }));
    const agg = new Map();
    for (const room of rooms) {
      for (const s of room.staffIds) if (s.id) add(s.id, { kind: "room", or: room.or, room, with: room.staffIds.filter((x) => x !== s) });
      for (const kind of ["ja", "breaks"]) {
        for (const s of room[kind === "ja" ? "jaIds" : "breakIds"]) {
          if (!s.id) continue;
          const k = `${s.id}|${kind}`;
          if (!agg.has(k)) { agg.set(k, { kind, rooms: [] }); add(s.id, agg.get(k)); }
          agg.get(k).rooms.push(room);
        }
      }
    }
    const opsc = resolve((sheet.opsc?.residents || []).join("/"), "OPSC");
    for (const s of opsc) if (s.id) add(s.id, { kind: "opsc", mdas: sheet.opsc.mdas, roomCount: sheet.opsc.rooms });
    const pat = resolve((sheet.pat || []).join("/"), "PAT");
    for (const s of pat) if (s.id) add(s.id, { kind: "pat" });
    const ob = resolve((sheet.ob?.residents || []).join("/"), "OB");
    for (const s of ob) if (s.id) add(s.id, { kind: "ob", mda: sheet.ob.mda });
    const night = resolve((sheet.night || []).join("/"), "Night coverage");
    for (const s of night) if (s.id) add(s.id, { kind: "night" });

    // Cath lab, EP lab, CT...: the resident sent there (Resident/CRNA column) and its JA.
    const procedures = (sheet.procedures || []).map((p) => ({
      ...p, staffIds: resolve(p.staff || "", p.name), jaIds: resolve(p.ja || "", `${p.name} JA`),
    }));
    for (const p of procedures) {
      for (const s of p.staffIds) if (s.id) add(s.id, { kind: "proc", name: p.name, mda: p.mda, proc: p });
      for (const s of p.jaIds) if (s.id) add(s.id, { kind: "proc", name: p.name, mda: p.mda, proc: p, asJa: true });
    }

    // The board runner's own list ("Location that day", "Late/Call"), and the Egress tab's
    // assignments: where everyone is, including the people in no room. A place the call sheet
    // already says (their rotation) adds nothing; anything else (cath lab, NORA...) becomes their
    // role for the day when the sheet gives them no other.
    const listed = new Map();
    const note = (name, where, call, from) => {
      const id = match(name, { prefer });
      if (!id || !where && !call) return;
      const was = listed.get(id);
      if (!was || (from === "list" && was.from !== "list")) listed.set(id, { where, call, from });
    };
    for (const x of sheet.egress?.residents || []) note(x.name, x.where, "", "egress");
    for (const x of sheet.people || []) note(x.name, x.where, x.call, "list");
    const listCall = new Map();
    for (const [id, x] of listed) {
      const b = baseDay(id, date);
      const code = normCode(x.where);
      const known = !!CODES[code];
      const sameAsRotation = known && (code === b.code || (!!CODES[b.code] && CODES[code].group === CODES[b.code].group));
      const status = /^(vac|vacation|pc|post\s*call|off|nights?|nf)$/i.test(x.where);
      const procHere = procedures.find((p) => p.name.toLowerCase() === String(x.where).toLowerCase());
      const procLike = !!procHere || /\b(cath|ep lab|ct|mri|angio|tee|bedside|ir)\b/i.test(x.where);
      if (!roles.has(id) && x.where && !sameAsRotation && !status) {
        add(id, { kind: "where", where: known ? CODES[code].label : x.where, code: known ? code : "", proc: procLike, mda: procHere?.mda || "" });
      }
      if (x.call) listCall.set(id, x.call);
    }

    // Notes at the bottom of the sheet that name a resident ("Sam to VA and relieve Pat in 18")
    // are shown on that resident's day. Surnames match; a first name only when one resident has it.
    const notesFor = new Map();
    const firstCount = new Map();
    for (const p of people) for (const f of new Set([p.first, p.preferred].filter(Boolean).map((x) => x.toLowerCase()))) firstCount.set(f, (firstCount.get(f) || 0) + 1);
    const word = (text, w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i").test(text);
    for (const text of sheet.notes || []) {
      for (const p of people) {
        if (p.cls === undefined) continue;
        const firsts = [p.first, p.preferred].filter((f) => f && f.length > 2 && firstCount.get(f.toLowerCase()) === 1);
        if ((p.last && p.last.length > 2 && word(text, p.last)) || firsts.some((f) => word(text, f))) {
          if (!notesFor.has(p.id)) notesFor.set(p.id, []);
          notesFor.get(p.id).push(text);
        }
      }
    }

    // Who runs the board that day: the Egress tab's "Board Runner" MDA, and the resident beside
    // them ("BR"), or the one the board runner's own list puts on the board.
    const attendings = attendingsOf(sheet.egress?.attendings);
    const brRow = [...(sheet.egress?.residents || []), ...(sheet.people || [])].find((x) => normCode(x.where) === "BD");
    const runner = {
      mda: attendings.find((a) => a.kind === "runner") || null,
      resident: brRow ? { name: brRow.name, id: match(brRow.name, { prefer }) || null } : null,
    };

    const out = {
      sheet, rooms, roles, unmatched: unmatched.filter((u) => !/resident|rotator|crna/i.test(u.name)), others: unmatched.filter((u) => /resident|rotator/i.test(u.name)),
      opsc, pat, ob, night, procedures, notesFor, listCall, attendings, runner,
    };
    dailyCache.set(date, out);
    return out;
  }

  function day(pid, date) {
    const key = `${pid}|${date}`;
    if (cache.has(key)) return cache.get(key);
    const info = baseDay(pid, date);
    const dl = daily(date);
    if (dl) {
      info.roles = dl.roles.get(pid) || [];
      info.sheetNotes = dl.notesFor.get(pid) || [];
      info.sheetCall = dl.listCall.get(pid) || ""; // the board runner's Late/Call column
    }
    // Someone whose own post is PAT (or NORA / board runner) and who is also pulled for breaks
    // stays in that post; the breaks are an extra duty, listed after it.
    const post = info.status === "work" && (KEEP_POST.has(info.code) || info.roles.some((r) => r.kind === "pat"));
    if (post && info.roles.some((r) => r.kind === "breaks") && info.roles.every((r) => r.kind === "breaks" || r.kind === "pat")) {
      info.alsoBreaks = true;
      info.roles = [...info.roles.filter((r) => r.kind === "pat"), ...info.roles.filter((r) => r.kind === "breaks")];
    }
    // Giving breaks is the job for the day: a lighter day, usually done by 2-3p.
    if (info.status === "work" && !info.call && !info.late && !info.alsoBreaks
      && info.roles.some((r) => r.kind === "breaks") && !info.roles.some((r) => r.kind === "room")) {
      info.breaksDay = true;
      info.shifts = info.shifts.map((s) => ({ ...s, end: Math.min(s.end, S.breaksEnd), label: "Breaks" }));
    }
    cache.set(key, info);
    return info;
  }

  function roster(date) {
    return people.map((p) => day(p.id, date));
  }

  function boardGroup(d) {
    if (d.status === "vacation") return "Vacation";
    if (d.status === "postcall") return "Post-call";
    if (d.status === "off" || d.status === "holiday") return "Off";
    if (d.status === "unknown") return "No schedule";
    if (d.call === "NF") return "Night float";
    if (d.call === "H1" || d.call === "H2") return "On call";
    if (d.alsoBreaks) return d.roles.some((r) => r.kind === "pat") ? "PAT" : (BOARD_ORDER.includes(d.group) ? d.group : "Other");
    if (d.roles.some((r) => r.kind === "room" || r.kind === "breaks" || r.kind === "ja")) return "Harper Main OR";
    if (d.roles.some((r) => r.kind === "proc")) return "Procedures";
    const placed = d.roles.find((r) => r.kind === "where");
    if (placed) return placed.proc ? "Procedures" : placed.code && BOARD_ORDER.includes(CODES[placed.code]?.group) ? CODES[placed.code].group : "Other";
    if (d.roles.some((r) => r.kind === "opsc")) return "OPSC";
    if (d.roles.some((r) => r.kind === "ob")) return "Obstetrics";
    if (d.roles.some((r) => r.kind === "pat")) return "PAT";
    if (d.call === "10-7") return "CA-3 10p–7a";
    if (d.source === "intern" && d.site === "offservice") return "Interns (off-service)";
    return BOARD_ORDER.includes(d.group) ? d.group : "Other";
  }

  function tonight(date) {
    const r = roster(date);
    const dl = daily(date);
    return {
      late: r.filter((d) => d.late),
      senior: r.filter((d) => d.call === "10-7"),
      night: r.filter((d) => d.call === "NF"),
      call24: r.filter((d) => d.call === "H1" || d.call === "24"),
      call12: r.filter((d) => d.call === "H2"),
      cardiac: r.filter((d) => d.cardiac),
      elevenNine: r.filter((d) => d.status === "work" && d.code === "11-9" && !d.call),
      ob: r.filter((d) => d.status === "work" && d.site === "hutzel" && d.code !== "11-9" && !d.call),
      ja: r.filter((d) => d.status === "work" && (d.code === "JA" || d.roles.some((x) => x.kind === "ja"))),
      dailyNight: dl ? dl.night : [],
      obMda: dl?.sheet?.ob?.mda || "",
      // Attendings from the Egress tab: on call tonight and pre-call. The board runner has its
      // own place at the top of Tonight (common.js runnerCard).
      mdaCall: dl ? dl.attendings.filter((a) => a.kind === "call") : [],
      mdaOther: dl ? dl.attendings.filter((a) => a.kind === "precall") : [],
      runner: dl?.runner || null,
      daily: dl,
    };
  }

  function coverageNeeded(date) {
    const m = ds.months?.[monthKey(date)];
    if (!m?.coverage) return [];
    const { d } = parts(date);
    return Object.entries(m.coverage).filter(([, v]) => v[d]).map(([label, v]) => ({ label, value: v[d] }));
  }

  // Digits of the resident's first dialable number ("" if none).
  function phone(pid) {
    const r = api.dir.resident(pid);
    return r?.primary ? api.dir.dial(r.primary) : "";
  }

  function name(pid) {
    const p = byId.get(pid);
    return p ? displayName(p) : pid;
  }

  function hasCall(date) {
    return !!ds.months?.[monthKey(date)];
  }

  function internPat(date) {
    for (const [start, block] of Object.entries(ds.interns?.pat || {})) {
      if (start <= date && date <= block.end) return block.people;
    }
    return [];
  }

  const api = {
    ds, S, people, byId, months, match, classAt,
    person: (id) => byId.get(id),
    name, phone, rotationFor, day, roster, daily, tonight, boardGroup, holidays, coverageNeeded, hasCall, internPat,
    // Program events from the office's emails (lib/mail-intake.js), soonest first. With `pid`,
    // only the ones for that resident: a CA-1 simulation isn't on a CA-3's Today or calendar.
    events: (from, to, pid) => (Array.isArray(ds.events) ? ds.events : []).filter((e) => {
      if (e.cancelled || e.date < from || (to && e.date > to)) return false;
      const classes = pid ? eventClasses(e.who) : [];
      return !classes.length || classes.includes(byId.get(pid)?.cls);
    }),
    site: (id) => SITES[id] || null,
  };
  api.dir = createDirectory(ds, api);
  api.didactics = createDidactics(ds, api);
  api.fairness = ds.fairness || {};
  return api;
}

// A short line describing what someone is doing, using the daily sheet when there is one.
// Who a program event is for, as classes: "CA-1s", "CA-2 and CA-3 residents", "Interns". None
// found (everyone, or a group like "residents going to the ASA") means it's shown to everyone.
export function eventClasses(who) {
  const s = String(who || "");
  const out = new Set();
  for (const m of s.matchAll(/\bCA\s*-?\s*([123])/gi)) out.add(`CA-${m[1]}`);
  if (/\b(PGY\s*-?\s*1|interns?)\b/i.test(s)) out.add("PGY-1");
  return [...out];
}

export function headline(d) {
  if (d.alsoBreaks) {
    const br = d.roles.find((r) => r.kind === "breaks");
    const post = d.roles.some((r) => r.kind === "pat") ? "PAT clinic" : d.label;
    return `${post} · breaks OR ${br.rooms.map((x) => x.or).join(", ")}`;
  }
  const room = d.roles.find((r) => r.kind === "room");
  // The MDA is who the day is spent with (no "MDA" before the name: it's understood); the
  // surgeon is on the room's line below it.
  if (room) return `OR ${room.or}${mdaText(room.room.mda) ? ` · ${mdaText(room.room.mda)}` : ""}`;
  const br = d.roles.find((r) => r.kind === "breaks");
  if (br) return `Breaks · OR ${br.rooms.map((x) => x.or).join(", ")}`;
  const ja = d.roles.find((r) => r.kind === "ja");
  if (ja) return `Junior attending · OR ${ja.rooms.map((x) => x.or).join(", ")}`;
  const proc = d.roles.find((r) => r.kind === "proc");
  if (proc) return `${proc.name}${proc.asJa ? " · JA" : ""}${mdaText(proc.mda) ? ` · ${mdaText(proc.mda)}` : ""}`;
  if (d.roles.some((r) => r.kind === "opsc")) return "OPSC";
  if (d.roles.some((r) => r.kind === "ob")) return "OB @ Hutzel";
  if (d.roles.some((r) => r.kind === "pat")) return "PAT clinic";
  const placed = d.roles.find((r) => r.kind === "where");
  if (placed) return `${placed.where}${mdaText(placed.mda) ? ` · ${mdaText(placed.mda)}` : ""}`;
  return d.label || d.rotation || "—";
}

export function siteName(d) {
  return SITES[d.site]?.short || "";
}
