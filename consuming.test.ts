import { test, expect } from "bun:test";
import { consumingTarget } from "./public/consuming.js";

const payload = (on) => ({
  status: {
    ok: true,
    data: {
      status: { consuming: { on, detail: "" }, sharing: { on: true, detail: "" } },
      doctor: { checks: [], accounts: [], summary: "" },
    },
  },
});

test("consumingTarget: off shows Start pool, on shows Stop pool", () => {
  expect(consumingTarget(payload(false))).toEqual({ kind: "start", label: "Start pool" });
  expect(consumingTarget(payload(true))).toEqual({ kind: "stop", label: "Stop pool" });
});

test("consumingTarget: null wherever the state is unknown rather than guessed", () => {
  expect(consumingTarget(null)).toBeNull(); // nothing loaded yet
  expect(consumingTarget({ status: { ok: false, raw: "…" } })).toBeNull(); // Health showing raw text
  expect(consumingTarget({})).toBeNull(); // defensive: no status key at all
});
