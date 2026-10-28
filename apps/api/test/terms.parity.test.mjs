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

test("MIG-0641 U01c: SA-076 transport maps CURRENT accepted, retry and unavailable outcomes", async () => {
  const { projectOnboardingTerms } = await import("../src/routes/personal/termsDecision.ts");
  const cases = [
    [{ kind: "accepted", termsVersionId: "v" }, { ok: true, alreadyAccepted: false }],
    [{ kind: "already_accepted", termsVersionId: "v" }, { ok: true, alreadyAccepted: true }],
    [{ kind: "database_unavailable", retryable: true }, {
      ok: false, message: "保存を完了できませんでした。再読み込み後にもう一度お試しください。同意済みの可能性があります。", retryable: true,
    }],
    [{ kind: "concurrent_update", retryable: true }, {
      ok: false, message: "保存を完了できませんでした。再読み込み後にもう一度お試しください。同意済みの可能性があります。", retryable: true,
    }],
    [{ kind: "terms_unavailable" }, { ok: false, message: "利用規約を取得できませんでした。" }],
    [{ kind: "user_missing" }, { ok: false, message: "利用規約への同意を完了できませんでした。" }],
    [{ kind: "commit_failed" }, {
      ok: false, message: "同意の保存に失敗しました。時間をおいて再試行してください。", retryable: true,
    }],
  ];
  for (const [input, expected] of cases) {
    const value = projectOnboardingTerms(input);
    assert.deepEqual(value, expected);
    assert.deepEqual(OnboardingTermsAcceptResponseSchema.parse(value), expected);
  }
});

test("MIG-0641 U01c: SA-075 failure redirects are JSON targets and external next is sanitized", async () => {
  const { projectLatestTerms } = await import("../src/routes/personal/termsDecision.ts");
  const cases = [
    [{ kind: "accepted", termsVersionId: "v" }, "/entry/foo", { ok: true, next: "/entry/foo" }],
    [{ kind: "already_accepted", termsVersionId: "v" }, "//evil.example", { ok: true, next: "/dashboard" }],
    [{ kind: "not_authenticated" }, "https://evil.example", { ok: false, next: "/entry?next=%2Fdashboard" }],
    [{ kind: "user_missing" }, "/entry", { ok: false, next: "/entry?next=%2Fentry" }],
    [{ kind: "database_unavailable", retryable: true }, "/dashboard", { ok: false, next: "/rules?next=%2Fdashboard&error=database_unavailable" }],
    [{ kind: "concurrent_update", retryable: true }, "/entry", { ok: false, next: "/rules?next=%2Fentry&error=concurrent_update" }],
    [{ kind: "terms_unavailable" }, "/entry", { ok: false, next: "/rules?next=%2Fentry&error=terms_unavailable" }],
    [{ kind: "commit_failed" }, "/entry", { ok: false, next: "/rules?next=%2Fentry&error=terms_commit_failed" }],
  ];
  for (const [result, next, expected] of cases) {
    const value = projectLatestTerms(result, next);
    assert.deepEqual(value, expected);
    assert.deepEqual(AcceptLatestTermsResponseSchema.parse(value), expected);
  }
});

test("MIG-0641 U01c: CURRENT onboarding-complete condition accepts pending/approved ONLY", async () => {
  const { canMarkOnboardingComplete } = await import("../src/routes/personal/termsDecision.ts");
  for (const [status, expected] of [
    ["none", false], ["pending", true], ["approved", true], ["rejected", false],
  ]) assert.equal(canMarkOnboardingComplete(status), expected, status);
});
