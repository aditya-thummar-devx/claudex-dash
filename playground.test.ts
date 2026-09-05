// Playground's tree is the one thing standing between a click and a real claudex spawn, so its
// shape gets checked directly: every leaf must be runnable exactly one way, and every `mutate` must
// be a real ASK/FIRE key (checked against app.js's own list, hardcoded here so this fails loudly if
// either drifts). namesFor() is checked against the same panel shapes mine.test.ts already uses.
import { test, expect } from "bun:test";
import { TREE, childKind, namesFor, findNode } from "./public/playground.js";

// Mirrors the keys of ASK/FIRE in public/app.js — kept in sync by hand since neither table is
// exported (they close over `last`/`ask`/`fireMutation`), same reasoning FIRE gives for keeping ASK
// and FIRE two tables instead of one.
const MUTATE_KEYS = ["switch", "remove", "pool", "allow", "deny", "start", "stop", "on", "off"];

function walk(nodes: any[], visit: (n: any) => void) {
  for (const n of nodes) {
    visit(n);
    if (n.children) walk(n.children, visit);
  }
}

test("TREE: every node has a label, and a summary unless it's a pure container", () => {
  walk(TREE, (n) => {
    expect(typeof n.label).toBe("string");
    expect(n.label.length).toBeGreaterThan(0);
  });
});

test("TREE: every node is exactly one runnable shape", () => {
  walk(TREE, (n) => {
    const kind = childKind(n);
    if (kind === "static") {
      // A branch runs nothing itself — its children do.
      expect(n.cmd).toBeUndefined();
      expect(n.mutate).toBeUndefined();
    } else if (kind === "dynamic") {
      // Runs only through its generated name-children: exactly one of readMember/mutate decides how.
      expect(n.cmd).toBeUndefined();
      expect(Boolean(n.readMember) !== Boolean(n.mutate)).toBe(true);
      expect(n.cli).toContain("{name}");
    } else {
      // A direct leaf: a no-argument read (cmd) or a no-argument write (mutate), never both.
      expect(Boolean(n.cmd) !== Boolean(n.mutate)).toBe(true);
      expect(n.cli).not.toContain("{name}");
    }
  });
});

test("TREE: every mutate is a real ASK/FIRE key", () => {
  walk(TREE, (n) => {
    if (n.mutate) expect(MUTATE_KEYS).toContain(n.mutate);
  });
});

test("TREE: every argSource is one namesFor() knows how to resolve", () => {
  walk(TREE, (n) => {
    if (n.argSource) expect(["poolMembers", "access", "list"]).toContain(n.argSource);
  });
});

test("findNode: resolves nested ids, including from inside a branch", () => {
  expect(findNode("usage")?.id).toBe("usage");
  expect(findNode("pool.member")?.id).toBe("pool.member");
  expect(findNode("nope")).toBeNull();
});

// Same panel shapes as mine.test.ts's payload() — only the fields namesFor() reads.
test("namesFor: reads names off the matching panel, [] when it isn't ok yet", () => {
  const last = {
    pool: { ok: true, data: [{ name: "alice.stoneham" }, { name: "brian.cooley" }] },
    access: { ok: true, data: [{ name: "brian.cooley" }] },
    accounts: { ok: true, data: { accounts: [{ account: "alice" }, { account: "brian" }] } },
  };
  expect(namesFor("poolMembers", last)).toEqual(["alice.stoneham", "brian.cooley"]);
  expect(namesFor("access", last)).toEqual(["brian.cooley"]);
  expect(namesFor("list", last)).toEqual(["alice", "brian"]);

  expect(namesFor("poolMembers", { pool: { ok: false } })).toEqual([]);
  expect(namesFor("poolMembers", null)).toEqual([]);
  expect(namesFor("unknown-source" as any, last)).toEqual([]);
});
