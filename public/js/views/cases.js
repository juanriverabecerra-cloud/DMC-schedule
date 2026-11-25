// Case log: the day's cases, already laid out from the OR sheet, so a resident taps age, ASA and
// what was done (often one preset) and nothing else. Every tap saves. ACGME's own page then gets
// them one tap at a time through the "Log cases" bookmark (see public/acgme.js).
import { h, icon, notice, toast, openSheet, closeSheet, copyText, safely } from "../ui.js";
import { fmtDate, addDays, nowMinutesLocal, diffDays, todayLocal } from "../../core/dates.js";
import {
  AGES, ACGME_SITES, ACGME_ADD, SECTIONS, PRESETS, PROCEDURES, kindInfo, dayCases, startingCards, blankCase, pageLayout,
  DEFAULT_NAMING, NAMING_STYLES, ID_PARTS, DATE_FORMATS, SEPARATORS, CASE_ID_MAX, cleanNaming, styleOf, withStyle, planIds, lastUsed,
  toggleCode, applyPreset, presetOn, applyCombo, comboOn, missing, isReady, summary, usual, recentSupervisors, dayWord, caseDateFor,
} from "../../core/acgme.js";
import {
  caseLog, casesOnDay, allCases, saveCase, removeCase, setDayNote, dayNote, setNaming, loadCaseLog, syncCaseLog, markCasesEntered, bookmarklet, hasUnsent,
} from "../cases.js";
import { openInSafari, opensInApp, isIos as onIphone } from "../install.js";
import { local } from "../api.js";

let lastLoad = 0;

// Fetch the server copy now and then (a render never waits for it).
function ensureLoaded(pid) {
  const L = caseLog(pid);
  const stale = !L.loadedAt || Date.now() - Date.parse(L.loadedAt) > 120000;
  if (stale && Date.now() - lastLoad > 60000) {
    lastLoad = Date.now();
    loadCaseLog(pid);
  }
}

const keyOf = (c) => c.id || c.slot;
const isIOS = onIphone;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const supName = (s) => (s ? (s.first ? `${s.last}, ${s.first}` : s.last) : "");

// The cards for one day: saved cases, plus the sheet's cases not yet touched (virtual: they're
// saved the moment anything on them is tapped). Later cases in a room show the case before them.
function cardsFor(pid, date, day, L) {
  const note = dayNote(pid, date);
  const real = casesOnDay(pid, date);
  const taken = new Set(real.map((c) => c.slot).filter(Boolean));
  const site = note.site || L.learned?.sites?.[day.kind]?.site || day.site || "harper";
  const virtual = startingCards(day, L.learned, date)
    .filter((v) => !taken.has(v.slot) && !note.hidden.includes(v.slot))
    .map((v) => ({ ...v, site, supervisor: note.supervisor || v.supervisor || null }));
  const roomAt = (c) => { const i = day.rooms.findIndex((r) => r.or === c.or); return i < 0 ? 99 : i; };
  const made = (c) => c.createdAt || c.updatedAt || "";
  const all = [...real, ...virtual].sort((a, b) => roomAt(a) - roomAt(b) || a.seq - b.seq || (made(a) > made(b) ? 1 : made(a) < made(b) ? -1 : 0));
  for (let i = 1; i < all.length; i++) {
    const c = all[i], prev = all[i - 1];
    if (!c.id && c.inherit && prev.or === c.or) all[i] = { ...c, codes: [...prev.codes], group: prev.group };
  }
  return all;
}

function commit(ctx, pid, c, change) {
  saveCase(pid, { ...c, ...change });
  ctx.render();
}

// ---- Case IDs: each resident's own style ----
const namingOf = (pid) => cleanNaming(caseLog(pid).naming || DEFAULT_NAMING);
const initialsOf = (model, pid) => { const p = model.person(pid); return p ? `${(p.preferred || p.first || "").charAt(0)}${(p.last || "").charAt(0)}`.toUpperCase() : ""; };

// The days whose IDs can still change (any with a case not yet in ACGME, plus the one on screen),
// oldest first, each laid out as the screen shows it.
function idDays(model, pid, also) {
  const L = caseLog(pid);
  const days = new Set(allCases(pid).filter((c) => !c.enteredAt).map((c) => c.day));
  if (also) days.add(also);
  return [...days].sort().map((d) => ({ day: d, cards: cardsFor(pid, d, dayCases(model, pid, d), L) }));
}
const planFor = (model, pid, naming, days) => planIds(days, naming, { initials: initialsOf(model, pid), last: lastUsed(naming, allCases(pid)) });

// Saves the Case IDs that should change: a case added or removed shifts the numbers after it, and
// a new style renames everything not yet in ACGME. Returns the plan (sheet cases included).
function syncIds(model, pid, also) {
  const plan = planFor(model, pid, namingOf(pid), idDays(model, pid, also));
  let changed = 0;
  for (const c of allCases(pid)) {
    const p = plan.get(c.id);
    if (p && (p.caseId !== c.caseId || p.num !== (c.num || 0))) { saveCase(pid, { ...c, ...p }); changed++; }
  }
  plan.changed = changed;
  return plan;
}

// ---- the screen ----
export function renderCases(ctx, arg) {
  const { model, state } = ctx;
  if (/^\d{4}-\d{2}-\d{2}$/.test(arg || "")) { state.date = arg; history.replaceState(null, "", "#/cases"); }
  if (arg === "acgme") { history.replaceState(null, "", "#/cases"); setTimeout(() => openEnterSheet(ctx), 0); }
  const pid = state.me;
  if (!pid || !model.person(pid)) {
    return h("div", null, notice("", "user", "Pick yourself first, so the case log can start from your OR assignment. ", h("a", { href: "#/pick" }, "Pick yourself")));
  }
  ensureLoaded(pid);
  const L = caseLog(pid);
  const date = state.date;
  const day = dayCases(model, pid, date);
  const plan = syncIds(model, pid, date);
  const cards = cardsFor(pid, date, day, L).map((c) => (!c.id && plan.has(c.slot) ? { ...c, caseId: plan.get(c.slot).caseId } : c));
  const root = h("div", { class: "caselog" });
  if (!L.owned) root.append(elsewhereCard(ctx, pid, L));
  if (date > state.today) root.append(notice("", "info", "This day hasn't happened yet. Cases can be logged once it has."));
  root.append(dayHeader(ctx, pid, date, day, cards));
  // A line or an intubation on its own: what interns (and anyone on an ICU month) log now and then.
  const procedural = isIntern(model, pid) || !day.kind;
  if (procedural && date <= state.today) root.append(procedureCard(ctx, pid, date, day));
  const openKey = openKeyFor(date, cards);
  cards.forEach((c, i) => root.append(caseCard(ctx, pid, day, c, i, { open: formKey(c) === openKey, next: cards.slice(i + 1).find((x) => !x.enteredAt) })));
  if (date <= state.today && (day.kind || cards.length)) root.append(addCard(ctx, pid, day, cards));
  root.append(acgmeCard(ctx, pid, L));
  return root;
}

const isIntern = (model, pid) => model.person(pid)?.cls === "PGY-1";

// Adds a procedure-only case: the supervisor from one logged in the last week (lines on an ICU
// month are usually the same attending's), the site set for the day or last used for these.
export function addProcedure(ctx, pid, date, preset) {
  const p = PRESETS[preset];
  const day = dayCases(ctx.model, pid, date);
  const note = dayNote(pid, date);
  const recent = allCases(pid).filter((c) => c.kind === "procedure" && c.supervisor && diffDays(c.day, date) <= 7 && c.day <= date).sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))[0];
  const L = caseLog(pid);
  const seq = 1 + Math.max(0, ...casesOnDay(pid, date).filter((c) => c.word === p.word).map((c) => c.seq));
  const base = blankCase({
    date, kind: "procedure", word: p.word, seq,
    site: note.site || L.learned?.sites?.procedure?.site || recent?.site || day.site || "harper",
    supervisor: note.supervisor || recent?.supervisor || null, age: "d",
  });
  const c = saveCase(pid, applyPreset(base, preset));
  openFor.set(date, formKey(c));
  return c;
}

function procedureCard(ctx, pid, date, day) {
  return h("section", { class: "card card-pad case-add" },
    h("h3", { class: "card-title" }, day.kind ? "Log a procedure on its own" : "Log a procedure"),
    h("p", { class: "small muted", style: { margin: "0 0 10px" } }, "A line, an intubation or a block outside a case. One tap adds it; check the supervisor, and it's ready."),
    h("div", { class: "taps" }, PROCEDURES.map((key) => h("button", { class: "tap preset", onclick: () => { addProcedure(ctx, pid, date, key); ctx.render(); } }, icon("add"), PRESETS[key].label))));
}

function elsewhereCard(ctx, pid, L) {
  return h("section", { class: "card card-pad" },
    h("h3", { class: "card-title" }, "Your case log is on another device"),
    h("p", { class: "small muted" }, `It has ${plural(L.otherCount || 0, "case")}, kept from the phone or browser you started it on (the Home Screen app and Safari count as different ones). Use it here too, and both stay in step.`),
    h("div", { class: "btnrow" }, h("button", { class: "btn sm primary", onclick: safely(async () => { await syncCaseLog(pid, { join: true }); await loadCaseLog(pid); ctx.render(); toast("Your case log is on this device too"); }) }, "Use it here too")));
}

function dayHeader(ctx, pid, date, day, cards) {
  const note = dayNote(pid, date);
  const real = cards.filter((c) => c.id);
  const ready = real.filter(isReady).length;
  const entered = real.filter((c) => c.enteredAt).length;
  const total = cards.length;
  // The day's supervisor: one set for the day, the sheet's, or the one every case shares.
  // Cases with different supervisors (the attending changed during the day) say so.
  const named = [...new Set(real.map((c) => supName(c.supervisor)).filter(Boolean))];
  const mixed = named.length > 1;
  const supervisor = mixed ? null : (named.length === 1 ? real.find((c) => c.supervisor).supervisor : null) || note.supervisor || day.supervisor;
  const site = note.site || cards[0]?.site || day.site;
  const status = !total ? (day.kind ? "Nothing logged yet" : "No cases expected")
    : entered === total ? `All ${total} in ACGME`
      : ready === total ? `All ${total} ready for ACGME`
        : `${ready} of ${total} ready`;
  return h("section", { class: "card card-pad case-day" },
    h("div", { class: "eyebrow" }, `Case log · ${fmtDate(date, "long")}`),
    h("h2", null, status),
    h("div", { class: "subtitle" }, [day.where, day.expected ? plural(day.expected, "case") + " on the sheet" : ""].filter(Boolean).join(" · ") || (day.kind ? kindInfo(day.kind).label : "Not a case day on your schedule")),
    day.kind || total ? h("div", { class: "taps", style: { marginTop: "10px" } },
      h("button", { class: `tap${supervisor || mixed ? "" : " need"}`, title: "Supervisor for the whole day; change any one case in its own form", onclick: () => pickSupervisor(ctx, pid, { day: date, sheet: day.sheetSupervisors }) }, icon("user"), supervisor ? supName(supervisor) : mixed ? `${named.length} supervisors` : "Supervisor"),
      h("button", { class: "tap", onclick: () => pickSite(ctx, pid, { day: date }) }, ACGME_SITES[site]?.short || "Site")) : null,
    note.none ? h("p", { class: "small muted", style: { margin: "10px 0 0" } }, "Marked: no cases this day. ", h("a", { href: "#/cases", onclick: (e) => { e.preventDefault(); setDayNote(pid, date, { none: false }); ctx.render(); } }, "Undo")) : null);
}

function statusPill(c) {
  if (c.enteredAt) return h("span", { class: "pill", style: { "--c": "var(--muted)" } }, "In ACGME");
  const need = missing(c);
  if (!need.length) return h("span", { class: "pill", style: { "--c": "var(--late)" } }, "Ready");
  return h("span", { class: "pill", style: { "--c": "var(--warn)" } }, `Needs ${need[0]}`);
}

// ---- one case, the way ACGME's Add Case page has it ----
// One case is open at a time, laid out top to bottom like ACGME's page (Case Date, Site,
// Supervisor, Patient Age, Life-Threatening Pathology, Difficult Airway Management, Comments,
// Group, ASA Physical Status, then the boxes under ACGME's own headings and words), so it feels
// like the page residents already know. The others fold to one line. "Next case" moves down the day.
const openFor = new Map(); // day -> the open case's key, or "" when the resident closed them all
const formKey = (c) => c.slot || c.id; // a sheet case keeps its key once it's saved
const shownOptional = new Set();
const commentsOpen = new Set();

// The first case still missing something opens by itself, and stays open (even once it's ready)
// until the resident moves on with Next case or Done.
function openKeyFor(date, cards) {
  if (!openFor.has(date)) {
    const first = cards.find((c) => !c.enteredAt && !isReady(c));
    openFor.set(date, first ? formKey(first) : "");
  }
  return openFor.get(date);
}
const scrollToCase = (key) => key && requestAnimationFrame(() => document.querySelector(`[data-case="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
function openCase(ctx, date, key) {
  openFor.set(date, key);
  ctx.render();
  scrollToCase(key);
}

// Gone from the log (and, for a sheet case, from the day), so it isn't waiting for ACGME any more.
function deleteCase(pid, c) {
  if (c.id) removeCase(pid, c.id);
  if (c.slot) setDayNote(pid, c.day, { hidden: [...new Set([...dayNote(pid, c.day).hidden, c.slot])] });
}

const ageOf = (c) => AGES.find((a) => a.key === c.age);
// The folded line: who, how old, ASA and what was done.
const lineOf = (c) => [c.supervisor?.last || "", ageOf(c)?.tap || "", summary(c)].filter(Boolean).join(" · ") || "Nothing picked yet";

function caseCard(ctx, pid, day, c, index, { open, next }) {
  const set = (change) => commit(ctx, pid, c, change);
  const key = formKey(c);
  const num = h("span", { class: "case-num" }, String(index + 1));
  const where = c.or ? h("span", { class: "muted" }, ` · OR ${c.or}`) : null;

  if (c.enteredAt) {
    return h("section", { class: "card case done", "data-case": key },
      h("div", { class: "case-head" }, num, h("div", { class: "case-id" }, c.caseId || "No Case ID", where), statusPill(c)),
      h("div", { class: "case-line" }, lineOf(c)),
      h("div", { class: "btnrow", style: { marginTop: "8px" } }, h("button", { class: "btn sm ghost", onclick: () => markCasesEntered(pid, [c.id], false).then(() => ctx.render()) }, "Not in ACGME after all")));
  }

  if (!open) {
    return h("section", { class: `card case slim${isReady(c) ? " ready" : ""}${c.id ? "" : " fresh"}`, "data-case": key, role: "button", tabindex: "0", "aria-label": `Case ${index + 1}, ${c.caseId || "no Case ID"}. Open`,
      onclick: () => openCase(ctx, c.day, key), onkeydown: (e) => { if (e.key === "Enter") openCase(ctx, c.day, key); } },
      h("div", { class: "case-head" }, num, h("div", { class: "case-id" }, h("span", { class: "n" }, c.caseId || "No Case ID"), where), statusPill(c), icon("down", 'class="chev"')),
      h("div", { class: "case-line" }, lineOf(c)));
  }

  const head = h("div", { class: "case-head" }, num,
    h("button", { class: "case-id link", title: "Rename", "aria-label": `Case ID ${c.caseId || "blank"}. Rename`, onclick: () => renameCase(ctx, pid, c) },
      h("span", { class: "n" }, c.caseId || "No Case ID"), where, icon("edit", 'class="pen"')),
    statusPill(c),
    h("button", { class: "iconbtn sm", "aria-label": "Fold this case", onclick: () => openCase(ctx, c.day, "") }, icon("up")));

  const need = new Set(missing(c));
  const label = (text, { req = false, note = "" } = {}) => h("div", { class: "cf-lbl" }, text, req ? h("span", { class: "req" }, "*") : null, note ? h("span", { class: "muted" }, ` ${note}`) : null);
  const choice = (on, text, onclick, cls = "radio") => h("button", { class: `tap ${cls}`, "aria-pressed": String(!!on), onclick }, text);
  const field = (lbl, ...kids) => h("div", { class: "cf-row" }, lbl, ...kids);
  const select = (value, placeholder, onclick, warn) => h("button", { class: `cf-select${warn ? " need" : ""}`, onclick }, h("span", { class: value ? "" : "muted" }, value || placeholder), icon("down"));

  const form = h("div", { class: "cf" });
  // Case Date (with the next day's date for a case after midnight on call).
  form.append(field(label("Case Date", { req: true }),
    h("div", { class: "cf-inline" },
      h("div", { class: "cf-select static" }, h("span", null, fmtDate(c.date, "md") + "/" + c.date.slice(0, 4))),
      day.overnight ? choice(c.date !== c.day, "After midnight", () => set({ date: caseDateFor(c.day, c.date === c.day) }), "box") : null)));
  form.append(field(label("Site", { req: true }), select(ACGME_SITES[c.site]?.name, "-- Select --", () => pickSite(ctx, pid, { card: c }), need.has("site"))));
  const later = laterCards(ctx, pid, day, c);
  form.append(field(label("Supervisor", { req: true }), select(supName(c.supervisor), "-- Select --", () => pickSupervisor(ctx, pid, { card: c, day: c.day, sheet: day.sheetSupervisors, later }), need.has("supervisor"))));
  form.append(field(label("Patient Age", { req: true }),
    h("div", { class: `taps${need.has("age") ? " need" : ""}` }, AGES.map((a) => h("button", { class: "tap radio", title: a.acgme, "aria-label": a.label, "aria-pressed": String(c.age === a.key), onclick: () => set({ age: a.key }) }, a.tap)))));
  form.append(field(label("Life-Threatening Pathology"),
    h("div", { class: "taps" }, [["nontrauma", "Non-Trauma"], ["trauma", "Trauma"]].map(([v, t]) => choice(c.ltp === v, t, () => set({ ltp: c.ltp === v ? "" : v }))))));
  form.append(field(label("Difficult Airway Management"),
    h("div", { class: "taps" }, [["anticipated", "Anticipated"], ["unanticipated", "Unanticipated"]].map(([v, t]) => choice(c.airway === v, t, () => set({ airway: c.airway === v ? "" : v }))))));
  // "Add Comments", as on ACGME's page: a link until there's something to say.
  if (c.comments || commentsOpen.has(key)) {
    const notes = h("textarea", { class: "input plain", rows: "2", maxlength: "500", placeholder: "Nothing that identifies the patient", "aria-label": "Comments", onchange: (e) => set({ comments: e.target.value }) });
    notes.value = c.comments || "";
    form.append(field(label("Comments"), notes));
  } else {
    form.append(h("button", { class: "cf-link", onclick: () => { commentsOpen.add(key); ctx.render(); } }, "Add Comments"));
  }
  form.append(field(label("Group"),
    h("div", { class: "segmented" }, [["proc", "Procedures"], ["pain", "Pain Consultations and Procedures"]].map(([g, t]) =>
      h("button", { type: "button", "aria-pressed": String(c.group === g), onclick: () => set({ group: g }) }, t)))));

  const box = (sec) => h("div", { class: "cf-sec" },
    h("div", { class: "cf-sec-title" }, sec.title),
    ...pageLayout(sec).map((b) => h("div", { class: "cf-sub" },
      b.sub ? h("div", { class: "cf-sub-title" }, b.sub) : null,
      h("div", { class: "taps" }, b.items.map((i) => h("button", { class: "tap box", "aria-pressed": String(c.codes.includes(i.key)), onclick: () => set(toggleCode(c, i.key)) }, i.label))))));

  if (c.group !== "pain") {
    const optional = c.kind === "procedure";
    const pick = (n, e) => set(c.asa === n && !!c.emergency === e ? { asa: "", emergency: false } : { asa: n, emergency: e });
    form.append(h("div", { class: `cf-sec${need.has("ASA") ? " need" : ""}` },
      h("div", { class: "cf-sec-title" }, "ASA Physical Status", optional ? h("span", { class: "muted" }, " (optional for a procedure on its own)") : h("span", { class: "req" }, "*")),
      h("div", { class: "cf-sub" }, h("div", { class: "cf-sub-title" }, "Non-emergency"),
        h("div", { class: "taps" }, ["1", "2", "3", "4", "5", "6"].map((n) => h("button", { class: "tap box asa", "aria-pressed": String(c.asa === n && (!c.emergency || n === "6")), onclick: () => pick(n, false) }, n)))),
      h("div", { class: "cf-sub" }, h("div", { class: "cf-sub-title" }, "Emergency"),
        h("div", { class: "taps" }, ["1", "2", "3", "4", "5"].map((n) => h("button", { class: "tap box asa", "aria-pressed": String(c.asa === n && !!c.emergency), onclick: () => pick(n, true) }, `${n}E`))))));
  }
  form.append(quickFill(ctx, pid, day, c, set));
  for (const sec of SECTIONS.filter((x) => x.group === c.group)) {
    // The two optional site lists open by themselves once they matter (a spinal, a block).
    const ticked = sec.items.some((i) => c.codes.includes(i.key));
    const relevant = sec.key === "neuraxial" ? c.codes.some((k) => ["spinal", "epidural", "cse"].includes(k))
      : sec.key === "block" ? c.codes.some((k) => ["pnb", "pnb-cath"].includes(k)) : true;
    const k = `${key}|${sec.key}`;
    if (!sec.optional || ticked || relevant || shownOptional.has(k)) form.append(box(sec));
    else form.append(h("button", { class: "cf-link", onclick: () => { shownOptional.add(k); ctx.render(); } }, `${sec.title} ›`));
  }

  const foot = h("div", { class: "cf-foot" },
    h("button", { class: "btn sm ghost danger", onclick: () => {
      if (c.id && !confirm("Delete this case? It isn't in ACGME yet, so nothing there changes.")) return;
      deleteCase(pid, c);
      openFor.set(c.day, next ? formKey(next) : "");
      ctx.render();
      toast(c.id ? "Case deleted" : "Taken off this day");
    } }, icon("trash"), c.id ? "Delete case" : "Not a case"),
    h("button", { class: "btn sm primary", onclick: () => openCase(ctx, c.day, next ? formKey(next) : "") }, next ? "Next case" : "Done", next ? icon("down") : icon("check")));

  return h("section", { class: `card case open${isReady(c) ? " ready" : ""}${c.id ? "" : " fresh"}`, "data-case": key }, head, form, foot);
}

// The app's own shortcut: one tap ticks a usual set of boxes (the resident's own first).
function quickFill(ctx, pid, day, c, set) {
  const info = kindInfo(c.kind || day.kind);
  const mine = usual(caseLog(pid).learned, c.kind || day.kind).filter((m) => m.group === c.group);
  const offered = c.group === "pain" ? [...new Set([...kindInfo("pain").presets, "acute-consult", "pca-pcea"])]
    : c.kind === "procedure" ? PROCEDURES
      : info.presets.filter((p) => (PRESETS[p].group || "proc") === "proc");
  const presetKeys = offered.filter((p) => !mine.some((m) => m.label === PRESETS[p].label));
  return h("div", { class: "cf-quick" },
    h("div", { class: "cf-sub-title" }, "Quick fill", h("span", { class: "muted" }, " · ticks the boxes below")),
    h("div", { class: "taps" },
      mine.map((m) => h("button", { class: "tap preset mine", "aria-pressed": String(comboOn(c, m)), onclick: () => set(applyCombo(c, m)) }, icon("sparkle"), m.label)),
      presetKeys.map((p) => h("button", { class: "tap preset", "aria-pressed": String(presetOn(c, p)), onclick: () => set(applyPreset(c, p)) }, PRESETS[p].label))));
}

// The cases after this one on the same day that aren't in ACGME yet, in the screen's order.
function laterCards(ctx, pid, day, c) {
  const cards = cardsFor(pid, c.day, dayCases(ctx.model, pid, c.day), caseLog(pid));
  const i = cards.findIndex((x) => formKey(x) === formKey(c));
  return i < 0 ? [] : cards.slice(i + 1).filter((x) => !x.enteredAt);
}

// Adding a case: "same again", or (on OB, block and pain days) straight from a preset.
function addCard(ctx, pid, day, cards) {
  const info = kindInfo(day.kind);
  const last = cards.at(-1);
  const word = last?.word || dayWord(day);
  const nextSeq = (w) => 1 + Math.max(0, ...casesOnDay(pid, ctx.state.date).filter((c) => (c.word || "") === w).map((c) => c.seq), ...cards.filter((c) => (c.word || "") === w).map((c) => c.seq));
  const make = (extra) => {
    const note = dayNote(pid, ctx.state.date);
    const base = blankCase({
      date: ctx.state.date, kind: day.kind || "or", word: extra.word ?? word, seq: nextSeq(extra.word ?? word), or: extra.or ?? last?.or ?? "", surgeon: extra.surgeon ?? last?.surgeon ?? "",
      site: note.site || last?.site || day.site || "harper", supervisor: note.supervisor || last?.supervisor || day.supervisor || null,
      age: day.kind === "peds" ? "" : "d", group: info.group || "proc",
    });
    return { ...base, ...extra.change };
  };
  const add = (extra) => { const c = saveCase(pid, make(extra)); openCase(ctx, ctx.state.date, formKey(c)); };
  return h("section", { class: "card card-pad case-add" },
    info.add ? h("div", { class: "case-row top", style: { marginTop: 0 } }, h("span", { class: "lbl" }, "Add"),
      h("div", { class: "taps" }, info.presets.map((p) => h("button", { class: "tap preset", onclick: () => add({ word: dayWord(day), or: "", surgeon: "", change: applyPreset(make({ word: dayWord(day), or: "", surgeon: "", change: {} }), p) }) }, icon("add"), PRESETS[p].label)))) : null,
    h("div", { class: "btnrow", style: { marginTop: info.add ? "10px" : 0 } },
      last ? h("button", { class: "btn sm", onclick: () => add({ change: { codes: [...last.codes], group: last.group } }) }, icon("add"), "Same again") : null,
      h("button", { class: "btn sm", onclick: () => add({ change: {} }) }, icon("add"), last ? "Different case" : "Add a case")),
    !cards.some((c) => c.id) && !dayNote(pid, ctx.state.date).none && day.kind ? h("button", { class: "btn sm ghost", style: { width: "100%", marginTop: "8px" }, onclick: () => {
      setDayNote(pid, ctx.state.date, { none: true });
      ctx.render();
      toast("Marked: no cases this day");
    } }, "I had no cases this day") : null);
}

// ---- pickers ----
// Supervisor: for the whole day (the day's header), or for one case. Attendings change during
// the day, so from a case it can also go to the cases after it. The day's sheet names come first.
function pickSupervisor(ctx, pid, { day, card, sheet = [], later = [] }) {
  const { model } = ctx;
  const L = caseLog(pid);
  const staff = (model.dir?.raw?.staff || []).map((s) => ({ last: s.last, first: s.first || "" }));
  const recent = recentSupervisors(L.learned);
  let alsoLater = false;
  const choose = (s) => {
    const sup = { last: s.last, first: s.first || "", name: supName(s) };
    if (card) {
      saveCase(pid, { ...card, supervisor: sup });
      if (alsoLater) for (const x of later) saveCase(pid, { ...x, supervisor: sup });
      ctx.render();
      toast(alsoLater && later.length ? `${sup.last} for this case and ${later.length === 1 ? "the one" : `the ${later.length}`} after it` : `${sup.last} for this case`);
    } else {
      setDayNote(pid, day, { supervisor: sup });
      // Cases already saved for the day follow along.
      for (const c of casesOnDay(pid, day)) if (!c.enteredAt) saveCase(pid, { ...c, supervisor: sup });
      ctx.render();
      toast(`${sup.last} for the day`);
    }
    closeSheet();
  };
  const list = h("ul", { class: "list" });
  const input = h("input", { class: "input", placeholder: "Search or type a last name", autocomplete: "off", "aria-label": "Supervisor" });
  // One row per person: the sheet's "Rook" and the directory's "Rook, Alex" are the same one.
  const same = (a, b) => a.last.toLowerCase() === b.last.toLowerCase() && (!a.first || !b.first || a.first.toLowerCase() === b.first.toLowerCase());
  const pool = [];
  for (const [rows, tag] of [[sheet, "On the OR sheet"], [recent, "Recent"], [staff, ""]]) {
    for (const r of rows) {
      const was = pool.find((x) => same(x, r));
      if (was) { if (!was.first && r.first) was.first = r.first; continue; }
      pool.push({ last: r.last, first: r.first || "", tag });
    }
  }
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const rows = pool.filter((s) => !q || `${s.last} ${s.first}`.toLowerCase().includes(q))
      .sort((a, b) => (!!b.tag - !!a.tag) || (a.tag && b.tag ? 0 : a.last.localeCompare(b.last)))
      .slice(0, 40);
    const current = card?.supervisor;
    list.replaceChildren(...rows.map((s) => h("li", { class: "row tap", onclick: () => choose(s) },
      h("div", { class: "main" }, h("div", { class: "name" }, supName(s)), s.tag ? h("div", { class: "sub" }, s.tag) : null),
      current && same(current, s) ? icon("check") : null)));
    if (q && !rows.some((s) => s.last.toLowerCase() === q)) {
      const typed = input.value.trim().replace(/\s+/g, " ");
      const [last, first = ""] = typed.includes(",") ? typed.split(",").map((x) => x.trim()) : [typed.split(" ").at(-1), typed.split(" ").slice(0, -1).join(" ")];
      list.append(h("li", { class: "row tap", onclick: () => choose({ last, first }) }, h("div", { class: "main" }, h("div", { class: "name" }, `Use “${typed}”`), h("div", { class: "sub" }, "ACGME's page matches it to their list by last name"))));
    }
  };
  input.addEventListener("input", draw);
  draw();
  const scope = card && later.length ? h("label", { class: "check", style: { margin: "0 0 10px" } },
    h("input", { type: "checkbox", onchange: (e) => { alsoLater = e.target.checked; } }),
    h("span", null, `Also the ${plural(later.length, "case")} after this one (the attending changed)`)) : null;
  openSheet(card ? "Supervisor for this case" : "Supervisor for the day", h("div", { class: "card-pad" }, scope, input, list));
  // With names to tap already, the keyboard would only cover them.
  if (!pool.some((x) => x.tag)) setTimeout(() => input.focus(), 50);
}

function pickSite(ctx, pid, { day, card }) {
  const current = card ? card.site : dayNote(pid, day).site;
  openSheet("Site", h("ul", { class: "list" }, Object.entries(ACGME_SITES).map(([key, s]) =>
    h("li", { class: "row tap", onclick: () => {
      if (card) commit(ctx, pid, card, { site: key });
      else { setDayNote(pid, day, { site: key }); for (const c of casesOnDay(pid, day)) if (!c.enteredAt) saveCase(pid, { ...c, site: key }); ctx.render(); }
      closeSheet();
    } }, h("div", { class: "main" }, h("div", { class: "name" }, s.name)), key === current ? icon("check") : null))));
}

// ---- naming ----
// One case: type anything, or take the same case in another style with one tap.
function renameCase(ctx, pid, c) {
  const { model } = ctx;
  const naming = namingOf(pid);
  const days = idDays(model, pid, c.day);
  const key = keyOf(c);
  const styleId = planFor(model, pid, naming, days.map((d) => ({ ...d, cards: d.cards.map((x) => ({ ...x, customId: false })) }))).get(key)?.caseId ?? "";
  // Running numbers only make sense to someone counting already (else they'd all start at 1).
  const ideas = [...new Set(NAMING_STYLES.filter((st) => st.parts.length && (!st.parts.includes("total") || naming.parts.includes("total"))).map((st) =>
    planFor(model, pid, withStyle(naming, st.key), days.map((d) => ({ ...d, cards: d.cards.map((x) => ({ ...x, customId: false })) }))).get(key)?.caseId))]
    .filter((x) => x && x !== styleId && x !== c.caseId).slice(0, 5);
  const input = h("input", { class: "input mono", value: c.caseId || "", maxlength: String(CASE_ID_MAX), autocapitalize: "off", autocomplete: "off", autocorrect: "off", spellcheck: "false", enterkeyhint: "done", "aria-label": "Case ID" });
  const save = (v) => {
    const id = String(v).trim().replace(/\s+/g, " ").slice(0, CASE_ID_MAX);
    const own = id !== styleId;
    commit(ctx, pid, c, own ? { caseId: id, customId: true } : { caseId: styleId, customId: false });
    closeSheet();
    toast(own ? (id ? "Renamed" : "Case ID left blank") : "Back to your style");
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(input.value); } });
  const quick = [
    c.customId && styleId ? h("button", { class: "tap", onclick: () => save(styleId) }, icon("refresh"), "Your style: ", h("span", { class: "mono" }, styleId)) : null,
    ...ideas.map((x) => h("button", { class: "tap mono", onclick: () => { input.value = x; input.focus(); } }, x)),
  ].filter(Boolean);
  openSheet("Rename this case", h("div", { class: "card-pad naming" },
    h("label", { class: "field" }, h("span", null, "Case ID"), input),
    h("p", { class: "small muted", style: { margin: "-6px 0 14px" } }, `Up to ${CASE_ID_MAX} characters, and nothing that identifies the patient: no names, MRNs or birthdays.`),
    quick.length ? h("div", { class: "case-sec-title" }, "Or one tap") : null,
    quick.length ? h("div", { class: "taps", style: { marginBottom: "16px" } }, quick) : null,
    h("div", { class: "btnrow" }, h("button", { class: "btn primary", onclick: () => save(input.value) }, "Save")),
    h("button", { class: "btn ghost block", style: { marginTop: "6px" }, onclick: () => openNamingSheet(ctx) }, "Change how all your cases are named")));
}

// A made-up day, for showing styles to someone with no cases yet.
const sampleDays = (date) => [{ day: date, cards: [
  { slot: "s1", day: date, date, word: "Smith", or: "7", site: "harper", seq: 1 },
  { slot: "s2", day: date, date, word: "Smith", or: "7", site: "harper", seq: 2 },
  { slot: "s3", day: date, date, word: "Lee", or: "7", site: "harper", seq: 1 },
] }];

// Everyone's style: pick a ready-made one (each shown with their own next cases) or build one.
// Cases not yet in ACGME follow along; cases already in ACGME never change.
export function openNamingSheet(ctx) {
  const { model, state } = ctx;
  const pid = state.me;
  if (!pid) return;
  const L = caseLog(pid);
  const saved = namingOf(pid);
  let draft = { ...saved };
  let custom = styleOf(saved) === "custom";
  let renameOwn = false;
  let startTyped = null;
  const days = idDays(model, pid, state.date);
  const plain = days.map((d) => ({ ...d, cards: d.cards.map((c) => ({ ...c, customId: false })) }));
  const pending = allCases(pid).filter((c) => !c.enteredAt);
  const ownNamed = pending.filter((c) => c.customId);
  const shown = [...planFor(model, pid, draft, plain).keys()].length ? plain : sampleDays(state.today);
  const counting = (n) => n.parts.includes("total");
  // With a new starting number, the count starts over from it.
  const effective = () => (startTyped && counting(draft) ? { ...draft, start: startTyped, last: 0, setAt: new Date().toISOString() } : draft);
  const examples = (n) => [...planFor(model, pid, n, shown).values()].slice(0, 3).map((p) => p.caseId);
  const nextNum = (n) => [...planFor(model, pid, n, plain).values()].find((p) => p.num)?.num || Math.max(n.start, n.last + 1, lastUsed(n, allCases(pid)) + 1);

  const body = h("div", { class: "card-pad naming" });
  // Stays in view while the list scrolls under it.
  const previewBox = h("div", { class: "id-preview-box", "aria-live": "polite" });
  const preview = h("div", { class: "id-preview" }, previewBox);
  const subs = new Map(); // each style's example line, kept current as a number is typed
  const styleExample = (key) => (key === "custom"
    ? (custom ? examples(effective())[0] || "Add parts below" : "Any parts, in any order")
    : examples(withStyle(effective(), key))[0] || "ACGME doesn't require one");
  const drawPreview = () => {
    for (const [key, el] of subs) el.textContent = styleExample(key);
    const ex = examples(effective());
    previewBox.replaceChildren(h("div", { class: "case-sec-title" }, shown === plain ? "Your next cases" : "Cases would look like"),
      ...(ex.some(Boolean) ? ex.map((x) => h("div", { class: "id-sample" }, x || "—")) : [h("div", { class: "id-sample muted" }, "No Case ID")]));
  };
  const section = (title, ...kids) => h("div", { class: "id-sec" }, h("div", { class: "case-sec-title" }, title), ...kids);
  const builder = () => {
    const today = state.today;
    const text = h("input", { class: "input", value: draft.text, maxlength: "12", placeholder: "e.g. DMC", autocapitalize: "characters", autocomplete: "off", "aria-label": "Your own text" });
    text.addEventListener("input", () => { draft = { ...draft, text: text.value }; drawPreview(); });
    return h("div", { class: "id-builder" },
      section("Parts, in order",
        h("div", { class: "taps" }, draft.parts.length
          ? draft.parts.map((p, i) => h("button", { class: "tap", "aria-pressed": "true", "aria-label": `Remove ${ID_PARTS[p]}`, onclick: () => { draft = { ...draft, parts: draft.parts.filter((_, j) => j !== i) }; draw(); } }, h("span", { class: "order" }, String(i + 1)), ID_PARTS[p], icon("x")))
          : h("span", { class: "small muted" }, "Nothing yet. Tap the parts below in the order you want them."))),
      section("Add a part",
        h("div", { class: "taps" }, Object.keys(ID_PARTS).filter((p) => !draft.parts.includes(p)).map((p) =>
          h("button", { class: "tap", disabled: draft.parts.length >= 6 || null, onclick: () => { draft = { ...draft, parts: [...draft.parts, p] }; draw(); } }, icon("add"), ID_PARTS[p])))),
      draft.parts.includes("date") ? section("Date",
        h("div", { class: "taps" }, DATE_FORMATS.map((f) => h("button", { class: "tap mono", "aria-pressed": String(draft.date === f), title: f, onclick: () => { draft = { ...draft, date: f }; draw(); } },
          planIds([{ day: today, cards: [{ slot: "d", day: today, date: today }] }], { parts: ["date"], date: f }).get("d").caseId)))) : null,
      draft.parts.length > 1 ? section("Between parts",
        h("div", { class: "taps" }, SEPARATORS.map(([v, label]) => h("button", { class: "tap", "aria-pressed": String(draft.sep === v), onclick: () => { draft = { ...draft, sep: v }; draw(); } },
          v.trim() ? h("b", { class: "mono" }, v) : null, label)))) : null,
      draft.parts.includes("text") ? section("Your own text", text) : null);
  };
  const counter = () => {
    const count = L.acgmeCount?.n;
    const now = nextNum(draft);
    const input = h("input", { class: "input mono", type: "number", inputmode: "numeric", min: "1", max: "999999", value: String(startTyped || now), "aria-label": "Number for your next case" });
    input.addEventListener("input", () => {
      const v = parseInt(input.value, 10);
      startTyped = v >= 1 && v < 1e6 && v !== now ? v : null;
      drawPreview();
    });
    return section("Running number",
      h("div", { class: "counter-row" },
        h("span", null, "Next case is #"), input,
        count != null && count + 1 !== (startTyped || now) ? h("button", { class: "tap", onclick: () => { startTyped = count + 1 === now ? null : count + 1; draw(); } }, `Match ACGME: ${count + 1}`) : null),
      h("p", { class: "small muted", style: { margin: "8px 0 0" } },
        count != null ? `ACGME showed ${count} cases submitted on ${fmtDate(todayLocal(new Date(L.acgmeCount.at)))}. ` : "Not sure? Your Log cases button reads ACGME's count each time you use it. ",
        "Cases waiting for ACGME are numbered oldest first, the order Log cases enters them. Cases already in ACGME keep their numbers."));
  };
  const apply = () => {
    const n = cleanNaming(effective());
    if (renameOwn) for (const c of ownNamed) saveCase(pid, { ...c, customId: false });
    setNaming(pid, n);
    const plan = syncIds(model, pid, state.date);
    closeSheet();
    ctx.render();
    toast(plan.changed ? `${plural(plan.changed, "case")} renamed` : "Saved");
  };
  const draw = () => {
    const picked = custom ? "custom" : styleOf(draft);
    subs.clear();
    const option = (key, label, sub, onPick) => {
      const line = h("div", { class: "sub mono" }, sub);
      subs.set(key, line);
      return h("li", { class: `row tap${picked === key ? " on" : ""}`, role: "radio", "aria-checked": String(picked === key), tabindex: "0", onclick: onPick },
        h("span", { class: "radio" }), h("div", { class: "main" }, h("div", { class: "name" }, label), line));
    };
    body.replaceChildren(...[
      preview,
      h("ul", { class: "list pick", role: "radiogroup", "aria-label": "Case ID style" },
        NAMING_STYLES.map((st) => option(st.key, st.label, styleExample(st.key), () => { custom = false; draft = withStyle(draft, st.key); draw(); })),
        option("custom", "Make your own", styleExample("custom"), () => { custom = true; draw(); })),
      custom ? builder() : null,
      counting(draft) ? counter() : null,
      ownNamed.length ? h("label", { class: "check" }, h("input", { type: "checkbox", checked: renameOwn || null, onchange: (e) => { renameOwn = e.target.checked; } }),
        h("span", null, `Also rename the ${plural(ownNamed.length, "case")} you named yourself`)) : null,
      h("p", { class: "small muted", style: { margin: "0 0 12px" } }, pending.length
        ? `For the ${plural(pending.length, "case")} not yet in ACGME and every case from now on. Cases already in ACGME keep their IDs.`
        : "For every case you log from now on."),
      h("div", { class: "btnrow" }, h("button", { class: "btn primary", onclick: apply }, "Save")),
    ].filter(Boolean));
    drawPreview();
  };
  draw();
  openSheet("Case IDs", body);
}

// ---- getting cases into ACGME ----
function waitingOf(pid) {
  const all = allCases(pid).filter((c) => !c.enteredAt);
  const ready = all.filter(isReady).sort((a, b) => (a.date > b.date ? 1 : -1));
  return { ready, notReady: all.filter((c) => !isReady(c)) };
}

function acgmeCard(ctx, pid, L) {
  const { ready, notReady } = waitingOf(pid);
  const needDays = [...new Set(notReady.map((c) => c.day))].sort();
  const unsent = hasUnsent(pid);
  const oldest = ready[0]?.date;
  return h("section", { class: "card card-pad" },
    h("h3", { class: "card-title" }, "ACGME", h("span", { class: "right muted small" }, unsent ? (L.syncError === "offline" ? "Saved on this phone; sends when online" : "Saving…") : L.loadedAt ? "Saved" : "")),
    ready.length
      ? h("p", { class: "small", style: { margin: "0 0 10px" } }, `${plural(ready.length, "case")} ready to enter${oldest ? `, the oldest from ${fmtDate(oldest)}` : ""}. About ${Math.max(1, Math.round(ready.length * 0.4))} min.`)
      : h("p", { class: "small muted", style: { margin: "0 0 10px" } }, "Nothing waiting. Cases show up here once they're ready."),
    notReady.length ? h("p", { class: "small", style: { margin: "0 0 10px", color: "var(--warn)" } }, `${plural(notReady.length, "case")} still ${notReady.length === 1 ? "needs" : "need"} details: `, ...needDays.slice(0, 4).map((d, i) => {
      const n = notReady.filter((c) => c.day === d).length;
      return [i ? ", " : "", h("a", { href: "#/cases", onclick: (e) => { e.preventDefault(); ctx.setDate(d); } }, `${fmtDate(d)}${n > 1 ? ` (${n})` : ""}`)];
    }), needDays.length > 4 ? ", …" : "") : null,
    h("div", { class: "btnrow" }, h("button", { class: `btn sm${ready.length ? " primary" : ""}`, onclick: () => openEnterSheet(ctx) }, icon("upload"), ready.length ? "Enter in ACGME" : "How entering works")),
    countNudge(ctx, pid, L),
    ready.length + notReady.length ? h("button", { class: "case-sum", onclick: () => openSavedSheet(ctx) },
      h("span", null, `${plural(ready.length + notReady.length, "case")} saved, not in ACGME yet`), h("span", { class: "more" }, "See or delete"), icon("right")) : null,
    h("button", { class: "case-sum", onclick: () => openNamingSheet(ctx) },
      h("span", { class: "id-line" }, "Case IDs ", idExample(ctx, pid)), h("span", { class: "more" }, "Change"), icon("right")));
}

// Every case saved here and not in ACGME yet, from any day: open one, or delete the ones that
// won't be entered (a half-filled case, a case that didn't happen).
export function openSavedSheet(ctx) {
  const pid = ctx.state.me;
  if (!pid) return;
  const body = h("div", { class: "card-pad saved" });
  const remove = (list) => { for (const c of list) deleteCase(pid, c); draw(); ctx.render(); };
  const order = (c) => `${c.day}${String(c.num || 0).padStart(7, "0")}${c.or}${String(c.seq).padStart(2, "0")}`;
  function draw() {
    const all = allCases(pid).filter((c) => !c.enteredAt).sort((a, b) => (order(a) > order(b) ? 1 : -1));
    if (!all.length) {
      body.replaceChildren(h("p", { class: "small muted", style: { margin: 0 } }, "Nothing saved that isn't in ACGME. Cases you log show up here until they're entered."));
      return;
    }
    const incomplete = all.filter((c) => !isReady(c));
    const days = [...new Set(all.map((c) => c.day))];
    body.replaceChildren(
      h("p", { class: "small muted", style: { marginTop: 0 } }, "Saved in your case log and waiting for ACGME. Delete any you won't enter; nothing in ACGME changes."),
      incomplete.length ? h("div", { class: "btnrow", style: { marginBottom: "12px" } }, h("button", { class: "btn sm danger", onclick: () => {
        if (confirm(`Delete the ${plural(incomplete.length, "case")} still missing details? This can't be undone.`)) { remove(incomplete); toast(`${plural(incomplete.length, "case")} deleted`); }
      } }, icon("trash"), `Delete the ${plural(incomplete.length, "incomplete case")}`)) : null,
      ...days.map((d) => h("div", { class: "saved-day" },
        h("div", { class: "case-sec-title" }, fmtDate(d, "long")),
        h("ul", { class: "list" }, all.filter((c) => c.day === d).map((c) => h("li", { class: "row" },
          h("button", { class: "main saved-open", onclick: () => { openFor.set(c.day, formKey(c)); closeSheet(); if (ctx.state.date !== c.day) ctx.setDate(c.day); else ctx.render(); scrollToCase(formKey(c)); } },
            h("div", { class: "name" }, h("span", { class: "n mono" }, c.caseId || "No Case ID"), statusPill(c)),
            h("div", { class: "sub" }, lineOf(c))),
          h("button", { class: "iconbtn sm danger", "aria-label": `Delete ${c.caseId || "this case"}`, onclick: () => {
            if (confirm(`Delete ${c.caseId || "this case"}? It isn't in ACGME, and this can't be undone.`)) { remove([c]); toast("Case deleted"); }
          } }, icon("trash"))))))));
  }
  draw();
  openSheet("Saved, not in ACGME yet", body);
}

// The style, shown as a real ID: the next case waiting, or a made-up one.
function idExample(ctx, pid) {
  const order = (c) => `${String(c.num || 9999999).padStart(7, "0")}${c.date}${c.or}${String(c.seq).padStart(2, "0")}`;
  const waiting = allCases(pid).filter((c) => !c.enteredAt && !c.customId).sort((a, b) => (order(a) > order(b) ? 1 : -1));
  const id = waiting.length ? waiting[0].caseId : [...planIds(sampleDays(ctx.state.today), namingOf(pid)).values()][0]?.caseId;
  if (!id) return h("span", { class: "muted" }, "left blank");
  return [waiting.length ? null : h("span", { class: "muted" }, "like "), h("span", { class: "mono muted" }, id)];
}

// Someone counting their cases whose ACGME count has run ahead (cases entered some other way):
// one tap catches the running number up.
function countNudge(ctx, pid, L) {
  const naming = namingOf(pid);
  const count = L.acgmeCount?.n;
  if (!naming.parts.includes("total") || count == null) return null;
  const next = Math.max(naming.start, naming.last + 1, lastUsed(naming, allCases(pid)) + 1);
  if (count + 1 <= next || local.get("idCountSkip") === count) return null;
  return h("div", { class: "id-nudge" },
    h("p", { class: "small", style: { margin: "0 0 8px" } }, `ACGME shows ${count} cases submitted, but your next running number is ${next}.`),
    h("div", { class: "btnrow" },
      h("button", { class: "btn sm primary", onclick: () => {
        setNaming(pid, { ...naming, start: count + 1, last: 0, setAt: new Date().toISOString() });
        const plan = syncIds(ctx.model, pid, ctx.state.date);
        ctx.render();
        toast(plan.changed ? `Renumbered from ${count + 1}` : `Next case is #${count + 1}`);
      } }, `Start at ${count + 1}`),
      h("button", { class: "btn sm", onclick: () => { local.set("idCountSkip", count); ctx.render(); } }, `Keep ${next}`)));
}

// ACGME in Safari itself, where the Log cases favorite and saved passwords are.
function openAcgme(url = ACGME_ADD) {
  openInSafari(url, {
    fallback: () => openSheet("Open it in Safari", h("div", { class: "card-pad" },
      h("p", { class: "small" }, "This iPhone didn't switch to Safari by itself (that needs iOS 17 or later). Open it here, then tap the Safari button in the bottom corner to move it into Safari, where your Favorites and passwords are."),
      h("div", { class: "btnrow" },
        h("a", { class: "btn sm primary", href: url, target: "_blank", rel: "noopener" }, "Open it here"),
        h("button", { class: "btn sm", onclick: () => copyText(url, "Link") }, icon("copy"), "Copy the link")))),
  });
}
const setupPage = (helper) => `${location.origin}/acgme-setup.html#k=${encodeURIComponent(helper)}`;

export function openEnterSheet(ctx) {
  const pid = ctx.state.me;
  if (!pid) return;
  const L = caseLog(pid);
  syncIds(ctx.model, pid);
  const { ready } = waitingOf(pid);
  const code = bookmarklet(L.helper);
  const setUp = !!L.helperSeenAt;
  const body = h("div", { class: "card-pad enter" });
  if (!code) {
    body.append(notice("warn", "alert", L.loadedAt ? "The ACGME button isn't available on this server yet (it needs CAL_SECRET or ADMIN_KEY)." : "Connect to the internet once so the app can make your ACGME button."));
  } else if (!setUp) {
    body.append(h("p", { class: "small" }, "ACGME doesn't let other apps send cases, so the app gives you a button for ACGME's own page. Each tap fills one case; you check it and tap Submit. Set it up once:"));
    if (opensInApp()) {
      // The Home Screen app can't add Safari Favorites; the setup page opens in Safari and walks
      // through it there, ending on ACGME with Safari's saved passwords.
      body.append(h("div", { class: "btnrow", style: { margin: "4px 0 6px" } },
        h("button", { class: "btn primary", onclick: () => openAcgme(setupPage(L.helper)) }, "Set it up in Safari")));
      body.append(h("p", { class: "small muted" }, "It opens Safari with three short steps. Your Favorites and saved passwords are there, which this app can't reach."));
      body.append(h("details", { class: "small", style: { marginTop: "12px" } }, h("summary", null, "On a computer instead"), computerSteps(code, L.helper)));
    } else {
      body.append(isIOS() ? iphoneSteps(code) : computerSteps(code, L.helper));
      body.append(h("details", { class: "small", style: { marginTop: "12px" } }, h("summary", null, isIOS() ? "On a computer instead" : "On an iPhone instead"), isIOS() ? computerSteps(code, L.helper) : iphoneSteps(code)));
    }
  } else {
    body.append(h("ol", { class: "steps" },
      h("li", null, isIOS() ? "In Safari, tap the address bar, then the book icon if Bookmarks aren't showing, and Log cases. It opens ACGME's Add Case page (sign in if asked; Safari fills in your password)." : "Click Log cases in your bookmarks bar. It opens ACGME's Add Case page (sign in if asked)."),
      h("li", null, isIOS() ? "Tap Log cases again: it fills every step of ACGME's form (no Next needed) and stops on the last one. Scroll down, check the codes, tap Submit." : "Click Log cases again: it fills the next case. Check it, click Submit."),
      h("li", null, "Repeat until it says you're caught up. Each case is marked here as it lands in ACGME.")));
    body.append(h("div", { class: "btnrow", style: { margin: "10px 0" } },
      h("button", { class: "btn sm primary", onclick: () => openAcgme() }, opensInApp() ? "Open ACGME in Safari" : "Open ACGME"),
      h("button", { class: "btn sm", onclick: () => copyText(code, "Log cases button") }, icon("copy"), "Copy the button again")));
    body.append(h("p", { class: "small muted" }, `Your Log cases button last reached the app ${fmtDate(todayLocal(new Date(L.helperSeenAt)))}.`));
    body.append(h("details", { class: "small" }, h("summary", null, "Set it up again, or on another device"),
      onIphone() ? h("div", { class: "btnrow", style: { margin: "8px 0" } }, h("button", { class: "btn sm", onclick: () => openAcgme(setupPage(L.helper)) }, "Set it up in Safari")) : null,
      opensInApp() ? null : iphoneSteps(code), computerSteps(code, L.helper)));
  }
  if (ready.length) {
    body.append(h("h4", { class: "case-sec-title", style: { marginTop: "16px" } }, `Waiting (${ready.length})`));
    body.append(h("ul", { class: "list compact" }, ready.slice(0, 30).map((c) => h("li", { class: "row" }, h("div", { class: "main" }, h("div", { class: "name mono" }, c.caseId || "No Case ID"), h("div", { class: "sub" }, summary(c)))))));
    body.append(h("div", { class: "btnrow", style: { marginTop: "10px" } }, h("button", { class: "btn sm ghost", onclick: safely(async () => {
      if (!confirm(`Mark all ${ready.length} as already in ACGME? Only do this if you entered them yourself.`)) return;
      await markCasesEntered(pid, ready.map((c) => c.id), true);
      closeSheet();
      ctx.render();
    }) }, "I entered these myself")));
  }
  openSheet("Enter in ACGME", body);
}

function iphoneSteps(code) {
  return h("ol", { class: "steps" },
    h("li", null, h("button", { class: "btn sm primary", onclick: () => copyText(code, "Log cases button") }, icon("copy"), "Copy the Log cases button")),
    h("li", null, "In Safari, on any page, add it to Favorites: ≡ beside the address › Tab Actions › Add to Favorites (or Share ", icon("share", 'class="glyph"'), " › Add to Favorites). Name it Log cases and tap Save."),
    h("li", null, "Tap the address bar, then the book icon at the top. Touch and hold Log cases › Edit. Clear the address, paste, and tap Save."),
    h("li", null, "Try it: ", h("a", { href: ACGME_ADD, onclick: (e) => { e.preventDefault(); openAcgme(); } }, "open ACGME in Safari"), ", tap the address bar, then Log cases under Bookmarks. (Typing its name won't run it: Safari only runs it from Bookmarks.)"));
}

function computerSteps(code, helper) {
  const link = h("a", { class: "btn sm", href: code, draggable: "true", onclick: (e) => { e.preventDefault(); toast("Drag it to your bookmarks bar"); } }, icon("add"), "Log cases");
  const setupUrl = `${location.origin}/acgme-setup.html#k=${encodeURIComponent(helper)}`;
  const mail = `mailto:?subject=${encodeURIComponent("My ACGME Log cases button")}&body=${encodeURIComponent(`Open this on the computer you use for ACGME and drag the button to your bookmarks bar:\n\n${setupUrl}\n\nIt's your own link: don't share it.`)}`;
  return h("ol", { class: "steps" },
    h("li", null, "On the computer you use for ACGME, show the bookmarks bar (Ctrl+Shift+B, or Cmd+Shift+B on a Mac)."),
    h("li", null, isIOS() ? h("a", { href: mail }, "Email yourself the link for the computer") : ["Drag this to the bookmarks bar: ", link], isIOS() ? ", open it there, and drag the button it shows to the bookmarks bar." : null),
    h("li", null, "On ACGME's Add Case page, click Log cases for each case, check it and click Submit."));
}

// ---- Today ----
// After an OR day (from 11a on), or for a recent day with nothing logged: one card that opens the
// day's cases, already laid out.
export function casesTodayCard(ctx) {
  const { model, state } = ctx;
  const pid = state.me;
  if (!pid || state.date > state.today) return null;
  const date = state.date;
  const day = dayCases(model, pid, date);
  ensureLoaded(pid);
  const note = dayNote(pid, date);
  const { ready: waiting } = waitingOf(pid);
  const real = casesOnDay(pid, date);
  const total = Math.max(day.expected, real.length);
  const readyHere = real.filter(isReady).length;
  const tooEarly = date === state.today && nowMinutesLocal() < 660;
  // Interns log now and then (a line, an intubation): no prompts for them, just the shortcut.
  const intern = isIntern(model, pid);
  const needsLog = !intern && day.kind && !note.none && !tooEarly && !(total && readyHere >= total && real.length >= total);
  const behind = waiting.length >= 10 || (waiting[0] && diffDays(waiting[0].date, state.today) >= 7);
  // Recent days with nothing at all logged, counted only from the first day this resident logged.
  const first = allCases(pid).reduce((m, c) => (!m || c.day < m ? c.day : m), "");
  const missed = [];
  for (let i = 1; i <= 6 && date === state.today && first && !intern; i++) {
    const d = addDays(state.today, -i);
    if (d > first && dayCases(model, pid, d).kind && !casesOnDay(pid, d).length && !dayNote(pid, d).none) missed.push(d);
  }
  if (!needsLog && !behind && !missed.length) return null;
  const title = needsLog
    ? (real.length ? `${readyHere} of ${total} cases logged` : date === state.today ? "Log today's cases" : `Log your cases from ${fmtDate(date)}`)
    : behind ? `${plural(waiting.length, "case")} waiting for ACGME` : `${plural(missed.length, "day")} with nothing logged`;
  const sub = needsLog ? [day.where, day.expected ? plural(day.expected, "case") + " on the sheet, already laid out" : "About a minute"].filter(Boolean).join(" · ")
    : behind ? "Entering them takes a few minutes, one tap each." : missed.map((d) => fmtDate(d)).join(", ");
  return h("section", { class: "card card-pad reminder" },
    h("div", { class: "avatar", style: { "--c": "var(--accent)" } }, icon("check")),
    h("div", { class: "main" },
      h("div", { class: "name" }, title),
      h("div", { class: "small muted" }, sub),
      needsLog && missed.length ? h("div", { class: "small muted" }, `Also nothing logged: ${missed.map((d) => fmtDate(d)).join(", ")}`) : null,
      h("div", { class: "btnrow" },
        needsLog ? h("button", { class: "btn sm primary", onclick: () => ctx.go("cases") }, real.length ? "Finish" : total ? `Log ${total}` : "Log cases")
          : behind ? h("button", { class: "btn sm primary", onclick: () => ctx.go("cases/acgme") }, "Enter in ACGME")
            : h("button", { class: "btn sm primary", onclick: () => ctx.go(`cases/${missed.at(-1)}`) }, "Log them"),
        needsLog && !real.length ? h("button", { class: "btn sm ghost", onclick: () => { setDayNote(pid, date, { none: true }); ctx.render(); } }, "No cases") : null)));
}

// On Today for interns, and for anyone on an ICU month: one quiet line of buttons. Not a reminder:
// no dot and no alert, it's just there for the day something happens.
export function procedureShortcut(ctx) {
  const { model, state } = ctx;
  const pid = state.me;
  if (!pid || state.date > state.today) return null;
  const d = model.day(pid, state.date);
  const icu = ["9-ICU", "SG-ICU"].includes(d.code);
  if (!isIntern(model, pid) && !icu) return null;
  if (["vacation", "off", "holiday"].includes(d.status)) return null;
  const go = (key) => { addProcedure(ctx, pid, state.date, key); ctx.go("cases"); };
  return h("section", { class: "card card-pad quick-proc" },
    h("div", { class: "small muted", style: { marginBottom: "8px" } }, "Did a line or an intubation? Log it:"),
    h("div", { class: "taps" }, ["proc-art", "proc-cvc", "proc-us", "proc-ett"].map((key) => h("button", { class: "tap", onclick: () => go(key) }, PRESETS[key].label)),
      h("button", { class: "tap", onclick: () => ctx.go("cases") }, "More")));
}

// For the More screen's row.
export function caseLogLine(ctx) {
  const pid = ctx.state.me;
  if (!pid) return "Pick yourself to start";
  const { ready, notReady } = waitingOf(pid);
  if (notReady.length) return `${plural(notReady.length, "case")} need details`;
  if (ready.length) return `${plural(ready.length, "case")} ready for ACGME`;
  return isIntern(ctx.model, pid) ? "Log a line or intubation in two taps" : "Log cases from your OR sheet, then into ACGME";
}

