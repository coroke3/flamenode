import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  announcementQuery, readAdminAnnouncements, formatAnnouncementUnix,
} from "../.test-dist/apps/ops/src/api/adminAnnouncements.js";
import { AnnouncementsView } from "../.test-dist/apps/ops/src/routes/admin/Announcements.js";

const sample = {
  audience: "creators", status: "draft",
  items: [{
    id: "example/a", title: "編集前のお知らせ", is_published: 0,
    publish_at: null, expire_at: null, updated_at: 1750000000,
  }],
};
const reply = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

test("MIG-0727 U02a: normalized audience/status query preserves CURRENT fallback", () => {
  assert.equal(announcementQuery(new URLSearchParams("audience=creators&status=draft")),
    "audience=creators&status=draft");
  assert.equal(announcementQuery(new URLSearchParams("audience=__proto__&status=invalid")),
    "audience=any&status=any");
  assert.equal(announcementQuery(new URLSearchParams("audience=all&status=published")),
    "audience=all&status=published");
});

test("MIG-0727 U02a: 50-row admin-read list, same-origin/no-store, abort signal", async () => {
  let actual;
  const signal = new AbortController().signal;
  const result = await readAdminAnnouncements(
    new URLSearchParams("audience=creators&status=draft"),
    async (path, init) => { actual = { path, init }; return reply(200, sample); },
    signal,
  );
  assert.deepEqual(result, { status: "ok", data: sample });
  assert.equal(actual.path, "/api/admin-read/announcements?audience=creators&status=draft");
  assert.equal(actual.init.method, "GET");
  assert.equal(actual.init.credentials, "same-origin");
  assert.equal(actual.init.cache, "no-store");
  assert.equal(actual.init.signal, signal);
});

test("MIG-0727 U02a: denied/malformed/oversized responses never render protected list", async () => {
  const q = new URLSearchParams();
  assert.deepEqual(await readAdminAnnouncements(q, async () => reply(401, {})),
    { status: "anonymous" });
  assert.deepEqual(await readAdminAnnouncements(q, async () => reply(403, { redirect: "/dashboard" })),
    { status: "forbidden", redirect: "/dashboard" });
  assert.deepEqual(await readAdminAnnouncements(q, async () => reply(200, { ...sample, items: [{ id: "broken" }] })),
    { status: "unavailable" });
  assert.deepEqual(await readAdminAnnouncements(q, async () => reply(200, {
    ...sample, items: Array.from({ length: 51 }, () => sample.items[0]),
  })), { status: "unavailable" });
  assert.deepEqual(await readAdminAnnouncements(q, async () => { throw Error("offline"); }),
    { status: "unavailable" });
});

test("MIG-0727 U02a: list renders filters, status, time fallbacks and audit links", () => {
  const markup = renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(AnnouncementsView, { data: sample })));
  assert.match(markup, /お知らせ管理/);
  assert.match(markup, /name="audience"/);
  assert.match(markup, /value="creators" selected=""/);
  assert.match(markup, /name="status"/);
  assert.match(markup, /value="draft" selected=""/);
  assert.match(markup, /編集前のお知らせ/);
  assert.match(markup, /下書き/);
  assert.match(markup, /admin\/announcements\/example%2Fa\/edit/);
  assert.match(markup, /table=announcements(?:&amp;|&)record=example%2Fa/);
  assert.equal(formatAnnouncementUnix(null), "—");
  const empty = renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(AnnouncementsView, { data: { ...sample, items: [] } })));
  assert.match(empty, /お知らせはまだありません/);
});
