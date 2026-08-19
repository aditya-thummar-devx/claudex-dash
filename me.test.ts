// "Mine" is the one fact claudex will not tell us, so the resolution of it is worth pinning down —
// especially the pool half, which is a DERIVED name (email local part) rather than one claudex
// printed. Getting that wrong renders a button whose POST comes straight back 400.
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveMe, whoAmI } from "./src/me.ts";
import type { AccountRow, PoolMember } from "./src/parse.ts";

const acc = (account: string, email: string): AccountRow =>
  ({ account, email, active: false, org: "acme corp", plan: "team", saved: "1d ago" });
const mem = (name: string): PoolMember =>
  ({ name, plan: "Max 5x", marked: false, active: false, sharing: true,
     session: { pct: null, at: null }, week: { pct: null, at: null }, netM: null });

const ACCOUNTS = [acc("alice", "alice.stoneham@example.com"), acc("brian", "brian.cooley@example.com")];
const MEMBERS = [mem("alice.stoneham"), mem("brian.cooley"), mem("cheryl.dawson")];

test("resolveMe: all three spellings of the same person land on one account", () => {
  const want = { account: "brian", pool: "brian.cooley" };
  expect(resolveMe("brian", ACCOUNTS, MEMBERS)).toEqual(want); // profile name
  expect(resolveMe("brian.cooley@example.com", ACCOUNTS, MEMBERS)).toEqual(want); // full address
  expect(resolveMe("brian.cooley", ACCOUNTS, MEMBERS)).toEqual(want); // local part = pool name
  expect(resolveMe("  BRIAN  ", ACCOUNTS, MEMBERS)).toEqual(want); // shell quoting and case
});

test("resolveMe: no answer is null, never a guess", () => {
  expect(resolveMe("", ACCOUNTS, MEMBERS)).toBeNull(); // CLAUDEX_ME unset
  expect(resolveMe("   ", ACCOUNTS, MEMBERS)).toBeNull();
  expect(resolveMe("nobody", ACCOUNTS, MEMBERS)).toBeNull(); // names no saved account
  expect(resolveMe("brian", null, MEMBERS)).toBeNull(); // `claudex list` unparseable
});

test("resolveMe: the dotted name only survives if the pool actually lists it", () => {
  // The account resolves either way — only the derived half is dropped, so the Usage and Accounts
  // tabs keep working while the Pool tab shows no button.
  expect(resolveMe("brian", ACCOUNTS, [mem("alice.stoneham")])).toEqual({ account: "brian", pool: null });
  expect(resolveMe("brian", ACCOUNTS, null)).toEqual({ account: "brian", pool: null });
  expect(resolveMe("brian", ACCOUNTS, [])).toEqual({ account: "brian", pool: null });
});

test("resolveMe: a profile whose email is not in the pool is not silently paired with one", () => {
  const solo = [acc("personal", "someone@gmail.com")];
  expect(resolveMe("personal", solo, MEMBERS)).toEqual({ account: "personal", pool: null });
});

// ---- whoAmI ----
// claudex has no command for this, so the answer comes off a private file. Read defensively: it is
// undocumented, it sits on the /api/all path every panel depends on, and a claudex update is free
// to move or reshape it. Every failure has to end as "" — a throw here blanks the whole dashboard.
// tmpdir, not the repo: a leftover fixture beside the source is noise in `git status`. Sync writes
// because the reader under test is sync too — an unawaited Bun.write() would be a race.
const fixture = (body: string) => {
  const f = join(mkdtempSync(join(tmpdir(), "claudex-dash-")), "identity.json");
  writeFileSync(f, body);
  return f;
};

test("whoAmI: reads the email claudex recorded when it joined the pool", () => {
  const f = fixture(JSON.stringify({ email: "alice.stoneham@example.com", poolId: "pl_x" }));
  expect(whoAmI("", f)).toBe("alice.stoneham@example.com");
});

test("whoAmI: CLAUDEX_ME overrides the file, so a wrong or stale one is escapable", () => {
  const f = fixture(JSON.stringify({ email: "alice.stoneham@example.com" }));
  expect(whoAmI("brian", f)).toBe("brian");
  expect(whoAmI("  brian  ", f)).toBe("brian");
  expect(whoAmI("brian", "/nonexistent")).toBe("brian"); // override needs no file at all
});

test("whoAmI: every way the file can fail ends as \"\", never a throw", () => {
  expect(whoAmI("", "/nonexistent/identity.json")).toBe(""); // never joined a pool
  expect(whoAmI("", fixture("not json"))).toBe(""); // truncated or corrupt
  expect(whoAmI("", fixture("null"))).toBe("");
  expect(whoAmI("", fixture(JSON.stringify({ poolId: "pl_x" })))).toBe(""); // reshaped: no email
  expect(whoAmI("", fixture(JSON.stringify({ email: 42 })))).toBe(""); // reshaped: wrong type
});
