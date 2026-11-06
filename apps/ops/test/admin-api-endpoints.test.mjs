import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  eventExportHref,
  readAdminApiEndpoints,
} from "../.test-dist/apps/ops/src/api/adminApiEndpoints.js";
import { AdminApiEndpointsView } from "../.test-dist/apps/ops/src/routes/admin/AdminApiEndpoints.js";

const payload = {
  rows: [{
    id: "first", event_id: "event-A", event_title: "公開作品A",
    public_api_enabled: 1, updated_at: 1750000000, created_at: 1740000000,
    event_visibility_status: "public",
  }],
  eventOptions: [{ id: "event-A", title: "公開作品A", enabled: 1 }],
};
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });
}

test("MIG-0727 U01: GET uses existing bounded admin-read endpoint with no-store credentials", async () => {
  let request;
  const signal = new AbortController().signal;
  const result = await readAdminApiEndpoints(async (path, init) => {
    request = { path, init };
    return json(200, payload);
  }, signal);
  assert.deepEqual(result, { status: "ok", data: payload });
  assert.equal(request.path, "/api/admin-read/api-endpoints");
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.cache, "no-store");
  assert.equal(request.init.credentials, "same-origin");
  assert.equal(request.init.signal, signal);
});

test("MIG-0727 U01: 401, 403, malformed payload and network failure fail closed", async () => {
  assert.deepEqual(await readAdminApiEndpoints(async () => json(401, {})),
    { status: "anonymous" });
  assert.deepEqual(await readAdminApiEndpoints(async () => json(403, { redirect: "/dashboard" })),
    { status: "forbidden", redirect: "/dashboard" });
  assert.deepEqual(await readAdminApiEndpoints(async () => json(200, {
    ...payload, rows: [{ id: "partial" }],
  })), { status: "unavailable" });
  assert.deepEqual(await readAdminApiEndpoints(async () => json(200, {
    ...payload, rows: Array.from({ length: 101 }, () => payload.rows[0]),
  })), { status: "unavailable" });
  assert.deepEqual(await readAdminApiEndpoints(async () => { throw Error("offline"); }),
    { status: "unavailable" });
});

test("MIG-0727 U01: link URL matches CURRENT export builder for v5, legacy, scheduled", () => {
  assert.equal(eventExportHref("a/b"),
    "/api/event-endpoints/a%2Fb?update=realtime");
  assert.equal(eventExportHref("event-A", "legacy"),
    "/api/event-endpoints/event-A?update=realtime&format=legacy");
  assert.equal(eventExportHref("event-A", "v5", "scheduled", 15),
    "/api/event-endpoints/event-A?update=scheduled&refresh=15");
  assert.equal(eventExportHref("event-A", "legacy", "scheduled", 1440),
    "/api/event-endpoints/event-A?update=scheduled&format=legacy&refresh=1440");
});

test("MIG-0727 U01: read-only page preserves notice, event link, export, empty and error states", () => {
  const html = renderToStaticMarkup(React.createElement(AdminApiEndpointsView, {
    data: payload, notice: "成功", error: "警告",
  }));
  assert.match(html, /作品情報出力API/);
  assert.match(html, /role="status"[^>]*>成功/);
  assert.match(html, /role="alert"[^>]*>警告/);
  assert.match(html, /href="\/manage\/events\/event-A"/);
  assert.match(html, /\/api\/event-endpoints\/event-A\?update=realtime/);
  assert.match(html, /出力を確認/);
  assert.doesNotMatch(html, /<form[ >]/);
  assert.doesNotMatch(html, /type="submit"/);

  const empty = renderToStaticMarkup(React.createElement(AdminApiEndpointsView, {
    data: { rows: [], eventOptions: [] },
  }));
  assert.match(empty, /発行済みのイベントAPIはありません。/);
});
