// The Playground command tree — pure data, no DOM, same shape as sort.js/mine.js so it can be unit
// tested without a browser. Deliberately restricted to the exact commands already safe to run
// elsewhere in this app: the read-only COMMANDS allowlist in src/claudex-dash.ts (`usage`, `list`,
// `current`, `doctor`, `pool status`, `pool members`, `access`) plus the mutating actions already
// wired to a button and a confirm dialog (`switch`, `remove`, `pool use`, `access allow/deny`,
// `pool start/stop`, `autoswitch on/off`). Nothing on README's banned list is reachable from here.
//
// A node is exactly one of:
//   - a branch:        has `children` (a fixed array of more nodes)
//   - a dynamic branch: has `argSource` — its "children" are names read live out of the cached
//                        `/api/all` payload (`namesFor` below), never free text
//   - a runnable leaf: has `cmd` (a no-argument read, via /api/playground/read) or `mutate` (a
//                        no-argument write, via the same ASK/FIRE table app.js already has) or both
//                        `argSource` and (`mutate` or `readMember`) — meaning its *generated* name
//                        children are what's runnable, not the node itself
// `cli` is a display-only string ("pool use {name}") for the terminal-style history log — it plays
// no part in what actually runs; app.js only ever calls through FIRE/ASK or the existing routes.
export const TREE = [
  { id: "usage", label: "Usage", cli: "usage", cmd: "usage",
    summary: "Rate-limit usage across your saved accounts — session and weekly gauges." },
  { id: "list", label: "List accounts", cli: "list", cmd: "list",
    summary: "List saved accounts (alias: ls)." },
  { id: "current", label: "Current account", cli: "current", cmd: "current",
    summary: "Show the currently active account (alias: whoami)." },
  { id: "doctor", label: "Doctor", cli: "doctor", cmd: "doctor",
    summary: "Health-check your claudex setup — what's on, wired, or failing." },
  { id: "switch", label: "Switch → name", cli: "switch {name} --force",
    argSource: "list", mutate: "switch",
    summary: "Log this machine into a saved account. Sessions started after this use it." },
  { id: "remove", label: "Remove → name", cli: "remove {name} --force",
    argSource: "list", mutate: "remove",
    summary: "Permanently delete a saved profile's token. Cannot be undone from this page." },
  { id: "pool", label: "Pool", summary: "Pool accounts behind one auto-failover proxy.",
    children: [
      { id: "pool.status", label: "Pool status", cli: "pool status", cmd: "poolStatus",
        summary: "Whether consuming/sharing token-swap is currently on." },
      { id: "pool.members", label: "Pool members", cli: "pool members", cmd: "poolMembers",
        summary: "Everyone in the pool: plan, share, session, own/pool/net." },
      { id: "pool.member", label: "Pool member → name", cli: "pool member {name}",
        argSource: "poolMembers", readMember: true,
        summary: "Full own/borrowed/shared breakdown for one pool member." },
      { id: "pool.use", label: "Use → name", cli: "pool use {name}",
        argSource: "poolMembers", mutate: "pool",
        summary: "Route your traffic through a coworker's token instead of your own." },
      { id: "pool.start", label: "Start pool", cli: "pool start", mutate: "start",
        summary: "Turn on token-swap for this account. Reversible with Stop pool." },
      { id: "pool.stop", label: "Stop pool", cli: "pool stop", mutate: "stop",
        summary: "Turn token-swap off for this account." },
    ] },
  { id: "access", label: "Access", summary: "Who may borrow your account through the pool.",
    children: [
      { id: "access.list", label: "Access (list)", cli: "access", cmd: "access",
        summary: "Who may borrow your account, allowed or blocked." },
      { id: "access.allow", label: "Allow → name", cli: "access allow {name}",
        argSource: "access", mutate: "allow",
        summary: "Let someone borrow your account through the pool." },
      { id: "access.deny", label: "Deny → name", cli: "access deny {name}",
        argSource: "access", mutate: "deny",
        summary: "Stop someone borrowing your account, effective immediately." },
    ] },
  { id: "autoswitch", label: "Autoswitch", summary: "Auto-switch accounts when usage gets high.",
    children: [
      { id: "autoswitch.on", label: "On", cli: "autoswitch on", mutate: "on",
        summary: "Enable automatic account switching." },
      { id: "autoswitch.off", label: "Off", cli: "autoswitch off", mutate: "off",
        summary: "Disable automatic account switching." },
    ] },
];

// Which "kind" of children a node has, if any — `children` (static, more tree) or `argSource`
// (dynamic, one leaf per name currently known). A node can only ever have one of the two, and a
// node with neither is a direct leaf (runnable via `cmd` or `mutate` with no argument).
export function childKind(node) {
  if (node.children) return "static";
  if (node.argSource) return "dynamic";
  return null;
}

// Live names for a dynamic branch, read out of the same /api/all payload app.js already caches as
// `last` — never free text, never a second network call. Mirrors the exact fields mine.js's
// mineTarget() already reads off the same payload. Empty (not an error) whenever that panel hasn't
// loaded ok yet.
export function namesFor(source, last) {
  switch (source) {
    case "poolMembers":
      return last?.pool?.ok ? last.pool.data.map((m) => m.name) : [];
    case "access":
      return last?.access?.ok ? last.access.data.map((p) => p.name) : [];
    case "list":
      return last?.accounts?.ok ? last.accounts.data.accounts.map((a) => a.account) : [];
    default:
      return [];
  }
}

// Depth-first lookup by id, used to resolve a clicked tree node (never the dynamic name leaves,
// which aren't in TREE at all — those are resolved by their parent's id instead).
export function findNode(id, nodes = TREE) {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNode(id, n.children);
      if (found) return found;
    }
  }
  return null;
}

// Depth-first find by `mutate` — the same key FIRE/ASK in app.js are keyed on — then substitute
// {name} into that node's cli template. Lets a data-kind button show the exact command it runs
// without duplicating the TREE's cli strings. Null for kinds with no CLI equivalent (e.g.
// "update", "detail" — these don't correspond to any mutate leaf here).
export function cliFor(kind, name, nodes = TREE) {
  for (const n of nodes) {
    if (n.mutate === kind) return `claudex ${n.cli.replace("{name}", name)}`;
    if (n.children) {
      const found = cliFor(kind, name, n.children);
      if (found) return found;
    }
  }
  return null;
}
