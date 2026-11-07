import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  eventLifecycleRoutes,
  validateEventArchiveRequest,
} from "../src/eventLifecycle/archiveRoute.ts";

const accepted = (id, body) => validateEventArchiveRequest(id, body);

test("MIG-0652 U04 SA-024 T01: valid route/form confirmation preserves ID", () => {
  assert.deepEqual(accepted("event_01", {
    event_id: " event_01 ", confirm: " event_01 ",
  }), { ok: true, eventId: "event_01" });
});

test("MIG-0652 U04 SA-024 T02: missing and malformed URL IDs fail closed", () => {
  for (const id of ["", "a/b", "space id", "x".repeat(65), "🐱"]) {
    assert.deepEqual(accepted(id, { event_id: id, confirm: id }), {
      ok: false, message: "イベントIDが不正です。",
    });
  }
});

test("MIG-0652 U04 SA-024 T03: missing or non-string form identity fails closed", () => {
  for (const raw of [undefined, null, 42, true, "", "  "]) {
    assert.deepEqual(accepted("e1", { event_id: raw, confirm: "e1" }), {
      ok: false, message: "event_id が必要です。",
    });
  }
});

test("MIG-0652 U04 SA-024 T04: a forged body event ID cannot override URI ID", () => {
  assert.deepEqual(accepted("alice", { event_id: "bob", confirm: "bob" }), {
    ok: false, message: "イベントIDが一致しません。",
  });
});

test("MIG-0652 U04 SA-024 T05: missing or invalid confirmation is rejected", () => {
  for (const raw of [undefined, null, "", "not_e1", 8]) {
    assert.deepEqual(accepted("e1", { event_id: "e1", confirm: raw }), {
      ok: false,
      message: "確認のため、イベント ID と同じ文字列を入力してください。",
    });
  }
});

test("MIG-0652 U04 SA-024 T06: unmounted router cannot write without parent session/DB", async () => {
  const response = await eventLifecycleRoutes.request("https://example.org/e1", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event_id: "e1", confirm: "e1" }),
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    ok: false, message: "操作する権限がありません。",
  });
});

test("MIG-0652 U04 SA-024 T07: code preserves R2 block -> audited D1 -> cache order", async () => {
  const source = await readFile(new URL("../src/eventLifecycle/archiveRoute.ts", import.meta.url), "utf8");
  assert.ok(source.includes('eventLifecycleRoutes.delete("/:eventId"'));
  assert.ok(source.includes('costGuardMiddleware("manage_event_archive")'));
  assert.ok(source.includes("planEventVisibilityTransition({"));
  assert.ok(source.includes("runEventWriteBehindVisibilityFence({"));
  assert.ok(source.includes("compensateEventVisibilityFenceOnD1Failure(db, {"));
  assert.ok(source.includes("await mutateWithAudit(db, {"));
  assert.ok(source.includes("preloaded: auditPreloaded(c)"));
  assert.ok(source.includes("...queue.statements"));
  assert.ok(source.includes("...queue.expectedChanges"));
  assert.ok(source.includes("await createEventPostCommitCacheHost().archive(eventId)"));
  assert.ok(!source.includes("staticRebuildWakeSource:"));
  const index = await readFile(new URL("../src/routes/events/index.ts", import.meta.url), "utf8");
  assert.ok(!index.includes('from "./lifecycle.ts"')); // unmounted: don't activate partial parity
});
