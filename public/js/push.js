// Lock-screen alerts on this device: one when a day's OR schedule is posted. On iPhone this only
// works from the Home Screen app (iOS 16.4 or later), so Safari gets the steps to add it first.
import { api, local } from "./api.js";

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

// "on", "off", "install" (iPhone in Safari: add to Home Screen first), "blocked", "unsupported".
export function alertStatus() {
  const can = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && location.protocol === "https:";
  if (!can) return isIos() && !standalone() ? "install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return local.get("alerts")?.endpoint && Notification.permission === "granted" ? "on" : "off";
}

const toKey = (b64) => {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

// Must run from a tap: iPhone only asks for permission in response to one.
export async function turnOnAlerts(pid) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "Notifications are blocked for this app. Allow them in Settings › Notifications." : "Notifications weren't allowed.");
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api("/api/push/key");
  let sub = await reg.pushManager.getSubscription();
  if (sub && local.get("alerts")?.key !== publicKey) { await sub.unsubscribe(); sub = null; }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) });
  await api("/api/push/subscribe", { method: "POST", body: { subscription: sub.toJSON(), pid } });
  local.set("alerts", { endpoint: sub.endpoint, key: publicKey, pid, on: new Date().toISOString() });
}

export async function turnOffAlerts() {
  const saved = local.get("alerts");
  local.del("alerts");
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch { /* already gone */ }
  if (saved?.endpoint) await api("/api/push/unsubscribe", { method: "POST", body: { endpoint: saved.endpoint } }).catch(() => {});
}

export const testAlert = () => api("/api/push/test", { method: "POST", body: { endpoint: local.get("alerts")?.endpoint } });

// When someone changes who they are, the alerts follow them.
export async function syncAlerts(pid) {
  const saved = local.get("alerts");
  if (!saved?.endpoint || saved.pid === pid || alertStatus() !== "on") return;
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (!sub) { local.del("alerts"); return; }
    await api("/api/push/subscribe", { method: "POST", body: { subscription: sub.toJSON(), pid } });
    local.set("alerts", { ...saved, pid });
  } catch { /* try again next time */ }
}
