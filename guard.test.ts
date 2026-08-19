// The mutating routes are the only thing standing between a random web page and `claudex switch`,
// so the check that gates them gets a test of its own.
import { test, expect } from "bun:test";
import { sameOrigin } from "./src/guard.ts";

const OK = ["http://127.0.0.1:4400", "http://localhost:4400"];

test("sameOrigin: this machine's own page passes, anyone else's does not", () => {
  expect(sameOrigin(null, OK)).toBe(true); // curl, and same-origin fetches that send no Origin
  expect(sameOrigin("http://127.0.0.1:4400", OK)).toBe(true);
  expect(sameOrigin("http://localhost:4400", OK)).toBe(true); // same machine, different origin
  expect(sameOrigin("https://evil.example", OK)).toBe(false);
  expect(sameOrigin("http://127.0.0.1:4401", OK)).toBe(false); // another server on this machine
  expect(sameOrigin("https://127.0.0.1:4400", OK)).toBe(false); // scheme is part of the origin
});
