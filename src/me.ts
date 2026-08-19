// Which account is *mine* — the one thing no claudex COMMAND will tell us.
//
// `claudex current` is aliased `whoami`, but it reports whichever account is logged in right now,
// not the person at the keyboard: switch to a coworker's saved profile and `whoami` says their
// name. What does know is a file claudex keeps beside its accounts — see whoAmI() below.
//
// Two names come back because the dashboard's two switch commands live in different namespaces and
// must never be crossed (see server.ts): `switch` takes the short profile name off `claudex list`
// ("brian"), `pool use` takes the dotted name off `claudex pool members` ("brian.cooley").
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AccountRow, PoolMember } from "./parse.ts";

export type Me = { account: string; pool: string | null } | null;

const local = (email: string) => email.split("@")[0] ?? "";

// claudex writes this when it first joins a pool and does not touch it again — it survives every
// `switch`, which is exactly the property `current` lacks. Verified: it still names the machine's
// owner while accounts.json (rewritten on every switch) has a coworker's profile active.
//
// Undocumented and private, so it is read defensively: any failure — absent, unreadable, renamed by
// a claudex update, or reshaped — returns "" and the dashboard simply shows no button. Never throw
// from here; this runs on the /api/all path that every panel depends on.
const IDENTITY = join(homedir(), ".claude-accounts", "identity.json");

export function whoAmI(env: string, path = IDENTITY): string {
  // The env var wins so a machine where the file is missing, stale, or deliberately wrong still has
  // a way to say who you are.
  if (env.trim()) return env.trim();
  try {
    const email = JSON.parse(readFileSync(path, "utf8"))?.email;
    return typeof email === "string" ? email : "";
  } catch {
    return "";
  }
}

// Three spellings are accepted because all three name the same person and there is no reason to
// make the user guess which one this file wants: the profile name, the full address, or its local
// part (which is also the pool name).
export function resolveMe(
  who: string,
  accounts: AccountRow[] | null,
  members: PoolMember[] | null
): Me {
  const w = who.trim().toLowerCase();
  if (!w || !accounts) return null;

  const a = accounts.find(
    (r) =>
      r.account.toLowerCase() === w ||
      r.email.toLowerCase() === w ||
      local(r.email).toLowerCase() === w
  );
  if (!a) return null;

  // The dotted name is a derivation, not something claudex handed us, so it only counts if the pool
  // list actually contains it. That is the same gate server.ts applies to an incoming name — doing
  // it here too means the page never renders a button whose POST would come straight back 400.
  const pool = local(a.email);
  return { account: a.account, pool: members?.some((m) => m.name === pool) ? pool : null };
}
