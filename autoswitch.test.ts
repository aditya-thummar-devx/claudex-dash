import { test, expect } from "bun:test";
import { autoswitchTarget } from "./public/autoswitch.js";

const payload = (detail) => ({
  status: {
    ok: true,
    data: {
      status: { consuming: { on: false, detail: "" }, sharing: { on: true, detail: "" } },
      doctor: {
        checks: detail === undefined ? [] : [{ ok: true, label: "autoswitch", detail }],
        accounts: [],
        summary: "",
      },
    },
  },
});

test("autoswitchTarget: disabled shows Enable, anything else shows Disable", () => {
  expect(autoswitchTarget(payload("disabled"))).toEqual({ kind: "on", label: "Enable autoswitch" });
  // Verified live against real claudex output: the enabled row doesn't say "enabled" — it describes
  // hook install state, and that description varies. "disabled" is the only fixed spelling.
  expect(autoswitchTarget(payload("Stop + SessionStart hooks present"))).toEqual({
    kind: "off",
    label: "Disable autoswitch",
  });
  expect(autoswitchTarget(payload("hooks missing"))).toEqual({
    kind: "off",
    label: "Disable autoswitch",
  });
});

test("autoswitchTarget: null only when doctor never reported the row at all", () => {
  expect(autoswitchTarget(null)).toBeNull(); // nothing loaded yet
  expect(autoswitchTarget({ status: { ok: false, raw: "…" } })).toBeNull(); // Health showing raw text
  expect(autoswitchTarget({})).toBeNull(); // defensive: no status key at all
  expect(autoswitchTarget(payload(undefined))).toBeNull(); // doctor ran but no autoswitch row
});
