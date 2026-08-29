// decide() gates whether the dashboard pops "update available" — a false positive nags for no
// reason, a false negative on a broken rev-parse silently offers to git pull on top of data we
// don't trust. Both are worth pinning down without shelling real git.
import { test, expect } from "bun:test";
import { decide } from "./src/update.ts";

const gitResult = (out: string, code = 0) => ({ out, code });

test("decide: same SHA on both sides is up to date", () => {
  const r = decide(gitResult("abc1234"), gitResult("abc1234"));
  expect(r).toEqual({ ok: true, current: "abc1234", latest: "abc1234", upToDate: true });
});

test("decide: different SHAs report the update available", () => {
  const r = decide(gitResult("abc1234"), gitResult("def5678"));
  expect(r).toEqual({ ok: true, current: "abc1234", latest: "def5678", upToDate: false });
});

// The safety case: a rev-parse failure (detached state, corrupt repo, git error) must never read as
// "you're behind" — that would offer to git pull on top of data the check couldn't actually verify.
test("decide: a failed rev-parse on either side defaults to up to date, not behind", () => {
  expect(decide(gitResult("", 128), gitResult("def5678")).upToDate).toBe(true);
  expect(decide(gitResult("abc1234"), gitResult("", 128)).upToDate).toBe(true);
  expect(decide(gitResult("", 128), gitResult("def5678")).ok).toBe(false);
});

test("decide: trims trailing newlines before comparing", () => {
  const r = decide(gitResult("abc1234\n"), gitResult("abc1234\n"));
  expect(r.current).toBe("abc1234");
  expect(r.latest).toBe("abc1234");
  expect(r.upToDate).toBe(true);
});
