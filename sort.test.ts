// The comparators behind the header's sort menu. They run against the same captured CLI output
// parse.test.ts uses, so a claudex table change breaks these too rather than silently reordering
// the dashboard by fields that no longer mean what they did.
import { test, expect } from "bun:test";
import { resetAt, arrange, SORTS } from "./public/sort.js";
import { parseUsage } from "./src/parse.ts";

const fx = (n: string) => Bun.file(`${import.meta.dir}/fixtures/${n}.txt`).text();
const rows = async () => parseUsage(await fx("usage"))!;
const names = (rs: any[]) => rs.map((r) => r.account);

const NOW = new Date(2026, 7, 20, 9, 0); // Aug 20 2026, 9:00am
const d = (ms: number | null) => (ms === null ? null : new Date(ms));

test("resetAt: a bare time is today", () => {
  expect(d(resetAt("11:39pm", NOW))).toEqual(new Date(2026, 7, 20, 23, 39));
});

test("resetAt: a dated time takes the current year", () => {
  expect(d(resetAt("Aug 23 12:29pm", NOW))).toEqual(new Date(2026, 7, 23, 12, 29));
});

// The two cases `h + 12` gets wrong.
test("resetAt: 12am is midnight, 12pm is noon", () => {
  expect(d(resetAt("12:00am", NOW))).toEqual(new Date(2026, 7, 20, 0, 0));
  expect(d(resetAt("12:00pm", NOW))).toEqual(new Date(2026, 7, 20, 12, 0));
});

// claudex never prints a year, so a January reset read in late December must not land 11 months
// in the past and sort as the most urgent row on the page.
test("resetAt: rolls to next year rather than deep into the past", () => {
  const dec = new Date(2026, 11, 28, 9, 0);
  expect(d(resetAt("Jan 3 9:00am", dec))).toEqual(new Date(2027, 0, 3, 9, 0));
});

test("resetAt: no reading and unparseable text are both null", () => {
  expect(resetAt(null, NOW)).toBeNull();
  expect(resetAt("", NOW)).toBeNull();
  expect(resetAt("live", NOW)).toBeNull();
  expect(resetAt("Xxx 20 1:09am", NOW)).toBeNull();
});

test("week sort runs least to most used, and reverses exactly", async () => {
  const rs = await rows();
  expect(names(arrange(rs, { sort: "week-asc" }))).toEqual(["alice", "cheryl", "brian", "daniel"]);
  expect(names(arrange(rs, { sort: "week-desc" }))).toEqual(["daniel", "brian", "cheryl", "alice"]);
});

test("session sort reads the other gauge", async () => {
  const rs = await rows();
  expect(names(arrange(rs, { sort: "session-asc" }))).toEqual(["alice", "brian", "daniel", "cheryl"]);
});

test("expiring soon orders by when the week window resets", async () => {
  const rs = await rows();
  // week resets: brian Aug 20, daniel Aug 21, alice Aug 23, cheryl Aug 24
  expect(names(arrange(rs, { sort: "reset-asc" }))).toEqual(["brian", "daniel", "alice", "cheryl"]);
});

test("name sort is A→Z and Z→A", async () => {
  const rs = await rows();
  expect(names(arrange(rs, { sort: "name-asc" }))).toEqual(["alice", "brian", "cheryl", "daniel"]);
  expect(names(arrange(rs, { sort: "name-desc" }))).toEqual(["daniel", "cheryl", "brian", "alice"]);
});

// The whole point of the null policy: "—" means claudex had no reading, so the row cannot be
// ranked. It goes last whichever way the sort points — never first when the order flips.
test("a null reading sinks in both directions", async () => {
  const rs = [...(await rows()), { account: "ghost", tier: "Max 5x", session: { pct: null, at: null }, week: { pct: null, at: null } }];
  expect(names(arrange(rs, { sort: "week-asc" })).at(-1)).toBe("ghost");
  expect(names(arrange(rs, { sort: "week-desc" })).at(-1)).toBe("ghost");
  expect(names(arrange(rs, { sort: "reset-asc" })).at(-1)).toBe("ghost");
  expect(names(arrange(rs, { sort: "week-reset" })).at(-1)).toBe("ghost");
});

test("5x filter drops the Team account", async () => {
  const rs = await rows();
  expect(names(arrange(rs, { only5x: true }))).toEqual(["alice", "brian", "cheryl"]);
  expect(names(arrange(rs, { only5x: true, sort: "week-desc" }))).toEqual(["brian", "cheryl", "alice"]);
});

// Pool members carry the plan under `plan`, not `tier` — one accessor pair has to serve both.
test("5x filter reads the pool member's plan too", () => {
  const pool = [{ name: "a", plan: "Max 5x" }, { name: "b", plan: "Max 20x" }, { name: "c", plan: "Team" }];
  expect(arrange(pool, { only5x: true }).map((m: any) => m.name)).toEqual(["a"]);
});

test("arrange never mutates its input, and the default keeps claudex's order", async () => {
  const rs = await rows();
  const before = names(rs);
  arrange(rs, { sort: "week-desc", only5x: true });
  expect(names(rs)).toEqual(before);
  expect(names(arrange(rs, {}))).toEqual(before);
  expect(arrange(rs, {})).not.toBe(rs);
});

test("every menu entry is a value the page can actually sort by", async () => {
  const rs = await rows();
  for (const [value] of SORTS) expect(arrange(rs, { sort: value })).toHaveLength(4);
});
