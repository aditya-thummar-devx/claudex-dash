// Which of the two switch commands the header button would fire. Worth its own test because the
// two take names from different namespaces — `switch` the short profile name, `pool use` the dotted
// pool name — and the wrong branch does not merely 400: `pool use` spends a coworker's quota.
import { test, expect } from "bun:test";
import { mineTarget } from "./public/mine.js";

const ME = { account: "brian", pool: "brian.cooley" };
// Only the fields mineTarget reads. `marked` is claudex's ▶ — the member currently serving you.
const payload = (over: any = {}) => ({
  me: ME,
  accounts: { ok: true, data: { current: { account: "alice" } } },
  pool: { ok: true, data: [{ name: "alice.stoneham", marked: true }, { name: "brian.cooley", marked: false }] },
  ...over,
});

test("mineTarget: each tab picks the command from its own namespace", () => {
  expect(mineTarget(payload(), "usage")).toEqual({ kind: "switch", name: "brian" });
  expect(mineTarget(payload(), "accounts")).toEqual({ kind: "switch", name: "brian" });
  expect(mineTarget(payload(), "pool")).toEqual({ kind: "pool", name: "brian.cooley" });
});

test("mineTarget: nothing to offer on the account you are already on", () => {
  const here = payload({ accounts: { ok: true, data: { current: { account: "brian" } } } });
  expect(mineTarget(here, "usage")).toBeNull();
  expect(mineTarget(here, "accounts")).toBeNull();
  // Pool is a separate question: being logged into your own account says nothing about whose token
  // your traffic is routed through, so the ▶ still decides this one.
  expect(mineTarget(here, "pool")).toEqual({ kind: "pool", name: "brian.cooley" });

  const served = payload({
    pool: { ok: true, data: [{ name: "brian.cooley", marked: true }] },
  });
  expect(mineTarget(served, "pool")).toBeNull();
});

test("mineTarget: null wherever the answer is unknown rather than guessed", () => {
  expect(mineTarget(null, "usage")).toBeNull(); // nothing loaded yet
  expect(mineTarget(payload({ me: null }), "usage")).toBeNull(); // CLAUDEX_ME unset
  expect(mineTarget(payload({ me: { account: "brian", pool: null } }), "pool")).toBeNull(); // not in the pool
  expect(mineTarget(payload(), "status")).toBeNull(); // Health has no accounts
  expect(mineTarget(payload(), "")).toBeNull();
});

test("mineTarget: a panel showing raw claudex output offers no button", () => {
  // Its data is unparsed text, so "am I already on it?" cannot be answered — and a button that
  // cannot tell is worse than no button.
  expect(mineTarget(payload({ accounts: { ok: false, raw: "…" } }), "usage")).toBeNull();
  expect(mineTarget(payload({ accounts: { ok: false, raw: "…" } }), "accounts")).toBeNull();
  expect(mineTarget(payload({ pool: { ok: false, raw: "…" } }), "pool")).toBeNull();
});
