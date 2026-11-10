import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ruleStatusQuery, readAdminRules, readAdminRuleDetail } from
  "../.test-dist/apps/ops/src/api/adminRules.js";
import { AdminRulesView, AdminRuleDetailView } from
  "../.test-dist/apps/ops/src/routes/admin/Rules.js";

const row = {
  id: "terms/a", version_label: "v2026.11", status: "published",
  severity: "major", published_at: 1760000000, updated_at: 1760000500,
};
const payload = {
  status: "published", items: [row], currentPublished: {
    id: "terms/a", version_label: "v2026.11",
  }, reacceptRequiredCount: 30, reacceptCountIsLowerBound: true,
};
const detail = {
  id: "terms/a", version_label: "v2026.11", body_markdown: "# 本文",
  severity: "major", status: "published",
};
const reply = (code, body) => new Response(JSON.stringify(body), {
  status: code, headers: { "content-type": "application/json" },
});

test("MIG-0727 U03a: rules query normalization, same-origin, no-store, abort", async () => {
  assert.equal(ruleStatusQuery(new URLSearchParams("status=published")), "published");
  assert.equal(ruleStatusQuery(new URLSearchParams("status=archived")), "archived");
  assert.equal(ruleStatusQuery(new URLSearchParams("status=__proto__")), "any");
  const signal = new AbortController().signal;
  let sent;
  const r = await readAdminRules(new URLSearchParams("status=published"), async (path, init) => {
    sent = { path, init };
    return reply(200, payload);
  }, signal);
  assert.deepEqual(r, { status: "ok", data: payload });
  assert.equal(sent.path, "/api/admin-read/rules?status=published");
  assert.equal(sent.init.method, "GET");
  assert.equal(sent.init.credentials, "same-origin");
  assert.equal(sent.init.cache, "no-store");
  assert.equal(sent.init.signal, signal);
});

test("MIG-0727 U03a: invalid/stale/oversized rules, count and auth failures fail closed", async () => {
  const q = new URLSearchParams("status=published");
  const read = async (body, code = 200) => readAdminRules(q, async () => reply(code, body));
  assert.deepEqual(await read(payload, 401), { status: "anonymous" });
  assert.deepEqual(await read({}, 403), { status: "forbidden" });
  assert.deepEqual(await read({ ...payload, status: "draft" }), { status: "unavailable" });
  assert.deepEqual(await read({ ...payload, reacceptRequiredCount: 31 }), { status: "unavailable" });
  assert.deepEqual(await read({ ...payload, reacceptRequiredCount: -1 }), { status: "unavailable" });
  assert.deepEqual(await read({ ...payload, reacceptRequiredCount: 1.5 }), { status: "unavailable" });
  assert.deepEqual(await read({ ...payload, items: Array.from({ length: 21 }, () => row) }),
    { status: "unavailable" });
  assert.deepEqual(await read({ ...payload, items: [{ id: "partial" }] }), { status: "unavailable" });
});

test("MIG-0727 U03a: detail payload identity, 404 and 401 cannot expose another rules body", async () => {
  let path;
  const fetcher = async input => {
    path = input;
    return reply(200, { item: detail });
  };
  assert.deepEqual(await readAdminRuleDetail(detail.id, fetcher),
    { status: "ok", data: { item: detail } });
  assert.equal(path, "/api/admin-read/rules/terms%2Fa");
  assert.deepEqual(await readAdminRuleDetail(detail.id, async () =>
    reply(200, { item: { ...detail, id: "other" } })), { status: "unavailable" });
  assert.deepEqual(await readAdminRuleDetail(detail.id, async () =>
    reply(200, { item: { id: detail.id } })), { status: "unavailable" });
  assert.deepEqual(await readAdminRuleDetail(detail.id, async () => reply(404, {})),
    { status: "notFound" });
  assert.deepEqual(await readAdminRuleDetail(detail.id, async () => reply(401, {})),
    { status: "anonymous" });
  assert.deepEqual(await readAdminRuleDetail("", async () => { throw Error("must not fetch"); }),
    { status: "notFound" });
});

test("MIG-0727 U03a: rules SSR preserves filters, upper-bound label, safe links and no write button", () => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(AdminRulesView, { data: payload })));
  assert.match(html, /規約管理/);
  assert.match(html, /name="status"/);
  assert.match(html, /value="published" selected=""/);
  assert.match(html, /現在の再同意待ち/);
  assert.match(html, /30件以上/);
  assert.match(html, /v2026.11/);
  assert.match(html, /公開中/);
  assert.match(html, /major/);
  assert.match(html, /admin\/rules\/terms%2Fa\/edit/);
  assert.match(html, /record=terms%2Fa/);
  assert.doesNotMatch(html, /TERMS.*確認して送信/);
  const empty = renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(AdminRulesView, { data: { ...payload, items: [] } })));
  assert.match(empty, /規約バージョンがまだ登録されていません/);
  const details = renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(AdminRuleDetailView, { data: { item: detail } })));
  assert.match(details, /v2026.11/);
  assert.match(details, /# 本文/);
  assert.match(details, /readOnly=""/i);
  assert.match(details, /編集・公開・アーカイブ操作は移行準備中/);
  assert.doesNotMatch(details, /type="submit"/);
});
