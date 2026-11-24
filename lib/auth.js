// Shared passcode for residents, a separate admin key for uploads, and per-resident
// calendar tokens (calendar apps can't send a passcode, so the feed URL carries a secret).
import crypto from "node:crypto";

export function env(name) {
  return globalThis.Netlify?.env?.get?.(name) ?? process.env[name] ?? "";
}

function safeEqual(a, b) {
  if (!a || !b) return false;
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function isAdmin(req) {
  return safeEqual(req.headers.get("x-admin-key"), env("ADMIN_KEY"));
}

export function isViewer(req) {
  return isAdmin(req) || safeEqual(req.headers.get("x-passcode"), env("APP_PASSCODE")) || isDemo(req);
}

// Signed in with the demo passcode: sees an invented program, never the real one (lib/demo.js).
export function isDemo(req) {
  const given = req.headers.get("x-passcode");
  return !isAdmin(req) && !safeEqual(given, env("APP_PASSCODE")) && safeEqual(given, env("DEMO_PASSCODE"));
}

function calSecret() {
  return env("CAL_SECRET") || env("ADMIN_KEY");
}

// A private address for one resident's feed. `kind` keeps a calendar link from opening a widget
// feed and the other way round.
export function feedToken(kind, pid) {
  return crypto.createHmac("sha256", calSecret()).update(`${kind}:${pid}`).digest("base64url").slice(0, 24);
}
export const calToken = (pid) => feedToken("cal", pid);
// The private address the program's emails are sent to (Admin › Email intake), and the check.
export const mailToken = () => (calSecret() ? feedToken("mail", "program") : "");
export const isMailToken = (token) => !!mailToken() && safeEqual(String(token || ""), mailToken());

// Keeps one rating per resident without storing who gave it.
export function surveyKey(pid) {
  return crypto.createHmac("sha256", calSecret() || "dmc").update(`survey:${pid}`).digest("base64url").slice(0, 24);
}

export function pidFromToken(token, people, kind = "cal") {
  if (!calSecret()) return null;
  const p = people.find((x) => safeEqual(feedToken(kind, x.id), token));
  return p ? p.id : null;
}

export function configured() {
  return { passcode: !!env("APP_PASSCODE"), admin: !!env("ADMIN_KEY"), ai: !!env("ANTHROPIC_API_KEY") };
}
