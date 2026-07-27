// Deterministic tests for redaction. Uses fabricated tokens/paths only.

import assert from "node:assert/strict";
import test from "node:test";
import { redact, isSensitiveKey } from "../lib/redact.mjs";

test("isSensitiveKey flags common secret keys", () => {
  assert.equal(isSensitiveKey("token"), true);
  assert.equal(isSensitiveKey("apiKey"), true);
  assert.equal(isSensitiveKey("Refresh_Token"), true);
  assert.equal(isSensitiveKey("client_secret"), true);
  assert.equal(isSensitiveKey("Authorization"), true);
  assert.equal(isSensitiveKey("headers"), true);
  assert.equal(isSensitiveKey("nonSensitive"), false);
});

test("redact removes values for sensitive keys", () => {
  const out = redact({ token: "abc", nested: { password: "hunter2" }, ok: "keep" });
  assert.equal(out.token, "<redacted:key>");
  assert.equal(out.nested.password, "<redacted:key>");
  assert.equal(out.ok, "keep");
});

test("redact rewrites token-like values in strings", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9abcdefghij.eyJzdWIiOiJob21lIn0abc.abcdefghij1234";
  const sk = "sk-proj-1234567890abcdefghij";
  assert.match(redact(jwt), /<redacted:jwt>/);
  assert.match(redact(sk), /<redacted:openai-sk>/);
});

test("redact scrubs bearer/basic auth tokens", () => {
  const bearer = "Authorization: Bearer aBcDefGhij12345678";
  const basic = "Authorization: Basic Zm9vOmJhcmJhc2VkZW5jb2RlZA==";
  assert.match(redact(bearer), /<redacted:bearer>/);
  assert.match(redact(basic), /<redacted:basic>/);
});

test("redact collapses host paths inside stacks and free-form text", () => {
  const stack =
    "Error: boom\n    at handler (/Users/alice/Sites/openclaw/foo.js:1:1)\n    at inner (/home/bob/.openclaw/oh.js:2:2)";
  const out = redact(stack);
  assert.doesNotMatch(out, /\/Users\/alice/);
  assert.doesNotMatch(out, /\/home\/bob/);
  assert.match(out, /<redacted-path:/);
});

test("redact scrubs emails and phones", () => {
  assert.match(redact("email me at Alice@Example.com please"), /<redacted:email>/);
  assert.match(redact("call +1 (555) 867-5309 today"), /<redacted:phone>/);
});

test("redact scrubs URL query secrets while preserving surrounding url", () => {
  const url = "https://example.com/cb?access_token=aaaaaaaaaaaaaaaaaaaaaaaa&keep=1";
  const out = redact(url);
  assert.match(out, /access_token=<redacted:url-secret>/);
  assert.match(out, /keep=1/);
});

test("redact scrubs high-entropy blobs but preserves commit SHAs", () => {
  const sha = "1f5e68cda9e8d63fa80f983b19e3a88f4e65ae17";
  const blob = "aGVsbG9CYXNlNjRibG9iVGhhdElzTG9uZ0Vub3VnaFRvVHJpZ2dlckVudHJvcHlSZWRhY3Rpb24=";
  assert.equal(redact(sha), sha);
  assert.match(redact(blob), /<redacted:entropy>/);
});

test("redact handles cycles without hanging", () => {
  const a = { name: "a" };
  a.self = a;
  const out = redact(a);
  assert.equal(out.name, "a");
  assert.equal(out.self, "<redacted:cycle>");
});

test("redact handles arrays and Errors", () => {
  const arr = ["ok", { token: "x" }, new Error("kaboom /Users/alice/Sites/x/y")];
  const out = redact(arr);
  assert.equal(out[0], "ok");
  assert.equal(out[1].token, "<redacted:key>");
  assert.match(out[2].message, /<redacted-path:/);
});

test("redact never serializes an env-style object", () => {
  const out = redact({ env: { HOME: "/root", TOKEN: "abc" } });
  assert.equal(out.env, "<redacted:key>");
});

test("redact preserves relative evidence paths and repo-relative refs", () => {
  const out = redact({ notes: "see src/acp/presets.ts:32 in commit 1f5e68c" });
  assert.match(out.notes, /src\/acp\/presets\.ts:32/);
  assert.match(out.notes, /1f5e68c/);
});
