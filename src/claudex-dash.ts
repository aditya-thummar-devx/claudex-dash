// Spawning the claudex CLI: command allowlist, hard timeout, 60s cache on reads.
//
// Three constraints drive everything here:
//   1. `claudex usage` takes ~1.25s AND writes ~/.claude-accounts/accounts.json as a side effect
//      (it refreshes and persists tokens). So we cache — a page reload must not rewrite the file
//      holding four account tokens.
//   2. An expired token can make claudex stall or prompt. An unbounded spawn would wedge the
//      request forever, so every run has a hard timeout and reads fall back to stale cache.
//   3. Exactly four commands here change state — `switch`, `pool use`, `access allow|deny`, and
//      `pool start|stop`, all driven by buttons on the page. Everything else is read-only, and
//      stays that way.
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
// NEVER add: login · add · remove · rename · pool join
//            sessions share/pull · keep-warm · refresh · autoswitch run · update · access remove
// Those create or destroy profiles, move tokens between people, or erase someone from your access
// list with no way back from a web page. None of them belong behind a button.
//
// `access` used to be on that list wholesale. It is not any more: bare `access` is a read, and
// `access allow|deny <name>` is reachable from the Access tab — see accessSet() below for the line
// that was drawn and where. `access remove` stays banned, hence its explicit entry above.
//
// `pool start`/`pool stop` used to be banned wholesale too. They are not any more, but they are a
// different shape from everything reachable here: no argument, so no coworker's name to check —
// what they flip is a boolean on THIS account. `pool join` stays banned: it is the one-way step of
// enrolling this account in a pool for the first time, and that still doesn't belong behind a
// button. See poolStart()/poolStop() below.
//
// `autoswitch on`/`autoswitch off` used to be banned wholesale too, for the same reason: no argument
// beyond a fixed on/off, so no coworker's name to check — what it flips is a setting on THIS account,
// reversible any time by pressing the other one. `autoswitch run` stays banned: it is a one-shot
// manual trigger that can switch the active account right now, not a persisted setting, and that
// still doesn't belong behind a button. See autoswitchOn()/autoswitchOff() below.
//
// Four commands live OUTSIDE this table because they take an argument:
//   `pool member <name>`        (read-only)  — captureMember()
//   `switch <name>`             (mutating)   — switchAccount()
//   `pool use <name>`           (mutating)   — poolUse()
//   `access allow|deny <name>`  (mutating)   — accessSet()
// The rule they share: the name is user-supplied, so the caller MUST validate it against a list
// claudex itself printed before it reaches argv. The three mutating ones additionally stay out of
// COMMANDS (captureAll() would run them on every page load) and out of capture() (a 60s TTL would
// silently no-op a second switch within the minute).
export const COMMANDS = {
  usage: ["usage"],
  poolMembers: ["pool", "members"],
  poolStatus: ["pool", "status"],
  list: ["list"],
  current: ["current"],
  doctor: ["doctor"],
  access: ["access"], // read-only: prints who may borrow this account. allow/deny is accessSet().
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

// The one mutating command this file was originally written to refuse — see the note on COMMANDS.
// Two things keep it inside the same guarantee as the other two rather than widening it:
//
//   1. `verb` is a union, not a string. The only two words that can reach argv here are spelled out
//      in this signature, so `access remove` is unreachable from any caller no matter what arrives
//      over the wire. server.ts validates the incoming value against the same two before calling.
//   2. `name` is subject to the same untrusted-name rule as switchAccount() and poolUse(): it must
//      already appear in the list `claudex access` itself printed. That list is its OWN namespace —
//      close in shape to `pool members`, and not interchangeable with it.
export const accessSet = (name: string, verb: "allow" | "deny") => action(["access", verb, name]);

// The two mutating commands this file was originally written to refuse — see the note on COMMANDS
// above. Unlike everything else exported here, neither takes a name: `pool start`/`pool stop` flip
// whether THIS account is currently borrowing from the pool via token-swap, on or off. There is no
// coworker's name to validate, which is why server.ts's route for this pair has no name list to
// check against.
//
// Shipped without --force: unlike switchAccount, whether these ever prompt is unverified (closed
// source, no fixture shows the `consuming: on` state). If one hangs to ACTION_TIMEOUT_MS on first
// real use, that's the signal to add the equivalent flag here — safer than guessing an unsupported
// flag now and breaking the command outright.
export const poolStart = () => action(["pool", "start"]);
export const poolStop = () => action(["pool", "stop"]);

// Same reasoning as poolStart/poolStop above: no coworker's name, a boolean on this account only,
// shipped without --force because whether autoswitch on/off ever prompts is unverified (closed
// source). If one hangs to ACTION_TIMEOUT_MS on first real use, add the equivalent flag then.
export const autoswitchOn = () => action(["autoswitch", "on"]);
export const autoswitchOff = () => action(["autoswitch", "off"]);
