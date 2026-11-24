// DOM helpers and shared components. Text always goes in through text nodes, never innerHTML.
import { fmtRange } from "../core/dates.js";
import { siteName, headline } from "../core/model.js";
import { prettyDigits, numberTag } from "../core/directory.js";

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") {
      for (const [n, val] of Object.entries(v)) if (n.startsWith("--")) el.style.setProperty(n, val); else el.style[n] = val;
    }
    else if (k === "vars") for (const [n, val] of Object.entries(v)) el.style.setProperty(n, val);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = !!v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === "") continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  grid: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3 2.8-5 5.5-5s4.9 2 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.2c2.3.2 4.2 2 4.8 4.8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  pager: '<rect x="3" y="7" width="18" height="10" rx="2.5"/><path d="M7 11h6"/>',
  phone: '<path d="M5 3h3l2 5-2.5 1.5a11 11 0 0 0 7 7L16 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  message: '<path d="M4 5h16v11H8l-4 4z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.2-7 8-7s7 2.5 8 7"/>',
  swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
  shield: '<path d="M12 3 4.5 6v6c0 4.5 3.2 8 7.5 9 4.3-1 7.5-4.5 7.5-9V6z"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  event: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="m12 12.3 1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z"/>',
  arrange: '<path d="M4 6h9M4 12h9M4 18h9"/><path d="M18 5v14M15 8l3-3 3 3M15 16l3 3 3-3"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  book: '<path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-4v12l-6-4z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
  thermo: '<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  share: '<path d="M12 14V3M8 7l4-4 4 4"/><path d="M8 10H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1"/>',
  add: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v8M8 12h8"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
};

export function icon(name, extra = "") {
  const span = document.createElement("span");
  span.style.display = "contents";
  span.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${ICONS[name] || ""}</svg>`;
  return span.firstChild;
}

export function initials(name) {
  const parts = String(name).split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[parts.length - 1]?.[0] || "")).toUpperCase();
}

export function avatar(model, pid, size = "") {
  const p = model.person(pid);
  return h("div", { class: `avatar ${p?.cls || ""} ${size}`, "aria-hidden": "true" }, initials(model.name(pid)));
}

export function classPill(cls) {
  return cls ? h("span", { class: `pill ${cls}` }, cls) : null;
}

export function telHref(phone) {
  const d = String(phone).replace(/[^\d]/g, "");
  return `tel:${d.length === 10 ? `+1${d}` : d}`;
}

export function smsHref(phone, body) {
  const num = String(phone).replace(/[^\d+]/g, "");
  return body ? `sms:${num}?&body=${encodeURIComponent(body)}` : `sms:${num}`;
}

// Call button for a row; `text` adds a text-message button (only for cell numbers).
export function contactActions(phone, { text = false } = {}) {
  if (!phone) return null;
  return h("div", { class: "actions" },
    text ? h("a", { href: smsHref(phone), "aria-label": "Text", onclick: (e) => e.stopPropagation() }, icon("message")) : null,
    h("a", { href: telHref(phone), "aria-label": "Call", onclick: (e) => e.stopPropagation() }, icon("phone")),
  );
}

// How a number is named on its button. The digits are never shown: a button says what the
// number is (Mobile, Cisco, Call), and the phone app shows the digits on the way out.
const numberLabel = (num, dial) => numberTag(num) || (dial ? "Call" : num.kind === "pager" ? "Pager" : "Ext");

// Pagers and hospital-only extensions can't be dialed from a cell, so they copy and say what was copied.
const copyNumber = (num, e) => {
  e?.stopPropagation();
  copyText(num.value, `${numberTag(num) || (num.kind === "pager" ? "Pager" : "Ext")} ${num.value}`);
};

// One number as an action, the same pill everywhere: dialable numbers are blue and call, and a
// mobile adds a text button. Anything that can only be copied is grey.
export function numberButton(dir, num, { label } = {}) {
  const dial = dir.dial(num);
  const name = label || numberLabel(num, dial);
  if (!dial) {
    return h("button", { class: "numbtn copy", type: "button", title: `${dir.text(num)}: tap to copy`, onclick: (e) => copyNumber(num, e) },
      icon(num.kind === "pager" ? "pager" : "phone"), name);
  }
  const call = h("a", { class: "numbtn", href: telHref(dial), "aria-label": `Call ${name}`, title: dir.text(num), onclick: (e) => e.stopPropagation() }, icon("phone"), name);
  if (numberTag(num) !== "Mobile") return call;
  return h("span", { class: "numpair" }, call,
    h("a", { class: "numbtn icononly", href: smsHref(dial), "aria-label": `Text ${name}`, title: `Text ${prettyDigits(dial)}`, onclick: (e) => e.stopPropagation() }, icon("message")));
}

// All of a contact's numbers, the default first. Two of the same kind are told apart: "Call 1", "Call 2".
export function numberButtons(dir, numbers) {
  const ordered = dir.inCallOrder(numbers);
  const labels = ordered.map((n) => numberLabel(n, dir.dial(n)));
  const seen = {};
  return ordered.map((n, i) => {
    const name = labels[i];
    seen[name] = (seen[name] || 0) + 1;
    return numberButton(dir, n, { label: labels.filter((l) => l === name).length > 1 ? `${name} ${seen[name]}` : name });
  });
}

// The same pill, named for who or what it calls, e.g. "OR 15" or an MDA.
export function callChip(dir, text, numbers) {
  const num = dir.primary(numbers) || numbers?.[0];
  if (!num) return null;
  const dial = dir.dial(num);
  return dial
    ? h("a", { class: "numbtn", href: telHref(dial), "aria-label": `Call ${text}`, title: dir.text(num), onclick: (e) => e.stopPropagation() }, icon("phone"), text)
    : h("button", { class: "numbtn copy", type: "button", onclick: (e) => copyNumber(num, e), title: `${dir.text(num)}: tap to copy` }, icon(num.kind === "pager" ? "pager" : "phone"), text);
}

// Status chips for one resident-day.
export function dayChips(d, { withTime = true } = {}) {
  const chips = [];
  const s = d.shifts[0];
  if (withTime && s) chips.push(h("span", { class: "chip time" }, fmtRange(s.start, s.end)));
  if (d.late) chips.push(h("span", { class: "chip late" }, "Late till 6p"));
  if (d.call === "H1" || d.call === "24") chips.push(h("span", { class: "chip call24" }, d.call === "H1" ? "H1 · 24h" : "24h call"));
  if (d.call === "H2") chips.push(h("span", { class: "chip call12" }, "H2 · 12h"));
  if (d.call === "NF") chips.push(h("span", { class: "chip night" }, "Night float"));
  if (d.call === "10-7") chips.push(h("span", { class: "chip senior" }, "10a–7p"));
  if (d.cardiac) chips.push(h("span", { class: "chip cardiac" }, "Cardiac call"));
  if (d.status === "vacation") chips.push(h("span", { class: "chip vac" }, "Vacation"));
  if (d.status === "postcall") chips.push(h("span", { class: "chip pc" }, "Post-call"));
  if (d.status === "holiday") chips.push(h("span", { class: "chip pc" }, "Holiday"));
  if (d.covering) chips.push(h("span", { class: "chip warn" }, "Covering"));
  if (d.changed) chips.push(h("span", { class: "chip gap" }, "Changed"));
  if (d.noCall) chips.push(h("span", { class: "chip pc" }, "No call"));
  return chips;
}

// One resident in a list. `sub` overrides the default description.
export function personRow(ctx, d, { sub, side, chips = true, onClick } = {}) {
  const { model } = ctx;
  const p = model.person(d.pid);
  const desc = sub ?? [headline(d), siteName(d)].filter((x, i, a) => x && a.indexOf(x) === i).join(" · ");
  return h("li", { class: "row tap", onclick: onClick || (() => ctx.go(`p/${d.pid}`)) },
    avatar(model, d.pid),
    h("div", { class: "main" },
      h("div", { class: "name" }, h("span", { class: "n" }, model.name(d.pid)), classPill(p?.cls), ctx.state.me === d.pid ? h("span", { class: "pill" }, "You") : null),
      desc ? h("div", { class: "sub" }, desc) : null,
      chips ? h("div", { class: "chips", style: { marginTop: "5px" } }, dayChips(d, { withTime: false })) : null,
    ),
    side ? h("div", { class: "side" }, side) : null,
    contactActions(model.phone(d.pid)),
  );
}

// ---- two columns on a wide screen ----
// Card screens on a wide screen (the Duo opened, an iPad, a computer) use two columns, read down
// the first and then the second. They're two real stacks rather than CSS columns, which in Safari
// can split a card or push a margin to the top of the second column. The break goes where the
// taller column is as short as it can be, and a section title stays with what follows it.
// A full-width piece (a search box, a toolbar) stays full width with columns below it. A `.flow`
// box (a list the screen redraws as you search or filter) is split inside itself; the screen
// calls splitColumns on it again after each redraw, or after cards that load later arrive. It
// can run again on a box it already split, and leaves alone a box someone is typing in.
const COL_GAP = 16;
export function splitColumns(box) {
  if (!box?.isConnected || document.body.dataset.layout !== "cols") return;
  const typing = document.activeElement?.matches?.("input, textarea, select") && box.contains(document.activeElement);
  if (typing) return;
  // Undo an earlier split first: its columns hold the pieces in their original order.
  for (const done of [...box.children].filter((k) => k.matches(".cols2"))) done.replaceWith(...[...done.children].flatMap((col) => [...col.children]));
  const view = document.getElementById("view");
  const style = getComputedStyle(view);
  const width = view.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  if (width < 580) return;
  const kids = [...box.children];
  const flows = kids.filter((k) => k.matches(".flow"));
  if (kids.length >= 2) {
    // Measure everything at the width it will have.
    box.style.width = `${(width - COL_GAP) / 2}px`;
    const tall = new Map(kids.map((k) => [k, k.getBoundingClientRect().height + (parseFloat(getComputedStyle(k).marginBottom) || 0)]));
    box.style.width = "";
    const out = [];
    let run = []; // pieces, each a section title with what follows it, or one element
    const flush = () => {
      if (run.length < 2) { out.push(...run.flat()); run = []; return; }
      const hs = run.map((piece) => piece.reduce((a, k) => a + tall.get(k), 0));
      const total = hs.reduce((a, b) => a + b, 0);
      let best = 1, bestH = Infinity, acc = 0;
      for (let i = 1; i < run.length; i++) {
        acc += hs[i - 1];
        const hgt = Math.max(acc, total - acc);
        if (hgt < bestH) { bestH = hgt; best = i; }
      }
      out.push(h("div", { class: "cols2" }, h("div", { class: "col" }, run.slice(0, best).flat()), h("div", { class: "col" }, run.slice(best).flat())));
      run = [];
    };
    for (const k of kids) {
      if (k.matches(".span-all, .toolbar, .flow")) { flush(); out.push(k); continue; }
      const last = run.at(-1);
      if (last && last.at(-1).matches(".section-title")) last.push(k); else run.push([k]);
    }
    flush();
    box.replaceChildren(...out);
  }
  for (const f of flows) splitColumns(f);
}

export function card(title, body, { right, pad = true } = {}) {
  return h("section", { class: "card" },
    // A list or grid brings its own top padding, so the title sits as close to it as to text.
    title ? h("div", { class: "card-pad", style: { paddingBottom: "0" } }, h("h3", { class: "card-title", style: pad ? null : { marginBottom: "2px" } }, title, right ? h("span", { class: "right" }, right) : null)) : null,
    pad ? h("div", { class: "card-pad", style: title ? { paddingTop: "0" } : null }, body) : body,
  );
}

export function emptyState(iconName, title, text, action) {
  return h("div", { class: "empty-state" }, icon(iconName), h("h3", null, title), text ? h("p", null, text) : null, action || null);
}

export function notice(kind, iconName, ...children) {
  return h("div", { class: `notice ${kind}` }, icon(iconName), h("div", null, ...children));
}

let toastTimer;
export function toast(text) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// For a button that saves something: if it fails, say why instead of doing nothing.
export const safely = (work) => async (...args) => {
  try { return await work(...args); } catch (err) { toast(err.message || "That didn't work."); return undefined; }
};

let closeOpenSheet = null;
export const closeSheet = () => closeOpenSheet?.();

export function openSheet(title, content) {
  closeSheet();
  const root = document.getElementById("sheet-root");
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => {
    root.replaceChildren();
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKey);
    if (closeOpenSheet === close) closeOpenSheet = null;
  };
  closeOpenSheet = close;
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "grab" }),
    h("div", { class: "sheet-head" }, h("h3", null, title), h("button", { class: "iconbtn", "aria-label": "Close", onclick: close }, icon("x"))),
    content,
  );
  root.append(h("div", { class: "sheet-backdrop", onclick: close }), sheet);
  document.body.style.overflow = "hidden";
  document.addEventListener("keydown", onKey);
  return close;
}

export async function copyText(text, shown) {
  try {
    await navigator.clipboard.writeText(text);
    toast(shown ? `${shown} copied` : "Copied");
  } catch {
    window.prompt("Copy this:", text);
  }
}

export function segmented(options, value, onChange) {
  return h("div", { class: "segmented", role: "group" }, options.map(([v, label]) =>
    h("button", { type: "button", "aria-pressed": String(v === value), onclick: () => onChange(v) }, label)));
}
