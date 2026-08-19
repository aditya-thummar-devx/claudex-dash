// Spawning the claudex CLI: command allowlist, hard timeout, 60s cache on reads.
//
// Three constraints drive everything here:
//   1. `claudex usage` takes ~1.25s AND writes ~/.claude-accounts/accounts.json as a side effect
//      (it refreshes and persists tokens). So we cache — a page reload must not rewrite the file
//      holding four account tokens.
//   2. An expired token can make claudex stall or prompt. An unbounded spawn would wedge the
//      request forever, so every run has a hard timeout and reads fall back to stale cache.
//   3. Exactly two commands here change state — `switch` and `pool use`, both driven by the
//      dashboard's Switch buttons. Everything else is read-only, and stays that way.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

// ~/.local/bin is not on a minimal PATH, so an absolute path is tried first — the same reason
// claude-session-manager/src/config.ts hardcodes CLAUDE_BIN. It cannot be hardcoded to one machine
// though, so: an explicit override, then the places claudex actually installs itself, then PATH.
//
// The last rung is load-bearing beyond convenience. When nothing resolves, spawn emits ENOENT on
// its `error` event, run() rejects, and capture() returns { raw: "", error: "spawn claudex ENOENT" }
// — an error with no raw at all. That shape is what public/app.js tells apart from a stale capture
// (which has an error AND raw) to decide whether claudex is missing rather than merely slow.
const BIN =
  process.env.CLAUDEX_BIN ??
  [`${homedir()}/.local/bin/claudex`, "/opt/homebrew/bin/claudex", "/usr/local/bin/claudex"].find(
    existsSync
  ) ??
  "claudex"; // spawn() runs without a shell, but still walks PATH for a bare name
const TIMEOUT_MS = 10_000;
// Mutating commands get a longer budget than reads. `switch` refreshes tokens over the network and
// rewrites accounts.json; at 10s a SIGKILL could plausibly land mid-write. At 30s a kill means the
// process is genuinely wedged rather than merely slow.
const ACTION_TIMEOUT_MS = 30_000;
const TTL_MS = 60_000;

// READ-ONLY ALLOWLIST. Every arg array below is a hardcoded constant — no user input ever reaches
// argv, and spawn runs without a shell.
//
// NEVER add: login · add · remove · rename · pool start/stop/join · access
//            sessions share/pull · keep-warm · refresh · autoswitch · update
// Those create or destroy profiles, move tokens between people, or change who may borrow this
// account. None of them belong behind a button on a web page.
//
// Three commands live OUTSIDE this table because they take an argument:
//   `pool member <name>` (read-only)  — captureMember()
//   `switch <name>`      (mutating)   — switchAccount()
//   `pool use <name>`    (mutating)   — poolUse()
// The rule they share: the name is user-supplied, so the caller MUST validate it against a list
// claudex itself printed before it reaches argv. The two mutating ones additionally stay out of
// COMMANDS (captureAll() would run them on every page load) and out of capture() (a 60s TTL would
// silently no-op a second switch within the minute).
export const COMMANDS = {
  usage: ["usage"],
  poolMembers: ["pool", "members"],
  poolStatus: ["pool", "status"],
  list: ["list"],
  current: ["current"],
  doctor: ["doctor"],
} as const;

export type CommandKey = keyof typeof COMMANDS;

// Resolves the exit code alongside the output: a read command's failure is caught by its parser, but
// a mutating command has no parser, so the code is the only success signal it gets.
function run(args: readonly string[], timeoutMs = TIMEOUT_MS): Promise<{ out: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, [...args], { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    // claudex prints its error pages (the ASCII cat, "unrecognized arguments") to stdout or stderr
    // depending on the failure, and the parsers detect those themselves — so merge both streams and
    // let the parser decide whether it is data.
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

export type Capture = { raw: string; age: number; error?: string };

// Keyed by string, not CommandKey, because per-member captures share this cache under
// `member:<name>`. The two key spaces cannot collide — no CommandKey contains a colon.
const cache = new Map<string, { raw: string; at: number }>();

async function capture(key: string, args: readonly string[], fresh: boolean): Promise<Capture> {
  const hit = cache.get(key);
  const now = Date.now();
  if (!fresh && hit && now - hit.at < TTL_MS) {
    return { raw: hit.raw, age: Math.round((now - hit.at) / 1000) };
  }
  try {
    // The exit code is deliberately ignored for reads: the parsers already reject output they do not
    // recognise, and claudex exits non-zero on conditions whose output is still perfectly parseable.
    const { out: raw } = await run(args);
    cache.set(key, { raw, at: now });
    return { raw, age: 0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Serve stale rather than nothing — an old number beats a blank panel, as long as we say so.
    if (hit) return { raw: hit.raw, age: Math.round((now - hit.at) / 1000), error: `stale: ${msg}` };
    return { raw: "", age: 0, error: msg };
  }
}

// All six run concurrently, so a refresh costs the slowest command (~1.5s), not their sum.
// Verified safe: three parallel `claudex usage` runs produced identical output and left
// accounts.json intact.
export async function captureAll(fresh: boolean): Promise<Record<CommandKey, Capture>> {
  const keys = Object.keys(COMMANDS) as CommandKey[];
  const results = await Promise.all(keys.map((k) => capture(k, COMMANDS[k], fresh)));
  return Object.fromEntries(keys.map((k, i) => [k, results[i]])) as Record<CommandKey, Capture>;
}

// The one read command that takes an argument. `pool member` is read-only — it prints a breakdown
// and mutates nothing — but it does break the "no user input ever reaches argv" rule above, so the
// name is not trusted here: server.ts matches it against the members parsed out of `pool members`
// first and rejects anything else. NEVER call this with a string straight off the wire.
export function captureMember(name: string, fresh: boolean): Promise<Capture> {
  return capture(`member:${name}`, ["pool", "member", name], fresh);
}

export type ActionResult = { ok: boolean; raw: string };

// The two mutating commands. Same untrusted-name rule as captureMember(): server.ts validates the
// name against claudex's own list before calling. Not cached — a switch must actually run every
// time — and the read cache is dropped afterwards because every entry in it now describes the
// pre-switch world.
async function action(args: readonly string[]): Promise<ActionResult> {
  const { out, code } = await run(args, ACTION_TIMEOUT_MS);
  cache.clear();
  return { ok: code === 0, raw: out };
}

// --force keeps it non-interactive: a confirmation prompt would leave the child waiting on a stdin
// we closed, and the HTTP request would hang until the timeout kills it.
export const switchAccount = (name: string) => action(["switch", name, "--force"]);
export const poolUse = (name: string) => action(["pool", "use", name]);
