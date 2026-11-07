/** Token estimates, stop handling and paced stream splitting. */

const CJK_RE = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/u;

export function countTokens(text) {
  const value = String(text ?? "");
  if (!value) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of value) {
    if (CJK_RE.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.max(1, cjk + Math.ceil(other / 4));
}

export function capToTokens(text, maxTokens) {
  let used = 0;
  let out = "";
  for (const ch of text) {
    const weight = CJK_RE.test(ch) ? 1 : 0.25;
    if (used + weight > maxTokens && out.length > 0) {
      return { text: out, truncated: true };
    }
    out += ch;
    used += weight;
  }
  return { text, truncated: false };
}

export function applyStop(text, stops) {
  if (!stops?.length) return { text, hit: null };
  let cut = -1;
  let hit = null;
  for (const stop of stops) {
    const at = text.indexOf(stop);
    if (at !== -1 && (cut === -1 || at < cut)) {
      cut = at;
      hit = stop;
    }
  }
  return cut === -1 ? { text, hit: null } : { text: text.slice(0, cut), hit };
}

export function splitForStream(text) {
  // Word-ish units for Latin text, per-character units for CJK, whitespace kept.
  const units = text.match(/[\u2e80-\u9fff\uac00-\ud7af]|[^\s\u2e80-\u9fff\uac00-\ud7af]+|\s+/gu) || [];
  const parts = [];
  let i = 0;
  while (i < units.length) {
    const n = 1 + Math.floor(Math.random() * 3);
    parts.push(units.slice(i, i + n).join(""));
    i += n;
  }
  return parts.filter(Boolean);
}


