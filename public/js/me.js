// This device and the resident using it (see lib/devices.js): whether the device is linked to them,
// so their case log and swap requests work here whichever device started them; what of theirs is
// kept on another device until it is; and whether their calendar app has subscribed to their feed.
import { h, icon, toast } from "./ui.js";
import { api, deviceKey } from "./api.js";

let status = { pid: null, data: null, at: 0, loading: false };
const listeners = new Set();
export const onMeChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
// Listeners hear the old answer and the new one.
const tell = (was, now) => { for (const fn of listeners) fn(was, now); };

// What's known now (null until the first answer); asks the server again every few minutes.
export function meStatus(pid) {
  if (!pid) return null;
  if (status.pid !== pid) status = { pid, data: null, at: 0, loading: false };
  if (!status.loading && Date.now() - status.at > 5 * 60 * 1000) loadMe(pid);
  return status.data;
}

export async function loadMe(pid) {
  if (!pid) return;
  status = { ...status, pid, loading: true };
  try {
    const data = await api(`/api/me/${encodeURIComponent(pid)}`, { headers: { "x-device-key": deviceKey() } });
    const was = status.data;
    status = { pid, data, at: Date.now(), loading: false };
    if (JSON.stringify(data) !== JSON.stringify(was)) tell(was, data);
  } catch {
    status = { ...status, at: Date.now(), loading: false };
  }
}

// One tap: this device is theirs. Screens that show their things load them again (app.js).
// The button for it sits where something of theirs is kept elsewhere (Case log, Swaps).
export async function linkHere(pid) {
  const data = await api(`/api/me/${encodeURIComponent(pid)}/link`, { method: "POST", body: { key: deviceKey() } });
  const was = (status.pid === pid && status.data) || { linked: false };
  status = { pid, data, at: Date.now(), loading: false };
  tell(was, data);
}

export const calendarSubscribed = (pid) => !!meStatus(pid)?.calendarAt;

export const linkButton = (pid, label = "Use it here too") => {
  const btn = h("button", { class: "btn sm primary", onclick: async () => {
    btn.disabled = true;
    try {
      await linkHere(pid);
      toast("Done: everything of yours works on this device too");
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    }
  } }, icon("check"), label);
  return btn;
};

// ---- RSVPs: the events someone has said they've replied to (Blobs rsvp/done, via /api/me) ----
const replied = new Map(); // what this phone just said, until the server's answer catches up
export function rsvpDone(pid) {
  const out = new Set(meStatus(pid)?.rsvpDone || []);
  for (const [id, done] of replied) if (done) out.add(id); else out.delete(id);
  return out;
}
export async function markRsvp(pid, id, done = true) {
  replied.set(id, done);
  tell(status.data, status.data);
  await api("/api/rsvp", { method: "POST", body: { pid, id, done } });
  if (status.data) status.data = { ...status.data, rsvpDone: [...rsvpDone(pid)] };
}
