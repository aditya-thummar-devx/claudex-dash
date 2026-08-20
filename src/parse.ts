// Parsers for `claudex` CLI output.
//
// claudex has no --json flag (verified: `usage --json` etc. all return "unrecognized arguments")
// and its source is closed, so its printed text is the only contract we get. It also self-updates
// from a `latest/` channel, meaning that contract can change without warning.
//
// So: every parser returns null on a shape it does not recognise, rather than inventing rows. The
// server pairs each parse with the raw text and the page renders the raw text whenever a parser
// returns null. A claudex update degrades the dashboard to plain text; it never fabricates numbers.

const ANSI = /\x1b\[[0-9;]*m/g;
const BORDER = /[┌┬┐├┼┤└┴┘]/; // ┌┬┐├┼┤└┴┘
const BARS = /[█░]/g; // █ ░
const NO_DATA = "—"; // — em dash: claudex has no reading at all (NOT zero)
const MINUS = "−"; // − claudex uses U+2212, not ASCII '-'; parseFloat chokes on it

// An unknown subcommand prints an ASCII-cat easter egg; a bad flag prints "unrecognized arguments".
// Either means the output is an error page, not data. (Deliberately does not include "✗" — `doctor`
// prints that for a legitimately failing check.)
const CLI_ERROR = /isn't a thing|does not exist|unrecognized arguments/;

function lines(text: string): string[] {
  return text.replace(ANSI, "").split("\n");
}

export type Gauge = { pct: number | null; at: string | null };
const NO_GAUGE: Gauge = { pct: null, at: null };

// "███░░░░░░░  30%  11:39pm" -> { pct: 30, at: "11:39pm" }
// "░░░░░░░░   0%"            -> { pct: 0,  at: null }      timestamp is optional
// "░░░░░░░░   —"             -> { pct: null, at: null }    no reading — must not become 0
export function gauge(cell: string): Gauge {
  const body = cell.replace(BARS, "").trim();
  if (!body || body.startsWith(NO_DATA)) return NO_GAUGE;
  const m = body.match(/^(\d+)\s*%\s*(.*)$/);
  if (!m) return NO_GAUGE;
  return { pct: Number(m[1]), at: m[2].trim() || null };
}

// `usage` and `list` print the same box-drawing table, so one reader serves both.
type Table = { headers: string[]; rows: string[][] };
function boxTable(text: string): Table | null {
  let headers: string[] | null = null;
  const rows: string[][] = [];
  for (const line of lines(text)) {
    if (!line.includes("│") || BORDER.test(line)) continue; // │
    const cells = line.split("│").slice(1, -1).map((c) => c.trim());
    if (!headers) headers = cells;
    else rows.push(cells);
  }
  if (!headers || rows.length === 0) return null;
  return { headers, rows };
}

export type UsageRow = {
  account: string;
  active: boolean;
  tier: string;
  session: Gauge;
  week: Gauge;
  updated: string;
};

export function parseUsage(text: string): UsageRow[] | null {
  if (CLI_ERROR.test(text)) return null;
  const t = boxTable(text);
  if (!t || t.headers[3] !== "SESSION") return null; // SESSION column is what makes this `usage`
  return t.rows.map((r) => ({
    active: r[0] === "●", // ● active, ○ saved
    account: r[1] ?? "",
    tier: r[2] ?? "",
    session: gauge(r[3] ?? ""),
    week: gauge(r[4] ?? ""),
    updated: r[5] ?? "",
  }));
}

export type AccountRow = {
  account: string;
  active: boolean;
  email: string;
  org: string;
  plan: string;
  saved: string;
};

export function parseList(text: string): AccountRow[] | null {
  if (CLI_ERROR.test(text)) return null;
  const t = boxTable(text);
  if (!t || t.headers[2] !== "EMAIL") return null; // EMAIL column is what makes this `list`
  return t.rows.map((r) => ({
    active: r[0] === "●",
    account: r[1] ?? "",
    email: r[2] ?? "",
    org: r[3] ?? "",
    plan: r[4] ?? "",
    saved: r[5] ?? "",
  }));
}

export type Current = { account: string; email: string; org: string; plan: string };

// ● brian / brian.cooley@example.com / acme corp  ·  team
export function parseCurrent(text: string): Current | null {
  if (CLI_ERROR.test(text)) return null;
  const ls = lines(text).map((l) => l.trim()).filter(Boolean);
  const m = ls[0]?.match(/^[●○]\s+(.+)$/);
  if (!m) return null;
  const [org = "", plan = ""] = (ls[2] ?? "").split("·").map((s) => s.trim());
  return { account: m[1], email: ls[1] ?? "", org, plan };
}

export type PoolStatus = {
  consuming: { on: boolean; detail: string };
  sharing: { on: boolean; detail: string };
};

// ○ consuming   token-swap OFF · on your own token  · start with pool start
// ● sharing     your account is serving the pool  · managed by your pod lead / admin
export function parsePoolStatus(text: string): PoolStatus | null {
  if (CLI_ERROR.test(text)) return null;
  const out: Record<string, { on: boolean; detail: string }> = {};
  for (const line of lines(text)) {
    const m = line.match(/^\s*([●○])\s+(consuming|sharing)\s{2,}(.+?)\s*$/);
    if (m) out[m[2]] = { on: m[1] === "●", detail: m[3] };
  }
  if (!out.consuming || !out.sharing) return null;
  return out as PoolStatus;
}

export type DoctorCheck = { ok: boolean; label: string; detail: string };
export type Doctor = { checks: DoctorCheck[]; accounts: DoctorCheck[]; summary: string };

export function parseDoctor(text: string): Doctor | null {
  if (CLI_ERROR.test(text)) return null;
  const checks: DoctorCheck[] = [];
  const accounts: DoctorCheck[] = [];
  let summary = "";
  let inAccounts = false;
  for (const raw of lines(text)) {
    const line = raw.trim();
    if (line === "accounts:") {
      inAccounts = true;
      continue;
    }
    const sum = line.match(/^●\s+(\d+\s+ok.*)$/);
    if (sum) {
      summary = sum[1];
      continue;
    }
    const m = line.match(/^([✓✗])\s+(.+?)(?:\s{2,}(.+))?$/); // ✓ ✗
    if (!m) continue;
    (inAccounts ? accounts : checks).push({
      ok: m[1] === "✓",
      label: m[2].trim(),
      detail: (m[3] ?? "").trim(),
    });
  }
  return checks.length ? { checks, accounts, summary } : null;
}

export type PoolMember = {
  name: string;
  plan: string;
  marked: boolean; // ▶ — claudex marks exactly one member; its exact meaning is undocumented
  active: boolean; // the ● / ○ before the name
  sharing: boolean; // the "● on" / "○ off" after the plan
  session: Gauge;
  week: Gauge;
  netM: number | null; // millions of tokens contributed (+) or borrowed (−)
};

//   ▶ ● alice.stoneham  · Max 5x · ● on
//         session █░░░░░░░   9%  Aug 20 1:10am
//         week    █░░░░░░░   9%  Aug 23 12:30pm   net +2482.3M
const MEMBER =
  /^\s*(▶)?\s*([●○])\s+(\S+)\s+·\s+(.+?)\s+·\s+[●○]\s*(on|off)\s*$/;
const GAUGE_LINE = /^\s+(session|week)\s+(.+)$/;
const NET = new RegExp(`\\s+net\\s+([+${MINUS}-]?[\\d.]+)M\\s*$`);

export function parsePoolMembers(text: string): PoolMember[] | null {
  if (CLI_ERROR.test(text)) return null;
  const members: PoolMember[] = [];
  let cur: PoolMember | null = null;
  for (const line of lines(text)) {
    const m = line.match(MEMBER);
    if (m) {
      cur = {
        marked: Boolean(m[1]),
        active: m[2] === "●",
        name: m[3],
        plan: m[4],
        sharing: m[5] === "on",
        session: NO_GAUGE,
        week: NO_GAUGE,
        netM: null,
      };
      members.push(cur);
      continue;
    }
    const g = line.match(GAUGE_LINE);
    if (!g || !cur) continue;
    let rest = g[2];
    const net = rest.match(NET);
    if (net) {
      cur.netM = Number(net[1].replace(MINUS, "-")); // U+2212 would make this NaN
      rest = rest.slice(0, net.index);
    }
    cur[g[1] as "session" | "week"] = gauge(rest);
  }
  return members.length ? members : null;
}

// `pool member <name>` — one person's full breakdown. Unlike `usage` and `list` this is not a
// uniform table: one box holds a status line, a five-column flow table, a net line, and one block
// per usage window. So it is read line by line off the box interior rather than through boxTable.
export type MemberFlow = {
  label: "own" | "borrowed" | "shared";
  in: string; out: string; cacheRead: string; cacheWrite: string; req: string;
  // Counts stay as claudex printed them ("1.7M", "805.6k", "8473"). It has already rounded them;
  // turning "1.7M" into 1700000 would invent three digits it never gave us.
  note: string; // "my token → me" / "from pool" / "to pool"
};
export type Driver = {
  name: string;
  you: boolean; // claudex suffixes the viewer's own row with "(you)"
  pct: number; // share of this window's traffic, NOT rate-limit headroom
  tokens: string;
};
export type MemberWindow = {
  label: string; // "5-hour" · "last 5h" when headroom is stale · "week" — claudex varies this
  pct: number | null;
  resets: string | null; // claudex omits "· resets …" on a stale window
  // The line claudex prints above the driver rows: either the "who drove your traffic:" heading or,
  // when nobody did, its own explanation. Only meaningful when `drivers` is empty.
  note: string | null;
  drivers: Driver[];
};
export type MemberDetail = {
  name: string;
  plan: string;
  marked: boolean; // ▶ — the same undocumented marker as PoolMember.marked
  sharing: boolean; // the "● on" / "○ off"
  state: string; // "offline" / "online"
  flows: MemberFlow[];
  netM: number | null; // millions, same unit and sign as PoolMember.netM
  netDir: "giver" | "taker" | null;
  splitNote: string | null; // "headroom stale", off the USAGE SPLIT heading
  footnote: string | null; // claudex's own accuracy caveat — captured, never hardcoded, so a
  windows: MemberWindow[]; //   reworded caveat is not shown as if it were the current one
};

//   ╭─ alice.stoneham · Max 5x ──────────────────────────────╮
//   │  ▶ ● on   offline                                      │
//   │  own       1.7M   6.8M   2471.6M   59.2M   8473  my token → me
//   │  net give/take  −1137.3M  ↓ taker                      │
//   │  USAGE SPLIT  · headroom stale                         │
//   │  5-hour   9% used  · resets 1:09am                     │
//   │    alice.stoneham (you)  ██████████████████ 100%  123.7M
const DETAIL_HEAD = /^\s*╭─\s+(\S+)\s+·\s+(.+?)\s*─+╮\s*$/;
const DETAIL_STATE = /^\s*(▶|[●○])\s+([●○])\s*(on|off)\s+(\S+)\s*$/;
const FLOW = /^\s*(own|borrowed|shared)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*?)\s*$/;
const DETAIL_NET = new RegExp(`^\\s*net give/take\\s+([+${MINUS}-]?[\\d.]+)M\\s+[↑↓]\\s*(giver|taker)\\s*$`);
const SPLIT_HEAD = /^\s*USAGE SPLIT\s*(?:·\s*(.+?))?\s*$/;
// Keyed on "N% used", not on a label whitelist: "5-hour" already becomes "last 5h" when claudex's
// headroom reading goes stale, so the label is not a contract.
const WINDOW = new RegExp(`^\\s*(.+?)\\s+(\\d+|${NO_DATA})%\\s+used\\s*(?:·\\s*resets\\s+(.+?))?\\s*$`);
const DRIVER = /^\s+(.+?)\s*(\(you\))?\s+[█░]+\s+(\d+)%\s+(\S+)\s*$/;

export function parseMemberDetail(text: string): MemberDetail | null {
  if (CLI_ERROR.test(text)) return null;

  const all = lines(text);
  const head = all.map((l) => l.match(DETAIL_HEAD)).find(Boolean);
  if (!head) return null;

  const d: MemberDetail = {
    name: head[1], plan: head[2].trim(),
    marked: false, sharing: false, state: "",
    flows: [], netM: null, netDir: null,
    splitNote: null, footnote: null, windows: [],
  };

  let win: MemberWindow | null = null;
  // ╭─…╮ and ├──┤ carry no │, so filtering on it drops the frame without matching on border glyphs.
  for (const line of all.filter((l) => l.includes("│")).map((l) => l.replace(/^\s*│/, "").replace(/│\s*$/, ""))) {
    const st = line.match(DETAIL_STATE);
    if (st) {
      d.marked = st[1] === "▶";
      d.sharing = st[3] === "on";
      d.state = st[4];
      continue;
    }
    const f = line.match(FLOW);
    if (f) {
      d.flows.push({
        label: f[1] as MemberFlow["label"],
        in: f[2], out: f[3], cacheRead: f[4], cacheWrite: f[5], req: f[6],
        note: f[7] ?? "",
      });
      continue;
    }
    const n = line.match(DETAIL_NET);
    if (n) {
      d.netM = Number(n[1].replace(MINUS, "-")); // U+2212 would make this NaN
      d.netDir = n[2] as "giver" | "taker";
      continue;
    }
    const sp = line.match(SPLIT_HEAD);
    if (sp) {
      d.splitNote = sp[1] ?? null;
      continue;
    }
    const w = line.match(WINDOW);
    if (w) {
      win = {
        label: w[1],
        pct: w[2] === NO_DATA ? null : Number(w[2]), // — is no reading, not 0% used
        resets: w[3] ?? null,
        note: null,
        drivers: [],
      };
      d.windows.push(win);
      continue;
    }
    const dr = line.match(DRIVER);
    if (dr && win) {
      win.drivers.push({ name: dr[1], you: Boolean(dr[2]), pct: Number(dr[3]), tokens: dr[4] });
      continue;
    }
    // Whatever is left is prose. claudex indents a window's own note deeper than the box's closing
    // caveat, so the indent decides which one this is — no wording is assumed either way. The flow
    // table's column header is also deeply indented but arrives before any window, hence `win`.
    if (/^ {4,}\S/.test(line)) {
      if (win) win.note ??= line.trim();
      continue;
    }
    if (/^ {2,3}\S/.test(line)) d.footnote = line.trim();
  }

  // `own` is the fingerprint: no sibling command prints a flow row labelled that.
  return d.flows.some((f) => f.label === "own") ? d : null;
}

export type AccessPerson = { name: string; allowed: boolean };

// `access` — who may borrow YOUR pooled account. A different list from `pool members`, in the same
// dotted-name namespace, so the two must never be crossed (see server.ts).
//
//   ╭─ Access to your account ──── 8 people ─╮
//   │  ● alice.stoneham     allowed          │
//   │  ● hugo.vandenberge   blocked          │
//   ╰────────────────────────────────────────╯
//     allow / block / remove:  access allow <name> · …
//
// Keyed on the word, not the dot: claudex prints ● on every row and carries allowed/blocked in the
// ANSI colour, which lines() strips. Note the CLI says "block" in its own footer hint but prints
// "blocked" as the state and takes `deny` as the verb — three spellings of one thing, so only the
// printed state is matched here.
const ACCESS_HEAD = /Access to your account/;
const ACCESS_ROW = /^\s*[●○]\s+(\S+)\s+(allowed|blocked)\s*$/;

export function parseAccess(text: string): AccessPerson[] | null {
  if (CLI_ERROR.test(text)) return null;
  const ls = lines(text);
  // Unlike every parser above, this one returns [] rather than null for a recognised-but-empty box:
  // the heading is a strong enough fingerprint on its own, and having nobody on your access list is
  // an ordinary state. Falling back to raw text there would put a ⚠ on the tab for "all fine, list
  // is empty". A missing heading still means we are not looking at `access` output at all.
  if (!ls.some((l) => ACCESS_HEAD.test(l))) return null;
  const people: AccessPerson[] = [];
  for (const line of ls) {
    if (!line.includes("│")) continue; // box interior only — the footer hint line is not a row
    const m = line.replace(/^\s*│/, "").replace(/│\s*$/, "").match(ACCESS_ROW);
    if (m) people.push({ name: m[1], allowed: m[2] === "allowed" });
  }
  return people;
}
