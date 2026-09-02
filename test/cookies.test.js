import test from "node:test";
import assert from "node:assert/strict";
import { mergeCookies } from "../src/lib/cookies.js";

test("mergeCookies merges current cookies with Set-Cookie headers", () => {
  assert.equal(
    mergeCookies("a=1; b=2", ["c=3", "b=updated"]),
    "a=1; b=updated; c=3",
  );
});

test("mergeCookies honors cookie deletion via past expires", () => {
  assert.equal(
    mergeCookies("keep=1; black_passportid=1", [
      "black_passportid=1; domain=.sogou.com; path=/; expires=Thu, 01-Dec-1994 16:00:00 GMT",
    ]),
    "keep=1",
  );
});

test("mergeCookies honors cookie deletion via Max-Age=0", () => {
  assert.equal(
    mergeCookies("session=abc", ["session=abc; Max-Age=0; path=/"]),
    undefined,
  );
});

test("mergeCookies keeps session cookies without expiry attributes", () => {
  assert.equal(
    mergeCookies("a=1", ["b=2; Path=/; Secure; HttpOnly"]),
    "a=1; b=2",
  );
});
