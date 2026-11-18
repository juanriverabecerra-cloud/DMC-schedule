// Only does anything inside the iPhone or Android app (not in a browser tab or the Home Screen
// web app). There, the phone itself handles three things the web can't: the widgets' feed,
// alerts through the phone's own service, and opening the day a tapped widget was showing.
import { api, local } from "./api.js";

const cap = () => window.Capacitor;
export const isNativeApp = () => !!cap()?.isNativePlatform?.();
export const nativePlatform = () => (isNativeApp() ? cap().getPlatform() : null);
const call = (plugin, method, options = {}) => cap().nativePromise(plugin, method, options);

// ---- widgets ----

// Gives the widgets this resident's private feed. Their exam choice rides along in the address,
// so the countdown on a widget matches the one in the app.
export async function syncWidget(pid) {
  if (nativePlatform() !== "ios") return;
  try {
    if (!pid) {
      local.del("widgetFeed");
      await call("DmcWidget", "clear");
      return;
    }
    const saved = local.get("widgetFeed");
    const url = saved?.pid === pid ? saved.url : (await api(`/api/widgettoken/${pid}`)).url;
    local.set("widgetFeed", { pid, url });
    const plan = local.get("examPlan");
    const exam = plan?.pid === pid && plan.track ? `?x=${[plan.track, plan.session || "", plan.day || ""].join(".")}` : "";
    await call("DmcWidget", "setFeed", { url: url + exam });
  } catch { /* the widgets keep what they have */ }
}

export function reloadWidgets() {
  if (nativePlatform() === "ios") call("DmcWidget", "reload").catch(() => {});
}

// `open(day)` runs for a widget tapped before the app was open, and for any tapped later.
export function onWidgetOpen(open) {
  if (nativePlatform() !== "ios") return;
  call("DmcWidget", "pendingDay").then((r) => { if (r?.day) open(r.day); }).catch(() => {});
  cap().addListener("DmcWidget", "openDay", (e) => { if (e?.day) open(e.day); });
}

// ---- the screen ----

// Which parts of the screen the phone keeps for itself: its camera and clock on a folding iPhone.
// `use(screen)` runs with { width, height, regions } now, and again when the phone is turned or
// folded. Older phones report no regions.
export function onScreenRegions(use) {
  if (nativePlatform() !== "ios") return;
  call("DmcScreen", "regions").then(use).catch(() => {});
  cap().addListener("DmcScreen", "change", use);
}

// ---- alerts ----

const TOKEN_WAIT = 15000;

// Asks the phone for its alert address. Rejects if the person says no or the phone can't get one.
export async function nativePushToken() {
  const permission = await call("PushNotifications", "requestPermissions");
  if (permission?.receive !== "granted") {
    local.set("alertsBlocked", true);
    throw new Error("Notifications are turned off for this app. Allow them in Settings › Notifications › DMC Schedule.");
  }
  local.del("alertsBlocked");
  return new Promise((resolve, reject) => {
    const handles = [];
    const done = (finish, value) => { clearTimeout(timer); handles.forEach((h) => h?.remove?.()); finish(value); };
    const timer = setTimeout(() => done(reject, new Error("The phone didn't answer. Check your connection and try again.")), TOKEN_WAIT);
    handles.push(cap().addListener("PushNotifications", "registration", (t) => done(resolve, t.value)));
    handles.push(cap().addListener("PushNotifications", "registrationError", (e) => done(reject, new Error(e?.error || "The phone couldn't register for alerts."))));
    call("PushNotifications", "register").catch((err) => done(reject, err));
  });
}

export const nativeUnregister = () => call("PushNotifications", "unregister").catch(() => {});

// A tapped alert opens the page it names.
export function onAlertTap(open) {
  if (!isNativeApp()) return;
  cap().addListener("PushNotifications", "pushNotificationActionPerformed", (e) => {
    const url = e?.notification?.data?.url;
    if (typeof url === "string" && url.startsWith("/")) open(url);
  });
}
