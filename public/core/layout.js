// Each person's own arrangement of the app: which pages sit in the tab bar (the first one opens
// with the app) and the order of Today's cards, some of which they may hide. Kept on the device.

export const TODAY_SECTIONS = [
  { key: "day", label: "Your day", sub: "Where you are and your hours", fixed: true },
  { key: "review", label: "Year in review", sub: "Late June: your year in numbers" },
  { key: "or", label: "OR sheet", sub: "Your room, start time and cases" },
  { key: "runner", label: "Board runner", sub: "Who's running the board, on an OR or call day" },
  { key: "cases", label: "Case log", sub: "After a case day; line shortcuts for interns" },
  { key: "tomorrow", label: "Tomorrow", sub: "Once the sheet is out the evening before" },
  { key: "didactics", label: "Didactics", sub: "On days with a session" },
  { key: "events", label: "Events", sub: "Program events today or tomorrow, and RSVPs due" },
  { key: "team", label: "Working with", sub: "Who's at your site" },
  { key: "quick", label: "Quick call", sub: "Numbers you'll likely need" },
  { key: "tonight", label: "Tonight", sub: "Who's on call" },
  { key: "week", label: "This week", sub: "Your next seven days" },
  { key: "gaps", label: "Coverage gaps", sub: "When a shift has no one" },
  { key: "hours", label: "Duty hours", sub: "Your 4-week average" },
  { key: "coming", label: "Coming up", sub: "Calls, events, golden weekends and exams ahead" },
  { key: "next", label: "Next month", sub: "Your next rotation" },
  { key: "calendar", label: "Calendar", sub: "Your schedule in your phone's calendar" },
];

// Pages that can be a tab: [label, icon].
export const TAB_PAGES = {
  today: ["Today", "home"],
  tonight: ["Tonight", "moon"],
  board: ["Board", "grid"],
  didactics: ["Didactics", "book"],
  cases: ["Cases", "check"],
  call: ["Call", "phone"],
  hours: ["Hours", "clock"],
  off: ["Days off", "calendar"],
  exams: ["Exams", "edit"],
  swaps: ["Swaps", "swap"],
  gaps: ["Gaps", "alert"],
  events: ["Events", "event"],
};
export const DEFAULT_TABS = ["today", "tonight", "board", "didactics"];
export const MAX_TABS = 4; // plus More, always last

// The saved order, with anything new since (a card added in an update) slotted in after the one
// it follows by default, so nobody's arrangement hides new things or jumbles.
export function arrange(defaults, saved) {
  const known = new Set(defaults);
  const out = (Array.isArray(saved) ? saved : []).filter((k, i, a) => known.has(k) && a.indexOf(k) === i);
  defaults.forEach((k, i) => {
    if (out.includes(k)) return;
    const before = defaults.slice(0, i).reverse().find((p) => out.includes(p));
    out.splice(before ? out.indexOf(before) + 1 : 0, 0, k);
  });
  return out;
}

// The tab bar: known pages only, no repeats, at most four, and Today always among them.
export function tabsFrom(saved) {
  const list = (Array.isArray(saved) ? saved : DEFAULT_TABS).filter((k, i, a) => TAB_PAGES[k] && a.indexOf(k) === i).slice(0, MAX_TABS);
  if (!list.includes("today")) list.splice(Math.min(list.length, MAX_TABS - 1), list.length >= MAX_TABS ? 1 : 0, "today");
  return list;
}

export function todayLayout(saved) {
  const order = arrange(TODAY_SECTIONS.map((s) => s.key), saved?.order);
  const fixed = new Set(TODAY_SECTIONS.filter((s) => s.fixed).map((s) => s.key));
  const hidden = (Array.isArray(saved?.hidden) ? saved.hidden : []).filter((k) => order.includes(k) && !fixed.has(k));
  return { order, hidden };
}

// Moves one key up (-1) or down (+1).
export function moved(list, key, by) {
  const i = list.indexOf(key), j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
