// Sort and filter for the Usage and Pool panels.
//
// Pure on purpose — no DOM, no fetch — so `bun test` can exercise the comparators directly
// (sort.test.ts). It lives in public/ rather than src/ because there is no bundler here: the
// page imports this file as-is, and a src/*.ts module would be unreachable from the browser.
//
// Usage rows (`UsageRow`) and pool members (`PoolMember`) come from different claudex commands
// and are different shapes, but they carry the same sortable things under different keys, so one
// accessor pair serves both panels and neither render function has to know about sorting.
const nameOf = (r) => r.account ?? r.name ?? "";
const planOf = (r) => r.tier ?? r.plan ?? "";
const pctOf = (win) => (r) => r[win]?.pct ?? null;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// "Aug 20 1:09am", or a bare "11:39pm" when claudex judged the date obvious. It never prints a
// year, and prints nothing at all when the gauge has no reading.
const AT = /^(?:([A-Za-z]{3})\s+(\d{1,2})\s+)?(\d{1,2}):(\d{2})\s*(am|pm)$/i;
const SIX_MONTHS = 183 * 24 * 3600e3;

// A Gauge.at string -> epoch ms, or null when there is nothing to read. null is not a date far in
// the past: every comparator below sinks it rather than ordering it.
export function resetAt(at, now = new Date()) {
  const m = String(at ?? "").trim().match(AT);
  if (!m) return null;
  // %12 then +12 for pm: 12am is hour 0 and 12pm is hour 12, both of which `h + 12` gets wrong.
  const h = (Number(m[3]) % 12) + (/pm/i.test(m[5]) ? 12 : 0);
  const min = Number(m[4]);
  if (!m[1]) return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min).getTime();
  const mon = MONTHS.indexOf(m[1].toLowerCase());
  if (mon < 0) return null;
  const at1 = (y) => new Date(y, mon, Number(m[2]), h, min).getTime();
  const t = at1(now.getFullYear());
  // No year in the input, so a December reset read in January would otherwise land 11 months in
  // the past and sort as the most urgent thing on the page.
  return now.getTime() - t > SIX_MONTHS ? at1(now.getFullYear() + 1) : t;
}

// null is "no reading" (parse.ts:14), not zero: it sinks to the end in BOTH directions, so
// reversing a sort never floats unknown rows to the top.
const by = (val, dir) => (a, b) => {
  const x = val(a), y = val(b);
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
  return (x - y) * dir;
};

const byName = (dir) => (a, b) => nameOf(a).localeCompare(nameOf(b)) * dir;
const resetKey = (r) => resetAt(r.week?.at);

// "Least used + expiring soon" — two axes with no common unit, blended by rank rather than by a
// normalised score, so there is no invented weighting constant to defend. `by` already pushes
// null readings to the last ranks, which is what we want on both axes.
//
// ponytail: equal weight to both axes. If one should dominate, scale its rank before summing.
function rankSum(rows) {
  const rankOf = (cmp) => new Map(rows.slice().sort(cmp).map((r, i) => [r, i]));
  const used = rankOf(by(pctOf("week"), 1));
  const soon = rankOf(by(resetKey, 1));
  const score = (r) => used.get(r) + soon.get(r);
  return rows.sort((a, b) => score(a) - score(b));
}

// [value, label, fn]. One list so the <option>s the page builds and the comparators behind them
// cannot drift apart. fn receives a copy it may sort in place, and returns the array to render.
export const SORTS = [
  ["", "Default order", null],
  ["name-asc", "Name A→Z", (rows) => rows.sort(byName(1))],
  ["name-desc", "Name Z→A", (rows) => rows.sort(byName(-1))],
  ["week-asc", "Least used (week)", (rows) => rows.sort(by(pctOf("week"), 1))],
  ["week-desc", "Most used (week)", (rows) => rows.sort(by(pctOf("week"), -1))],
  ["session-asc", "Least used (session)", (rows) => rows.sort(by(pctOf("session"), 1))],
  ["session-desc", "Most used (session)", (rows) => rows.sort(by(pctOf("session"), -1))],
  ["reset-asc", "Expiring soon", (rows) => rows.sort(by(resetKey, 1))],
  ["week-reset", "Least used + expiring soon", rankSum],
];

// Never mutates `rows`: the caller's copy is the payload load() stashed, and it has to survive
// every later re-sort unchanged.
export function arrange(rows, { sort = "", only5x = false } = {}) {
  if (!Array.isArray(rows)) return rows;
  const out = only5x ? rows.filter((r) => /5x/i.test(planOf(r))) : rows.slice();
  const fn = SORTS.find(([v]) => v === sort)?.[2];
  return fn ? fn(out) : out;
}
