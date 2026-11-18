// Runs on ACGME's Add Case page when a resident taps their "Log cases" bookmark. It fills the
// next case from their DMC Schedule case log and stops: they check it and press ACGME's Submit.
// It never submits. After Submit the page reloads; the next tap sees the case in ACGME's own
// "Last 5 Cases" list, marks it entered in the app, and fills the one after.
(function () {
  "use strict";
  var me = document.currentScript;
  var src = new URL(me && me.src ? me.src : location.href);
  var token = src.searchParams.get("k");
  var api = src.origin + "/api/acgme/" + encodeURIComponent(token || "");
  var ADD = "/ads/CaseLogs/CaseEntry/Insert";
  var MEMO = "dmc-acgme";

  // ---- a small bar along the bottom of ACGME's page ----
  function bar(opts) {
    var old = document.getElementById("dmc-bar");
    if (old) old.remove();
    var el = document.createElement("div");
    el.id = "dmc-bar";
    el.setAttribute("role", "status");
    el.style.cssText = "position:fixed;left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom));z-index:2147483647;background:#0b0f14;color:#f2f5f9;border-radius:14px;padding:12px 14px;font:15px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35);box-sizing:border-box;width:auto;max-width:min(560px,calc(100vw - 16px));margin:0 auto;overflow-wrap:anywhere;text-align:left";
    var head = document.createElement("div");
    head.style.cssText = "display:flex;gap:8px;align-items:baseline";
    var tag = document.createElement("b");
    tag.textContent = "DMC";
    tag.style.cssText = "color:#7fb7ff;font-size:13px;letter-spacing:.04em";
    var title = document.createElement("b");
    title.textContent = opts.title;
    title.style.cssText = "flex:1";
    var close = button("×", function () { el.remove(); });
    close.setAttribute("aria-label", "Close");
    close.style.cssText += ";background:transparent;font-size:20px;padding:0 4px";
    head.append(tag, title, close);
    el.append(head);
    (opts.lines || []).forEach(function (t) {
      if (!t) return;
      var p = document.createElement("div");
      p.textContent = t;
      p.style.cssText = "margin-top:4px;color:#c9d2dc";
      el.append(p);
    });
    (opts.warnings || []).forEach(function (t) {
      var p = document.createElement("div");
      p.textContent = "⚠ " + t;
      p.style.cssText = "margin-top:6px;color:#ffcf66;font-weight:600";
      el.append(p);
    });
    if (opts.buttons && opts.buttons.length) {
      var row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;margin-top:10px;flex-wrap:wrap";
      opts.buttons.forEach(function (b) { row.append(button(b[0], b[1], b[2])); });
      el.append(row);
    }
    document.body.append(el);
    return el;
  }
  function button(label, onclick, primary) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText = "border:0;border-radius:10px;padding:8px 12px;font:600 14px -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;color:" + (primary ? "#0b0f14" : "#f2f5f9") + ";background:" + (primary ? "#7fb7ff" : "#26303b");
    b.addEventListener("click", onclick);
    return b;
  }
  function memo(next) {
    try {
      if (next === undefined) return JSON.parse(sessionStorage.getItem(MEMO) || "{}");
      sessionStorage.setItem(MEMO, JSON.stringify(next));
    } catch (e) { /* private mode */ }
    return next || {};
  }
  var norm = function (s) { return String(s || "").replace(/\s+/g, "").toLowerCase(); };
  var fold = function (s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z,' -]/g, "").replace(/\s+/g, " ").trim(); };

  // ---- where are we? ----
  // (A copy of the form on the developer's own machine is let through, for testing.)
  var local = /^(localhost|127\.0\.0\.1)$/.test(src.hostname) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (!token) { alert("This Log cases button is missing its link. Set it up again from the app's Case log."); return; }
  if (/acgmecloud\.org$/.test(location.hostname)) { bar({ title: "Sign in to ACGME first", lines: ["Then tap Log cases again."] }); return; }
  if (!local && !/(^|\.)acgme\.org$/.test(location.hostname)) { location.href = "https://apps.acgme.org" + ADD; return; }
  if (!local && location.pathname.indexOf(ADD) !== 0) { location.href = ADD; return; }
  var form = document.querySelector("form[action*='CaseEntry']");
  var $ = window.jQuery;
  if (!form || !$) { bar({ title: "This doesn't look like ACGME's Add Case page", lines: ["Open Case Logs › Add Cases, then tap Log cases again."] }); return; }

  // Case IDs in ACGME's own "Last 5 Cases" list.
  function recentIds() {
    var out = {};
    var tables = document.querySelectorAll("table");
    for (var i = 0; i < tables.length; i++) {
      var heads = tables[i].querySelectorAll("th");
      var isIt = false;
      for (var j = 0; j < heads.length; j++) if (heads[j].textContent.trim() === "Case ID") isIt = true;
      if (!isIt) continue;
      var cells = tables[i].querySelectorAll("td");
      for (var k = 0; k < cells.length; k++) out[norm(cells[k].textContent)] = true;
    }
    return out;
  }
  function caseIdInput() {
    var labels = form.querySelectorAll("label");
    for (var i = 0; i < labels.length; i++) {
      if (/^\s*Case ID/.test(labels[i].textContent)) {
        var input = labels[i].parentElement.querySelector("input[type=text]");
        if (input) return input;
      }
    }
    return null;
  }
  // ACGME names this field with random hex that can start with a digit, which isn't a valid CSS
  // selector, so look it up by id.
  function dateInput() {
    var app = window.caseEntryApp;
    var sel = app && app.globals && app.globals.CaseEntry89;
    var byId = typeof sel === "string" && sel.charAt(0) === "#" ? document.getElementById(sel.slice(1)) : null;
    return byId || form.querySelector(".ProcedureDate input");
  }
  function setSelect(el, value) {
    if (!el) return false;
    $(el).val(String(value)).trigger("change");
    return String(el.value) === String(value);
  }
  function supervisorValue(sel, sup) {
    if (!sel || !sup || !sup.last) return null;
    var L = fold(sup.last), F = fold(sup.first);
    var list = [];
    for (var i = 0; i < sel.options.length; i++) {
      var o = sel.options[i];
      if (!o.value) continue;
      var parts = fold(o.text).split(",");
      list.push({ value: o.value, last: (parts[0] || "").trim(), first: (parts[1] || "").trim() });
    }
    var m = list.filter(function (p) { return p.last === L; });
    if (!m.length) m = list.filter(function (p) { return p.last.replace(/[^a-z]/g, "") === L.replace(/[^a-z]/g, ""); });
    if (m.length > 1 && F) {
      var full = m.filter(function (p) { return p.first === F; });
      var initial = m.filter(function (p) { return p.first.charAt(0) === F.charAt(0); });
      m = full.length ? full : initial.length ? initial : m;
    }
    // ACGME lists a few people twice: the same name is the same person.
    if (m.length > 1 && m.every(function (p) { return p.last === m[0].last && p.first === m[0].first; })) m = [m[0]];
    return m.length === 1 ? m[0].value : null;
  }
  function panelFor(group) {
    return document.getElementById("template_" + group) || form;
  }
  function visible(el) { return !!el && el.offsetParent !== null; }
  function setGroup(group) {
    var g = document.getElementById("procedures");
    if (!g || String(g.value) === String(group)) return true;
    $(g).val(String(group)).trigger("change");
    if (!visible(panelFor(group))) g.dispatchEvent(new Event("change", { bubbles: true }));
    var entry = window.caseEntry040;
    if (!visible(panelFor(group)) && entry && entry.handlers && entry.handlers.SwapTemplates) entry.handlers.SwapTemplates();
    return visible(panelFor(group));
  }
  function findBox(panel, item) {
    var byId = document.getElementById(String(item.id));
    if (byId && panel.contains(byId)) return byId;
    var boxes = panel.querySelectorAll("input.cbprocedureid");
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i], area = (b.getAttribute("data-area") || "").trim(), type = (b.getAttribute("data-type") || "").trim();
      if (area === item.area && (type === (item.type || item.label) || (b.parentElement && b.parentElement.textContent.trim() === item.label))) return b;
    }
    return null;
  }

  function fill(c) {
    var warnings = [];
    // Start clean: ticks from an earlier try, in either group, would be sent too.
    form.querySelectorAll("input.cbprocedureid:checked").forEach(function (b) { b.checked = false; });
    form.querySelectorAll("input[type=radio][id^=CaseTypes_]:checked").forEach(function (r) { r.checked = false; });
    if (!setGroup(c.group)) warnings.push("Switch Group to " + (c.group === 680 ? "Pain Consultations and Procedures" : "Procedures") + " yourself.");

    var id = caseIdInput();
    if (id) { id.value = c.caseId; $(id).trigger("input").trigger("change"); } else warnings.push("Type the Case ID: " + c.caseId);
    var d = dateInput();
    if (d) {
      if ($.fn.datepicker) { try { $(d).datepicker("update", c.date); } catch (e) { /* plain input */ } }
      d.value = c.date;
      $(d).trigger("change");
    } else warnings.push("Set the date: " + c.date);
    if (!setSelect(document.getElementById("Institutions"), c.siteId)) warnings.push("Pick the site: " + c.siteName);
    var sel = document.getElementById("Attendings");
    var who = supervisorValue(sel, c.supervisor);
    if (who) setSelect(sel, who);
    else {
      $(sel).val("").trigger("change");
      warnings.push(c.supervisor ? "Pick the supervisor: " + c.supervisor.last + (c.supervisor.first ? ", " + c.supervisor.first : "") + " isn't clear on ACGME's list." : "Pick the supervisor.");
    }
    if (!setSelect(document.getElementById("PatientTypes"), c.ageId)) warnings.push("Pick the patient age.");
    (c.radios || []).forEach(function (r) {
      var el = document.getElementById("CaseTypes_" + r);
      if (el) { el.checked = true; $(el).trigger("change"); } else warnings.push("Couldn't tick one of the case types.");
    });
    var panel = panelFor(c.group);
    var missed = [];
    (c.items || []).forEach(function (it) {
      var box = findBox(panel, it);
      if (box) { box.checked = true; $(box).trigger("change"); } else missed.push(it.label);
    });
    if (missed.length) warnings.push("Tick these yourself: " + missed.join(", "));
    var notes = document.getElementById("Comments");
    if (notes) notes.value = c.comments || "";
    window.scrollTo({ top: 0, behavior: "smooth" });
    return warnings;
  }

  // When the resident presses ACGME's Submit on a case this filled, and ACGME's own checks pass,
  // the app hears about it right away (so the last case of a sitting isn't left "waiting"). The
  // next tap still checks ACGME's Last 5 Cases.
  var watched = null;
  function watchSubmit(c) {
    var btn = document.getElementById("submitButton");
    if (!btn) return;
    if (watched) btn.removeEventListener("click", watched, true);
    watched = function () {
      var id = caseIdInput();
      var ok = (!$.fn.valid || $(form).valid()) && form.querySelector("input.cbprocedureid:checked") && id && norm(id.value) === norm(c.caseId);
      if (!ok) return;
      var body = JSON.stringify({ entered: [c.id] });
      if (!(navigator.sendBeacon && navigator.sendBeacon(api, body))) fetch(api, { method: "POST", body: body, keepalive: true }).catch(function () {});
    };
    btn.addEventListener("click", watched, true);
  }

  function markEntered(ids) {
    if (!ids.length) return Promise.resolve();
    // Plain text, so the browser sends it without asking first.
    return fetch(api, { method: "POST", body: JSON.stringify({ entered: ids }) }).catch(function () {});
  }

  function run(data, opts) {
    opts = opts || {};
    var seen = recentIds();
    var state = memo();
    var skipped = state.skipped || [];
    var done = data.cases.filter(function (c) { return seen[norm(c.caseId)]; }).map(function (c) { return c.id; });
    if (opts.confirmed) done.push(opts.confirmed);
    markEntered(done);
    var queue = data.cases.filter(function (c) { return done.indexOf(c.id) < 0 && skipped.indexOf(c.id) < 0; });
    var later = data.notReady ? data.notReady + " more " + (data.notReady === 1 ? "needs" : "need") + " details in the app first." : "";
    if (!queue.length) {
      memo({});
      bar({ title: skipped.length ? "Done, apart from the ones you skipped" : "All caught up", lines: ["Every ready case in your case log is in ACGME.", later] });
      return;
    }
    var next = queue[0];
    var idBox = caseIdInput();
    // Filled last time but not in ACGME's list: ask rather than guess (it may have been retyped).
    if (state.filled === next.id && !opts.refill && idBox && norm(idBox.value) !== norm(next.caseId)) {
      bar({
        title: "Did " + next.caseId + " go in?",
        lines: ["It isn't in ACGME's Last 5 Cases. If you changed its Case ID before submitting, it's in."],
        buttons: [["It's in", function () { run(data, { confirmed: next.id }); }, true], ["Fill it again", function () { run(data, { refill: true }); }]],
      });
      return;
    }
    var warnings = idBox && norm(idBox.value) === norm(next.caseId) && !opts.refill && state.filled === next.id ? [] : fill(next);
    memo({ filled: next.id, skipped: skipped });
    watchSubmit(next);
    var left = queue.length;
    bar({
      title: next.caseId + (left === 1 ? " · last one" : " · " + left + " to go"),
      lines: [next.summary, left === 1 ? "Check it, then tap Submit (top right)." : "Check it, then tap Submit (top right), then Log cases again for the next."],
      warnings: warnings,
      buttons: [["Skip this one", function () { memo({ skipped: skipped.concat(next.id) }); run(data); }]],
    });
  }

  bar({ title: "Getting your cases…" });
  fetch(api).then(function (res) {
    return res.json().then(function (body) {
      if (!res.ok) throw new Error(body && body.error ? body.error : "Couldn't reach DMC Schedule.");
      return body;
    });
  }).then(function (data) { run(data); }, function (err) {
    bar({ title: "Couldn't get your cases", lines: [err.message || "Check your connection and tap Log cases again."] });
  });
})();
