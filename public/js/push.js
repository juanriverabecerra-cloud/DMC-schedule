// Lock-screen alerts on this device: one when a day's OR schedule is posted, and a heads-up 5
// minutes before a Zoom lecture. On iPhone this only works from the Home Screen app (iOS 16.4 or
// later), so Safari gets the steps to add it first.
import { api, local } from "./api.js";
import { isNativeApp, nativePlatform, nativePushToken, nativeUnregister } from "./native.js";
import { isIos, standalone } from "./install.js";

// "on", "off", "install" (iPhone in Safari: add to Home Screen first), "blocked", "unsupported".
export function alertStatus() {
  // In the app the phone's own alert service is used, so none of the browser checks apply.
  if (isNativeApp()) {
    if (nativePlatform() !== "ios") return "unsupported"; // the Android app's alerts aren't built yet
    return local.get("alerts")?.token ? "on" : local.get("alertsBlocked") ? "blocked" : "off";
  }
  const can = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && location.protocol === "https:";
  if (!can) return isIos() && !standalone() ? "install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return local.get("alerts")?.endpoint && Notification.permission === "granted" ? "on" : "off";
}

// `ready` never settles if the worker couldn't install, which would leave a spinner forever.
const worker = () => Promise.race([
  navigator.serviceWorker.ready,
  new Promise((_, reject) => setTimeout(() => reject(new Error("The app is still setting up. Try again in a moment.")), 8000)),
]);

const toKey = (b64) => {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

// Must run from a tap: iPhone only asks for permission in response to one.
export async function turnOnAlerts(pid) {
  if (isNativeApp()) return turnOnNative(pid);
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "Notifications are blocked for this app. Allow them in Settings › Notifications." : "Notifications weren't allowed.");
  const reg = await worker();
  const { publicKey } = await api("/api/push/key");
  let sub = await reg.pushManager.getSubscription();
  if (sub && local.get("alerts")?.key !== publicKey) { await sub.unsubscribe(); sub = null; }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) });
  const mode = local.get("alerts")?.mode || "smart";
  const lectures = lecturesHere();
  const cases = caseNudgesHere();
  await api("/api/push/subscribe", { method: "POST", body: { subscription: sub.toJSON(), pid, mode, lectures, cases } });
  local.set("alerts", { endpoint: sub.endpoint, key: publicKey, pid, mode, lectures, cases, admin: !!local.get("adminKey"), on: new Date().toISOString() });
}

async function turnOnNative(pid) {
  const token = await nativePushToken();
  const mode = local.get("alerts")?.mode || "smart";
  const lectures = lecturesHere();
  const cases = caseNudgesHere();
  await api("/api/push/subscribe", { method: "POST", body: { native: { platform: nativePlatform(), token }, pid, mode, lectures, cases } });
  local.set("alerts", { token, pid, mode, lectures, cases, admin: !!local.get("adminKey"), on: new Date().toISOString(), synced: new Date().toISOString() });
}

// What the server knows this phone by: a web address in a browser, a device token in the app.
const address = (saved) => (saved?.token ? { token: saved.token } : { endpoint: saved?.endpoint });

// Admins choose how much they hear about residents' requests: "smart", "sick" or "off".
export async function setRequestMode(mode) {
  const saved = local.get("alerts");
  if (!saved?.endpoint && !saved?.token) throw new Error("Turn on alerts on this phone first.");
  await api("/api/push/mode", { method: "POST", body: { ...address(saved), mode } });
  local.set("alerts", { ...saved, mode });
}
export const requestModeHere = () => local.get("alerts")?.mode || "smart";

// The 5-minute heads-up before a Zoom lecture: on unless this phone turned it off.
export const lecturesHere = () => local.get("alerts")?.lectures !== false;
export async function setLectureReminders(on) {
  const saved = local.get("alerts");
  if (!saved?.endpoint && !saved?.token) throw new Error("Turn on alerts on this phone first.");
  await api("/api/push/lectures", { method: "POST", body: { ...address(saved), on } });
  local.set("alerts", { ...saved, lectures: on });
}

// Case log nudges (after a case day with nothing logged, and once a week when cases wait for
// ACGME): on unless this phone turned them off. Only sent to someone who has started a case log.
export const caseNudgesHere = () => local.get("alerts")?.cases !== false;
export async function setCaseNudges(on) {
  const saved = local.get("alerts");
  if (!saved?.endpoint && !saved?.token) throw new Error("Turn on alerts on this phone first.");
  await api("/api/push/cases", { method: "POST", body: { ...address(saved), on } });
  local.set("alerts", { ...saved, cases: on });
}

export async function turnOffAlerts() {
  const saved = local.get("alerts");
  local.del("alerts");
  if (isNativeApp()) {
    await nativeUnregister();
    if (saved?.token) await api("/api/push/unsubscribe", { method: "POST", body: { token: saved.token } }).catch(() => {});
    return;
  }
  try {
    const reg = await worker();
    const sub = await reg.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch { /* already gone */ }
  if (saved?.endpoint) await api("/api/push/unsubscribe", { method: "POST", body: { endpoint: saved.endpoint } }).catch(() => {});
}

export const testAlert = () => api("/api/push/test", { method: "POST", body: address(local.get("alerts")) });

const REFRESH_DAYS = 3;

// When someone changes who they are, or signs in or out as an admin, the alerts follow. Every
// few days the phone also re-registers, so one the server lost starts hearing alerts again.
export async function syncAlerts(pid) {
  const saved = local.get("alerts");
  const admin = !!local.get("adminKey");
  if ((!saved?.endpoint && !saved?.token) || alertStatus() !== "on") return;
  const recent = Date.now() - new Date(saved.synced || saved.on).getTime() < REFRESH_DAYS * 86400000;
  if (saved.pid === pid && !!saved.admin === admin && recent) return;
  if (isNativeApp()) {
    // The phone's address can change, so ask for it again rather than trusting the saved one.
    try { await turnOnNative(pid); } catch { /* try again next time */ }
    return;
  }
  try {
    const sub = await (await worker()).pushManager.getSubscription();
    if (!sub) { local.del("alerts"); return; }
    await api("/api/push/subscribe", { method: "POST", body: { subscription: sub.toJSON(), pid, mode: saved.mode, lectures: lecturesHere(), cases: caseNudgesHere() } });
    local.set("alerts", { ...saved, endpoint: sub.endpoint, pid, admin, synced: new Date().toISOString() });
  } catch { /* try again next time */ }
}
