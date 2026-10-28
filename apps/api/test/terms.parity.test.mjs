import assert from "node:assert/strict";
import test from "node:test";
import {
  AcceptLatestTermsBodySchema,
  AcceptLatestTermsResponseSchema,
  OnboardingTermsAcceptResponseSchema,
  OnboardingCompleteResponseSchema,
} from "@flamenode/contracts";

// MIG-0641 U01a: transport schema tests. No Hono D1 writes yet.
test("MIG-0641 U01a: SA-075 input accepts optional next string", () => {
  assert.deepEqual(AcceptLatestTermsBodySchema.parse({}), {});
  assert.deepEqual(AcceptLatestTermsBodySchema.parse({ next: "/dashboard" }), { next: "/dashboard" });
  assert.equal(AcceptLatestTermsBodySchema.safeParse({ next: 123 }).success, false);
});
test("MIG-0641 U01a: SA-075 result explicitly includes a navigation target", () => {
  assert.deepEqual(AcceptLatestTermsResponseSchema.parse({ ok: true, next: "/entry" }), { ok: true, next: "/entry" });
  assert.equal(AcceptLatestTermsResponseSchema.safeParse({ ok: true }).success, false);
});
test("MIG-0641 U01a: SA-076 CURRENT accepted or message/retryable union", () => {
  assert.deepEqual(OnboardingTermsAcceptResponseSchema.parse({ ok: true, alreadyAccepted: true }), { ok: true, alreadyAccepted: true });
  assert.deepEqual(OnboardingTermsAcceptResponseSchema.parse({ ok: false, message: "保存に失敗しました。", retryable: true }), { ok: false, message: "保存に失敗しました。", retryable: true });
  assert.equal(OnboardingTermsAcceptResponseSchema.safeParse({ ok: false }).success, false);
});
test("MIG-0641 U01a: complete marker only carries status and optional message", () => {
  assert.deepEqual(OnboardingCompleteResponseSchema.parse({ ok: true }), { ok: true });
  assert.equal(OnboardingCompleteResponseSchema.safeParse({ ok: "yes" }).success, false);
});

test("MIG-0641 U01b: SA-075 redirect sanitizer exactly matches CURRENT on safe, external and invalid next", async () => {
  const { sanitizeNextPath } = await import("../../../src/lib/utils/next.ts");
  const { sanitizeTermsNextPath } = await import("../src/routes/personal/termsNext.ts");
  const samples = [
    undefined, null, "", "  ", "/", "/dashboard", "/entry/slotted?slot=abc",
    " /dashboard?tab=a ", "//evil.example/steal", "https://evil.example",
    "javascript:alert(1)", "entry", "/\\evil.example", "/x://bad",
    "/ok\nbad", "/ok\u007f", "/" + "a".repeat(511), "/" + "a".repeat(512),
    "/path#fragment", "/%2Fexternal", "/?next=https://evil.example",
  ];
  for (const value of samples) {
    assert.equal(sanitizeTermsNextPath(value), sanitizeNextPath(value),
      JSON.stringify(value));
  }
  assert.equal(sanitizeTermsNextPath("//evil.example"), "/dashboard");
  assert.equal(sanitizeTermsNextPath("/entry/slotted?slot=x"), "/entry/slotted?slot=x");
});
