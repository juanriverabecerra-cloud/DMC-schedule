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
  return isAdmin(req) || safeEqual(req.headers.get("x-passcode"), env("APP_PASSCODE"));
}

function calSecret() {
  return env("CAL_SECRET") || env("ADMIN_KEY");
}

export function calToken(pid) {
  return crypto.createHmac("sha256", calSecret()).update(`cal:${pid}`).digest("base64url").slice(0, 24);
}

// Keeps one rating per resident without storing who gave it.
export function surveyKey(pid) {
  return crypto.createHmac("sha256", calSecret() || "dmc").update(`survey:${pid}`).digest("base64url").slice(0, 24);
}

export function pidFromToken(token, people) {
  if (!calSecret()) return null;
  const p = people.find((x) => safeEqual(calToken(x.id), token));
  return p ? p.id : null;
}

export function configured() {
  return { passcode: !!env("APP_PASSCODE"), admin: !!env("ADMIN_KEY"), ai: !!env("ANTHROPIC_API_KEY") };
}
