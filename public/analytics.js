// The pure half of the analytics layer: event names, the enablement decision, and the shaping of
// user properties and event params. No DOM, no fetch, no Firebase — so `bun test` imports it
// directly (analytics.test.ts), the same split sort.js/playground.js follow. The impure half —
// loading the Firebase SDK, reading Remote Config, localStorage, and the actual logEvent calls —
// lives in telemetry.js, which imports everything here.
//
// It lives in public/ (not src/) because there is no bundler: the page loads it as-is via
// telemetry.js, and a src/*.ts module would be unreachable from the browser.
import { consumingTarget } from "./consuming.js";
import { autoswitchTarget } from "./autoswitch.js";

// Every event name in one place, so call sites and any future dashboard read from one list rather
// than scattering string literals. snake_case per GA4 convention.
export const EVENTS = {
  PAGE_VIEW: "page_view",
  APP_FOREGROUND: "app_foreground",
  TAB_VIEW: "tab_view",
  ACCOUNT_SWITCH: "account_switch",
  ACCESS_CHANGE: "access_change",
  POOL_TOGGLE: "pool_toggle",
  AUTOSWITCH_TOGGLE: "autoswitch_toggle",
  ACCOUNT_REMOVE: "account_remove",
  PLAYGROUND_COMMAND: "playground_command",
  THEME_CHANGE: "theme_change",
  FILTER_CHANGE: "filter_change",
  VIEW_MEMBER_DETAILS: "view_member_details",
  UPDATE_CHECK: "update_check",
  UPDATE_APPLY: "update_apply",
  APP_ERROR: "app_error",
};

// The write-button kinds app.js already uses (data-kind on each button, and the ASK/FIRE tables)
// mapped to the event each fires and the `action` value that distinguishes them within it. One
// place so doAction() can be instrumented with a single lookup rather than a branch per kind.
// `#mine` reuses these same kinds (switch / pool), so it is covered for free.
export const KIND_EVENT = {
  switch: { event: EVENTS.ACCOUNT_SWITCH, action: "switch" },
  pool: { event: EVENTS.ACCOUNT_SWITCH, action: "pool_use" },
  remove: { event: EVENTS.ACCOUNT_REMOVE, action: "remove" },
  allow: { event: EVENTS.ACCESS_CHANGE, action: "allow" },
  deny: { event: EVENTS.ACCESS_CHANGE, action: "deny" },
  start: { event: EVENTS.POOL_TOGGLE, action: "start" },
  stop: { event: EVENTS.POOL_TOGGLE, action: "stop" },
  on: { event: EVENTS.AUTOSWITCH_TOGGLE, action: "on" },
  off: { event: EVENTS.AUTOSWITCH_TOGGLE, action: "off" },
};

// GA4 hard limits we respect rather than let the SDK silently truncate: event-param string values
// cap at 100 chars, user-property values at 36. Numbers/bools are coerced to strings first so a
// single clamp covers every value.
const PARAM_MAX = 100;
const USER_PROP_MAX = 36;

const clamp = (v, max) => {
  const s = typeof v === "string" ? v : String(v);
  return s.length > max ? s.slice(0, max) : s;
};

// The enablement decision, layered exactly as agreed:
//   1. the local kill-switch (env "off", surfaced by the server as enabled:false) wins — hard off;
//   2. no complete Firebase config → off (the ship-dark state);
//   3. otherwise the Remote Config flag decides, and only when it is explicitly false;
//   4. default on.
// `serverEnabled` is /api/analytics-config's `enabled` (already folds in the env switch AND config
// completeness). `remoteFlag` is the Remote Config value, or undefined before/without a fetch.
export function isEnabled(serverEnabled, remoteFlag) {
  if (!serverEnabled) return false;
  if (remoteFlag === false) return false;
  return true;
}

// URLs are the one thing the pool/error text can leak that we never want in analytics — the
// internal API URL called out in .gitignore rides inside claudex's own error strings. Strip every
// http(s) token, collapse the gap, and clamp. Names are deliberately NOT stripped: per the agreed
// design they travel raw so pool-relationship analysis stays readable.
export function sanitizeMessage(msg) {
  return clamp(
    String(msg ?? "")
      .replace(/https?:\/\/\S+/gi, "[url]")
      .replace(/\s+/g, " ")
      .trim(),
    PARAM_MAX
  );
}

// Merge the always-on globals under the per-event params (an event may override a global by passing
// the same key), drop null/undefined so GA4 never records an empty value, and clamp every value.
// `globals` is { theme, active_tab, app_version } assembled by the caller.
export function buildEventParams(params = {}, globals = {}) {
  const merged = { ...globals, ...params };
  const out = {};
  for (const [k, v] of Object.entries(merged)) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = clamp(v, PARAM_MAX);
  }
  return out;
}

// A boolean the analytics layer treats as three-state: true/false when known, "unknown" when the
// panel it comes from has not loaded (null). Kept as strings because GA4 user properties are
// strings, and "unknown" is a value an analyst can segment on.
const flag = (v) => (v === null || v === undefined ? "unknown" : v ? "true" : "false");
const count = (n) => (typeof n === "number" ? String(n) : "unknown");
const str = (s) => (s ? clamp(s, USER_PROP_MAX) : "unknown");

// The GA4 user properties, from the server `ctx` (the four facts only it can see) plus everything
// derivable from the cached /api/all payload the client already holds. Every value is a clamped
// string; anything unresolved is "unknown" rather than absent, so a property never silently
// disappears between loads.
export function buildUserProps(ctx = {}, last = null) {
  const accounts = last?.accounts?.ok ? last.accounts.data.accounts : null;
  const members = last?.pool?.ok ? last.pool.data : null;
  const has5x =
    accounts && members
      ? [...accounts, ...members].some((r) => /5x/i.test(r.tier ?? r.plan ?? ""))
      : null;
  const consuming = consumingState(last);
  const autoswitch = autoswitchState(last);

  return {
    user_email: str(ctx.email),
    os_username: str(ctx.os_username),
    macos_version: str(ctx.macos_version),
    app_version: str(ctx.app_version),
    in_pool: flag(last?.me ? Boolean(last.me.pool) : null),
    account_count: count(accounts ? accounts.length : undefined),
    pool_member_count: count(members ? members.length : undefined),
    has_5x: flag(has5x),
    consuming_on: flag(consuming),
    autoswitch_on: flag(autoswitch),
  };
}

// Reuse the tested button-target logic rather than re-deriving state: consumingTarget offers "Stop"
// only when consuming is currently on; autoswitchTarget offers "Disable" (kind "off") only when
// autoswitch is currently on. null (Health not loaded) stays null so flag() renders "unknown".
function consumingState(last) {
  const t = consumingTarget(last);
  return t ? t.kind === "stop" : null;
}
function autoswitchState(last) {
  const t = autoswitchTarget(last);
  return t ? t.kind === "off" : null;
}

// A random id for distinguishing installs when identity is unknown. crypto.randomUUID exists in
// every browser this runs in; the || fallback keeps the pure function total for the test
// environment and any exotic runtime without it. Storage of the id is telemetry.js's job.
export function newInstallId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
