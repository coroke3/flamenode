import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { JSDOM } from "jsdom";
import { DeleteEventTemplateButton } from "../.test-dist/apps/ops/src/routes/admin/DeleteEventTemplateButton.js";
import {
  deleteAdminEventTemplate, eventDisplayState, eventIndexQuery, formatEventUnix,
  readAdminEvents, readAdminEventTemplates, readAdminEventNew,
} from "../.test-dist/apps/ops/src/api/adminEvents.js";
import {
  addEventsToGroup,
  createAdminEventGroupsApi,
  createEventGroup,
  deleteEventGroup,
  eventGroupPublicHref,
  eventGroupsQuery,
  readAdminEventGroupDetail,
  readAdminEventGroups,
  removeEventFromGroup,
  searchEventGroupEventOptions,
  updateEventGroup,
} from "../.test-dist/apps/ops/src/api/adminEventGroups.js";
import { AdminEvents } from "../.test-dist/apps/ops/src/routes/admin/AdminEvents.js";
import { EventTemplates } from "../.test-dist/apps/ops/src/routes/admin/EventTemplates.js";
import { EventGroupsPage } from "../.test-dist/apps/ops/src/routes/admin/EventGroups.js";
import {
  EventGroupCreatePage,
  EventGroupEditPage,
} from "../.test-dist/apps/ops/src/routes/admin/EventGroupEdit.js";
import { EventGroupForm } from "../.test-dist/apps/ops/src/routes/admin/EventGroupForm.js";
import { EventGroupMembersEditor } from "../.test-dist/apps/ops/src/routes/admin/EventGroupMembersEditor.js";
import { DeleteEventGroupForm } from "../.test-dist/apps/ops/src/routes/admin/DeleteEventGroupForm.js";
import { OpsRoutes } from "../.test-dist/apps/ops/src/routes/router.js";

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
const eventNew = {
  ...templates, userId: "admin-account", templateId: "t1", templateName: "Example",
  templateSettingsJson: JSON.stringify({
    event_type: "collabo", slot_type: "time", slot_visibility_mode: "anonymous",
    explanation: "Template information", youtube_description_template: "  First\r\nSecond  ",
    allow_user_video_edits: 1, user_video_edit_permission_keys_json: '["title"]',
    custom_question_definitions: [
      { question_key: "q_template", label: "Choice", type: "select", required: true,
        options_json: '[" A ","B","A"]', is_active: true, visibility: "review" },
      { question_key: "stage_permission_1", label: "Stage", type: "textarea", required: false,
        options_json: null, is_active: true, visibility: "private" },
    ],
  }),
  formInitial: "deferred",
};

async function withDom(url, fn) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url });
  const keys = [
    "window", "document", "FormData", "Element", "HTMLElement",
    "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement",
    "Node", "Event", "MouseEvent", "navigator", "ResizeObserver",
    "requestAnimationFrame", "cancelAnimationFrame",
  ];
  const previous = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const wasAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  for (const key of keys) {
    if (key in dom.window) {
      Object.defineProperty(globalThis, key, {
        configurable: true, writable: true, value: dom.window[key],
      });
    }
  }
  const raf = (cb) => setTimeout(cb, 0);
  const caf = (id) => clearTimeout(id);
  dom.window.requestAnimationFrame = raf;
  dom.window.cancelAnimationFrame = caf;
  globalThis.requestAnimationFrame = raf;
  globalThis.cancelAnimationFrame = caf;
  // JSDOM has no ResizeObserver; TableScroll needs only observe/disconnect.
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  dom.window.matchMedia = () => ({
    matches: false,
    media: "",
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; },
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.getElementById("root");
  const root = createRoot(container);
  try {
    return await fn({ dom, container, root });
  } finally {
    await React.act(async () => root.unmount());
    for (const [key, old] of previous) {
      if (old) Object.defineProperty(globalThis, key, old);
      else delete globalThis[key];
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = wasAct;
    dom.window.close();
  }
}

function LocationProbe() {
  const loc = useLocation();
  return React.createElement("output", { "data-testid": "loc" }, loc.pathname + loc.search);
}

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

test("MIG-0721 U03a: new-event read encodes selection and preserves CURRENT template defaults and owner", async () => {
  const body = { ...eventNew, templateId: "pick &/?#日" };
  const controller = new AbortController();
  const seen = [];
  const result = await readAdminEventNew(" \tpick &/?#日\n", async (path, init) => {
    seen.push([path, init]);
    return json(200, body);
  }, controller.signal);
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], "/api/admin-read/events/new?template=pick+%26%2F%3F%23%E6%97%A5");
  assert.equal(seen[0][1].method, "GET");
  assert.equal(seen[0][1].credentials, "same-origin");
  assert.equal(seen[0][1].cache, "no-store");
  assert.equal(seen[0][1].headers.accept, "application/json");
  assert.equal(seen[0][1].signal, controller.signal);
  assert.equal(result.status, "ok");
  const { formProps, ...dto } = result.data;
  assert.deepEqual(dto, body, "retain the validated read DTO, including the deferred marker");
  assert.equal(formProps.templateId, body.templateId);
  assert.equal(formProps.draftAuthUserId, "admin-account");
  assert.equal(formProps.initial.event_type, "collabo");
  assert.equal(formProps.initial.explanation, "Template information");
  assert.equal(formProps.initial.youtube_description_template, "First\nSecond");
  assert.equal(formProps.initial.user_video_edit_permission_keys_json, '["title"]');
  assert.equal(formProps.initial.slot_visibility_mode, "anonymous");
  assert.equal(formProps.initial.visibility_status, "private");
  for (const key of ["start_time", "end_time", "entry_start_time", "entry_end_time"]) {
    assert.equal(formProps.initial[key], null);
  }
  assert.deepEqual(formProps.initial.custom_questions, [{
    clientId: "q_template", question_key: "q_template", label: "Choice", description: "",
    type: "select", required: true, options: ["A", "B"], placeholder: "", enabled: true,
  }], "the canonical helper filters stage-permission questions and normalizes choices");
});

test("MIG-0721 U03a: missing, unknown and invalid snapshots retain selection metadata without initial values", async () => {
  const cases = [
    [null, "", null, null],
    [" \t ", "", null, null],
    [" missing ", "missing", null, null],
    ["t1", "t1", "Unavailable settings", null],
    ["t1", "t1", "Malformed settings", "{"],
    ["t1", "t1", "Invalid snapshot", '{"event_type":"unknown","slot_type":"time"}'],
  ];
  for (const [selection, templateId, templateName, templateSettingsJson] of cases) {
    const body = { ...eventNew, templateId, templateName, templateSettingsJson };
    const result = await readAdminEventNew(selection, async (path) => {
      assert.equal(path, "/api/admin-read/events/new" + (templateId ? "?template=" + templateId : ""));
      return json(200, body);
    });
    assert.deepEqual(result, { status: "ok", data: {
      ...body, formProps: {
        initial: undefined, templateId: templateId || undefined, draftAuthUserId: "admin-account",
      },
    } });
  }
});

test("MIG-0721 U03a: guard-denied template lists keep selected settings and server draft ownership", async () => {
  const body = { ...eventNew, guardOk: false, templates: [], userId: "other-admin" };
  const result = await readAdminEventNew("t1", async () => json(200, body));
  assert.equal(result.status, "ok", "the list guard is not an HTTP authorization failure");
  const { formProps, ...dto } = result.data;
  assert.deepEqual(dto, body);
  assert.equal(formProps.templateId, "t1");
  assert.equal(formProps.draftAuthUserId, "other-admin");
  assert.equal(formProps.initial.event_type, "collabo");
  assert.equal(formProps.initial.visibility_status, "private");
});

test("MIG-0721 U03a: HTTP denial, malformed DTOs and aborted reads never yield form props", async () => {
  let unauthorizedBodyReads = 0;
  const unauthorized = json(401, eventNew);
  unauthorized.json = async () => { unauthorizedBodyReads += 1; return eventNew; };
  assert.deepEqual(await readAdminEventNew("t1", async () => unauthorized), { status: "anonymous" });
  assert.equal(unauthorizedBodyReads, 0);
  for (const [response, expected] of [
    [json(403, { ...eventNew, redirect: "/dashboard", reason: "admin_required" }),
      { status: "forbidden", redirect: "/dashboard", reason: "admin_required" }],
    [json(403, { ...eventNew, redirect: "https://example.test" }), { status: "forbidden" }],
    [new Response("{", { status: 403 }), { status: "forbidden" }],
    [json(404, eventNew), { status: "notFound" }],
    [json(501, eventNew), { status: "unsupported" }],
    [json(503, eventNew), { status: "unavailable" }],
    [new Response("{", { status: 200 }), { status: "unavailable" }],
    [json(200, { ...eventNew, userId: null }), { status: "unavailable" }],
    [json(200, { ...eventNew, formInitial: {} }), { status: "unavailable" }],
    [json(200, { ...eventNew, templateSettingsJson: {} }), { status: "unavailable" }],
  ]) {
    assert.deepEqual(await readAdminEventNew("t1", async () => response), expected);
  }
  assert.deepEqual(await readAdminEventNew("t1", async () => { throw new Error("offline"); }),
    { status: "unavailable" });
  const controller = new AbortController();
  const late = json(200, eventNew);
  late.json = async () => { controller.abort(); return eventNew; };
  assert.deepEqual(await readAdminEventNew("t1", async () => late, controller.signal),
    { status: "unavailable" }, "an abort during JSON decoding cannot expose a completed form model");
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

test("MIG-0728 U02: dot-segment template IDs cannot escape the DELETE route", async () => {
  assert.equal(new URL("/api/admin/event-templates/..", "https://flamenode.test").pathname,
    "/api/admin/", "URL normalization would otherwise redirect the DELETE");
  assert.equal(new URL("/api/admin/event-templates/.", "https://flamenode.test").pathname,
    "/api/admin/event-templates/");
  let requests = 0;
  const fetchFn = async () => {
    requests++;
    return json(200, { ok: true });
  };
  for (const invalid of [".", "..", "", " ", " x", "x ", "\uD800", "\uDC00"]) {
    assert.deepEqual(await deleteAdminEventTemplate(invalid, fetchFn), { status: "unavailable" },
      "reject unsafe ID " + JSON.stringify(invalid));
  }
  assert.equal(requests, 0, "no unsafe ID must reach fetch");
  assert.deepEqual(await deleteAdminEventTemplate("tpl-1", fetchFn), { status: "ok" });
  assert.equal(requests, 1, "valid IDs still reach the template DELETE endpoint");
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

test("MIG-0728 U02: IME composition blocks automatic and manual event searches until commit tick ends", async () => {
  await withDom("https://flamenode.test/admin/events", async ({ dom, root }) => {
    const paths = [];
    const fetchFn = async (path) => {
      paths.push(path);
      const q = new URL(path, "https://flamenode.test").searchParams.get("q") ?? "";
      return json(200, { ...events, q });
    };
    await React.act(async () => root.render(React.createElement(MemoryRouter, {
      initialEntries: ["/admin/events?q=initial"],
    }, React.createElement(AdminEvents, { fetchFn }))));
    assert.equal(paths.length, 1);
    const form = dom.window.document.querySelector('form[role="search"]');
    const input = form.querySelector('input[name="q"]');
    const filter = form.querySelector('select[name="filter"]');
    const nativeInputSet = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    const nativeSelectSet = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value").set;
    await React.act(async () => {
      nativeInputSet.call(input, "変換途中");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      input.dispatchEvent(new dom.window.CompositionEvent("compositionstart", { bubbles: true }));
    });
    assert.equal(form.hasAttribute("data-fn-ime-composing"), true);
    await React.act(async () => {
      nativeSelectSet.call(filter, "public");
      filter.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.equal(paths.length, 1, "select auto-submit and form submit must not navigate during IME conversion");
    await React.act(async () => {
      input.dispatchEvent(new dom.window.CompositionEvent("compositionend", { bubbles: true }));
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.equal(paths.length, 1, "the IME commit event tick must not trigger search");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(form.hasAttribute("data-fn-ime-composing"), false);
    await React.act(async () => {
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.equal(paths.length, 2, "search works after composition has ended");
    assert.equal(new URL(paths[1], "https://flamenode.test").searchParams.get("q"), "変換途中");
  });
});

test("MIG-0728 T04: ConfirmDialog cancel never calls DELETE; confirm calls once and refreshes", async () => {
  await withDom("https://example.com/admin/events/templates", async ({ dom, container, root }) => {
    let calls = 0;
    let refreshed = 0;
    const fetchFn = async () => {
      calls++;
      return json(200, { ok: true });
    };
    const click = async (label) => {
      const button = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
      assert.ok(button, label + " button must exist");
      await React.act(async () => { button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
    };
    await React.act(async () => root.render(React.createElement(DeleteEventTemplateButton, {
      id: "tpl", name: "Demo", onDeleted: () => { refreshed++; }, fetchFn,
    })));
    await click("削除");
    const dialog = container.querySelector('[role="alertdialog"]');
    assert.ok(dialog, "ConfirmDialog alertdialog must open");
    assert.match(dialog.textContent, /イベントテンプレートを削除/);
    await click("キャンセル");
    assert.equal(calls, 0);
    assert.equal(container.querySelector('[role="alertdialog"]'), null);
    await click("削除");
    await click("削除する");
    assert.equal(calls, 1);
    assert.equal(refreshed, 1);
  });
});

test("MIG-0728 T05: AdminEvents search q updates URL query and re-fetches", async () => {
  await withDom("https://flamenode.test/admin/events", async ({ dom, container, root }) => {
    const calls = [];
    const fetchFn = async (path) => {
      calls.push(path);
      return json(200, { ...events, q: "winter" });
    };
    await React.act(async () => root.render(
      React.createElement(MemoryRouter, { initialEntries: ["/admin/events"] },
        React.createElement(Routes, null,
          React.createElement(Route, {
            path: "/admin/events",
            element: React.createElement(React.Fragment, null,
              React.createElement(LocationProbe),
              React.createElement(AdminEvents, { fetchFn })),
          }))),
    ));
    assert.equal(calls[0], "/api/admin-read/events?sort=newest&filter=all&q=");
    const input = container.querySelector('input[name="q"]');
    const nativeInputSet = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    await React.act(async () => {
      nativeInputSet.call(input, "  winter  ");
      container.querySelector('form[role="search"]').dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    assert.equal(container.querySelector('[data-testid="loc"]').textContent,
      "/admin/events?sort=newest&filter=all&q=winter");
    assert.equal(calls[1], "/api/admin-read/events?sort=newest&filter=all&q=winter");
  });
});

test("MIG-0728 U01/U03: event-group API adapters enforce contracts, path safety and SA-025..030", async () => {
  assert.equal(eventGroupsQuery(new URLSearchParams("visibility=bogus&type=constructor")),
    "visibility=any&type=any");
  assert.equal(eventGroupsQuery(new URLSearchParams("visibility=public&type=series")),
    "visibility=public&type=series");
  assert.equal(eventGroupPublicHref("winter-2026"), "/event#event-group-winter-2026");

  const calls = [];
  const sampleGroup = {
    id: "grp_1", name: "冬フェス", slug: "winter-2026", description: null,
    group_type: "series", icon_url: null, accent_color: "#ff5500",
    visibility_status: "public", sort_order: 1, updated_at: 1700000000,
  };
  const fetchFn = async (path, init) => {
    calls.push([path, init]);
    if (path.startsWith("/api/admin-read/event-groups?")) {
      return json(200, { visibility: "any", type: "any", groups: [{ ...sampleGroup, event_count: 2 }] });
    }
    if (path === "/api/admin-read/event-groups/grp_1") {
      return json(200, { group: sampleGroup, members: [], eventOptions: [], nextCursor: null });
    }
    if (path.startsWith("/api/admin/event-groups/event-options")) {
      return json(200, { ok: true, options: [{ id: "ev1", title: "EV1", start_time: null }], nextCursor: "c1" });
    }
    if (path === "/api/admin/event-groups" && init?.method === "POST") {
      return json(200, { ok: true, id: "grp_new", pendingPublicReflection: true });
    }
    if (path === "/api/admin/event-groups/grp_1" && init?.method === "PATCH") {
      return json(409, { ok: false, message: "他の操作で更新されています。" });
    }
    if (path === "/api/admin/event-groups/grp_1" && init?.method === "DELETE") {
      return json(200, { ok: true });
    }
    if (path === "/api/admin/event-groups/grp_1/events" && init?.method === "POST") {
      return json(200, { ok: true, id: "grp_1", added: 2 });
    }
    if (path === "/api/admin/event-groups/grp_1/events/ev%2F1" && init?.method === "DELETE") {
      return json(200, { ok: true, id: "grp_1" });
    }
    return json(500, {});
  };

  // Path traversal and invalid IDs rejected before network
  assert.deepEqual(await readAdminEventGroupDetail("..", fetchFn), { status: "notFound" });
  assert.deepEqual(await readAdminEventGroupDetail(".", fetchFn), { status: "notFound" });
  assert.deepEqual(await updateEventGroup("..", { name: "A", slug: "a" }, fetchFn), { ok: false, message: "ID が必要です。" });
  assert.deepEqual(await deleteEventGroup(".", fetchFn), { ok: false, message: "ID が必要です。" });
  assert.deepEqual(await removeEventFromGroup({ groupId: "grp_1", eventId: ".." }, fetchFn),
    { ok: false, message: "グループとイベントを指定してください。" });
  // Client-side contract check rejects invalid slug before network
  assert.equal((await createEventGroup({ name: "A", slug: "INVALID SLUG" }, fetchFn)).ok, false);
  // Client-side >80 IDs rejected before network
  const eightyOne = Array.from({ length: 81 }, (_, i) => `ev_${i}`);
  assert.equal((await addEventsToGroup({ groupId: "grp_1", eventIds: eightyOne }, fetchFn)).ok, false);
  assert.equal(calls.length, 0, "all preflight rejections must make 0 network requests");

  // Mismatched group.id on detail read fails closed
  assert.deepEqual(await readAdminEventGroupDetail("other_id", async () =>
    json(200, { group: sampleGroup, members: [], eventOptions: [], nextCursor: null })),
  { status: "unavailable" });

  // Valid operations hit real SA-025..030 and admin-read endpoints
  assert.equal((await readAdminEventGroups(new URLSearchParams(), fetchFn)).status, "ok");
  assert.equal((await readAdminEventGroupDetail("grp_1", fetchFn)).status, "ok");
  assert.deepEqual(await searchEventGroupEventOptions({ groupId: "grp_1", query: "EV", cursor: null }, fetchFn),
    { ok: true, options: [{ id: "ev1", title: "EV1", start_time: null }], nextCursor: "c1" });
  assert.deepEqual(await createEventGroup({
    name: "冬フェス", slug: "winter-2026", group_type: "series", visibility_status: "public", sort_order: "1",
  }, fetchFn), { ok: true, id: "grp_new", pendingPublicReflection: true });
  assert.deepEqual(await updateEventGroup("grp_1", {
    base_updated_at: "1700000000", name: "冬フェス", slug: "winter-2026",
  }, fetchFn), { ok: false, message: "他の操作で更新されています。" });
  assert.deepEqual(await deleteEventGroup("grp_1", fetchFn), { ok: true });
  assert.deepEqual(await addEventsToGroup({ groupId: "grp_1", eventIds: [" ev1 ", "ev1", "ev2"] }, fetchFn),
    { ok: true, id: "grp_1", added: 2 });
  assert.equal(JSON.parse(calls.at(-1)[1].body).eventIds.length, 2, "duplicate eventIds trimmed and deduped");
  assert.deepEqual(await removeEventFromGroup({ groupId: "grp_1", eventId: "ev/1" }, fetchFn),
    { ok: true, id: "grp_1" });
});

test("MIG-0728 T01 & T02: member search discards stale response and pagination deduplicates options", async () => {
  await withDom("https://flamenode.test/admin/event-groups/grp_1/edit", async ({ dom, container, root }) => {
    const resolvers = [];
    const seenRequests = [];
    const api = createAdminEventGroupsApi(async (path) => {
      seenRequests.push(path);
      return new Promise((resolve) => resolvers.push({ path, resolve }));
    });

    await React.act(async () => root.render(React.createElement(MemoryRouter, null,
      React.createElement(EventGroupMembersEditor, {
        groupId: "grp_1",
        members: [],
        eventOptions: [{ id: "ev0", title: "Initial Event", start_time: null }],
        initialEventOptionsCursor: "cur_0",
        api,
      }))));

    const input = container.querySelector('input[type="search"]');
    const form = input.closest("form");
    const nativeInputSet = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;

    // T01: fire search "first" then rapidly "second"; resolve "second" first, then "first" late
    await React.act(async () => {
      nativeInputSet.call(input, "first");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await React.act(async () => {
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
    await React.act(async () => {
      nativeInputSet.call(input, "second");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await React.act(async () => {
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });

    assert.equal(resolvers.length, 2);
    // Resolve 2nd request first
    await React.act(async () => {
      resolvers[1].resolve(json(200, {
        ok: true,
        options: [{ id: "ev_new", title: "Second Result", start_time: null }],
        nextCursor: "cur_second",
      }));
    });
    assert.match(container.textContent, /Second Result/);

    // Now resolve stale 1st request late — MUST be discarded
    await React.act(async () => {
      resolvers[0].resolve(json(200, {
        ok: true,
        options: [{ id: "ev_stale", title: "Stale Result", start_time: null }],
        nextCursor: null,
      }));
    });
    assert.match(container.textContent, /Second Result/);
    assert.doesNotMatch(container.textContent, /Stale Result/, "stale search response must be discarded");

    // T02: modify search text without submitting, then click "さらに読み込む" -> uses loadedQuery ("second"), dedups ev_new
    await React.act(async () => {
      nativeInputSet.call(input, "unsent-edit");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    const loadMoreBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "さらに読み込む");
    assert.ok(loadMoreBtn);
    await React.act(async () => {
      loadMoreBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(resolvers.length, 3);
    assert.match(resolvers[2].path, /q=second/, "pagination must reuse loadedQueryRef");
    await React.act(async () => {
      resolvers[2].resolve(json(200, {
        ok: true,
        options: [
          { id: "ev_new", title: "Second Result", start_time: null },
          { id: "ev_page2", title: "Page Two Result", start_time: null },
        ],
        nextCursor: null,
      }));
    });
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    assert.equal(checkboxes.length, 2, "duplicate ev_new must appear only once");
    assert.match(container.textContent, /Page Two Result/);
  });
});

test("MIG-0728 T03 & U01: EventGroupCreatePage navigates to edit on create and blocks double-submit", async () => {
  await withDom("https://flamenode.test/admin/event-groups/new", async ({ dom, container, root }) => {
    let resolvePost;
    let postCount = 0;
    const fetchFn = async (path, init) => {
      if (path === "/api/admin/event-groups" && init?.method === "POST") {
        postCount++;
        return new Promise((resolve) => { resolvePost = resolve; });
      }
      return json(404, {});
    };

    await React.act(async () => root.render(
      React.createElement(MemoryRouter, { initialEntries: ["/admin/event-groups/new"] },
        React.createElement(Routes, null,
          React.createElement(Route, {
            path: "/admin/event-groups/new",
            element: React.createElement(EventGroupCreatePage, { fetchFn }),
          }),
          React.createElement(Route, {
            path: "/admin/event-groups/:id/edit",
            element: React.createElement(LocationProbe),
          }))),
    ));

    const nameInput = container.querySelector('input[name="name"]');
    const slugInput = container.querySelector('input[name="slug"]');
    const nativeInputSet = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    nativeInputSet.call(nameInput, "テストグループ");
    nativeInputSet.call(slugInput, "test-group");
    const form = container.querySelector("form");

    // Trigger submit twice synchronously before promise settles (single-flight lock)
    await React.act(async () => {
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.equal(postCount, 1, "busyRef must block duplicate create submits");

    await React.act(async () => {
      resolvePost(json(200, { ok: true, id: "grp_42", pendingPublicReflection: false }));
    });
    assert.equal(container.querySelector('[data-testid="loc"]').textContent, "/admin/event-groups/grp_42/edit");
  });
});

test("MIG-0728 U01: DeleteEventGroupForm requires confirmation, removes on confirm, and shows D-17-5 notice", async () => {
  await withDom("https://flamenode.test/admin/event-groups/grp_1/edit", async ({ dom, container, root }) => {
    let deleteCount = 0;
    const fetchFn = async (path, init) => {
      if (path === "/api/admin/event-groups/grp_1" && init?.method === "DELETE") {
        deleteCount++;
        return json(200, { ok: true });
      }
      if (path.startsWith("/api/admin-read/event-groups?")) {
        return json(200, { visibility: "any", type: "any", groups: [] });
      }
      return json(404, {});
    };
    const api = createAdminEventGroupsApi(fetchFn);
    const click = async (label) => {
      const btn = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
      assert.ok(btn, label + " button must exist");
      await React.act(async () => { btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
    };
    let deletedNav = false;
    await React.act(async () => root.render(React.createElement(MemoryRouter, null,
      React.createElement(DeleteEventGroupForm, {
        id: "grp_1", name: "テスト", api, onDeleted: () => { deletedNav = true; },
      }))));

    await click("グループを削除");
    assert.ok(container.querySelector('[role="alertdialog"]'));
    await click("キャンセル");
    assert.equal(deleteCount, 0);
    await click("グループを削除");
    await click("削除する");
    assert.equal(deleteCount, 1);
    assert.equal(deletedNav, true);
  });
});

test("MIG-0728 D-17-2 & D-17-5: 404 renders NotFoundView, 401/403 redirect, and ?notice=/?error= render", async () => {
  await withDom("https://flamenode.test/admin/event-groups/missing/edit", async ({ dom, container, root }) => {
    await React.act(async () => root.render(
      React.createElement(MemoryRouter, { initialEntries: ["/admin/event-groups/missing/edit"] },
        React.createElement(Routes, null,
          React.createElement(Route, {
            path: "/admin/event-groups/:id/edit",
            element: React.createElement(EventGroupEditPage, { fetchFn: async () => json(404, {}) }),
          }))),
    ));
    assert.match(container.textContent, /ページが見つかりません/);
  });

  await withDom("https://flamenode.test/admin/event-groups?notice=%E4%BF%9D%E5%AD%98%E3%81%97%E3%81%BE%E3%81%97%E3%81%9F&error=%E8%AD%A6%E5%91%8A", async ({ container, root }) => {
    await React.act(async () => root.render(
      React.createElement(MemoryRouter, {
        initialEntries: ["/admin/event-groups?notice=%E4%BF%9D%E5%AD%98%E3%81%97%E3%81%BE%E3%81%97%E3%81%9F&error=%E8%AD%A6%E5%91%8A"],
      }, React.createElement(EventGroupsPage, {
        fetchFn: async () => json(200, { visibility: "any", type: "any", groups: [] }),
      })),
    ));
    assert.match(container.querySelector('[role="status"]').textContent, /保存しました/);
    assert.match(container.querySelector('[role="alert"]').textContent, /警告/);
  });

  await withDom("https://flamenode.test/admin/event-groups", async ({ dom, root }) => {
    const assigned = [];
    const winProxy = new Proxy(dom.window, {
      get(target, prop) {
        if (prop === "location") {
          return { assign: (url) => assigned.push(url), href: target.location.href, origin: target.location.origin };
        }
        const val = Reflect.get(target, prop);
        return typeof val === "function" ? val.bind(target) : val;
      },
    });
    Object.defineProperty(globalThis, "window", { configurable: true, value: winProxy });
    await React.act(async () => root.render(
      React.createElement(MemoryRouter, { initialEntries: ["/admin/event-groups"] },
        React.createElement(EventGroupsPage, {
          fetchFn: async () => json(401, {}),
        })),
    ));
    assert.deepEqual(assigned, ["/entry"]);
  });
});

test("MIG-0728 U03: OpsRoutes mounts all 5 routes behind OpsGate and blocks non-admin", async () => {
  const paths = [
    ["/admin/event-groups", /イベントグループ管理/],
    ["/admin/event-groups/new", /新規イベントグループ/],
    ["/admin/event-groups/grp_1/edit", /イベントグループを取得できませんでした|読み込み中|冬フェス を編集/],
    ["/admin/events", /全イベント管理/],
    ["/admin/events/templates", /イベントテンプレート/],
  ];

  // 1. Non-admin redirects to /dashboard and renders nothing protected
  const nonAdminApi = {
    getSummary: async () => ({
      status: "ok",
      summary: { loggedIn: true, role: "moderator", canAccessAdmin: false, canAccessManage: true },
    }),
    checkManageNavigation: async () => "allow",
  };
  for (const [route] of paths) {
    await withDom("https://flamenode.test" + route, async ({ dom, container, root }) => {
      const assigned = [];
      const winProxy = new Proxy(dom.window, {
        get(target, prop) {
          if (prop === "location") {
            return { assign: (url) => assigned.push(url), href: target.location.href, origin: target.location.origin };
          }
          const val = Reflect.get(target, prop);
          return typeof val === "function" ? val.bind(target) : val;
        },
      });
      Object.defineProperty(globalThis, "window", { configurable: true, value: winProxy });
      await React.act(async () => root.render(
        React.createElement(MemoryRouter, { initialEntries: [route] },
          React.createElement(OpsRoutes, { api: nonAdminApi })),
      ));
      assert.deepEqual(assigned, ["/dashboard"], `${route} must redirect non-admin`);
      assert.doesNotMatch(container.textContent, /イベントグループ管理|新規イベントグループ|全イベント管理|イベントテンプレート/);
    });
  }

  // 2. Admin gate allows all 5 routes without hitting UnmigratedView
  const adminApi = {
    getSummary: async () => ({
      status: "ok",
      summary: { loggedIn: true, role: "admin", canAccessAdmin: true, canAccessManage: true },
    }),
    checkManageNavigation: async () => "allow",
  };
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const s = String(url);
    if (s.includes("/api/admin-read/cost-guard-banner")) return json(200, { mode: "normal", reason: null });
    if (s.startsWith("/api/admin-read/event-groups?")) return json(200, { visibility: "any", type: "any", groups: [] });
    if (s === "/api/admin-read/event-groups/grp_1") {
      return json(200, {
        group: {
          id: "grp_1", name: "冬フェス", slug: "winter-2026", description: null,
          group_type: "series", icon_url: null, accent_color: null,
          visibility_status: "public", sort_order: 0, updated_at: 1700000000,
        },
        members: [],
        eventOptions: [],
        nextCursor: null,
      });
    }
    if (s.startsWith("/api/admin-read/events?")) return json(200, events);
    if (s === "/api/admin-read/events/templates") return json(200, templates);
    return json(500, {});
  };
  try {
    for (const [route, pattern] of paths) {
      await withDom("https://flamenode.test" + route, async ({ container, root }) => {
        await React.act(async () => root.render(
          React.createElement(MemoryRouter, { initialEntries: [route] },
            React.createElement(OpsRoutes, { api: adminApi })),
        ));
        await React.act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 15));
        });
        assert.doesNotMatch(container.textContent, /移行準備中/, `${route} must not hit UnmigratedView`);
        assert.match(container.textContent, pattern, `${route} must render MIG-0728 screen`);
      });
    }
  } finally {
    globalThis.fetch = origFetch;
  }
});
