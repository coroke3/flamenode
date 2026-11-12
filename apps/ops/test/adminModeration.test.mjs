import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  moderationFilters, moderationReadPath, createAdminModerationApi,
} from "../.test-dist/apps/ops/src/api/adminModeration.js";
import { AdminModerationContent } from "../.test-dist/apps/ops/src/routes/admin/AdminModeration.js";

const resp = (status, payload) => new Response(JSON.stringify(payload), {
  status, headers: { "content-type": "application/json" },
});
const now = 1700000000;
const fixture = {
  type: "all", status: "open", overdue: true, now,
  cases: [{
    id: "case/1", video_id: "vid/1", case_type: "rights", status: "open",
    public_reason: "public", private_note: "<script>private</script>",
    due_at: now - 1, locked_until: null, attempt_count: 1,
    related_x_user_id: "x/1", created_by_user_id: null, resolved_by_user_id: null,
    created_at: now - 10, resolved_at: null, video_title: "video",
    video_status: "public", related_x_name: "creator",
  }],
};
test("MIG-0731 U03a: CURRENT filters and overdue=1 query semantics", () => {
  assert.deepEqual(moderationFilters(new URLSearchParams()), {
    type: "all", status: "open", overdue: false,
  });
  assert.deepEqual(moderationFilters(new URLSearchParams(
    "type=rights&status=resolved&overdue=1")), {
    type: "rights", status: "resolved", overdue: true,
  });
  assert.deepEqual(moderationFilters(new URLSearchParams(
    "type=unsupported&status=unknown&overdue=0")), {
    type: "all", status: "open", overdue: false,
  });
  assert.equal(moderationReadPath({ type: "rights", status: "open", overdue: true }),
    "/api/admin-read/moderation?type=rights&status=open&overdue=1");
});
test("MIG-0731 U03a: protected GET/no-store, malformed and denied DTO fail closed", async () => {
  const calls = [];
  const api = createAdminModerationApi(async (path, init) => {
    calls.push({ path, init }); return resp(200, fixture);
  });
  const filters = moderationFilters(new URLSearchParams("overdue=1"));
  const ok = await api.list(filters);
  assert.equal(ok.status, "ok");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.method, "GET");
  const malformed = createAdminModerationApi(async () => resp(200, { ...fixture, cases: [{ id: "only" }] }));
  assert.deepEqual(await malformed.list(filters), { status: "unavailable" });
  const denied = createAdminModerationApi(async () => resp(403, { redirect: "https://evil.invalid" }));
  assert.deepEqual(await denied.list(filters), { status: "forbidden" });
  const unauthorized = createAdminModerationApi(async () => resp(401, {}));
  assert.deepEqual(await unauthorized.list(filters), { status: "anonymous" });
});
test("MIG-0731 U03a: unmounted display includes overdue + escaped private note, never write form", () => {
  const markup = renderToStaticMarkup(React.createElement(AdminModerationContent, {
    data: fixture, filters: { type: "all", status: "open", overdue: true },
  }));
  assert.match(markup, /期限切れのみ/);
  assert.match(markup, /fn-badge-danger/);
  assert.match(markup, /&lt;script&gt;private&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /<script>/);
  assert.match(markup, /\/admin\/videos\/vid%2F1/);
  assert.match(markup, /\/user\/x%2F1/);
  assert.match(markup, /更新操作は未移植/);
  assert.doesNotMatch(markup, /\/api\/admin\/moderation/);
});
