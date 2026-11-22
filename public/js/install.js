// Putting the web app on the Home Screen. There it opens full screen, keeps its saved data, and on
// iPhone it's the only way to get alerts. iPhone needs a few taps in the browser's Share menu;
// Chrome on Android has its own install box, which the Today card's button opens.
import { isNativeApp } from "./native.js";

export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const standalone = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

let offer = null; // Chrome's install box, kept until the button asks for it

export function watchInstall(changed) {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); offer = e; changed(); });
  window.addEventListener("appinstalled", () => { offer = null; changed(); });
}

// "safari": iPhone Safari. "other-ios": another iPhone browser, whose Share menu may or may not
// have the option. "prompt": Chrome's own box is ready. "": already on the Home Screen, or no way.
export function installRoute() {
  if (isNativeApp() || standalone()) return "";
  if (isIos()) return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(navigator.userAgent) ? "other-ios" : "safari";
  return offer ? "prompt" : "";
}

// Chrome lets the box open once per offer. True when it was installed.
export async function promptInstall() {
  const e = offer;
  if (!e) return false;
  offer = null;
  await e.prompt();
  return (await e.userChoice)?.outcome === "accepted";
}

// From the Home Screen app, links open in a small in-app browser that has neither the resident's
// Favorites (where the Log cases button lives) nor, reliably, their saved passwords. iOS 17 and
// later open an x-safari-https:// address in Safari itself (checked on the iOS simulator). Older
// iPhones ignore it, so `fallback` runs if the app is still showing a moment later.
export const opensInApp = () => isIos() && standalone() && !isNativeApp();
export function openInSafari(url, { fallback } = {}) {
  if (!opensInApp()) { window.open(url, "_blank", "noopener"); return; }
  let left = false;
  const away = () => { if (document.visibilityState === "hidden") left = true; };
  document.addEventListener("visibilitychange", away);
  window.addEventListener("pagehide", away);
  location.href = url.replace(/^https?:\/\//, (m) => `x-safari-${m}`);
  setTimeout(() => {
    document.removeEventListener("visibilitychange", away);
    window.removeEventListener("pagehide", away);
    if (!left && document.visibilityState === "visible") fallback?.();
  }, 1600);
}
