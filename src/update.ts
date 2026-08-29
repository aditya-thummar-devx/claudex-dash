// Checking and applying updates: a sibling to claudex-dash.ts's run(), not a widening of it. run()
// hardcodes the claudex binary and its resolution logic — none of that applies to git, which is
// always on PATH but does need a cwd pinned to the repo root, something run() never sets because
// claudex doesn't care where it's invoked from.
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { ActionResult } from "./claudex-dash.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const TIMEOUT_MS = 10_000; // fetch + rev-parse — matches claudex-dash.ts's read timeout
const PULL_TIMEOUT_MS = 30_000; // pull — matches claudex-dash.ts's ACTION_TIMEOUT_MS

type GitResult = { out: string; code: number };

function runGit(args: readonly string[], timeoutMs = TIMEOUT_MS): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...args], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], shell: false });
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ out, code: code ?? 1 });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

export type UpdateCheck = { ok: boolean; current: string; latest: string; upToDate: boolean; error?: string };

// Pure decision from two rev-parse results — testable without shelling real git. A rev-parse failure
// on either side means we don't trust the SHAs, so upToDate defaults to true: never pop "update
// available" off data we're not sure about (same principle as capture() in claudex-dash.ts).
export function decide(head: GitResult, origin: GitResult): UpdateCheck {
  if (head.code !== 0 || origin.code !== 0) {
    return { ok: false, current: "", latest: "", upToDate: true, error: "git rev-parse failed" };
  }
  const current = head.out.trim();
  const latest = origin.out.trim();
  return { ok: true, current, latest, upToDate: current === latest };
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  try {
    const fetch = await runGit(["fetch", "origin", "main"]);
    if (fetch.code !== 0) {
      return { ok: false, current: "", latest: "", upToDate: true, error: fetch.out.trim() || "git fetch failed" };
    }
    const [head, origin] = await Promise.all([
      runGit(["rev-parse", "--short", "HEAD"]),
      runGit(["rev-parse", "--short", "origin/main"]),
    ]);
    return decide(head, origin);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, current: "", latest: "", upToDate: true, error: msg };
  }
}

export async function applyUpdate(): Promise<ActionResult> {
  const r = await runGit(["pull", "--ff-only", "origin", "main"], PULL_TIMEOUT_MS);
  return { ok: r.code === 0, raw: r.out };
}
