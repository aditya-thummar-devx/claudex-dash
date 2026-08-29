// claudex-dash — a web view of claudex state, with six actions.
//
// Seven API routes plus static files. Three GETs compose the panels from seven CLI captures, or check
// this dashboard's own repo against origin/main; each panel carries both parsed data and the raw text
// it came from, so a parser that stops recognising claudex's output degrades that panel to plain text
// instead of showing wrong numbers.
//
// Six POSTs back the page's buttons: `claudex switch`, `claudex pool use`,
// `claudex access allow|deny`, `claudex pool start|stop`, `claudex autoswitch on|off`, and this
// dashboard's own `git pull` to update itself. They are the only routes that change anything, and
// they are held to the same rules — same-origin only, JSON content type only, and — for the three
// that take a name — a name that claudex itself already listed, in the namespace of the command about
// to receive it. The other three take no name at all; see the POSTS table below.
import { join } from "node:path";
import {
  captureAll, captureMember, switchAccount, poolUse, accessSet, poolStart, poolStop,
  autoswitchOn, autoswitchOff,
} from "./src/claudex-dash.ts";
import type { Capture } from "./src/claudex-dash.ts";
import { checkForUpdate, applyUpdate } from "./src/update.ts";
import { sameOrigin } from "./src/guard.ts";
import { resolveMe, whoAmI } from "./src/me.ts";
import {
  parseUsage, parseList, parseCurrent, parsePoolStatus, parseDoctor, parsePoolMembers,
  parseMemberDetail, parseAccess,
} from "./src/parse.ts";

// Overridable because 4400 is not reserved for us — and because running the bootstrap twice would
// otherwise kill the second copy with a raw EADDRINUSE stack. ORIGINS below interpolates this, so
// the CSRF guard follows a custom port for free.
const PORT = Number(process.env.PORT) || 4400;
const PUBLIC_DIR = join(import.meta.dir, "public");
// Who is at this keyboard — normally detected, not configured, because nobody installing this from
// bootstrap.sh is going to set an env var they were never told about. CLAUDEX_ME still overrides.
// Read once at boot: identity.json does not change while the server runs, and re-reading it on
// every /api/all would put a file read on the hot path for a value that cannot have moved.
// Finding nobody is an ordinary state: /api/all reports me:null and the page shows no button.
const ME = whoAmI(process.env.CLAUDEX_ME ?? "");

type Panel = { ok: boolean; data: unknown; raw: string; age: number; error?: string };

// A panel is ok only when the parser recognised the shape AND the capture itself succeeded.
function panel(cap: Capture, data: unknown): Panel {
  const ok = data !== null && !cap.error;
  return {
    ok,
    data,
    raw: cap.raw,
    age: cap.age,
    ...(cap.error ? { error: cap.error } : data === null ? { error: "unrecognised output" } : {}),
  };
}

// Two captures share a panel where they describe one thing: accounts+current, and pool health.
function pair(a: Capture, b: Capture, data: unknown): Panel {
  const err = a.error ?? b.error;
  return {
    ok: data !== null && !err,
    data,
    raw: `${a.raw}\n${b.raw}`,
    age: Math.max(a.age, b.age),
    ...(err ? { error: err } : data === null ? { error: "unrecognised output" } : {}),
  };
}

// Both spellings of this machine — see src/guard.ts for why refusing one buys nothing.
const ORIGINS = [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`];

// The five mutating routes, one row each. A table rather than branches because the rows must be
// read side by side: each names the list its `name` has to appear in, and those lists are DIFFERENT
// NAMESPACES that must never be crossed. `switch` wants the short profile name from `claudex list`
// ("brian"); `pool use` wants the dotted pool name from `claudex pool members` ("alice.stoneham");
// `access allow|deny` wants a dotted name too, but off `claudex access` — a separate list that
// merely looks like the pool one. Validating each against its own source enforces all of that for
// free, and puts the pairing somewhere it can be checked at a glance. `pool start|stop` and
// `autoswitch on|off` carry no name at all — `known: null` marks a route as having nobody to check,
// see the handler below.
const POSTS = {
  "/api/switch": {
    known: (c: Record<string, Capture>) => parseList(c.list.raw)?.map((a) => a.account),
    run: (name: string) => switchAccount(name),
  },
  "/api/pool/use": {
    known: (c: Record<string, Capture>) => parsePoolMembers(c.poolMembers.raw)?.map((m) => m.name),
    run: (name: string) => poolUse(name),
  },
  "/api/access": {
    known: (c: Record<string, Capture>) => parseAccess(c.access.raw)?.map((p) => p.name),
    // The only route with a second field. `remove` is deliberately absent — see the note at the
    // check below, and the one on COMMANDS in src/claudex-dash.ts.
    verbs: ["allow", "deny"] as const,
    run: (name: string, verb: "allow" | "deny") => accessSet(name, verb),
  },
  "/api/pool/toggle": {
    // No name to validate — pool start/pool stop take no argument, they flip THIS account's own
    // state. `known: null` tells the handler below to skip the name gate entirely, rather than
    // treating an empty list as "nobody is valid".
    known: null,
    verbs: ["start", "stop"] as const,
    run: (_name: string, verb: "start" | "stop") => (verb === "start" ? poolStart() : poolStop()),
  },
  "/api/autoswitch/toggle": {
    // Same shape as /api/pool/toggle: autoswitch on/off take no argument, they flip THIS account's
    // own setting.
    known: null,
    verbs: ["on", "off"] as const,
    run: (_name: string, verb: "on" | "off") => (verb === "on" ? autoswitchOn() : autoswitchOff()),
  },
  "/api/update/apply": {
    // Same shape again: no name, one thing this route ever does. `verbs` is a single-item tuple
    // purely so the body still goes through the same dispatch as every other row, rather than a
    // bespoke branch below.
    known: null,
    verbs: ["apply"] as const,
    run: (_name: string, _verb: "apply") => applyUpdate(),
  },
} as const;

const config = {
  port: PORT,
  // 127.0.0.1 ONLY. The pool panel renders coworkers' email addresses and usage figures; this must
  // never be reachable off this machine.
  hostname: "127.0.0.1",
  async fetch(req: Request) {
    const url = new URL(req.url);

    // NEVER add CORS headers to this response — not to any route here, but this is the one that
    // would tempt you, because it is the one whose body someone else's page might want.
    //
    // Binding 127.0.0.1 stops other machines, not other pages: any site open in this browser can
    // fire a fetch at this URL, and this route answers with 10 coworkers' email addresses and usage
    // figures. What keeps that from leaking is the ABSENCE of Access-Control-Allow-Origin, which
    // makes the browser withhold the body from a cross-origin caller. It is the whole defence for
    // the GETs — src/guard.ts only covers the POSTs. So a well-meant "fix the CORS error" here
    // publishes the pool panel to every tab.
    if (url.pathname === "/api/all" && req.method === "GET") {
      const c = await captureAll(url.searchParams.has("fresh"));

      const accounts = parseList(c.list.raw);
      const current = parseCurrent(c.current.raw);
      const status = parsePoolStatus(c.poolStatus.raw);
      const doctor = parseDoctor(c.doctor.raw);
      const members = parsePoolMembers(c.poolMembers.raw);

      return Response.json({
        usage: panel(c.usage, parseUsage(c.usage.raw)),
        pool: panel(c.poolMembers, members),
        accounts: pair(c.list, c.current, accounts && current ? { accounts, current } : null),
        status: pair(c.poolStatus, c.doctor, status && doctor ? { status, doctor } : null),
        access: panel(c.access, parseAccess(c.access.raw)),
        // Not a panel: it has no raw text of its own and nothing to fall back to. Null whenever
        // CLAUDEX_ME is unset or names nobody claudex knows, which the page reads as "no button".
        me: resolveMe(ME, accounts, members),
      });
    }

    // One member's full own/borrowed/shared breakdown, fetched on demand when a Pool card's
    // View Details is clicked. Not part of /api/all: it is one CLI run per person, so it would turn
    // a page load into eleven spawns.
    if (url.pathname === "/api/pool/member" && req.method === "GET") {
      const name = url.searchParams.get("name") ?? "";
      // The name reaches argv, so it must be a selection rather than a string: it is only allowed
      // through if `claudex pool members` already listed it. This keeps the allowlist guarantee in
      // src/claudex-dash.ts intact. Uses the cached capture, so it normally costs nothing.
      const c = await captureAll(false);
      const members = parsePoolMembers(c.poolMembers.raw);
      // Two different failures, and conflating them lies: no list means we cannot vouch for ANY
      // name, which is a server problem — not the caller naming someone who is not in the pool.
      if (!members) return Response.json({ error: "pool member list unavailable" }, { status: 503 });
      if (!members.some((m) => m.name === name)) {
        return Response.json({ error: "unknown member" }, { status: 400 });
      }

      const cap = await captureMember(name, url.searchParams.has("fresh"));
      return Response.json(panel(cap, parseMemberDetail(cap.raw)));
    }

    // This dashboard's own version check: fetches origin/main and compares short SHAs. Unguarded
    // like /api/all — the response is just two commit hashes, nothing sensitive.
    if (url.pathname === "/api/update/check" && req.method === "GET") {
      return Response.json(await checkForUpdate());
    }

    // ---- the mutating routes ----
    // Everything above this point only reads. These five change something — which account is
    // logged in, who may borrow this one, whether it is currently borrowing from the pool, or
    // whether it auto-switches on high usage — so they carry the guards the GETs do not need: a
    // same-origin check (see src/guard.ts — localhost is reachable from any page in this browser), a
    // JSON content type (which forces a CORS preflight this server never answers), and — for the
    // three that take a name — the same gate as /api/pool/member above.
    if (req.method === "POST" && url.pathname in POSTS) {
      if (!sameOrigin(req.headers.get("origin"), ORIGINS)) {
        return Response.json({ error: "bad origin" }, { status: 403 });
      }
      if (req.headers.get("content-type") !== "application/json") {
        return Response.json({ error: "expected application/json" }, { status: 415 });
      }
      const body = await req.json().catch(() => null);
      const route = POSTS[url.pathname as keyof typeof POSTS];

      // Not every route takes a name — /api/pool/toggle and /api/autoswitch/toggle each flip a
      // boolean with nobody to name — so `known: null` is how a row opts out of this gate rather
      // than pretending an empty list means "nobody is valid". Uses the cached captures, so the gate
      // normally costs nothing.
      let name = "";
      if (route.known) {
        name = typeof body?.name === "string" ? body.name : "";
        const c = await captureAll(false);
        const known = route.known(c);
        // Two different failures, and conflating them lies: no list means we cannot vouch for ANY
        // name, which is a server problem — not the caller naming someone who does not exist.
        if (!known) return Response.json({ error: "name list unavailable" }, { status: 503 });
        if (!known.includes(name)) return Response.json({ error: "unknown name" }, { status: 400 });
      }

      // /api/access, /api/pool/toggle, and /api/autoswitch/toggle each carry a second field, the
      // verb claudex will run. Checked against a two-item literal rather than passed through — for
      // /api/access that's what puts `access remove` out of reach of anything arriving over the wire
      // (accessSet() narrows to the same two, so this is the outer half of one guarantee rather than
      // a lone check). An absent or unrecognised verb is a 400, never a default.
      const verb = body?.action;
      if (route.verbs && !route.verbs.includes(verb)) {
        return Response.json({ error: "unknown action" }, { status: 400 });
      }

      // claudex prints its own explanation on failure; pass it straight through rather than
      // inventing a message that might not match what actually went wrong.
      const r = await route.run(name, verb);

      // The one write whose success means "kill this process": launchd's KeepAlive=true
      // (bootstrap.sh) respawns it with the code just pulled. Deferred so the response below
      // actually reaches the browser before the process exits.
      if (url.pathname === "/api/update/apply" && r.ok) {
        setTimeout(() => process.exit(0), 100);
      }

      return Response.json({ ok: r.ok, raw: r.raw.trim() }, { status: r.ok ? 200 : 500 });
    }

    const file = Bun.file(join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname));
    if (await file.exists()) return new Response(file);
    return new Response("Not found", { status: 404 });
  },
};

// A busy port is the one startup failure a normal person will actually hit — running the install
// line twice does it — and it is almost always this same server already up. Say that, instead of
// exiting on a stack trace that reads like the tool is broken.
let server;
try {
  server = Bun.serve(config);
} catch (e) {
  if ((e as { code?: string })?.code !== "EADDRINUSE") throw e;
  console.error(`port ${PORT} is busy — claudex-dash is probably already running:`);
  console.error(`  http://127.0.0.1:${PORT}`);
  console.error(`if that port is something else, pick another:  PORT=4500 bun run server.ts`);
  process.exit(1);
}

console.log(`claudex-dash → http://127.0.0.1:${server.port}`);
