import assert from "node:assert/strict";
import test from "node:test";
import { authRedirectTarget } from "../src/auth/redirect.ts";

const origin = "https://flamenode.example";
test("MIG-0802 U01: auth redirect parity with CURRENT for relative and same-origin URLs", () => {
  for (const [input, expected] of [
    ["/manage/events?tab=1", origin + "/manage/events?tab=1"],
    ["/dashboard#activity", origin + "/dashboard#activity"],
    ["//evil.example/x", origin + "//evil.example/x"], // CURRENT quirk, same host
    [origin + "/profile?x=1", origin + "/profile?x=1"],
    [origin + ":443/x", origin + "/x"],
    ["https://evil.example/steal", origin + "/dashboard"],
    ["https://flamenode.example.evil.example/", origin + "/dashboard"],
    ["http://flamenode.example/", origin + "/dashboard"],
    ["javascript:alert(1)", origin + "/dashboard"],
    ["not a URL", origin + "/dashboard"],
  ]) {
    assert.equal(authRedirectTarget(input, origin), expected, input);
  }
});
test("MIG-0802 U01: redirect never trusts an attacker-controlled origin", () => {
  const configured = "https://site.example";
  assert.equal(authRedirectTarget("https://evil.example/login", configured), configured + "/dashboard");
  assert.equal(authRedirectTarget("/entry", configured), configured + "/entry");
});
