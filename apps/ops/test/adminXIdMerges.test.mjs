// MIG-0732 U02a: current Hono admin X ID merge reads and safe read-only presentation.
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { createXIdMergesApi, xMergeReadPath } from "../.test-dist/apps/ops/src/api/xidMerges.js";
import { AdminXIdMergesContent } from "../.test-dist/apps/ops/src/routes/admin/AdminXIdMerges.js";

const merge = {
  id: "mg1", request_type: "merge", status: "pending",
  source_x_user_id: "alice", target_x_user_id: "bob",
  parent_request_id: null, revert_deadline_at: null, updated_at: 1700000000,
  source_name: "Alice", target_name: "Bob", has_restore_snapshot: true,
  impact: [{ key: "videos", label: "作品投稿者", count: 2 }],
  preview: [{ id: "vid/1", title: "Demo", visibility_status: "public", primary_event_id: null,
    creator_change: 1, member_rows: 0, chapter_rows: 0, slot_rows: 0, interaction_rows: 0, moderation_rows: 0 }],
};
const revert = {
  id: "rv1", status: "pending", parent_request_id: "mg1",
  revert_deadline_at: 1600000000, has_restore_snapshot: true,
};
const requests = { view: "requests", selectedImpactId: "mg1", requests: [merge], reverts: [], now: 1700000000 };
const reverts = { view: "reverts", selectedImpactId: "", requests: [], reverts: [revert], now: 1700000000 };
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

test("U02a: authorized GET query, normalized view, no-store and strict expected view", async () => {
  const calls = [];
  const api = createXIdMergesApi(async (path, init) => {
    calls.push({ path, init });
    return json(200, path.includes("reverts") ? reverts : requests);
  });
  assert.equal((await api.get("requests", " mg1 ")).status, "ok");
  assert.equal((await api.get("reverts", "ignored")).status, "ok");
  assert.deepEqual(calls.map(x => x.path), [
    "/api/admin-read/x-id-merges?impact=mg1", "/api/admin-read/x-id-merges?view=reverts",
  ]);
  for (const call of calls) {
    assert.equal(call.init.method, "GET");
    assert.equal(call.init.credentials, "same-origin");
    assert.equal(call.init.cache, "no-store");
  }
  assert.equal(xMergeReadPath("requests", "a/b"), "/api/admin-read/x-id-merges?impact=a%2Fb");
});

test("U02a: reject malformed, mismatched, duplicate, excessive and inconsistent snapshots", async () => {
  const bad = [
    { ...requests, view: "reverts" },
    { ...requests, selectedImpactId: "other" },
    { ...requests, requests: [...requests.requests, { ...merge }] },
    { ...requests, requests: [{ ...merge, impact: [{ key: "v", label: "V", count: -1 }] }] },
    { ...requests, requests: [{ ...merge, preview: Array(52).fill(merge.preview[0]) }] },
    { ...requests, requests: [{ ...merge, has_restore_snapshot: "secret json" }] },
    { ...requests, requests: [{ ...merge, updated_at: Number.NaN }] },
    { ...requests, reverts: [revert] },
    { ...requests, requests: Array(51).fill(merge).map((r, i) => ({ ...r, id: "id" + i, impact: [], preview: [] })) },
  ];
  for (const value of bad) {
    const api = createXIdMergesApi(async () => json(200, value));
    assert.equal((await api.get("requests", "mg1")).status, "unavailable");
  }
  for (const status of [401, 403, 503]) {
    const api = createXIdMergesApi(async () => json(status, { redirect: "/dashboard" }));
    assert.notEqual((await api.get("requests", "mg1")).status, "ok");
  }
  const inconsistent = { ...requests, requests: [{ ...merge, id: "other" }] };
  assert.equal((await createXIdMergesApi(async () => json(200, inconsistent)).get("requests", "mg1")).status, "unavailable");
});

test("U02a: SSR tables show bounded impact preview but never expose restore JSON or enable mutations", () => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(AdminXIdMergesContent, { data: requests })));
  assert.match(html, /X ID統合管理/);
  assert.match(html, /統合前の確認/);
  assert.match(html, /作品投稿者/);
  assert.match(html, /vid%2F1/);
  assert.match(html, /管理API移行完了後に有効化/);
  assert.doesNotMatch(html, /name="confirm"/);
  assert.doesNotMatch(html, /restore_snapshot_json/);

  const back = renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(AdminXIdMergesContent, { data: reverts })));
  assert.match(back, /差し戻し申請/);
  assert.match(back, /期限切れ/);
  assert.match(back, /復元情報あり/);
  assert.doesNotMatch(back, /restore_snapshot_json/);
});
