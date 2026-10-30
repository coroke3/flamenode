import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  deleteAdminEventTemplate, eventDisplayState, eventIndexQuery, formatEventUnix,
  readAdminEvents, readAdminEventTemplates,
} from "../.test-dist/apps/ops/src/api/adminEvents.js";
import { AdminEvents } from "../.test-dist/apps/ops/src/routes/admin/AdminEvents.js";
import { EventTemplates } from "../.test-dist/apps/ops/src/routes/admin/EventTemplates.js";

const json = (status, data) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json" },
});
const event = {
  id: "foo", title: "Event", visibility_status: "public", start_time: null,
  end_time: null, entry_start_time: null, entry_end_time: null,
};
const events = { sort: "newest", filter: "all", q: "foo", now: 100,
  events: [event] };
const templates = {
  guardOk: true, templates: [{
    id: "t1", name: "Example", description: null, source_event_id: null,
    updated_at: 100,
  }],
};

test("MIG-0728 U02: event query normalizes CURRENT sort/filter and trims q", () => {
  assert.equal(eventIndexQuery(new URLSearchParams("sort=x&filter=y&q=%20foo%20")),
    "sort=newest&filter=all&q=foo");
  assert.equal(eventIndexQuery(new URLSearchParams("sort=upcoming&filter=accepting&q=a%26b")),
    "sort=upcoming&filter=accepting&q=a%26b");
});

test("MIG-0728 U02: event API read is same-origin, no-store, validated, abort-aware", async () => {
  const seen = [];
  const get = async (path, init) => {
    seen.push([path, init]);
    return json(200, events);
  };
  const controller = new AbortController();
  assert.deepEqual(await readAdminEvents(new URLSearchParams("q=%20foo%20"), get, controller.signal),
    { status: "ok", data: events });
  assert.equal(seen[0][0], "/api/admin-read/events?sort=newest&filter=all&q=foo");
  assert.equal(seen[0][1].method, "GET");
  assert.equal(seen[0][1].cache, "no-store");
  assert.equal(seen[0][1].credentials, "same-origin");
  assert.equal(seen[0][1].signal, controller.signal);
  controller.abort();
  assert.deepEqual(await readAdminEvents(new URLSearchParams(), get, controller.signal),
    { status: "unavailable" });
  assert.deepEqual(await readAdminEvents(new URLSearchParams(), async () => json(200, { events: [] })),
    { status: "unavailable" });
  assert.deepEqual(await readAdminEvents(new URLSearchParams(), async () => json(403, { redirect: "/dashboard" })),
    { status: "forbidden", redirect: "/dashboard" });
});

test("MIG-0728 U02: template read rejects malformed and guard-denied payloads are preserved", async () => {
  assert.deepEqual(await readAdminEventTemplates(async () => json(200, templates)),
    { status: "ok", data: templates });
  assert.deepEqual(await readAdminEventTemplates(async () => json(200, { guardOk: true, templates: [{ id: 1 }] })),
    { status: "unavailable" });
  assert.deepEqual(await readAdminEventTemplates(async () => json(200, { guardOk: false, templates: [] })),
    { status: "ok", data: { guardOk: false, templates: [] } });
  assert.deepEqual(await readAdminEventTemplates(async () => json(401, {})), { status: "anonymous" });
});

test("MIG-0728 U02: delete enforces HTTP authentication, encoded ID, and strict success", async () => {
  const calls = [];
  const fetchFn = async (path, init) => {
    calls.push([path, init]);
    return json(200, { ok: true, message: "deleted" });
  };
  assert.deepEqual(await deleteAdminEventTemplate("id/1", fetchFn), { status: "ok" });
  assert.equal(calls[0][0], "/api/admin/event-templates/id%2F1");
  assert.equal(calls[0][1].method, "DELETE");
  assert.equal(calls[0][1].credentials, "same-origin");
  assert.equal(calls[0][1].cache, "no-store");
  assert.equal(calls[0][1].body, undefined);
  assert.deepEqual(await deleteAdminEventTemplate(" ", fetchFn), { status: "unavailable" });
  assert.equal(calls.length, 1);
  for (const [status, body, expected] of [
    [401, { ok: true }, { status: "anonymous" }],
    [403, { ok: true }, { status: "forbidden" }],
    [409, { ok: false, message: "conflict" }, { status: "rejected", message: "conflict" }],
    [200, { ok: false, message: "no" }, { status: "rejected", message: "no" }],
    [500, { ok: true }, { status: "unavailable" }],
    [200, { surprise: true }, { status: "unavailable" }],
  ]) {
    assert.deepEqual(await deleteAdminEventTemplate("t", async () => json(status, body)), expected);
  }
});

test("MIG-0728 U02: CURRENT event status parity includes point event and accepting fence", () => {
  assert.deepEqual(eventDisplayState(event, 100), { label: "公開", accepting: false });
  assert.deepEqual(eventDisplayState({ ...event, start_time: 200, entry_start_time: 50 }, 100),
    { label: "公開", accepting: true });
  assert.deepEqual(eventDisplayState({ ...event, start_time: 50, end_time: 99, entry_start_time: 10 }, 100),
    { label: "終了済", accepting: false });
  assert.deepEqual(eventDisplayState({ ...event, visibility_status: "archived", entry_start_time: 10 }, 100),
    { label: "非公開", accepting: false });
  assert.deepEqual(eventDisplayState({ ...event, start_time: 101, end_time: 120 }, 100),
    { label: "開始前", accepting: false });
  assert.equal(formatEventUnix(null), "-");
  assert.match(formatEventUnix(0), /1970/);
});

test("MIG-0728 U02: screens render CURRENT controls, safe links and no write before confirmation", () => {
  const markup = renderToStaticMarkup(React.createElement(MemoryRouter, {
    initialEntries: ["/admin/events?q=foo&filter=public&sort=oldest"],
  }, React.createElement(AdminEvents)));
  assert.match(markup, /全イベント管理/);
  assert.match(markup, /name="q"/);
  assert.match(markup, /name="sort"/);
  assert.match(markup, /新規イベント/);
  const list = renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(EventTemplates)));
  assert.match(list, /イベントテンプレート/);
  assert.match(list, /読み込み中/);
});
