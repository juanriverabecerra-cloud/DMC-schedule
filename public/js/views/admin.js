// Admin: uploads (call sheet, rotations, daily photo), review/edit of the daily sheet,
// phone directory, people, settings and backups. Every call sends the admin key.
import { h, icon, card, toast, notice, openSheet, avatar, classPill, segmented, append } from "../ui.js";
import { api, local } from "../api.js";
import { todayLocal, addDays, diffDays, fmtDate, fmtTime, fmtMonth, addMonths, DOW_SHORT } from "../../core/dates.js";
import { KINDS, SERIES, ROLES, OWN_ROLES, clock, parseClock, cleanPersonName } from "../../core/didactics.js";
import { renderFairness } from "./fairness.js";
import { renderInbox, inboxCounts, loadInbox } from "./inbox.js";
import { roleWord } from "../../core/model.js";
import { formatDirectoryText } from "../../core/directory.js";
import { createMatcher, splitNames, isCrnaMark } from "../../core/names.js";
import { DEFAULT_SETTINGS, FILL_TAG_LABELS, mergeSettings } from "../../core/codes.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function downscale(file, max = 2000) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const w = source.width, hgt = source.height;
  const scale = Math.min(1, max / Math.max(w, hgt));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(hgt * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
}

function fileButton(label, iconName, accept, onFile, { primary = false, capture } = {}) {
  const input = h("input", { type: "file", accept, hidden: true, capture, onchange: (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); } });
  return h("label", { class: `btn${primary ? " primary" : ""}`, style: { cursor: "pointer" } }, icon(iconName), label, input);
}

function adminLogin(ctx) {
  const input = h("input", { class: "input", type: "password", placeholder: "Admin key", autocomplete: "off", "aria-label": "Admin key" });
  const err = h("p", { class: "small", style: { color: "var(--gap)" } });
  return h("form", { class: "card card-pad", onsubmit: async (e) => {
    e.preventDefault();
    const res = await fetch("/api/login", { method: "POST", headers: { "x-admin-key": input.value.trim() } }).then((r) => r.json()).catch(() => ({}));
    if (!res.admin) { err.textContent = "That admin key didn't work."; return; }
    local.set("adminKey", input.value.trim());
    ctx.state.admin = true;
    ctx.render();
  } },
  h("p", { class: "small muted", style: { marginTop: 0 } }, "Uploads and edits need the admin key (set as ADMIN_KEY in Netlify)."),
  h("label", { class: "field" }, h("span", null, "Admin key"), input), err,
  h("button", { class: "btn primary block", type: "submit" }, "Unlock admin"));
}

function summaryView(s) {
  const lines = [];
  if (s.months) for (const m of s.months) lines.push(`${m.month}: ${m.residents} residents${m.lastUpdated ? ` (sheet updated ${m.lastUpdated})` : ""}`);
  if (s.ay) lines.push(`Academic year ${s.ay}–${s.ay + 1}: ${s.residents} residents`);
  if (s.interns) lines.push(`${s.interns} interns from the PGY-1 sheet`);
  if (s.added?.length) lines.push(`New people: ${s.added.join("; ")}`);
  if (s.unknownCodes?.length) lines.push(`Codes the app doesn't know yet (shown as typed): ${s.unknownCodes.join(", ")}`);
  return h("div", null,
    notice("", "check", h("b", null, "Uploaded. "), lines.join(" · ")),
    ...(s.warnings || []).map((w) => notice("warn", "alert", w)));
}

// ---------- daily sheet editor ----------

const ROOM_FIELDS = [["or", "OR", "3.5em"], ["surgeon", "Surgeon"], ["time", "Time", "4.5em"], ["cases", "#", "3em"], ["mda", "MDA"], ["staff", "Resident/CRNA"], ["ja", "JA"], ["breaks", "Breaks"]];
const list = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);

function blankDaily() {
  return { rooms: [], opsc: { rooms: "", mdas: [], residents: [] }, procedures: [], meyers: { rooms: "", mda: "" }, pat: [], ob: { mda: "", residents: [] }, night: [], notes: [], other: [], uncertain: [] };
}

// Sheets are posted the day before they apply: use the date printed on the sheet when it's
// plausible, otherwise tomorrow.
function sheetDate(printed, today) {
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(printed || "") && diffDays(today, printed) >= -3 && diffDays(today, printed) <= 10;
  return ok ? { date: printed, fromSheet: true } : { date: addDays(today, 1), fromSheet: false };
}

function openEditor(ctx, initialDate, initial, { source = "manual", photoId = null, dateNote = "", onSaved } = {}) {
  let date = initialDate;
  const data = JSON.parse(JSON.stringify({ ...blankDaily(), ...initial }));
  if (!data.rooms.length) data.rooms = Array.from({ length: 6 }, () => ({ or: "", surgeon: "", time: "", cases: "", mda: "", staff: "", ja: "", breaks: "" }));
  const match = createMatcher(ctx.state.model.people);
  const nameOk = (text) => !text || isCrnaMark(text) || splitNames(text).every((n) => roleWord(n) || /resident|rotator/i.test(n) || match(n));

  const dateHint = h("p", { class: "tiny muted", style: { margin: "6px 0 0" } });
  // The first save of a day sends everyone with alerts on a lock-screen alert. A fix to a sheet
  // that's already out only does if this is ticked.
  const realert = h("input", { type: "checkbox" });
  const realertLine = h("label", { class: "checkline", style: { margin: "0 0 10px" } }, realert, h("span", null, "Send the alert again: the rooms changed enough that people should look"));
  const showHint = () => {
    const exists = !!ctx.state.model.ds.daily?.[date];
    dateHint.textContent = [dateNote, exists ? "Saving replaces the sheet already saved for this day." : date >= todayLocal() ? "Saving sends a lock-screen alert to everyone who turned alerts on." : ""].filter(Boolean).join(" ");
    realertLine.hidden = !exists || date < todayLocal();
  };
  const dateInput = h("input", { class: "input", type: "date", value: date, "aria-label": "Sheet date", onchange: (e) => { if (e.target.value) { date = e.target.value; showHint(); } } });
  showHint();

  const roomsHolder = h("div");
  function drawRooms() {
    roomsHolder.replaceChildren(h("div", { class: "scrollx" }, h("table", { class: "edit" },
      h("thead", null, h("tr", null, ROOM_FIELDS.map(([, label]) => h("th", null, label)), h("th"))),
      h("tbody", null, data.rooms.map((room, i) => h("tr", null,
        ROOM_FIELDS.map(([key, label, width]) => {
          const isName = ["staff", "ja", "breaks"].includes(key);
          const inp = h("input", { value: room[key] || "", "aria-label": `${label} row ${i + 1}`, style: width ? { width } : null, class: isName && !nameOk(room[key]) ? "bad" : "",
            oninput: (e) => { room[key] = e.target.value; if (isName) e.target.className = nameOk(e.target.value) ? "" : "bad"; } });
          return h("td", null, inp);
        }),
        h("td", null, h("button", { class: "iconbtn", style: { width: "32px", height: "32px" }, "aria-label": "Remove row", onclick: () => { data.rooms.splice(i, 1); drawRooms(); } }, icon("x"))),
      ))))));
  }
  drawRooms();

  const field = (label, value, onInput, placeholder = "") => h("label", { class: "field" }, h("span", null, label),
    h("input", { class: "input", value, placeholder, oninput: (e) => onInput(e.target.value) }));

  const procText = h("textarea", { class: "input", style: { minHeight: "80px" }, placeholder: "Cath lab | 1 | Name" },
    data.procedures.map((p) => `${p.name} | ${p.count} | ${p.mda}`).join("\n"));
  const notesText = h("textarea", { class: "input", style: { minHeight: "70px" } }, data.notes.join("\n"));
  const saveBtn = h("button", { class: "btn primary block" }, icon("check"), "Save daily sheet");

  const body = h("div",
    null,
    h("label", { class: "field" }, h("span", null, "Sheet date"), dateInput, dateHint),
    data.uncertain?.length ? notice("warn", "alert", h("b", null, "Double-check: "), data.uncertain.join("; ")) : null,
    source === "photo" ? notice("", "sparkle", "Read from the photo by Claude. Names are matched to the resident list when you save; anything outlined doesn't match a resident yet.") : null,
    h("h4", { class: "card-title" }, "Operating rooms"),
    roomsHolder,
    h("button", { class: "btn sm", style: { margin: "6px 0 14px" }, onclick: () => { data.rooms.push({ or: "", surgeon: "", time: "", cases: "", mda: "", staff: "", ja: "", breaks: "" }); drawRooms(); } }, "+ Add room"),
    h("p", { class: "tiny muted", style: { marginTop: "-8px" } }, "Resident/CRNA: \"X\" means a CRNA room; \"A/B\" means two residents. \"PAT\" in a name cell becomes that day's PAT resident. Separate list entries below with commas."),
    h("div", { class: "grid2" },
      field("OPSC rooms", data.opsc.rooms, (v) => { data.opsc.rooms = v; }),
      field("OPSC MDAs", data.opsc.mdas.join(", "), (v) => { data.opsc.mdas = list(v); })),
    field("OPSC residents", data.opsc.residents.join(", "), (v) => { data.opsc.residents = list(v); }),
    h("label", { class: "field" }, h("span", null, "Procedure areas (name | count | MDA, one per line)"), procText),
    h("div", { class: "grid2" },
      field("Meyers lab rooms", data.meyers.rooms, (v) => { data.meyers.rooms = v; }),
      field("Meyers lab MDA", data.meyers.mda, (v) => { data.meyers.mda = v; })),
    field("PAT", data.pat.join(", "), (v) => { data.pat = list(v); }),
    h("div", { class: "grid2" },
      field("OB MDA", data.ob.mda, (v) => { data.ob.mda = v; }),
      field("OB residents", data.ob.residents.join(", "), (v) => { data.ob.residents = list(v); })),
    field("Night coverage", data.night.join(", "), (v) => { data.night = list(v); }),
    h("label", { class: "field" }, h("span", null, "Notes (one per line)"), notesText),
    realertLine,
    saveBtn,
  );

  const close = openSheet("Daily OR sheet", body);
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    data.procedures = procText.value.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((x) => x[0]).map(([name, count = "", mda = ""]) => ({ name, count, mda }));
    data.notes = notesText.value.split("\n").map((x) => x.trim()).filter(Boolean);
    data.source = source;
    try {
      const res = await api(`/api/daily/${date}`, { method: "PUT", body: { ...data, photo: photoId, notify: realert.checked && !realertLine.hidden } });
      const fixes = [...new Set((res.changes || []).map((c) => `${c.from} → ${c.to}`))];
      const sent = res.alerted ? ` · alert sent to ${res.alerted} ${res.alerted === 1 ? "phone" : "phones"}` : "";
      toast(`Saved for ${fmtDate(date)}${sent}${fixes.length ? ` · ${fixes.slice(0, 3).join(", ")}${fixes.length > 3 ? "…" : ""}` : ""}`);
      close();
      await ctx.reload();
      onSaved?.();
    } catch (err) {
      toast(err.message);
      saveBtn.disabled = false;
    }
  });
}

function dailySection(ctx, status) {
  const holder = h("div");
  const progress = h("div");
  const spinner = (text) => h("div", { style: { display: "flex", gap: "10px", alignItems: "center", marginTop: "10px" } }, h("div", { class: "spinner" }), text);
  const daily = (date) => ctx.state.model.ds.daily?.[date];

  async function readPhoto(file) {
    const tomorrow = addDays(todayLocal(), 1);
    progress.replaceChildren(spinner("Uploading photo…"));
    let id = null;
    try {
      const blob = await downscale(file);
      const res = await api("/api/photo", { method: "POST", body: blob, headers: { "content-type": "image/jpeg" } });
      id = res.id;
      if (!res.queued) {
        progress.replaceChildren();
        openEditor(ctx, tomorrow, daily(tomorrow) || {}, { photoId: id, dateNote: "Photo attached. Check the date and type in the sheet.", onSaved: draw });
        return;
      }
      const started = Date.now();
      for (;;) {
        await sleep(3000);
        const secs = Math.round((Date.now() - started) / 1000);
        progress.replaceChildren(spinner(`Reading the sheet with Claude… ${secs}s (usually under a minute)`));
        const job = await api(`/api/job/${id}`);
        if (job.status === "done") {
          progress.replaceChildren();
          const { date, fromSheet } = sheetDate(job.daily.date, todayLocal());
          openEditor(ctx, date, job.daily, {
            source: "photo", photoId: id, onSaved: draw,
            dateNote: fromSheet ? "Date read from the sheet." : "No date could be read on the sheet, so it's set to tomorrow.",
          });
          return;
        }
        if (job.status === "error") throw new Error(job.error);
        if (Date.now() - started > 5 * 60 * 1000) throw new Error("The reader is taking too long.");
      }
    } catch (err) {
      progress.replaceChildren(notice("gap", "alert", `Couldn't read the photo: ${err.message} `,
        id ? h("a", { href: "#", onclick: (e) => { e.preventDefault(); openEditor(ctx, tomorrow, daily(tomorrow) || {}, { photoId: id, onSaved: draw }); } }, "Type it in instead") : null));
    }
  }

  function dayRow(date, label) {
    const existing = daily(date);
    return h("li", { class: "row", style: { padding: "8px 0", minHeight: "52px" } },
      h("div", { class: "main" },
        h("div", { class: "name" }, `${label} · ${fmtDate(date)}`),
        h("div", { class: "sub" }, existing ? `${existing.rooms.length} rooms${existing.source === "photo" ? " · from photo" : ""}` : "Not posted yet")),
      h("button", { class: "btn sm", onclick: () => openEditor(ctx, date, existing || {}, { onSaved: draw }) }, existing ? "Edit" : "Add"),
      existing ? h("button", { class: "iconbtn", "aria-label": `Delete the sheet for ${date}`, onclick: async () => {
        if (!confirm(`Delete the daily sheet for ${fmtDate(date)}?`)) return;
        await api(`/api/daily/${date}`, { method: "DELETE" });
        await ctx.reload();
        draw();
      } }, icon("x")) : null);
  }

  function draw() {
    const today = todayLocal();
    const tomorrow = addDays(today, 1);
    holder.replaceChildren(
      h("p", { class: "small muted", style: { marginTop: 0 } }, "A backup to the live sheet above: upload the WhatsApp photo. The date comes from the sheet itself, so the evening-before sheet is filed under tomorrow automatically."),
      h("div", { class: "btnrow" },
        fileButton(status?.configured?.ai ? "Read a photo" : "Upload photo", "camera", "image/*", readPhoto, { primary: true }),
        h("button", { class: "btn", onclick: () => openEditor(ctx, tomorrow, daily(tomorrow) || {}, { onSaved: draw }) }, icon("edit"), "Enter by hand")),
      progress,
      h("ul", { class: "list", style: { marginTop: "10px" } }, dayRow(tomorrow, "Tomorrow"), dayRow(today, "Today")),
      h("label", { class: "field", style: { marginTop: "8px" } }, h("span", null, "Another day"),
        h("input", { class: "input", type: "date", onchange: (e) => e.target.value && openEditor(ctx, e.target.value, daily(e.target.value) || {}, { onSaved: draw }) })),
      status && !status.configured?.ai ? h("p", { class: "disclaimer" }, "Photo reading is off: add ANTHROPIC_API_KEY in Netlify to turn it on. Photos are still attached so residents can view them.") : null,
    );
  }
  draw();
  return card("Daily OR sheet", holder);
}

// ---------- didactics (monthly conference schedule) ----------

const peopleText = (people) => (people || []).map((p) => [p.name, p.role, p.topic || "", p.start != null && p.start !== "" ? `${clock(typeof p.start === "number" ? p.start : parseClock(p.start))}-${clock(typeof p.end === "number" ? p.end : parseClock(p.end))}` : ""]
  .join(" | ").replace(/( \| )+$/, "")).join("\n");
function parsePeople(text) {
  return text.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((x) => x[0]).map(([name, role = "presenter", topic = "", slot = ""]) => {
    const [start = "", end = ""] = slot.split(/\s*[-–]\s*/);
    return { name, role: ROLES[role.toLowerCase()] ? role.toLowerCase() : "presenter", topic, start, end };
  });
}
const toClock = (v) => (typeof v === "number" ? clock(v) : v || "");

function guessMonth() {
  const t = todayLocal();
  return Number(t.slice(8, 10)) >= 15 ? addMonths(t.slice(0, 7), 1) : t.slice(0, 7);
}

function openDidacticsEditor(ctx, initialMonth, initial, { source = "manual", pdfId = null, onSaved } = {}) {
  let month = initialMonth;
  const data = JSON.parse(JSON.stringify(initial || {}));
  data.events = (data.events || []).map((e) => ({ ...e, start: toClock(e.start), end: toClock(e.end),
    people: (e.people || []).map((p) => ({ ...p, start: toClock(p.start), end: toClock(p.end) })) }));
  data.zoom = data.zoom || [];
  const match = createMatcher(ctx.state.model.people);

  const monthHint = h("p", { class: "tiny muted", style: { margin: "6px 0 0" } });
  const showHint = () => { monthHint.textContent = ctx.state.model.ds.didactics?.[month] ? "Saving replaces this month's schedule." : ""; };
  const monthInput = h("input", { class: "input", type: "month", value: month, "aria-label": "Month", onchange: (e) => { if (e.target.value) { month = e.target.value; showHint(); } } });
  showHint();
  const locInput = h("input", { class: "input", value: data.location || "", placeholder: "Main Auditorium", oninput: (e) => { data.location = e.target.value; } });

  const zoomHolder = h("div");
  function drawZoom() {
    zoomHolder.replaceChildren(...data.zoom.map((z, i) => h("div", { class: "card card-pad", style: { margin: "0 0 8px" } },
      h("div", { class: "grid2" },
        h("label", { class: "field" }, h("span", null, "Key (wednesday, monday, friday…)"), h("input", { class: "input", value: z.key || "", oninput: (e) => { z.key = e.target.value; } })),
        h("label", { class: "field" }, h("span", null, "Label"), h("input", { class: "input", value: z.label || "", oninput: (e) => { z.label = e.target.value; } }))),
      h("label", { class: "field" }, h("span", null, "Zoom link"), h("input", { class: "input", value: z.url || "", oninput: (e) => { z.url = e.target.value; } })),
      h("div", { class: "grid2" },
        h("label", { class: "field" }, h("span", null, "Meeting ID"), h("input", { class: "input", value: z.meetingId || "", oninput: (e) => { z.meetingId = e.target.value; } })),
        h("label", { class: "field" }, h("span", null, "Passcode"), h("input", { class: "input", value: z.passcode || "", oninput: (e) => { z.passcode = e.target.value; } }))),
      h("label", { class: "field" }, h("span", null, "Dial-in numbers (comma-separated)"), h("input", { class: "input", value: (z.phones || []).join(", "), oninput: (e) => { z.phones = e.target.value.split(",").map((x) => x.trim()).filter(Boolean); } })),
      h("button", { class: "btn sm danger", onclick: () => { data.zoom.splice(i, 1); drawZoom(); drawEvents(); } }, "Remove this Zoom room"))));
  }

  const eventsHolder = h("div");
  function drawEvents() {
    const zoomKeys = data.zoom.map((z) => z.key).filter(Boolean);
    eventsHolder.replaceChildren(...data.events.map((e, i) => {
      const unknown = h("p", { class: "tiny", style: { color: "var(--warn)", margin: "4px 0 0" } });
      const check = (text) => {
        const bad = parsePeople(text).filter((p) => OWN_ROLES.has(p.role) && !/^\s*dr\.?\s/i.test(p.name) && !match(cleanPersonName(p.name))).map((p) => p.name);
        unknown.textContent = bad.length ? `Not on the resident list: ${bad.join(", ")}` : "";
      };
      const ppl = h("textarea", { class: "input", style: { minHeight: "70px" }, placeholder: "Doe | examinee | | 06:00-06:30\nDr. Smith | moderator", oninput: (ev) => { e.people = parsePeople(ev.target.value); check(ev.target.value); } }, peopleText(e.people));
      check(ppl.value);
      const sel = (opts, value, onChange) => h("select", { class: "input", onchange: (ev) => onChange(ev.target.value) }, opts.map(([v, label]) => h("option", { value: v, selected: v === value }, label)));
      const summary = `${e.date ? `${DOW_SHORT[new Date(`${e.date}T12:00:00`).getDay()]} ${e.date.slice(5)}` : "New"} · ${e.start || "?"} · ${KINDS[e.kind]?.label || "Session"}${e.title ? ` · ${e.title}` : ""}`;
      return h("details", { class: "card card-pad edit-event", open: !e.date },
        h("summary", null, summary),
        h("div", { class: "grid3" },
          h("label", { class: "field" }, h("span", null, "Date"), h("input", { class: "input", type: "date", value: e.date || "", oninput: (ev) => { e.date = ev.target.value; } })),
          h("label", { class: "field" }, h("span", null, "Start"), h("input", { class: "input", type: "time", value: e.start || "", oninput: (ev) => { e.start = ev.target.value; } })),
          h("label", { class: "field" }, h("span", null, "End"), h("input", { class: "input", type: "time", value: e.end || "", oninput: (ev) => { e.end = ev.target.value; } }))),
        h("div", { class: "grid2" },
          h("label", { class: "field" }, h("span", null, "Kind"), sel(Object.entries(KINDS).map(([k, v]) => [k, v.label]), e.kind || "other", (v) => { e.kind = v; })),
          h("label", { class: "field" }, h("span", null, "Series"), sel(Object.entries(SERIES), e.series || "other", (v) => { e.series = v; }))),
        h("label", { class: "field" }, h("span", null, "Title"), h("input", { class: "input", value: e.title || "", oninput: (ev) => { e.title = ev.target.value; } })),
        h("div", { class: "grid2" },
          h("label", { class: "field" }, h("span", null, "Room (blank = default)"), h("input", { class: "input", value: e.location || "", oninput: (ev) => { e.location = ev.target.value; } })),
          h("label", { class: "field" }, h("span", null, "Zoom"), sel([["", "None"], ...zoomKeys.map((k) => [k, data.zoom.find((z) => z.key === k)?.label || k])], e.zoom || "", (v) => { e.zoom = v; }))),
        h("div", { class: "btnrow", style: { margin: "4px 0 8px" } },
          ...[["virtual", "Virtual only"], ["cancelled", "Cancelled"], ["cme", "CME"]].map(([k, label]) => h("label", { class: "checkline", style: { margin: 0 } },
            h("input", { type: "checkbox", checked: !!e[k], onchange: (ev) => { e[k] = ev.target.checked; } }), h("span", null, label)))),
        h("label", { class: "field" }, h("span", null, "People: name | role | topic | own time slot (one per line). Roles: presenter, examinee, moderator, faculty, examiner"), ppl, unknown),
        h("label", { class: "field" }, h("span", null, "Objectives"), h("textarea", { class: "input", style: { minHeight: "50px" }, oninput: (ev) => { e.objectives = ev.target.value; } }, e.objectives || "")),
        h("button", { class: "btn sm danger", onclick: () => { data.events.splice(i, 1); drawEvents(); } }, "Remove session"));
    }));
  }
  drawZoom();
  drawEvents();

  const notesText = h("textarea", { class: "input", style: { minHeight: "50px" } }, (data.notes || []).join("\n"));
  const saveBtn = h("button", { class: "btn primary block" }, icon("check"), "Save didactics");
  const body = h("div", null,
    h("div", { class: "grid2" },
      h("label", { class: "field" }, h("span", null, "Month"), monthInput, monthHint),
      h("label", { class: "field" }, h("span", null, "Default room"), locInput)),
    data.uncertain?.length ? notice("warn", "alert", h("b", null, "Double-check: "), data.uncertain.join("; ")) : null,
    source === "pdf" ? notice("", "sparkle", "Read from the PDF by Claude. Resident names are matched to the roster when you save.") : null,
    h("h4", { class: "card-title" }, `Sessions (${data.events.length})`),
    eventsHolder,
    h("button", { class: "btn sm", style: { margin: "6px 0 14px" }, onclick: () => { data.events.push({ date: "", start: "", end: "", kind: "lecture", series: "other", title: "", people: [] }); drawEvents(); } }, "+ Add session"),
    h("h4", { class: "card-title" }, "Zoom rooms"),
    zoomHolder,
    h("button", { class: "btn sm", style: { margin: "6px 0 14px" }, onclick: () => { data.zoom.push({ key: "", label: "", url: "", phones: [], meetingId: "", passcode: "" }); drawZoom(); drawEvents(); } }, "+ Add Zoom room"),
    h("label", { class: "field" }, h("span", null, "Notes for residents (one per line)"), notesText),
    saveBtn);

  const close = openSheet("Didactics", body);
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    data.notes = notesText.value.split("\n").map((x) => x.trim()).filter(Boolean);
    try {
      const res = await api(`/api/didactics/${month}`, { method: "PUT", body: { data: { ...data, month }, pdf: pdfId } });
      const n = res.didactics.events.length;
      const fixes = [...new Set((res.changes || []).map((c) => `${c.from} → ${c.to}`))];
      toast(`Saved ${n} sessions for ${fmtMonth(month)}${fixes.length ? ` · ${fixes.slice(0, 3).join(", ")}${fixes.length > 3 ? "…" : ""}` : ""}`);
      close();
      await ctx.reload();
      onSaved?.();
    } catch (err) {
      toast(err.message);
      saveBtn.disabled = false;
    }
  });
}

function didacticsSection(ctx, status) {
  const holder = h("div");
  const progress = h("div");
  const spinner = (text) => h("div", { style: { display: "flex", gap: "10px", alignItems: "center", marginTop: "10px" } }, h("div", { class: "spinner" }), text);
  const stored = () => ctx.state.model.ds.didactics || {};

  async function readPdf(file) {
    progress.replaceChildren(spinner("Uploading PDF…"));
    let id = null;
    try {
      const res = await api("/api/didactics/pdf", { method: "POST", body: file, headers: { "content-type": "application/pdf" } });
      id = res.id;
      if (!res.queued) {
        progress.replaceChildren();
        const m = guessMonth();
        openDidacticsEditor(ctx, m, stored()[m] || {}, { pdfId: id, onSaved: draw });
        return;
      }
      const started = Date.now();
      for (;;) {
        await sleep(3000);
        const secs = Math.round((Date.now() - started) / 1000);
        progress.replaceChildren(spinner(`Reading the schedule with Claude… ${secs}s (usually under a minute)`));
        const job = await api(`/api/job/${id}`);
        if (job.status === "done") {
          progress.replaceChildren();
          const m = /^\d{4}-\d{2}$/.test(job.didactics?.month || "") ? job.didactics.month : guessMonth();
          openDidacticsEditor(ctx, m, job.didactics, { source: "pdf", pdfId: id, onSaved: draw });
          return;
        }
        if (job.status === "error") throw new Error(job.error);
        if (Date.now() - started > 5 * 60 * 1000) throw new Error("The reader is taking too long.");
      }
    } catch (err) {
      progress.replaceChildren(notice("gap", "alert", `Couldn't read the PDF: ${err.message} `,
        id ? h("a", { href: "#", onclick: (e) => { e.preventDefault(); openDidacticsEditor(ctx, guessMonth(), {}, { pdfId: id, onSaved: draw }); } }, "Type it in instead") : null));
    }
  }

  function draw() {
    const months = Object.keys(stored()).sort().reverse();
    holder.replaceChildren(
      h("p", { class: "small muted", style: { marginTop: 0 } }, "Upload the monthly conference-schedule PDF when it's emailed. Claude reads the sessions, presenters, mock-oral slots and Zoom details; check them and save. Residents see it under More › Didactics, on Today, on their profile and in their calendar."),
      h("div", { class: "btnrow" },
        fileButton(status?.configured?.ai ? "Read a PDF" : "Upload PDF", "upload", "application/pdf", readPdf, { primary: true }),
        h("button", { class: "btn", onclick: () => openDidacticsEditor(ctx, guessMonth(), stored()[guessMonth()] || {}, { onSaved: draw }) }, icon("edit"), "Enter by hand")),
      progress,
      months.length ? h("ul", { class: "list", style: { marginTop: "10px" } }, months.map((m) => {
        const d = stored()[m];
        return h("li", { class: "row", style: { padding: "8px 0", minHeight: "52px" } },
          h("div", { class: "main" },
            h("div", { class: "name" }, fmtMonth(m)),
            h("div", { class: "sub" }, `${d.events.filter((e) => !e.cancelled).length} sessions${d.hasPdf ? " · PDF attached" : ""}`)),
          h("button", { class: "btn sm", onclick: () => openDidacticsEditor(ctx, m, d, { onSaved: draw }) }, "Edit"),
          h("button", { class: "iconbtn", "aria-label": `Delete didactics for ${fmtMonth(m)}`, onclick: async () => {
            if (!confirm(`Delete the ${fmtMonth(m)} conference schedule?`)) return;
            await api(`/api/didactics/${m}`, { method: "DELETE" });
            await ctx.reload();
            draw();
          } }, icon("x")));
      })) : null,
      status && !status.configured?.ai ? h("p", { class: "disclaimer" }, "PDF reading is off: add ANTHROPIC_API_KEY in Netlify to turn it on. Without it, the PDF is still attached for residents and you can type the sessions in.") : null,
    );
  }
  draw();
  return card("Didactics", holder);
}

function uploadSection(ctx, title, help, path, extra) {
  const out = h("div");
  const ayInput = extra ? h("input", { class: "input", type: "number", min: "2020", max: "2100", placeholder: "e.g. 2026", style: { maxWidth: "140px" } }) : null;
  const btn = fileButton("Choose .xlsx", "upload", ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", async (file) => {
    out.replaceChildren(h("div", { style: { display: "flex", gap: "10px", alignItems: "center" } }, h("div", { class: "spinner" }), `Reading ${file.name}…`));
    const m = file.name.match(/(20\d\d)\s*[-–_ ]\s*(20\d\d)/);
    if (ayInput && !ayInput.value && m) ayInput.value = m[1];
    try {
      const qs = new URLSearchParams({ name: file.name });
      if (ayInput?.value) qs.set("ay", ayInput.value);
      const res = await api(`${path}?${qs}`, { method: "POST", body: await file.arrayBuffer(), headers: { "content-type": "application/octet-stream" } });
      out.replaceChildren(summaryView(res.summary));
      await ctx.reload();
    } catch (err) {
      out.replaceChildren(notice("gap", "alert", err.message));
    }
  }, { primary: true });
  return card(title, h("div", null,
    h("p", { class: "small muted", style: { marginTop: 0 } }, help),
    ayInput ? h("label", { class: "field" }, h("span", null, "Academic year starting July of (auto-filled from the file name)"), ayInput) : null,
    btn, out));
}

function directorySection(ctx) {
  const { model } = ctx;
  const text = h("textarea", { class: "input", style: { minHeight: "320px" }, spellcheck: "false", "aria-label": "Directory" },
    formatDirectoryText(model.ds, model.people));
  const out = h("div");
  const save = h("button", { class: "btn primary", onclick: async () => {
    save.disabled = true;
    try {
      const res = await api("/api/directory", { method: "PUT", body: { text: text.value } });
      const s = res.summary;
      out.replaceChildren(
        notice("", "check", h("b", null, "Saved. "), `${s.residents} residents, ${s.staff} attendings, ${s.places} places and pagers, ${s.dialing} dialing rules.`),
        s.added.length ? notice("", "user", `Added to the roster: ${s.added.join(", ")}`) : null,
        s.removed?.length ? notice("", "user", `No longer listed and no schedule, so removed: ${s.removed.join(", ")}`) : null,
        s.unmatched.length ? notice("warn", "alert", `These residents didn't match anyone (add a class like "| PGY-1" to add them): ${s.unmatched.join(", ")}`) : null,
        ...(s.warnings || []).map((w) => notice("warn", "alert", w)));
      await ctx.reload();
    } catch (err) {
      out.replaceChildren(notice("gap", "alert", err.message));
    } finally {
      save.disabled = false;
    }
  } }, icon("check"), "Save directory");
  const load = fileButton("Import .txt", "upload", ".txt,text/plain", async (file) => {
    text.value = await file.text();
    out.replaceChildren(notice("", "info", `Loaded ${file.name}. Review it, then Save.`));
  });
  const download = h("button", { class: "btn", onclick: () => {
    const url = URL.createObjectURL(new Blob([text.value], { type: "text/plain" }));
    const a = h("a", { href: url, download: "dmc-directory.txt" });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } }, "Download");
  return card("Directory", h("div", null,
    h("p", { class: "small muted", style: { marginTop: 0 } },
      "Everything callable in the app comes from this text. One entry per line, \"Name | number | number\"; start a section with \"## Title\". Label numbers Cisco, Cell, Ext or Pager. Sections named \"Residents\" match the roster, \"Anesthesiologists …\" are the MDAs on the daily sheet, \"Harper OR rooms\" and \"OPSC rooms\" power the room buttons, and \"Dialing\" turns extensions into numbers a cell can call."),
    text,
    h("div", { class: "btnrow", style: { marginTop: "10px" } }, save, load, download),
    out,
    h("p", { class: "disclaimer" }, "Only people with the passcode see these numbers. Never put this file in the GitHub repository.")));
}

function peopleSection(ctx) {
  const { model } = ctx;
  const all = [...model.ds.people].sort((a, b) => (a.cls || "").localeCompare(b.cls || "") || a.last.localeCompare(b.last));
  return card("People", h("ul", { class: "list" }, all.map((p) => {
    const cls = h("select", { class: "input", style: { width: "92px", padding: "6px 8px", fontSize: "14px" }, "aria-label": `Class for ${p.last}` },
      ["CA-1", "CA-2", "CA-3", "PGY-1"].map((c) => h("option", { value: c, selected: p.cls === c ? true : null }, c)));
    cls.value = p.cls || "CA-1";
    cls.addEventListener("change", async () => { await api(`/api/people/${p.id}`, { method: "PATCH", body: { cls: cls.value } }); toast("Saved"); ctx.reload(); });
    const hide = h("input", { type: "checkbox", checked: !p.hidden, "aria-label": `Show ${p.last}`, onchange: async (e) => { await api(`/api/people/${p.id}`, { method: "PATCH", body: { hidden: !e.target.checked } }); toast(e.target.checked ? "Shown" : "Hidden"); ctx.reload(); } });
    const remove = h("button", { class: "iconbtn", "aria-label": `Remove ${p.last} from the app`, title: "Left the program: remove", onclick: async () => {
      if (!confirm(`Remove ${p.preferred || p.first} ${p.last} from the app?\n\nTheir call-sheet rows, planned rotations and phone numbers are deleted. If a file you upload later lists them, they'll be added back.`)) return;
      try { await api(`/api/people/${p.id}`, { method: "DELETE" }); toast(`Removed ${p.last}`); await ctx.reload(); ctx.render(); } catch (err) { toast(err.message); }
    } }, icon("x"));
    return h("li", { class: "row", style: { minHeight: "52px" } },
      avatar(model, p.id, "sm"),
      h("div", { class: "main" }, h("div", { class: "name" }, `${p.last}, ${p.preferred || p.first}`, p.hidden ? h("span", { class: "pill" }, "hidden") : null, p.former ? h("span", { class: "pill" }, "former") : null),
        p.aliases?.length ? h("div", { class: "sub tiny" }, `Also: ${p.aliases.join("; ")}`) : null),
      cls, h("label", { title: "Show in the app", style: { display: "flex", alignItems: "center", gap: "4px", fontSize: "12px" } }, hide, "show"), remove);
  })), { pad: false, right: `${all.length}` });
}

const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const fromHHMM = (s) => { const [hh, mm] = String(s).split(":").map(Number); return hh * 60 + (mm || 0); };

function settingsSection(ctx) {
  const S = mergeSettings(ctx.model.ds.settings);
  const start = h("input", { class: "input", type: "time", value: toHHMM(S.dayHours[0]) });
  const end = h("input", { class: "input", type: "time", value: toHHMM(S.dayHours[1]) });
  const late = h("input", { class: "input", type: "time", value: toHHMM(S.lateEnd) });
  const codeHours = h("textarea", { class: "input", style: { minHeight: "80px" } },
    Object.entries(S.codeHours).map(([c, [a, b]]) => `${c}: ${toHHMM(a)}-${toHHMM(b)}`).join("\n"));
  const rules = S.staffing.map((r) => ({ ...r }));
  const rulesList = h("ul", { class: "list" }, rules.map((r) => h("li", { class: "row", style: { minHeight: "48px", padding: "6px 0" } },
    h("input", { type: "checkbox", checked: r.enabled !== false, "aria-label": r.label, onchange: (e) => { r.enabled = e.target.checked; } }),
    h("div", { class: "main small" }, r.label, h("div", { class: "tiny muted" }, r.days.map((d) => DOW_SHORT[d]).join(" "))),
    h("input", { class: "input", type: "number", min: "0", max: "9", value: r.min, style: { width: "64px", padding: "6px 8px" }, "aria-label": `Minimum for ${r.label}`, oninput: (e) => { r.min = Number(e.target.value) || 0; } }))));
  const fills = h("textarea", { class: "input", style: { minHeight: "90px" } },
    Object.entries(S.fillTags).map(([hex, tag]) => `${hex} = ${tag}`).join("\n"));
  const out = h("div");
  return card("Settings", h("div", null,
    h("p", { class: "small muted", style: { marginTop: 0 } }, `Used for duty-hour estimates. A regular day is now ${fmtTime(S.dayHours[0])}–${fmtTime(S.dayHours[1])}.`),
    h("div", { class: "grid2" }, h("label", { class: "field" }, h("span", null, "Regular day starts"), start), h("label", { class: "field" }, h("span", null, "Regular day ends"), end)),
    h("label", { class: "field" }, h("span", null, "Late resident stays until"), late),
    h("label", { class: "field" }, h("span", null, "Hours by code (CODE: HH:MM-HH:MM)"), codeHours),
    h("h4", { class: "card-title", style: { marginTop: "14px" } }, "Expected staffing (coverage-gap checks)"),
    rulesList,
    h("label", { class: "field", style: { marginTop: "12px" } }, h("span", null, `Cell colors (HEX = ${Object.keys(FILL_TAG_LABELS).join(" | ")})`), fills),
    h("div", { class: "btnrow" },
      h("button", { class: "btn primary", onclick: async () => {
        const ch = {};
        for (const line of codeHours.value.split("\n")) {
          const m = line.match(/^\s*([^:]+):\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
          if (m) ch[m[1].trim().toUpperCase()] = [fromHHMM(m[2]), fromHHMM(m[3]) <= fromHHMM(m[2]) ? fromHHMM(m[3]) + 1440 : fromHHMM(m[3])];
        }
        const ft = {};
        for (const line of fills.value.split("\n")) {
          const m = line.match(/^\s*#?([0-9a-f]{6})\s*=\s*(\w+)/i);
          if (m && FILL_TAG_LABELS[m[2]]) ft[m[1].toUpperCase()] = m[2];
        }
        const settings = { dayHours: [fromHHMM(start.value), fromHHMM(end.value)], lateEnd: fromHHMM(late.value), codeHours: ch, staffing: rules, fillTags: ft };
        try { await api("/api/settings", { method: "PUT", body: settings }); out.replaceChildren(notice("", "check", "Settings saved.")); await ctx.reload(); } catch (err) { out.replaceChildren(notice("gap", "alert", err.message)); }
      } }, "Save settings"),
      h("button", { class: "btn", onclick: async () => {
        if (!confirm("Reset all settings to defaults?")) return;
        await api("/api/settings", { method: "PUT", body: {} });
        await ctx.reload();
        toast("Settings reset");
      } }, "Reset")),
    out,
    h("p", { class: "disclaimer" }, `Defaults: regular day ${fmtTime(DEFAULT_SETTINGS.dayHours[0])}–${fmtTime(DEFAULT_SETTINGS.dayHours[1])}, late until ${fmtTime(DEFAULT_SETTINGS.lateEnd)}.`)));
}

// The board runner's live workbook. The link goes to the server and never comes back: this
// screen only ever shows whether it's connected and how it's doing.
function liveSheetCard(ctx) {
  const body = h("div", null, h("p", { class: "small muted", style: { margin: 0 } }, "Loading…"));
  const stamp = (iso) => (iso ? `${fmtDate(todayLocal(new Date(iso)))}, ${new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "—");
  const run = async (btn, job, done) => {
    btn.disabled = true;
    try { const s = await job(); if (done) toast(typeof done === "function" ? done(s) : done); await ctx.reload({ quiet: true }); draw(s); } catch (err) { toast(err.message); btn.disabled = false; }
  };
  function draw(s) {
    body.replaceChildren();
    if (!s.connected) {
      const input = h("input", { class: "input", type: "url", autocomplete: "off", placeholder: "Paste the Google Sheets link", "aria-label": "Google Sheets link" });
      const go = h("button", { class: "btn primary", style: { marginTop: "8px" } }, icon("link"), "Connect");
      go.addEventListener("click", () => run(go, () => api("/api/daily-source", { method: "PUT", body: { url: input.value } }), "Connected"));
      append(body, [
        h("p", { class: "small muted", style: { marginTop: 0 } }, "Connect the board runner's sheet once, and the app reads it every 3 minutes from about 5a to midnight. The link stays on the server: residents never see it, and it isn't in backups."),
        input, go,
      ]);
      return;
    }
    const check = h("button", { class: "btn sm" }, icon("refresh"), "Check now");
    check.addEventListener("click", () => run(check, () => api("/api/daily-source/check", { method: "POST" })));
    const alertBtn = h("button", { class: "btn sm" }, icon("bell"), "Send alert now");
    alertBtn.addEventListener("click", () => { if (confirm("Tell everyone with alerts on that this sheet is ready?")) run(alertBtn, () => api("/api/daily-source/alert", { method: "POST" }), (r) => `Alert sent to ${r.alerted} ${r.alerted === 1 ? "phone" : "phones"}`); });
    const off = h("button", { class: "btn sm danger" }, "Disconnect");
    off.addEventListener("click", () => { if (confirm("Stop reading the sheet automatically?")) run(off, () => api("/api/daily-source", { method: "DELETE" }), "Disconnected"); });
    append(body, [
      s.error ? notice("gap", "alert", h("b", null, "Can't read the sheet. "), `${s.error} The app keeps the last good version. The photo upload below still works.`) : null,
      s.held ? notice("warn", "info", h("b", null, "Latest version not shown. "), s.held) : null,
      h("dl", { class: "kv" },
        h("dt", null, "Sheet date"), h("dd", null, s.date ? fmtDate(s.date) : "—"),
        h("dt", null, "Last checked"), h("dd", null, stamp(s.checkedAt)),
        h("dt", null, "Last change"), h("dd", null, stamp(s.changedAt)),
        h("dt", null, "Alert"), h("dd", null, s.alertedAt ? `Sent ${stamp(s.alertedAt)}` : "Waits until the sheet settles")),
      h("p", { class: "tiny muted" }, "Every change shows in the app within a few minutes, marked as still being finalized. Phones get one alert, after 2p, once the sheet has sat unchanged for 45 minutes with every room staffed. After that, only residents whose own assignment changed hear about it, once."),
      h("div", { class: "btnrow" }, check, s.alertedAt ? null : alertBtn, off),
    ]);
  }
  api("/api/daily-source").then(draw).catch(() => body.replaceChildren(h("p", { class: "small muted", style: { margin: 0 } }, "Couldn't load the sheet's status.")));
  return card("Live daily sheet", body);
}

function backupSection(ctx) {
  return card("Backup", h("div", null,
    h("p", { class: "small muted", style: { marginTop: 0 } }, "Download everything (schedules, daily sheets, directory, settings) as one file, or restore from one. Keep backups private: they contain everyone's schedule."),
    h("div", { class: "btnrow" },
      h("button", { class: "btn", onclick: async () => {
        const res = await api("/api/export", { raw: true });
        const url = URL.createObjectURL(await res.blob());
        const a = h("a", { href: url, download: `dmc-schedule-backup-${todayLocal()}.json` });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } }, icon("upload"), "Download backup"),
      fileButton("Restore", "refresh", "application/json,.json", async (file) => {
        if (!confirm("Replace everything on the server with this backup?")) return;
        try { await api("/api/import", { method: "POST", body: JSON.parse(await file.text()) }); await ctx.reload(); toast("Restored"); } catch (err) { toast(err.message); }
      }))));
}

export function renderAdmin(ctx, arg) {
  const root = h("div");
  if (!local.get("adminKey")) { root.append(adminLogin(ctx)); return root; }
  // An alert or the Today card links straight to the requests.
  if (arg === "requests") { local.set("adminTab", "requests"); history.replaceState(null, "", "#/admin"); }
  const tab = local.get("adminTab", "uploads");
  loadInbox(ctx);
  const waiting = inboxCounts(ctx.state.today).open;
  root.append(h("div", { style: { marginBottom: "12px" } }, segmented([["uploads", "Uploads"], ["fairness", "Fairness"], ["requests", waiting ? `Requests · ${waiting}` : "Requests"]], tab, (v) => { local.set("adminTab", v); ctx.render(); })));
  if (tab === "fairness") { root.append(renderFairness(ctx)); return root; }
  if (tab === "requests") { root.append(renderInbox(ctx)); return root; }
  const statusHolder = h("div");
  const dailyHolder = h("div");
  const didHolder = h("div");
  root.append(statusHolder);
  api("/api/status").then((status) => {
    statusHolder.replaceChildren(
      !status.configured.ai ? notice("warn", "info", "Photo and PDF reading are off until ANTHROPIC_API_KEY is set in Netlify.") : notice("", "sparkle", "Photo and PDF reading are on: upload the WhatsApp photo or the conference PDF and review what Claude read before saving."),
    );
    dailyHolder.replaceChildren(dailySection(ctx, status));
    didHolder.replaceChildren(didacticsSection(ctx, status));
  }).catch(() => { dailyHolder.replaceChildren(dailySection(ctx, null)); didHolder.replaceChildren(didacticsSection(ctx, null)); });
  root.append(
    liveSheetCard(ctx),
    dailyHolder,
    uploadSection(ctx, "Monthly call schedule", "The .xlsx the program coordinator emails each month. Re-uploading a month replaces it; other months are kept.", "/api/upload/call"),
    uploadSection(ctx, "Annual rotations", "The yearly rotations-by-site .xlsx. Used for months that don't have a call sheet yet.", "/api/upload/rotations", true),
    didHolder,
    directorySection(ctx),
    peopleSection(ctx),
    settingsSection(ctx),
    backupSection(ctx),
    h("button", { class: "btn block sm", onclick: () => { local.del("adminKey"); ctx.state.admin = false; ctx.render(); } }, "Lock admin on this device"),
  );
  return root;
}

export { classPill };
