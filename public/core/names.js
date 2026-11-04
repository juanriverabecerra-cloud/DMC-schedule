// Name handling across the three sources. The same resident appears as
// "Smith, Alex", "Smith, Alexandra (Alex)", a misspelling such as "Smyth", or initials such as "ABC".

const PARTICLES = new Set(["de", "del", "della", "da", "di", "la", "le", "van", "von", "der", "st", "mc"]);

export function fold(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function tokens(s) {
  return fold(s).split(/[^a-z']+/).filter(Boolean);
}

// "Last, First Middle (Preferred)" -> parts used for matching and display.
export function splitName(raw) {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ");
  let last = s, first = "";
  if (s.includes(",")) {
    const i = s.indexOf(",");
    last = s.slice(0, i).trim();
    first = s.slice(i + 1).trim();
  } else if (s.includes(" ")) {
    const words = s.split(" ");
    last = words.pop();
    first = words.join(" ");
  }
  const paren = first.match(/\(([^)]+)\)/);
  const firstClean = first.replace(/\([^)]*\)/g, "").trim();
  const preferred = (paren ? paren[1] : firstClean.split(" ")[0] || "").trim();
  const lastTokens = tokens(last);
  const sig = lastTokens.find((t) => !PARTICLES.has(t) && t.length > 1) || lastTokens[0] || "";
  return {
    raw: s,
    last,
    first: firstClean,
    preferred,
    lastTokens,
    lastSig: sig,
    lastFull: lastTokens.join(""),
    firstTokens: [...new Set([...tokens(firstClean), ...(paren ? tokens(paren[1]) : [])])],
  };
}

export function slugify(s) {
  return fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function sameName(a, b) {
  if (!a.lastSig || a.lastSig !== b.lastSig) return false;
  if (!a.firstTokens.length || !b.firstTokens.length) return true;
  return a.firstTokens.some((t) => b.firstTokens.includes(t) || b.firstTokens.some((u) => u.startsWith(t) || t.startsWith(u)));
}

export function displayName(p) {
  return `${p.preferred || p.first || ""} ${p.last}`.trim();
}

function initialsOf(p) {
  const f = fold(p.preferred || p.first || "")[0] || "";
  const l = p.lastTokens.map((t) => t[0]).join("");
  return [(f + l).toUpperCase(), (fold(p.first)[0] + l).toUpperCase()];
}

function editDistance(a, b) {
  if (a === b) return 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
    }
  }
  return dp[a.length][b.length];
}

// Split a cell such as "Smith/Jones" or "Lee / Park" into names.
export function splitNames(cell) {
  return String(cell ?? "")
    .split(/\s*(?:\/|&|,|;|\+|\band\b)\s*/i)
    .map((s) => s.replace(/^dr\.?\s+/i, "").trim())
    .filter(Boolean);
}

export function isCrnaMark(s) {
  return /^(x|crna)$/i.test(String(s ?? "").trim());
}

// Build a matcher over people records ({id, last, first, preferred, aliases}).
// Returns match(text, {prefer}) -> id | null. `prefer` is a Set of ids to favour on ties
// (for example residents whose rotation that day is at Harper).
export function createMatcher(people) {
  const index = people.map((p) => {
    const parts = splitName(`${p.last}, ${p.first}${p.preferred && p.preferred !== p.first ? ` (${p.preferred})` : ""}`);
    const aliasParts = (p.aliases || []).map(splitName);
    return { id: p.id, parts, aliasParts, initials: initialsOf(parts) };
  });

  function pick(cands, prefer) {
    if (cands.length === 1) return cands[0].id;
    if (prefer && cands.length > 1) {
      const pref = cands.filter((c) => prefer.has(c.id));
      if (pref.length === 1) return pref[0].id;
    }
    return null;
  }

  return function match(text, { prefer } = {}) {
    const raw = String(text ?? "").replace(/\([^)]*\)/g, "").trim();
    if (!raw || isCrnaMark(raw)) return null;
    if (/^[A-Z]{2,4}$/.test(raw)) {
      const byInit = index.filter((e) => e.initials.includes(raw));
      const got = pick(byInit, prefer);
      if (got) return got;
    }
    // "Van Tran" may be a two-word surname or "First Last"; try the surname reading first.
    const variants = raw.includes(",") ? [raw] : raw.includes(" ") ? [`${raw},`, raw] : [`${raw},`];
    for (const variant of variants) {
      const got = matchParts(splitName(variant), prefer);
      if (got !== undefined) return got;
    }
    return null;
  };

  // Returns an id, null for "ambiguous, stop looking", or undefined for "no candidate".
  function matchParts(q, prefer) {
    const qLast = q.lastFull;
    const qSig = q.lastSig || qLast;
    if (!qSig) return undefined;
    const firstOk = (e) => !q.firstTokens.length || sameName(q, e.parts);

    const exact = index.filter((e) => (e.parts.lastFull === qLast || e.parts.lastTokens.includes(qSig)
      || e.aliasParts.some((a) => a.lastFull === qLast)) && firstOk(e));
    if (exact.length) return pick(exact, prefer);

    if (qSig.length >= 4) {
      const scored = index.map((e) => {
        const ds = [e.parts.lastFull, ...e.parts.lastTokens].map((t) => editDistance(qSig, t));
        return { e, d: Math.min(...ds) };
      }).filter((x) => x.d <= (qSig.length >= 7 ? 2 : 1) && firstOk(x.e));
      if (scored.length) {
        const best = Math.min(...scored.map((x) => x.d));
        return pick(scored.filter((x) => x.d === best).map((x) => x.e), prefer);
      }
    }
    return undefined;
  }
}
