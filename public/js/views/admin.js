// Admin: uploads (call sheet, rotations, daily photo), review/edit of the daily sheet,
// phone directory, people, settings and backups. Every call sends the admin key.
import { h, icon, card, toast, notice, openSheet, avatar, classPill } from "../ui.js";
import { api, local } from "../api.js";
import { todayLocal, addDays, diffDays, fmtDate, fmtTime, DOW_SHORT } from "../../core/dates.js";
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
  const showHint = () => {
    dateHint.textContent = [dateNote, ctx.state.model.ds.daily?.[date] ? "Saving replaces the sheet already saved for this day." : ""].filter(Boolean).join(" ");
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
    saveBtn,
  );

  const close = openSheet("Daily OR sheet", body);
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    data.procedures = procText.value.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((x) => x[0]).map(([name, count = "", mda = ""]) => ({ name, count, mda }));
    data.notes = notesText.value.split("\n").map((x) => x.trim()).filter(Boolean);
    data.source = source;
    try {
      const res = await api(`/api/daily/${date}`, { method: "PUT", body: { ...data, photo: photoId } });
      const fixes = [...new Set((res.changes || []).map((c) => `${c.from} → ${c.to}`))];
      toast(`Saved for ${fmtDate(date)}${fixes.length ? ` · ${fixes.slice(0, 3).join(", ")}${fixes.length > 3 ? "…" : ""}` : ""}`);
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
      h("p", { class: "small muted", style: { marginTop: 0 } }, "Upload the WhatsApp photo when it's posted. The date comes from the sheet itself, so the evening-before sheet is filed under tomorrow automatically."),
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
    return h("li", { class: "row", style: { minHeight: "52px" } },
      avatar(model, p.id, "sm"),
      h("div", { class: "main" }, h("div", { class: "name" }, `${p.last}, ${p.preferred || p.first}`, p.hidden ? h("span", { class: "pill" }, "hidden") : null),
        p.aliases?.length ? h("div", { class: "sub tiny" }, `Also: ${p.aliases.join("; ")}`) : null),
      cls, h("label", { title: "Show in the app", style: { display: "flex", alignItems: "center", gap: "4px", fontSize: "12px" } }, hide, "show"));
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

export function renderAdmin(ctx) {
  const root = h("div");
  if (!local.get("adminKey")) { root.append(adminLogin(ctx)); return root; }
  const statusHolder = h("div");
  const dailyHolder = h("div");
  root.append(statusHolder);
  api("/api/status").then((status) => {
    statusHolder.replaceChildren(
      !status.configured.ai ? notice("warn", "info", "Photo reading is off until ANTHROPIC_API_KEY is set in Netlify.") : notice("", "sparkle", "Photo reading is on: upload the WhatsApp photo and review what Claude read before saving."),
    );
    dailyHolder.replaceChildren(dailySection(ctx, status));
  }).catch(() => dailyHolder.replaceChildren(dailySection(ctx, null)));
  root.append(
    dailyHolder,
    uploadSection(ctx, "Monthly call schedule", "The .xlsx the program coordinator emails each month. Re-uploading a month replaces it; other months are kept.", "/api/upload/call"),
    uploadSection(ctx, "Annual rotations", "The yearly rotations-by-site .xlsx. Used for months that don't have a call sheet yet.", "/api/upload/rotations", true),
    directorySection(ctx),
    peopleSection(ctx),
    settingsSection(ctx),
    backupSection(ctx),
    h("button", { class: "btn block sm", onclick: () => { local.del("adminKey"); ctx.state.admin = false; ctx.render(); } }, "Lock admin on this device"),
  );
  return root;
}

export { classPill };
