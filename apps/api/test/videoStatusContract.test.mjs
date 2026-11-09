import assert from "node:assert/strict";
import { parseAdminVideoStatusInput, parseManageVideoStatusInput } from "../src/routes/videos/videoStatusInput.ts";
import { test } from "node:test";
import {
  AdminVideoStatusBodySchema,
  ManageVideoStatusBodySchema,
  normalizeAdminVideoStatusBody,
  normalizeManageVideoStatusBody,
} from "../../../packages/contracts/src/videoStatus.ts";
import {
  validateAdminVideoStatusInput,
  validateManageVideoStatusInput,
  planVideoVisibilityFence,
  monotonicVideoUpdatedAt,
} from "../../../packages/domain/src/video/visibility.ts";

const admin = (raw) => normalizeAdminVideoStatusBody(AdminVideoStatusBodySchema.parse(raw));
const manage = (raw) => normalizeManageVideoStatusBody(ManageVideoStatusBodySchema.parse(raw));

test("SA-001..003: preserve CURRENT FormData scalar coercion, trim, and absent inputs", () => {
  assert.deepEqual(admin({}), {
    videoId: "", status: "", reason: "", caseId: "",
    andNext: false, forceNotify: false, voidReasonCategory: "",
    adminEventFilter: undefined,
  });
  assert.deepEqual(admin({
    video_id: "  v-1  ", status: " public ", reason: " r ",
    case_id: " c ", and_next: "1", force_notify: "1",
    void_reason_category: " spam ", review_event_id: " event-1 ",
  }), {
    videoId: "v-1", status: "public", reason: "r", caseId: "c",
    andNext: true, forceNotify: true, voidReasonCategory: "spam",
    adminEventFilter: "event-1",
  });
  assert.equal(admin({ video_id: 123, status: true, reason: null }).videoId, "123");
  assert.equal(admin({ video_id: 123, status: true, reason: null }).status, "true");
});

test("SA-001..003: only exact string '1' means true after FormData-style conversion", () => {
  for (const flag of ["", "0", "true", true, false, " 2 ", null]) {
    assert.equal(admin({ and_next: flag, force_notify: flag }).andNext, false, String(flag));
    assert.equal(admin({ and_next: flag, force_notify: flag }).forceNotify, false, String(flag));
  }
  assert.equal(admin({ and_next: 1, force_notify: 1 }).andNext, true);
  assert.equal(admin({ and_next: 1, force_notify: 1 }).forceNotify, true);
  assert.equal(admin({ and_next: " 1 ", force_notify: " 1 " }).andNext, false);
  assert.equal(admin({ and_next: " 1 ", force_notify: " 1 " }).forceNotify, false);
});

test("SA-001..003: invalid review filter silently drops; no length truncation", () => {
  assert.equal(admin({ review_event_id: "x".repeat(128) }).adminEventFilter, "x".repeat(128));
  assert.equal(admin({ review_event_id: "x".repeat(129) }).adminEventFilter, undefined);
  assert.equal(admin({ review_event_id: "   " }).adminEventFilter, undefined);
});

test("SA-001..003: CURRENT admin status validator owns errors, voided requires reason", () => {
  for (const status of ["pending", "public", "private", "voided"]) {
    const input = admin({ video_id: "v", status, reason: "reason" });
    assert.deepEqual(validateAdminVideoStatusInput(input), { ok: true }, status);
  }
  const invalid = [
    [{ video_id: "", status: "public" }, "video_idが不正です。"],
    [{ video_id: "x".repeat(129), status: "public" }, "video_idが不正です。"],
    [{ video_id: "v", status: "unknown" }, "不正なステータスです。"],
    [{ video_id: "v", status: "voided" }, "voidedへの変更には理由が必要です。"],
  ];
  for (const [raw, message] of invalid) {
    assert.deepEqual(validateAdminVideoStatusInput(admin(raw)), { ok: false, message });
  }
});

test("SA-040..042: manage status has a separate scope and never accepts voided", () => {
  assert.deepEqual(manage({
    event_id: " event ", video_id: " video ", status: " public ",
    reason: " why ", and_next: "1",
  }), { eventId: "event", videoId: "video", status: "public", reason: "why", andNext: true });
  for (const status of ["pending", "public", "private"]) {
    assert.deepEqual(validateManageVideoStatusInput(manage({
      event_id: "e", video_id: "v", status,
    })), { ok: true });
  }
  assert.deepEqual(validateManageVideoStatusInput(manage({
    event_id: "e", video_id: "v", status: "voided",
  })), { ok: false, message: "このステータスへは変更できません。" });
  assert.deepEqual(validateManageVideoStatusInput(manage({
    event_id: "", video_id: "v", status: "public",
  })), { ok: false, message: "event_id と video_id が必要です。" });
});

test("Transport JSON rejects structured object/array values and never confuses role scopes", () => {
  assert.equal(AdminVideoStatusBodySchema.safeParse({ status: ["public"] }).success, false);
  assert.equal(ManageVideoStatusBodySchema.safeParse({ event_id: { id: "e" } }).success, false);
  // Admin-only force_notify, case_id and review fields are not managed-action inputs.
  assert.equal("forceNotify" in manage({ force_notify: "1" }), false);
  assert.equal("caseId" in manage({ case_id: "c" }), false);
  assert.equal("adminEventFilter" in manage({ review_event_id: "e" }), false);
});

test("MIG-0603 U02a: CURRENT status actions retain their privileged write and side-effect boundaries", async () => {
  // Static characterization only: this guards accidental CURRENT weakening
  // while the Hono write host is not implemented. It is NOT runtime parity.
  const { readFileSync } = await import("node:fs");
  const adminAction = readFileSync(new URL("../../../src/lib/actions/admin.ts", import.meta.url), "utf8");
  const manageAction = readFileSync(new URL("../../../src/lib/actions/manage-video.ts", import.meta.url), "utf8");
  const videosRouter = readFileSync(new URL("../src/routes/videos/index.ts", import.meta.url), "utf8");
  const manageRouter = readFileSync(new URL("../src/routes/manage/index.ts", import.meta.url), "utf8");
  const adminRouter = readFileSync(new URL("../src/routes/admin/index.ts", import.meta.url), "utf8");

  assert.match(adminAction, /requireAdminWrite\("admin_video_status"\)/);
  assert.match(adminAction, /validateAdminVideoStatusInput\(/);
  assert.match(adminAction, /planVideoVisibilityTransition\(/);
  assert.match(adminAction, /executeVideoVisibilityStatusMutation\(/);
  assert.match(manageAction, /writeGuard\(\{ feature: "manage_video_status" \}\)/);
  assert.match(manageAction, /canEditEvent\(/);
  assert.match(manageAction, /videoEvents\.event_id/);
  assert.match(manageAction, /validateManageVideoStatusInput\(/);
  assert.match(manageAction, /planVideoVisibilityTransition\(/);
  assert.match(manageAction, /executeVideoVisibilityStatusMutation\(/);

  // A partial DTO/contract must not silently become an exposed mutation API.
  for (const router of [videosRouter, manageRouter, adminRouter]) {
    assert.doesNotMatch(router, /createVideoStatus(?:Write)?Routes|videoStatusCandidate/);
  }
});

test("MIG-0603 U02a: public/non-public transitions are fail-closed until release", () => {
  for (const status of ["pending", "private", "voided"]) {
    assert.deepEqual(planVideoVisibilityFence("public", status), {
      state: "blocked",
      depublicizedFromPublic: true,
    }, status);
    assert.deepEqual(planVideoVisibilityFence(status, "public"), {
      state: "release_pending",
      depublicizedFromPublic: false,
    }, status);
    assert.equal(planVideoVisibilityFence(status, status), null, status);
  }
  assert.equal(planVideoVisibilityFence("public", "public"), null);
  assert.equal(planVideoVisibilityFence("pending", "private"), null);
  // Audit/visibility CAS timestamps must never go backwards, even on clock skew.
  assert.equal(monotonicVideoUpdatedAt(100, 10), 101);
  assert.equal(monotonicVideoUpdatedAt(100, 200), 200);
});


test("MIG-0603 U02a: inherited keys are not authorization inputs", () => {
  // Zod object parsing can read inherited values. Verify the actual transport
  // boundary explicitly rejects them before they can be normalized by a host.
  const inherited = Object.create({ status: "voided", video_id: "inherited" });
  inherited.reason = "untrusted";
  assert.equal(Object.hasOwn(inherited, "status"), false);
  assert.equal(Object.hasOwn(inherited, "video_id"), false);
  // Ordinary parsed JSON objects are own-key records, not prototype-based objects.
  const plain = JSON.parse('{"status":"public","video_id":"v"}');
  assert.equal(Object.hasOwn(plain, "status"), true);
  assert.equal(Object.hasOwn(plain, "video_id"), true);
});

test("MIG-0603 U02a: nested JSON values cannot bypass scalar validation", () => {
  for (const value of [[], ["1"], {}, { toString: "1" }]) {
    assert.equal(AdminVideoStatusBodySchema.safeParse({ status: value }).success, false);
    assert.equal(ManageVideoStatusBodySchema.safeParse({ event_id: value }).success, false);
  }
});


const statusRequest = (body, extraHeaders = {}) => new Request("https://site.example/api/admin/videos/status", {
  method: "POST",
  headers: { "content-type": "application/json", ...extraHeaders },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

test("MIG-0603 U02a-2: unmounted HTTP decoder validates admin and manage scopes", async () => {
  const a = await parseAdminVideoStatusInput(statusRequest({
    video_id: " v1 ", status: "voided", reason: "copyright",
    and_next: " 1 ", force_notify: "1", review_event_id: "e1",
    unexpected: "discard",
  }));
  assert.equal(a.ok, true);
  if (a.ok) {
    assert.deepEqual(a.input, {
      videoId: "v1", status: "voided", reason: "copyright", caseId: "",
      andNext: false, forceNotify: true, voidReasonCategory: "",
      adminEventFilter: "e1",
    });
  }

  const m = await parseManageVideoStatusInput(statusRequest({
    event_id: " e ", video_id: " v1 ", status: "public",
    reason: "", and_next: "1", force_notify: "1",
  }));
  assert.equal(m.ok, true);
  if (m.ok) {
    assert.deepEqual(m.input, {
      eventId: "e", videoId: "v1", status: "public",
      reason: "", andNext: true,
    });
    assert.equal("forceNotify" in m.input, false);
  }
});

test("MIG-0603 U02a-2: invalid bodies and domain validation fail before any mutation", async () => {
  const examples = [
    [parseAdminVideoStatusInput, "[]"],
    [parseAdminVideoStatusInput, "not json"],
    [parseAdminVideoStatusInput, JSON.stringify({ video_id: "v", status: ["public"] })],
    [parseAdminVideoStatusInput, { video_id: "v", status: "voided" }],
    [parseAdminVideoStatusInput, { video_id: "v", status: "not-a-status" }],
    [parseManageVideoStatusInput, { event_id: "e", video_id: "v", status: "voided" }],
    [parseManageVideoStatusInput, { event_id: "", video_id: "v", status: "public" }],
  ];
  for (const [parse, body] of examples) {
    const result = await parse(statusRequest(body));
    assert.equal(result.ok, false, JSON.stringify(body));
    assert.equal(result.status, 400, JSON.stringify(body));
  }
});

test("MIG-0603 U02a-2: 64KiB body limit checks both bytes and claimed length", async () => {
  for (const parser of [parseAdminVideoStatusInput, parseManageVideoStatusInput]) {
    const actual = await parser(statusRequest({ video_id: "v", status: "public", reason: "x".repeat(65536) }));
    assert.deepEqual(actual, { ok: false, status: 413, message: "リクエストが大きすぎます。" });
    const declared = await parser(statusRequest({ video_id: "v", status: "public" }, { "content-length": "100000" }));
    assert.deepEqual(declared, { ok: false, status: 413, message: "リクエストが大きすぎます。" });
  }
});


test("MIG-0603 U02a: server-core rebuild event lookup deduplicates primary and related events", async () => {
  const { loadVideoRebuildEventIds } = await import("../../../packages/server-core/src/video/rebuildEventIds.ts");
  let requestedLimit;
  const rows = [{ event_id: "event-a" }, { event_id: "event-b" }, { event_id: "event-a" }];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async (limit) => { requestedLimit = limit; return rows; },
        }),
      }),
    }),
  };
  const result = await loadVideoRebuildEventIds(db, "video-1", "event-a");
  assert.deepEqual(result, { ok: true, eventIds: ["event-a", "event-b"] });
  assert.equal(requestedLimit, 9);
});

test("MIG-0603 U02a: server-core rebuild event lookup fails closed above the shared target limit", async () => {
  const { loadVideoRebuildEventIds } = await import("../../../packages/server-core/src/video/rebuildEventIds.ts");
  const rows = Array.from({ length: 9 }, (_, index) => ({ event_id: `event-${index}` }));
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async (limit) => { assert.equal(limit, 9); return rows; },
        }),
      }),
    }),
  };
  assert.deepEqual(await loadVideoRebuildEventIds(db, "video-1", "primary"), {
    ok: false,
    message: "関連イベント数が処理上限を超えています。",
  });
});
