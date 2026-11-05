// DOM helpers and shared components. Text always goes in through text nodes, never innerHTML.
import { fmtRange } from "../core/dates.js";
import { siteName, headline } from "../core/model.js";

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
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
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

// One number as an action: dialable numbers call, extensions without a dialing rule and
// pagers copy (they only work from a hospital phone or the paging system).
export function numberButton(dir, num, { compact = false } = {}) {
  const dial = dir.dial(num);
  const label = num.kind === "pager" ? `Pager ${num.value}` : num.kind === "ext" && !dial ? `Ext ${num.value}` : compact ? (num.label && !["Phone", "Ext"].includes(num.label) ? num.label : "Call") : dir.text(num);
  if (dial) {
    return h("a", { class: `numbtn${compact ? " compact" : ""}`, href: telHref(dial), onclick: (e) => e.stopPropagation(), title: dir.text(num) },
      icon("phone"), h("span", null, label), !compact && num.label && !["Phone", "Ext"].includes(num.label) ? h("small", null, num.label) : null);
  }
  return h("button", { class: `numbtn copy${compact ? " compact" : ""}`, type: "button", title: num.kind === "pager" ? "Copy pager number" : "Dial from a hospital phone — tap to copy",
    onclick: (e) => { e.stopPropagation(); copyText(num.value); } },
  icon(num.kind === "pager" ? "message" : "link"), h("span", null, label), !compact && num.kind !== "pager" ? h("small", null, "hospital phone") : null);
}

// Small inline chip that calls a place or person, e.g. "OR 15" or an MDA.
export function callChip(dir, text, numbers) {
  const num = dir.primary(numbers) || numbers?.[0];
  if (!num) return null;
  const dial = dir.dial(num);
  return dial
    ? h("a", { class: "chip callchip", href: telHref(dial), onclick: (e) => e.stopPropagation(), title: dir.text(num) }, icon("phone"), text)
    : h("button", { class: "chip callchip muted", type: "button", onclick: (e) => { e.stopPropagation(); copyText(num.value); }, title: `${dir.text(num)} — copy` }, icon(num.kind === "pager" ? "message" : "link"), text);
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

export function card(title, body, { right, pad = true } = {}) {
  return h("section", { class: "card" },
    title ? h("div", { class: "card-pad", style: { paddingBottom: pad ? "0" : "6px" } }, h("h3", { class: "card-title" }, title, right ? h("span", { class: "right" }, right) : null)) : null,
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

export function openSheet(title, content) {
  const root = document.getElementById("sheet-root");
  root.replaceChildren();
  const close = () => { root.replaceChildren(); document.body.style.overflow = ""; };
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "grab" }),
    h("div", { class: "sheet-head" }, h("h3", null, title), h("button", { class: "iconbtn", "aria-label": "Close", onclick: close }, icon("x"))),
    content,
  );
  root.append(h("div", { class: "sheet-backdrop", onclick: close }), sheet);
  document.body.style.overflow = "hidden";
  const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
  return close;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    window.prompt("Copy this:", text);
  }
}

export function segmented(options, value, onChange) {
  return h("div", { class: "segmented", role: "group" }, options.map(([v, label]) =>
    h("button", { type: "button", "aria-pressed": String(v === value), onclick: () => onChange(v) }, label)));
}
