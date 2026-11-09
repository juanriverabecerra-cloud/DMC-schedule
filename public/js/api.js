// Talking to the server, plus a small localStorage wrapper (it can be unavailable in private mode).

export const local = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(`dmc.${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`dmc.${key}`, JSON.stringify(value)); return true; } catch { return false; /* storage full or blocked */ }
  },
  del(key) {
    try { localStorage.removeItem(`dmc.${key}`); } catch { /* ignore */ }
  },
};

// A random key made once per device. It's what lets this device change what it sent: its own
// logged hours and its own swap requests and offers.
export function deviceKey() {
  let key = local.get("deviceKey");
  if (!key) {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    key = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    local.set("deviceKey", key);
  }
  return key;
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(path, { method = "GET", body, headers = {}, raw = false } = {}) {
  const h = { ...headers };
  const passcode = local.get("passcode");
  const admin = local.get("adminKey");
  if (passcode) h["x-passcode"] = passcode;
  if (admin) h["x-admin-key"] = admin;
  let payload = body;
  if (body && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !(body instanceof Uint8Array) && typeof body === "object") {
    payload = JSON.stringify(body);
    h["content-type"] = "application/json";
  }
  const res = await fetch(path, { method, headers: h, body: payload });
  if (raw) {
    if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status);
    return res;
  }
  if (res.status === 304) return { notModified: true };
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  return data;
}

export async function fetchDataset() {
  const etag = local.get("etag");
  const cached = local.get("ds");
  const headers = etag && cached ? { "if-none-match": etag } : {};
  const passcode = local.get("passcode");
  const admin = local.get("adminKey");
  if (passcode) headers["x-passcode"] = passcode;
  if (admin) headers["x-admin-key"] = admin;
  const res = await fetch("/api/data", { headers });
  if (res.status === 304) return { ds: cached, changed: false };
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(err.error || `Could not load the schedule (${res.status})`, res.status);
  }
  const ds = await res.json();
  // Only remember the version if the copy really saved. Otherwise the server would answer "not
  // modified" from now on and this phone would be stuck on an older schedule.
  if (local.set("ds", ds)) local.set("etag", res.headers.get("etag"));
  else local.del("etag");
  return { ds, changed: true };
}
