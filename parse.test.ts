// Parsers run against real captured CLI output. These exist because claudex self-updates and can
// change its table layout under us — if that happens, these fail loudly instead of the dashboard
// quietly showing wrong numbers.
import { test, expect } from "bun:test";
import {
  parseUsage, parseList, parseCurrent, parsePoolStatus, parseDoctor, parsePoolMembers,
  parseMemberDetail,
} from "./src/parse.ts";

const fx = (n: string) => Bun.file(`${import.meta.dir}/fixtures/${n}.txt`).text();

test("usage: 4 accounts, every percent a number", async () => {
  const rows = parseUsage(await fx("usage"))!;
  expect(rows).toHaveLength(4);
  expect(rows.map((r) => r.account)).toEqual(["alice", "brian", "cheryl", "daniel"]);
  for (const r of rows) {
    expect(typeof r.session.pct).toBe("number");
    expect(typeof r.week.pct).toBe("number");
  }
  const brian = rows.find((r) => r.account === "brian")!;
  expect(brian.active).toBe(true);
  expect(brian.week.pct).toBe(87);
  expect(brian.session.at).toBe("11:39pm");
});

test("pool: 10 members", async () => {
  const m = parsePoolMembers(await fx("pool-members"))!;
  expect(m).toHaveLength(10);
  expect(m.every((x) => x.sharing)).toBe(true);
  expect(m.find((x) => x.marked)!.name).toBe("alice.stoneham");
});

test("no-data em dash parses to null, NOT 0", async () => {
  const m = parsePoolMembers(await fx("pool-members"))!;
  const cheryl = m.find((x) => x.name === "cheryl.dawson")!;
  expect(cheryl.session.pct).toBeNull();
  expect(cheryl.week.pct).toBeNull();
  // and a genuine zero still reads as zero, not as missing
  expect(m.find((x) => x.name === "farhan.mills")!.session.pct).toBe(0);
});

test("unicode minus in net parses negative, not NaN", async () => {
  const m = parsePoolMembers(await fx("pool-members"))!;
  expect(m.find((x) => x.name === "elena.brooks")!.netM).toBe(-489.6);
  expect(m.find((x) => x.name === "alice.stoneham")!.netM).toBe(2482.3);
  // a member with no usage reading still has a net balance
  expect(m.find((x) => x.name === "cheryl.dawson")!.netM).toBe(-1137.3);
});

test("list / current / pool status / doctor", async () => {
  const accts = parseList(await fx("list"))!;
  expect(accts).toHaveLength(4);
  expect(accts.find((a) => a.active)!.email).toBe("brian.cooley@example.com");

  expect(parseCurrent(await fx("current"))).toEqual({
    account: "brian", email: "brian.cooley@example.com", org: "acme corp", plan: "team",
  });

  const st = parsePoolStatus(await fx("pool-status"))!;
  expect(st.consuming.on).toBe(false);
  expect(st.sharing.on).toBe(true);

  const doc = parseDoctor(await fx("doctor"))!;
  expect(doc.summary).toBe("15 ok");
  expect(doc.accounts).toHaveLength(4);
  expect(doc.checks.find((c) => c.label === "claude CLI")!.detail).toBe("2.1.234 (Claude Code)");
});

// Two fixtures because claudex prints a different shape once its headroom reading goes stale, and
// that branch is exactly where an update will break this.
test("pool member: flows, drivers, and the stale-headroom shape", async () => {
  const d = parseMemberDetail(await fx("pool-member"))!;
  expect(d.name).toBe("alice.stoneham");
  expect(d.marked).toBe(true);
  expect(d.flows.map((f) => f.label)).toEqual(["own", "borrowed", "shared"]);
  expect(d.flows[0].note).toBe("my token → me");
  expect(d.netM).toBe(2482.3);
  expect(d.netDir).toBe("giver");
  expect(d.splitNote).toBeNull();
  expect(d.footnote).toBe("shares are of observed proxy tokens, approximate");

  expect(d.windows.map((w) => w.label)).toEqual(["5-hour", "week"]);
  // "(you)" is a suffix on the name, not part of it
  expect(d.windows[0].drivers[0]).toEqual({ name: "alice.stoneham", you: true, pct: 100, tokens: "123.7M" });
  expect(d.windows[1].drivers).toHaveLength(3);
  expect(d.windows[1].drivers[1].you).toBe(false);

  const s = parseMemberDetail(await fx("pool-member-stale"))!;
  expect(s.splitNote).toBe("headroom stale");
  // a stale window loses its label AND its reset time, but 0% used is still a genuine zero
  expect(s.windows[0].label).toBe("last 5h");
  expect(s.windows[0].pct).toBe(0);
  expect(s.windows[0].resets).toBeNull();
  expect(s.windows[0].drivers).toEqual([]);
  expect(s.windows[0].note).toBe("no attributed traffic this window");
  expect(s.netM).toBe(-1137.3); // U+2212 minus, not NaN
});

test("garbage in -> null out, so the server falls back to raw text", async () => {
  const cat = "  ( ^_^ )  'usage --json' isn't a thing, but you typed it with such confidence!";
  expect(parseUsage(cat)).toBeNull();
  expect(parsePoolMembers(cat)).toBeNull();
  expect(parseList("")).toBeNull();
  expect(parseCurrent("")).toBeNull();
  expect(parsePoolStatus("")).toBeNull();
  expect(parseDoctor("")).toBeNull();
  expect(parseMemberDetail(cat)).toBeNull();
  // a `list` table must not be accepted as a `usage` table, and vice versa
  expect(parseUsage(await fx("list"))).toBeNull();
  expect(parseList(await fx("usage"))).toBeNull();
  // `pool members` and `pool member` are the closest pair here — neither may pass as the other
  expect(parseMemberDetail(await fx("pool-members"))).toBeNull();
  expect(parsePoolMembers(await fx("pool-member"))).toBeNull();
});
