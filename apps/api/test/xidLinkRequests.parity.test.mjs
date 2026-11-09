import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
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
    { reason: "", request_id: "spoof" }, { actor_x_user_id: "attacker" }]) {
    assert.equal(XIdLinkRejectBodySchema.safeParse(input).success, false);
  }
});

test("SA-090/091: result DTO is closed and carries only CURRENT result fields", () => {
  assert.deepEqual(XIdLinkReviewResultSchema.parse({ ok: true, message: "却下しました。" }),
    { ok: true, message: "却下しました。" });
  assert.deepEqual(XIdLinkReviewResultSchema.parse({ ok: false }), { ok: false });
  assert.equal(XIdLinkReviewResultSchema.safeParse({ ok: "true" }).success, false);
  assert.equal(XIdLinkReviewResultSchema.safeParse({ ok: true, actor_x_user_id: "spoof" }).success, false);
});

import { drizzle } from "drizzle-orm/d1";
import { createSqlite, insert } from "./support/personalHarness.mjs";
import { atomicD1, seedChapterWorld } from "./support/chapterSeed.mjs";
import {
  authorizeXIdLinkRequestReview,
  xidLinkRequestReviewAuthorizationMiddleware,
} from "../src/routes/xid/linkRequests.ts";

test("SA-090/091 T08: review authorization allows admin and explicitly authorized approved-X staff only", async () => {
  const sqlite = createSqlite();
  seedChapterWorld(sqlite);
  insert(sqlite, "event_staff", {
    id: "s_xid_reviewer",
    event_id: "ev2",
    x_user_id: "x_staff",
    display_name: "X ID reviewer",
    permission_preset: "xid_reviewer",
  });
  const d1 = atomicD1(sqlite);
  const db = drizzle(d1);

  const admin = await authorizeXIdLinkRequestReview(db, {
    id: "u_admin", role: "admin", active_x_user_id: "x_admin",
  });
  assert.deepEqual(admin, { allowed: true, actorXUserId: null });

  const authorizedStaff = await authorizeXIdLinkRequestReview(db, {
    id: "u_staff", role: "user", active_x_user_id: "x_staff",
  });
  assert.deepEqual(authorizedStaff, { allowed: true, actorXUserId: "x_staff" });

  const unauthorizedStaff = await authorizeXIdLinkRequestReview(db, {
    id: "u_other", role: "user", active_x_user_id: "x_other",
  });
  assert.deepEqual(unauthorizedStaff, {
    allowed: false,
    actorXUserId: null,
    message: "X ID 申請を処理する権限がありません。",
  });

  assert.equal(d1.stats.batches, 0, "authorization must not write or batch any D1 statements");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM x_identity_requests").get().count, 0);
  sqlite.close();
});


test("SA-090/091 T08 middleware carries the exact authorizing X identity and denies unauthorized staff", async () => {
  const sqlite = createSqlite();
  seedChapterWorld(sqlite);
  insert(sqlite, "event_staff", {
    id: "s_xid_reviewer",
    event_id: "ev2",
    x_user_id: "x_staff",
    display_name: "X ID reviewer",
    permission_preset: "xid_reviewer",
  });
  const d1 = atomicD1(sqlite);
  const db = drizzle(d1);

  async function requestAs(user) {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("db", db);
      c.set("user", user);
      await next();
    });
    app.use("*", xidLinkRequestReviewAuthorizationMiddleware);
    app.get("/review", (c) => c.json({
      actorXUserId: c.get("xidLinkRequestActorXUserId"),
    }));
    return app.request("/review");
  }

  const admin = await requestAs({ id: "u_admin", role: "admin", active_x_user_id: "x_admin" });
  assert.equal(admin.status, 200);
  assert.deepEqual(await admin.json(), { actorXUserId: null });

  const reviewer = await requestAs({ id: "u_staff", role: "user", active_x_user_id: "x_staff" });
  assert.equal(reviewer.status, 200);
  assert.deepEqual(await reviewer.json(), { actorXUserId: "x_staff" });

  const denied = await requestAs({ id: "u_other", role: "user", active_x_user_id: "x_other" });
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), {
    ok: false,
    message: "X ID 申請を処理する権限がありません。",
  });

  assert.equal(d1.stats.batches, 0, "authorization middleware must not mutate D1");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM x_identity_requests").get().count, 0);
  sqlite.close();
});
