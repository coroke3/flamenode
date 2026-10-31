import test from "node:test";
import assert from "node:assert/strict";
import {
  XIdLinkReviewRequestIdSchema,
  XIdLinkApproveBodySchema,
  XIdLinkRejectBodySchema,
  XIdLinkReviewResultSchema,
} from "../../../packages/contracts/src/xidLinkRequest.ts";

test("SA-090/091: URL id preserves CURRENT FormData trim and missing-id denial", () => {
  for (const value of ["  req-01 ", "\treq-02\n", "申請-3"]) {
    const form = new FormData();
    form.set("request_id", value);
    const current = String(form.get("request_id") ?? "").trim();
    assert.equal(XIdLinkReviewRequestIdSchema.parse(value), current);
  }
  assert.equal(XIdLinkReviewRequestIdSchema.safeParse("").success, false);
  assert.equal(XIdLinkReviewRequestIdSchema.safeParse(" \n ").success, false);
  assert.equal(XIdLinkReviewRequestIdSchema.safeParse(null).success, false);
  assert.equal(XIdLinkReviewRequestIdSchema.safeParse(123).success, false);
});

test("SA-090: approval accepts only an empty JSON object; path is authoritative", () => {
  assert.deepEqual(XIdLinkApproveBodySchema.parse({}), {});
  for (const input of [null, [], "", { request_id: "spoof" }, { reason: "unexpected" }]) {
    assert.equal(XIdLinkApproveBodySchema.safeParse(input).success, false);
  }
});

test("SA-091: reject reason is optional, trimmed then truncated at 500 characters", () => {
  assert.deepEqual(XIdLinkRejectBodySchema.parse({}), { reason: "" });
  assert.deepEqual(XIdLinkRejectBodySchema.parse({ reason: "  insufficient proof \n" }),
    { reason: "insufficient proof" });
  for (const text of ["\t" + "a".repeat(504) + "  ", "　理由".repeat(260) + "  "]) {
    const form = new FormData();
    form.set("reason", text);
    const current = String(form.get("reason") ?? "").trim().slice(0, 500);
    assert.equal(XIdLinkRejectBodySchema.parse({ reason: text }).reason, current);
  }
});

test("SA-091: reject body fails closed on invalid types and unsolicited mutation keys", () => {
  for (const input of [null, [], { reason: null }, { reason: 5 },
    { reason: "" , request_id: "spoof" }, { actor_x_user_id: "attacker" }]) {
    assert.equal(XIdLinkRejectBodySchema.safeParse(input).success, false);
  }
});

test("SA-090/091: result DTO carries only the CURRENT result fields", () => {
  assert.deepEqual(XIdLinkReviewResultSchema.parse({ ok: true, message: "却下しました。" }),
    { ok: true, message: "却下しました。" });
  assert.deepEqual(XIdLinkReviewResultSchema.parse({ ok: false }), { ok: false });
  assert.equal(XIdLinkReviewResultSchema.safeParse({ ok: "true" }).success, false);
});
