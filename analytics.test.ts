// The pure analytics logic, exercised without a browser — same pattern as sort.test.ts /
// playground.test.ts (import the public/*.js module straight into bun test). The impure half
// (telemetry.js: Firebase, fetch, localStorage) is glue and is not unit-tested, exactly as app.js
// isn't.
import { test, expect } from "bun:test";
import {
  isEnabled,
  sanitizeMessage,
  buildEventParams,
  buildUserProps,
  newInstallId,
  EVENTS,
  KIND_EVENT,
} from "./public/analytics.js";

// ---- isEnabled: the layering the whole kill-switch story rests on ----
test("isEnabled: the local switch / missing config (serverEnabled=false) is a hard off", () => {
  expect(isEnabled(false, undefined)).toBe(false);
  expect(isEnabled(false, true)).toBe(false); // even a remote "on" cannot override a local off
});

test("isEnabled: with the server enabled, Remote Config decides, and only an explicit false is off", () => {
  expect(isEnabled(true, undefined)).toBe(true); // before/without a fetch → default on
  expect(isEnabled(true, true)).toBe(true);
  expect(isEnabled(true, false)).toBe(false); // remote master switch off
});

// ---- sanitizeMessage: strip the internal API URL, keep names, clamp ----
test("sanitizeMessage: URLs are replaced but the rest of the message survives", () => {
  expect(sanitizeMessage("timeout calling https://internal.api.example.com/v1/pool now")).toBe(
    "timeout calling [url] now"
  );
  expect(sanitizeMessage("switch to brian.cooley failed")).toBe("switch to brian.cooley failed"); // names kept
});

test("sanitizeMessage: total on junk input, clamped to 100 chars", () => {
  expect(sanitizeMessage(null)).toBe("");
  expect(sanitizeMessage(undefined)).toBe("");
  expect(sanitizeMessage("x".repeat(200))).toHaveLength(100);
});

// ---- buildEventParams: globals under params, empties dropped, clamped ----
test("buildEventParams: merges globals, lets the event override, drops empty, clamps", () => {
  const globals = { theme: "scifi", active_tab: "pool", app_version: "abc1234" };
  const p = buildEventParams({ tab_name: "usage", active_tab: "usage", note: "" }, globals);
  expect(p).toEqual({ theme: "scifi", active_tab: "usage", app_version: "abc1234", tab_name: "usage" });
  expect(p.note).toBeUndefined(); // empty string dropped, never recorded
});

test("buildEventParams: numeric values are coerced to strings and clamped", () => {
  const p = buildEventParams({ duration_ms: 1234, big: "y".repeat(150) });
  expect(p.duration_ms).toBe("1234");
  expect(p.big).toHaveLength(100);
});

// ---- buildUserProps: server ctx + derived-from-last, unknown fallbacks, 36-char clamp ----
const ctx = { email: "aditya@devxlabs.ai", os_username: "aditya", macos_version: "14.5", app_version: "abc1234" };

const fullLast = {
  me: { account: "aditya", pool: "aditya.t" },
  accounts: { ok: true, data: { accounts: [{ tier: "Max 5x" }, { tier: "Pro" }] } },
  pool: { ok: true, data: [{ plan: "Max 5x" }, { plan: "Pro" }, { plan: "Team" }] },
  status: { ok: true, data: { status: { consuming: { on: true } }, doctor: { checks: [{ label: "autoswitch", detail: "disabled" }] } } },
};

test("buildUserProps: full payload resolves every property from ctx + last", () => {
  const u = buildUserProps(ctx, fullLast);
  expect(u).toEqual({
    user_email: "aditya@devxlabs.ai",
    os_username: "aditya",
    macos_version: "14.5",
    app_version: "abc1234",
    in_pool: "true",
    account_count: "2",
    pool_member_count: "3",
    has_5x: "true",
    consuming_on: "true",
    autoswitch_on: "false", // doctor row reads "disabled" → autoswitch is off
  });
});

test("buildUserProps: nothing loaded yet → identity blanks and derived state are all \"unknown\"", () => {
  const u = buildUserProps({}, null);
  expect(u.user_email).toBe("unknown");
  expect(u.in_pool).toBe("unknown");
  expect(u.account_count).toBe("unknown");
  expect(u.pool_member_count).toBe("unknown");
  expect(u.has_5x).toBe("unknown");
  expect(u.consuming_on).toBe("unknown");
  expect(u.autoswitch_on).toBe("unknown");
});

test("buildUserProps: an over-long email is clamped to GA4's 36-char user-property limit", () => {
  const u = buildUserProps({ email: "a".repeat(50) + "@example.com" }, null);
  expect(u.user_email).toHaveLength(36);
});

test("buildUserProps: autoswitch enabled shows as on, in_pool false when solo", () => {
  const last = {
    me: { account: "aditya", pool: null },
    status: { ok: true, data: { status: { consuming: { on: false } }, doctor: { checks: [{ label: "autoswitch", detail: "Stop + SessionStart hooks present" }] } } },
  };
  const u = buildUserProps(ctx, last);
  expect(u.in_pool).toBe("false");
  expect(u.consuming_on).toBe("false");
  expect(u.autoswitch_on).toBe("true"); // anything but "disabled" means enabled
});

// ---- KIND_EVENT: every button kind app.js dispatches maps to an event ----
test("KIND_EVENT: switch/pool share account_switch with distinct actions; access + toggles mapped", () => {
  expect(KIND_EVENT.switch).toEqual({ event: EVENTS.ACCOUNT_SWITCH, action: "switch" });
  expect(KIND_EVENT.pool).toEqual({ event: EVENTS.ACCOUNT_SWITCH, action: "pool_use" });
  expect(KIND_EVENT.allow.event).toBe(EVENTS.ACCESS_CHANGE);
  expect(KIND_EVENT.deny.event).toBe(EVENTS.ACCESS_CHANGE);
  expect(KIND_EVENT.start.event).toBe(EVENTS.POOL_TOGGLE);
  expect(KIND_EVENT.on.event).toBe(EVENTS.AUTOSWITCH_TOGGLE);
  expect(KIND_EVENT.remove.event).toBe(EVENTS.ACCOUNT_REMOVE);
  // Every mutating kind app.js has a button for is covered.
  expect(Object.keys(KIND_EVENT).sort()).toEqual(
    ["allow", "deny", "off", "on", "pool", "remove", "start", "stop", "switch"].sort()
  );
});

// ---- newInstallId ----
test("newInstallId: returns a non-empty unique string", () => {
  const a = newInstallId();
  const b = newInstallId();
  expect(typeof a).toBe("string");
  expect(a.length).toBeGreaterThan(0);
  expect(a).not.toBe(b);
});
