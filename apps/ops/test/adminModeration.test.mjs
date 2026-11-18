import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  moderationFilters, moderationReadPath, createAdminModerationApi,
} from "../.test-dist/apps/ops/src/api/adminModeration.js";
import { AdminModerationContent, requestModerationFilterSubmit, onModerationReadCompleted, moderationGetSearchParams } from "../.test-dist/apps/ops/src/routes/admin/AdminModeration.js";
import { ModerationCaseStatusForm, parseModerationFormInput } from "../.test-dist/apps/ops/src/routes/admin/ModerationCaseStatusForm.js";
import { MODERATION_FLASH_KEY, parseModerationSaveNotice, storeModerationSaveNotice,
  consumeModerationSaveNotice, ModerationFlashNotice } from "../.test-dist/apps/ops/src/routes/admin/ModerationFlashNotice.js";

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

test("MIG-0731 U03a: CURRENT filter auto-submits the exact GET form", () => {
  let submitted = 0;
  requestModerationFilterSubmit({ requestSubmit() { submitted++; } });
  requestModerationFilterSubmit(null);
  assert.equal(submitted, 1);
  const markup = renderToStaticMarkup(React.createElement(AdminModerationContent, {
    data: { ...fixture, cases: [] },
    filters: { type: "rights", status: "resolved", overdue: true },
  }));
  assert.ok(markup.includes('action="/admin/moderation"'));
  assert.match(markup, /name="type"/);
  assert.match(markup, /name="status"/);
  assert.match(markup, /name="overdue"/);
  assert.match(markup, /value="1"/);
});

test("MIG-0731 U03 form: correct SA-044 path, body, no-store and safe failure handling", async () => {
  const calls = [];
  const client = createAdminModerationApi(async (path, init) => {
    calls.push({ path, init }); return resp(200, { ok: true, message: "saved", pendingPublicReflection: true });
  });
  const good = await client.resolveCase("case/a&b", {
    status: "resolved", video_status: "private", private_note: "reason",
  });
  assert.deepEqual(good, { status: "ok", data: {
    ok: true, message: "saved", pendingPublicReflection: true,
  } });
  assert.equal(calls[0].path, "/api/admin/moderation/cases/case%2Fa%26b/status");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    status: "resolved", video_status: "private", private_note: "reason",
  });
  assert.deepEqual(await client.resolveCase("", {
    status: "resolved", video_status: "", private_note: "",
  }), { status: "unavailable" });
  assert.equal(calls.length, 1);
  const invalid = createAdminModerationApi(async () => resp(200, { ok: "yes" }));
  assert.deepEqual(await invalid.resolveCase("c1", {
    status: "resolved", video_status: "", private_note: "",
  }), { status: "unavailable" });
  const anonymous = createAdminModerationApi(async () => resp(401, { ok: false }));
  assert.deepEqual(await anonymous.resolveCase("c1", {
    status: "resolved", video_status: "", private_note: "",
  }), { status: "anonymous" });
  const proxyError = createAdminModerationApi(async () => resp(501, { ok: true }));
  assert.deepEqual(await proxyError.resolveCase("c1", {
    status: "resolved", video_status: "", private_note: "",
  }), { status: "unavailable" });
});
test("MIG-0731 U03 form: mirrors CURRENT status/video/note controls but remains unmounted", () => {
  const html = renderToStaticMarkup(React.createElement(ModerationCaseStatusForm, {
    caseId: "c1", onSaved() {},
  }));
  for (const item of ["resolved", "rejected", "cancelled", "expired", "pending", "public", "private", "voided"]) {
    assert.match(html, new RegExp('value="' + item + '"'));
  }
  assert.match(html, /name="private_note"/);
  assert.match(html, /maxLength="2000"/i);
  const formData = new FormData();
  formData.set("status", "rejected");
  formData.set("video_status", "voided");
  formData.set("private_note", "reviewed");
  assert.deepEqual(parseModerationFormInput(formData), {
    ok: true, body: { status: "rejected", video_status: "voided", private_note: "reviewed" },
  });
  formData.set("status", "open");
  assert.deepEqual(parseModerationFormInput(formData), { ok: false });
  formData.set("status", "resolved");
  formData.set("private_note", "x".repeat(2001));
  assert.deepEqual(parseModerationFormInput(formData), { ok: false });
});
test("MIG-0731 U03 flash: exact session key, one-shot display, rejection of malicious persisted data", () => {
  assert.equal(MODERATION_FLASH_KEY, "flamenode:moderation-save-notice");
  const map = new Map();
  const storage = {
    setItem(k, v) { map.set(k, v); },
    getItem(k) { return map.get(k) ?? null; },
    removeItem(k) { map.delete(k); },
  };
  storeModerationSaveNotice({
    message: "saved", pendingPublicReflection: true,
  }, storage);
  assert.deepEqual(consumeModerationSaveNotice(storage), {
    message: "saved", pendingPublicReflection: true,
  });
  assert.equal(consumeModerationSaveNotice(storage), null, "consumed only once");
  assert.equal(parseModerationSaveNotice('{"message":"ok","style":{"color":"red"}}').message, "ok");
  for (const raw of ["", "{", "null", "[]", '{"message":""}',
    '{"message":{},"pendingPublicReflection":true}',
    '{"message":"good","pendingPublicReflection":"true"}', "x".repeat(4097)]) {
    assert.equal(parseModerationSaveNotice(raw), null);
  }
  const inaccessible = { setItem() { throw Error("blocked"); },
    getItem() { throw Error("blocked"); }, removeItem() { throw Error("blocked"); } };
  assert.doesNotThrow(() => storeModerationSaveNotice({ message: "ok" }, inaccessible));
  assert.equal(consumeModerationSaveNotice(inaccessible), null);
  assert.equal(renderToStaticMarkup(React.createElement(ModerationFlashNotice)), "");
});

test("MIG-0731 U03 T04: unmounted screen wires open-case form and one-shot refresh candidate", () => {
  const html = renderToStaticMarkup(React.createElement(AdminModerationContent, {
    data: fixture, filters: { type: "all", status: "open", overdue: false },
    onSaved() {},
  }));
  assert.match(html, /name="id" value="case\/1"/);
  assert.match(html, /name="status"/);
  assert.match(html, /name="video_status"/);
  assert.match(html, /name="private_note"/);
  assert.doesNotMatch(html, /更新操作は未移植/);
  const terminal = renderToStaticMarkup(React.createElement(AdminModerationContent, {
    data: { ...fixture, cases: [{ ...fixture.cases[0], status: "resolved" }] },
    filters: { type: "all", status: "resolved", overdue: false },
    onSaved() {},
  }));
  assert.match(terminal, /\/admin\/audit\?table=video_moderation_cases&amp;record=case%2F1/);
  assert.doesNotMatch(terminal, /name="private_note"/);
});

test("MIG-0731 U03 T04: success flash is gated by finished authorized GET, not refresh request", () => {
  let consumed = 0;
  const fire = () => { consumed++; };
  const valid = { status: "ok", data: fixture };
  onModerationReadCompleted({ aborted: false }, valid, fire);
  assert.equal(consumed, 1);
  onModerationReadCompleted({ aborted: true }, valid, fire);
  onModerationReadCompleted({ aborted: false }, { status: "anonymous" }, fire);
  onModerationReadCompleted({ aborted: false }, { status: "forbidden" }, fire);
  onModerationReadCompleted({ aborted: false }, { status: "unavailable" }, fire);
  onModerationReadCompleted({ aborted: false }, { status: "notFound" }, fire);
  assert.equal(consumed, 1, "no flash before success or after abort/denial/error");
});

test("MIG-0731 U03: SPA filter preserves GET semantics and strips unselected overdue", () => {
  const fd = new FormData();
  fd.set("type", "rights");
  fd.set("status", "rejected");
  fd.set("overdue", "1");
  assert.equal(moderationGetSearchParams(fd).toString(), "type=rights&status=rejected&overdue=1");
  fd.delete("overdue");
  assert.equal(moderationGetSearchParams(fd).toString(), "type=rights&status=rejected");
  fd.set("extraneous", "secret");
  assert.equal(moderationGetSearchParams(fd).has("extraneous"), false);
  const markup = renderToStaticMarkup(React.createElement(AdminModerationContent, {
    data: { ...fixture, cases: [] },
    filters: { type: "rights", status: "rejected", overdue: false },
    onFilterChange() {},
  }));
  assert.match(markup, /method="get"/);
  assert.ok(markup.includes('action="/admin/moderation"'));
  assert.match(markup, /name="type"/);
  assert.match(markup, /name="status"/);
});
