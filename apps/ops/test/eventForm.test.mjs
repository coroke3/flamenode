// MIG-0721 U01: unmounted EventForm; real browser and live API gates remain separate.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { MessageChannel } from "node:worker_threads";
import { EventForm } from "../.test-dist/apps/ops/src/components/event/EventForm.js";
import { eventFormStyles, eventFormCss } from "../.test-dist/apps/ops/src/components/event/eventFormStyles.js";
import { editorCss, fieldCss } from "../.test-dist/apps/ops/src/components/event/eventCustomQuestionsStyles.js";
import { youtubeTemplateEditorCss } from "../.test-dist/apps/ops/src/components/event/youtubeDescriptionTemplateEditorStyles.js";
import { buildEventFormCss, portCssModule } from "../scripts/portCssModule.mjs";
import { buildFormDraftStorageKey } from "../.test-dist/apps/ops/src/lib/useFormDraft.js";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const generatedEventFormCss = read("../src/styles/event-form.css");
const noop = async () => ({ ok: false });
const base = { mode: "create", createEvent: noop, updateEvent: noop, router: { push() {}, refresh() {} } };
const field = (form, name) => form.querySelector('[name="' + name + '"]');

function renderForm(props) {
  const entry = props.mode === "edit" ? `/manage/events/${encodeURIComponent(props.initial.id)}/edit`
    : `/admin/events/new${props.templateId ? `?template=${encodeURIComponent(props.templateId)}` : ""}`;
  const router = createMemoryRouter([{ path: "*", element: React.createElement(EventForm, props) }], { initialEntries: [entry] });
  try { return renderToStaticMarkup(React.createElement(RouterProvider, { router })); }
  finally { router.dispose(); }
}

test("U01 preserves CURRENT JSX, submit flow and generated CSS selectors", () => {
  const current = read("../../../src/components/admin/EventForm.tsx");
  const target = read("../src/components/event/EventForm.tsx");
  const submitStart = "  const submit = (event: React.FormEvent<HTMLFormElement>) => {";
  const submitEnd = "  const submitLabel =";
  const block = s => s.slice(s.indexOf(submitStart), s.indexOf(submitEnd));
  assert.ok(block(current).length > 1000);
  assert.equal(block(target), block(current));
  const renderStart = "  const submitLabel =";
  const targetRender = target.slice(target.indexOf(renderStart))
    .replace("      <style>{eventFormCss}</style>\n", "")
    .replace(/      <ConfirmDialog\n[\s\S]*?      \/>\n/, "")
    .replace("      <ScrollRestoration />\n", "")
    .replace('<Link key={item.id} to={{ pathname: location.pathname, search: location.search, hash: `#${item.id}` }}>', '<a key={item.id} href={`#${item.id}`}>')
    .replace("</Link>", "</a>");
  assert.equal(targetRender, current.slice(current.indexOf(renderStart)));
  assert.equal(eventFormCss, portCssModule(read("../../../src/components/admin/EventForm.module.css"), "ops-event-form"));
  assert.equal(buildEventFormCss(), generatedEventFormCss);
  for (const css of [eventFormCss, editorCss, fieldCss, youtubeTemplateEditorCss]) {
    assert.ok(generatedEventFormCss.includes(css), "generated stylesheet preserves every CURRENT EventForm editor CSS module");
  }
  for (const match of target.matchAll(/\bstyles\.([A-Za-z]\w*)/g)) {
    assert.equal(eventFormStyles[match[1]], "ops-event-form-" + match[1]);
    assert.ok(eventFormCss.includes("." + eventFormStyles[match[1]]));
  }
});

test("U01 create mode preserves all section anchors, template and Tokyo timestamp fields", () => {
  const dom = new JSDOM(renderForm({
    ...base, templateId: "event-template",
    initial: { title: "Test event", start_time: Date.UTC(2026, 4, 19, 3, 34) / 1000, end_time: null, visibility_status: "archived" }
  }));
  try {
    const form = dom.window.document.querySelector("form");
    assert.deepEqual([...form.querySelectorAll("nav a")].map(a => new URL(a.getAttribute("href"), "https://flamenode.test").hash), ["#section-basic", "#section-publish", "#section-questions", "#section-required", "#section-slots"]);
    assert.equal(field(form, "template_id").value, "event-template");
    assert.equal(field(form, "start_time").value, "2026-05-19T12:34");
    assert.equal(field(form, "end_time").value, "");
    assert.equal(field(form, "visibility_status").value, "private");
    assert.equal(field(form, "required_video_fields_present").value, "1");
    assert.equal(field(form, "custom_questions_present").value, "1");
    assert.equal(field(form, "general_custom_questions_present").value, "1");
    assert.equal(form.querySelector('button[type="submit"]').textContent, "イベントを作成");
  } finally { dom.window.close(); }
});

test("T06 slots-only staff retains denied section values without enabling edits", () => {
  const dom = new JSDOM(renderForm({
    ...base, mode: "edit", variant: "manage",
    initial: { id: "event-a", updated_at: 123, title: "Locked title", event_type: "collabo", visibility_status: "public", slot_type: "count", max_slots_per_video: 3 },
    editableSections: { basic: false, publish: false, questions: false, slots: true }
  }));
  try {
    const form = dom.window.document.querySelector("form");
    const data = new dom.window.FormData(form);
    assert.equal(field(form, "title").readOnly, true);
    assert.equal(field(form, "event_type").type, "hidden");
    assert.equal(data.get("event_type"), "collabo");
    assert.equal(data.get("visibility_status"), "public");
    assert.equal(data.get("revision"), "123");
    assert.equal(data.get("id"), "event-a");
    assert.equal(field(form, "slot_type").disabled, false);
    assert.equal(field(form, "max_slots_per_video").readOnly, false);
    assert.equal(data.get("max_slots_per_video"), "3");
    assert.equal(form.querySelectorAll("fieldset > p[role=status]").length, 4);
    assert.equal(form.querySelector('button[type="submit"]').textContent, "変更を保存");
  } finally { dom.window.close(); }
});

async function withForm(props, run) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://flamenode.test/admin/events/new", pretendToBeVisual: true });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const keys = ["window", "document", "sessionStorage", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Node", "Event", "MouseEvent", "FormData", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? dom.window : dom.window[key] });
  const node = dom.window.document.getElementById("root");
  const root = createRoot(node);
  const router = createMemoryRouter([{ path: "*", element: React.createElement(EventForm, { ...base, ...props }) }], { initialEntries: ["/admin/events/new"] });
  try {
    await React.act(async () => root.render(React.createElement(RouterProvider, { router })));
    const form = node.querySelector("form");
    const submit = () => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await run({ dom, form, submit });
  } finally {
    try { await React.act(async () => root.unmount()); }
    finally {
      router.dispose();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      dom.window.close();
    }
  }
}

test("T01/T04 create sends one FormData, clears the draft and navigates with encoded event ID", async () => {
  const calls = [], destinations = [];
  let refreshes = 0, resolve;
  const pending = new Promise(r => { resolve = r; });
  await withForm({
    draftAuthUserId: "test-user", templateId: "t1",
    initial: { title: "Create event" },
    createEvent(data) { calls.push(data); return pending; },
    router: { push(href) { destinations.push(href); }, refresh() { refreshes++; } }
  }, async ({ dom, submit }) => {
    const key = buildFormDraftStorageKey({ authUserId: "test-user", formId: "event-create-t1", schemaVersion: "event-form-v3" });
    dom.window.localStorage.setItem(key, "draft-to-clear");
    await React.act(async () => { submit(); submit(); });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].get("title"), "Create event");
    assert.equal(calls[0].get("template_id"), "t1");
    await React.act(async () => { resolve({ ok: true, eventId: "new-event", pendingPublicReflection: true }); });
    assert.deepEqual(destinations, ["/manage/events/new-event/edit"]);
    assert.equal(refreshes, 0);
    assert.equal(dom.window.localStorage.getItem(key), null);
  });
});

test("T02 empty choice options refuse submission with CURRENT message", async () => {
  let calls = 0;
  const question = { clientId: "c1", question_key: "q1", label: "質問A", description: "", type: "select", required: false, options: [], placeholder: "", enabled: true };
  await withForm({ initial: { title: "Test", custom_questions: [question] }, createEvent: async () => { calls++; return { ok: true }; } }, async ({ form, submit }) => {
    await React.act(async () => submit());
    assert.equal(calls, 0);
    assert.equal(form.querySelector(".fn-error").textContent, "質問Aの選択肢を1件以上入力してください。");
  });
});

test("U01 edit failure preserves input and successful retry refreshes without redirect", async () => {
  const calls = [];
  let refreshes = 0, redirects = 0;
  await withForm({
    mode: "edit", variant: "manage", initial: { id: "event-a", updated_at: 9, title: "Keep title" },
    updateEvent: async data => { calls.push(data); return calls.length === 1 ? { ok: false, message: "保存失敗" } : { ok: true, pendingPublicReflection: true }; },
    router: { push() { redirects++; }, refresh() { refreshes++; } }
  }, async ({ form, submit }) => {
    await React.act(async () => submit());
    assert.equal(form.querySelector(".fn-error").textContent, "保存失敗");
    assert.equal(field(form, "title").value, "Keep title");
    assert.equal(refreshes, 0);
    await React.act(async () => submit());
    assert.equal(calls.length, 2);
    assert.equal(calls[1].get("revision"), "9");
    assert.equal(redirects, 0);
    assert.equal(refreshes, 1);
    assert.match(form.querySelector(".fn-success").textContent, /保存しました。/);
    assert.match(form.querySelector(".fn-success").textContent, /公開ページへの反映/);
  });
});

// Exercise the real form, children and hooks; only the server/navigation boundary
// is replaced. Source-text checks cannot observe pre-commit FormData snapshots.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const bundle = await build({
  stdin: {
    contents: `import * as React from "react";
      import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
      import { EventForm } from "./apps/ops/src/components/event/EventForm.tsx";
      import { createMemoryRouter, RouterProvider } from "react-router-dom";
      const root = createRoot(document.getElementById("root"));
      const Props = React.createContext({});
      function RoutedForm() { return React.createElement(EventForm, React.useContext(Props)); }
      const router = createMemoryRouter([
        { path: "/left", element: React.createElement("p", null, "Left form") },
        { path: "/manage/events/:id/edit", element: React.createElement("p", null, "Saved destination") },
        { path: "*", element: React.createElement(RoutedForm) },
      ], { initialEntries: ["/admin/events/new"] });
      const render = (props) => React.createElement(Props.Provider, { value: props }, React.createElement(RouterProvider, { router }));
      window.eventFormTest = {
        act: React.act,
        navigate: (to, options) => router.navigate(to, options),
        location: () => router.state.location,
        render: (props, strict) => React.act(async () => root.render(strict
          ? React.createElement(React.StrictMode, null, render(props)) : render(props))),
        unmount: () => React.act(async () => { root.unmount(); router.dispose(); }),
      };`,
    resolveDir: repoRoot, loader: "tsx", sourcefile: "event-form-draft-fixture.tsx",
  },
  bundle: true, platform: "browser", format: "iife", write: false,
  outdir: "event-form-draft-fixture", jsx: "automatic",
  tsconfig: `${repoRoot}/apps/ops/tsconfig.json`, loader: { ".css": "local-css" },
  define: { "process.env.NODE_ENV": '"development"' },

});
const formScript = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const draftKey = "fn:draft:editor-1:event-edit-event-1:event-form-v3";
const initial = {
  id: "event-1", updated_at: 42, title: "Published title",
  allow_user_video_edits: 1, user_video_edit_permission_keys_json: "[]",
};
const draftJson = (baseRevision, value, metadata = {}) => JSON.stringify({
  savedAt: Date.now(),
  metadata: {
    schemaVersion: "event-form-v3", authUserId: "editor-1", mode: "edit",
    eventId: "event-1", baseRevision, ...metadata,
  },
  value,
}, null, 2);

async function withEventForm({ raw = null, props = {}, storage = {}, strict = false } = {}, run) {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://flamenode.test/manage/events/event-1/edit", runScripts: "outside-only",
  });
  const { window } = dom;
  const { document, localStorage } = window;
  const channels = [];
  window.MessageChannel = class extends MessageChannel {
    constructor() { super(); channels.push(this); }
  };
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.TextEncoder = TextEncoder;
  window.Request = Request;
  window.Response = Response;
  window.Headers = Headers;
  window.AbortController = AbortController;
  window.IS_REACT_ACT_ENVIRONMENT = true;
  if (raw !== null) localStorage.setItem(draftKey, raw);
  for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
  let timerId = 0;
  const timers = new Map();
  window.setTimeout = (callback) => { timers.set(++timerId, callback); return timerId; };
  window.clearTimeout = (id) => timers.delete(id);
  const submissions = [];
  let outcome = { ok: false, message: "Save unavailable" };
  let refreshes = 0;
  const pushes = [];
  window.eventFormRouter = { push(url) { pushes.push(url); }, refresh() { refreshes += 1; } };
  window.eventFormAction = async (data) => {
    submissions.push(Object.fromEntries(data));
    return outcome;
  };
  window.eval(formScript);
  const { act, render, unmount } = window.eventFormTest;
  const read = (key = draftKey) => localStorage.getItem(key);
  const saved = (key = draftKey) => JSON.parse(read(key))?.value;
  const policy = () => document.querySelector('[name="user_video_edit_permission_keys_json"]').value;
  const change = (selector, value) => act(async () => {
    const input = document.querySelector(selector);
    assert.ok(input, selector);
    const prototype = input instanceof window.HTMLSelectElement
      ? window.HTMLSelectElement.prototype
      : input instanceof window.HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
    input.dispatchEvent(new window.Event(input instanceof window.HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
  const click = (label) => act(async () => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === label);
    assert.ok(button, label);
    button.click();
  });
  const flush = (event = "pagehide") => act(async () => {
    if (event === "visibilitychange") {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new window.Event(event));
    } else window.dispatchEvent(new window.Event(event));
  });
  const debounce = () => act(async () => {
    for (const [id, callback] of [...timers]) {
      if (timers.delete(id)) callback();
    }
  });
  const guarded = () => {
    const event = new window.Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  let currentProps = {
    mode: "edit", initial, draftAuthUserId: "editor-1",
    createEvent: window.eventFormAction, updateEvent: window.eventFormAction,
    router: window.eventFormRouter, ...props,
  };
  let mounted = true;
  const detach = async () => {
    if (!mounted) return;
    mounted = false;
    await unmount();
  };
  try {
    await render(currentProps, strict);
    await run({
      window, document, read, saved, policy, change, click, flush, debounce, guarded,
      submissions, pushes, act, detach, refreshes: () => refreshes,
      setOutcome: (next) => { outcome = next; },
      updateProps: (next) => {
        currentProps = { ...currentProps, ...next };
        return render(currentProps, strict);
      },
      submit: () => act(async () => document.querySelector("form").dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      )),
    });
  } finally {
    await detach();
    for (const { port1, port2 } of channels) { port1.close(); port2.close(); }
    dom.window.close();
  }
}

test("untouched EventForm retains stale revision bytes through initialization and every automatic save", async () => {
  const raw = draftJson(41, { title: "Prior revision draft" });
  await withEventForm({ raw }, async ({ document, read, debounce, flush, guarded }) => {
    assert.match(document.querySelector(".fn-error").textContent, /自動復元しませんでした/);
    assert.equal(document.querySelector('[name="title"]').value, initial.title);
    assert.equal(guarded(), false);
    assert.equal(read(), raw);
    await debounce();
    assert.equal(read(), raw);
    await flush();
    assert.equal(read(), raw);
    await flush("visibilitychange");
    assert.equal(read(), raw);
  });
});

test("first ordinary edit replaces stale draft and preserves untouched legacy policy bytes", async () => {
  const legacy = ' [ "title" ] ';
  await withEventForm({
    raw: draftJson(41, { title: "Prior revision draft" }),
    props: { initial: { ...initial, user_video_edit_permission_keys_json: legacy } },
  }, async ({ change, debounce, saved, read, guarded, policy }) => {
    await change('[name="title"]', "New deliberate edit");
    assert.equal(guarded(), true);
    await debounce();
    assert.equal(saved().title, "New deliberate edit");
    assert.equal(JSON.parse(read()).metadata.baseRevision, 42);
    assert.equal(saved().user_video_edit_permission_keys_json, legacy);
    assert.equal(policy(), legacy);
  });
});

test("permission select and bulk buttons persist the committed policy and activate the leave guard", async () => {
  for (const edit of ["single", "すべて許可", "すべて継承"]) {
    await withEventForm({}, async ({ change, click, flush, saved, guarded, policy }) => {
      if (edit === "single") await change('select[aria-label$=" policy"]', "allow");
      else await click(edit);
      assert.equal(guarded(), true, edit);
      assert.notEqual(policy(), "[]", edit);
      await flush();
      assert.equal(saved().user_video_edit_permission_keys_json, policy(), edit);
      const value = JSON.parse(policy());
      assert.equal(value.version, 2);
      assert.ok(edit === "すべて継承" ? value.inherit.length > 1 : value.allow.length > 0);
    });
  }
});

test("matching revision restores permission controls and subsequent edits retain the restored policy", async () => {
  const restoredPolicy = JSON.stringify({ version: 2, fallback: "deny", allow: ["title"], deny: [], inherit: [] });
  await withEventForm({ raw: draftJson(42, {
    title: "Restored title", user_video_edit_permission_keys_json: restoredPolicy,
  }) }, async ({ document, change, flush, saved, policy, guarded }) => {
    assert.equal(document.querySelector('[name="title"]').value, "Restored title");
    assert.equal(policy(), restoredPolicy);
    assert.equal(document.querySelector('select[aria-label="タイトル policy"]').value, "allow");
    assert.equal(document.querySelector('select[aria-label$=" policy"]').value, "deny");
    assert.equal(guarded(), true);
    await change('[name="title"]', "After restore");
    await flush("visibilitychange");
    assert.equal(saved().title, "After restore");
    assert.equal(saved().user_video_edit_permission_keys_json, restoredPolicy);
    await change('select[aria-label$=" policy"]', "allow");
    await flush();
    const editedPolicy = JSON.parse(saved().user_video_edit_permission_keys_json);
    assert.ok(editedPolicy.allow.includes("title"));
    assert.ok(editedPolicy.deny.length > 0, "untouched fallback-denied fields remain denied");
  });
});

test("disabled permission controls cannot dirty or replace an untouched stale draft", async () => {
  const raw = draftJson(41, { title: "Prior revision draft" });
  await withEventForm({ raw, props: {
    editableSections: { basic: true, publish: true, questions: false, slots: true },
  } }, async ({ document, click, debounce, flush, read, policy, guarded }) => {
    assert.equal(document.querySelector('select[aria-label$=" policy"]').disabled, true);
    await click("すべて許可");
    await click("すべて継承");
    await debounce();
    await flush();
    assert.equal(read(), raw);
    assert.equal(policy(), "[]");
    assert.equal(guarded(), false);
  });
});

test("failed save preserves edits; successful save clears the draft through later lifecycle events", async () => {
  await withEventForm({}, async ({ change, click, flush, debounce, saved, read, policy, submit, setOutcome, submissions, refreshes, guarded, detach }) => {
    await change('[name="title"]', "Ready to save");
    await click("すべて許可");
    await flush();
    const expectedPolicy = policy();
    await submit();
    assert.equal(saved().title, "Ready to save");
    assert.equal(guarded(), true);
    setOutcome({ ok: true });
    await submit();
    assert.equal(submissions.length, 2);
    assert.equal(submissions[1].user_video_edit_permission_keys_json, expectedPolicy);
    assert.equal(refreshes(), 1);
    assert.equal(read(), null);
    assert.equal(guarded(), false);
    await debounce();
    await flush();
    await flush("visibilitychange");
    assert.equal(read(), null);
    await detach();
    assert.equal(read(), null, "unmount cannot recreate a successfully cleared draft");
  });
});

const templateA = {
  mode: "create", templateId: "template-a", draftAuthUserId: "editor-1",
  initial: { title: "Template A", explanation: "A initial" },
};
const templateB = { ...templateA, templateId: "template-b", initial: { title: "Template B", explanation: "B initial" } };
const templateKey = (id) => `fn:draft:editor-1:event-create-template-${id}:event-form-v3`;

test("template navigation before debounce flushes the departing owner and A-B-A restores only its own draft", async () => {
  await withEventForm({ props: templateA }, async ({ document, change, updateProps, saved, read, debounce, policy }) => {
    const oldForm = document.querySelector("form");
    await change('[name="title"]', "A unsaved title");
    await change('[name="explanation"]', "A unsaved explanation");
    await change('select[aria-label$=" policy"]', "allow");
    const oldPolicy = policy();
    assert.equal(read(templateKey("a")), null, "no debounce has run");
    await updateProps(templateB);
    assert.notEqual(document.querySelector("form"), oldForm);
    assert.equal(document.querySelector('[name="title"]').value, "Template B");
    assert.equal(document.querySelector('[name="explanation"]').value, "B initial");
    assert.equal(saved(templateKey("a")).title, "A unsaved title");
    assert.equal(saved(templateKey("a")).template_id, "template-a");
    assert.equal(saved(templateKey("a")).user_video_edit_permission_keys_json, oldPolicy);
    await debounce();
    assert.equal(read(templateKey("b")), null, "pristine B cannot receive A's draft");
    await updateProps(templateA);
    assert.equal(document.querySelector('[name="title"]').value, "A unsaved title");
    assert.equal(document.querySelector('[name="explanation"]').value, "A unsaved explanation");
    assert.equal(policy(), oldPolicy);
  });
});

test("template navigation preserves and restores an existing destination draft in StrictMode", async () => {
  const rawB = draftJson(null, {
    title: "B existing draft", explanation: "B saved text", template_id: "template-b",
    custom_question_id: "question-b", custom_question_enabled: "1", custom_question_required: "1",
    custom_question_label: "B restored question", custom_question_description: "B question details",
  }, {
    mode: "create", eventId: null,
  });
  await withEventForm({ props: templateA, storage: { [templateKey("b")]: rawB }, strict: true },
    async ({ document, change, updateProps, saved, debounce }) => {
      await change('[name="title"]', "A latest text");
      await updateProps(templateB);
      assert.equal(document.querySelector('[name="title"]').value, "B existing draft");
      assert.equal(document.querySelector('[name="explanation"]').value, "B saved text");
      assert.equal(document.querySelector('[name="custom_question_label"]')?.value, "B restored question");
      await debounce();
      assert.equal(saved(templateKey("a")).title, "A latest text");
      assert.equal(saved(templateKey("b")).title, "B existing draft");
      assert.equal(saved(templateKey("b")).template_id, "template-b");
      assert.equal(saved(templateKey("b")).custom_question_label, "B restored question");
    });
});

test("account, event and mode changes reset form state and flush exclusively to the previous key", async () => {
  for (const next of [
    { draftAuthUserId: "editor-2", initial: { ...initial, title: "Other account" }, key: "fn:draft:editor-2:event-edit-event-1:event-form-v3" },
    { initial: { ...initial, id: "event-2", title: "Other event" }, key: "fn:draft:editor-1:event-edit-event-2:event-form-v3" },
    { mode: "create", initial: { title: "New event" }, key: "fn:draft:editor-1:event-create-new:event-form-v3" },
  ]) {
    await withEventForm({}, async ({ document, change, updateProps, saved, read, debounce }) => {
      await change('[name="title"]', "Previous owner edit");
      const { key, ...props } = next;
      await updateProps(props);
      assert.equal(document.querySelector('[name="title"]').value, props.initial.title);
      assert.equal(saved().title, "Previous owner edit");
      await debounce();
      assert.equal(read(key), null);
    });
  }
});

test("late success or failure from a departed owner cannot clear drafts or navigate the active owner", async () => {
  for (const result of [{ ok: true, eventId: "created-a" }, { ok: false, message: "Old owner failure" }, new Error("Old owner exception")]) {
    await withEventForm({ props: templateA }, async ({ document, change, updateProps, submit, setOutcome, act, saved, read, pushes, refreshes }) => {
      const pending = Promise.withResolvers();
      setOutcome(pending.promise);
      await change('[name="title"]', "Submitted A");
      await submit();
      await updateProps(templateB);
      await change('[name="title"]', "New B edit");
      // Returning to A creates a new lifetime even though its storage key repeats.
      await updateProps(templateA);
      await change('[name="title"]', "A after return");
      const before = read(templateKey("a"));
      await act(async () => {
        if (result instanceof Error) pending.reject(result);
        else pending.resolve(result);
      });
      assert.equal(document.querySelector('[name="title"]').value, "A after return");
      assert.equal(saved(templateKey("b")).title, "New B edit");
      assert.equal(read(templateKey("a")), before, "old success cannot clear the new lifetime's storage key");
      assert.deepEqual(pushes, []);
      assert.equal(refreshes(), 0);
      assert.equal(document.querySelector(".fn-error"), null);
    });
  }
});

test("same-owner initial-object refresh preserves edits made after the last saved draft", async () => {
  await withEventForm({ raw: draftJson(42, { title: "Saved earlier" }) },
    async ({ document, change, updateProps, saved, debounce }) => {
      const form = document.querySelector("form");
      await change('[name="title"]', "New edit before debounce");
      await updateProps({ initial: { ...initial, title: "Refreshed server title" }, draftAuthUserId: " editor-1 " });
      assert.equal(document.querySelector("form"), form);
      assert.equal(document.querySelector('[name="title"]').value, "New edit before debounce");
      await debounce();
      assert.equal(saved().title, "New edit before debounce");
    });
});


test("T03 EventForm confirmation cancels with button/Escape and confirms with old-key flush", async () => {
  await withEventForm({}, async view => {
    const { window, document, act, change, click, read } = view;
    await change('[name="title"]', "Keep this edit");
    const leave = () => act(async () => window.eventFormTest.navigate("/left"));
    await leave();
    assert.ok(document.querySelector('[role="alertdialog"]'));
    await click("編集を続ける");
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    assert.equal(document.querySelector('[name="title"]').value, "Keep this edit");
    assert.equal(window.eventFormTest.location().pathname, "/admin/events/new");
    await leave();
    await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    assert.equal(window.eventFormTest.location().pathname, "/admin/events/new");
    await leave();
    await click("このページを離れる");
    assert.equal(window.eventFormTest.location().pathname, "/left");
    assert.equal(document.querySelector("form"), null);
    assert.equal(JSON.parse(read()).value.title, "Keep this edit");
  });
});

test("T03 immediate create success navigates cleanly without re-creating its draft", async () => {
  await withEventForm({ props: { mode: "create", templateId: "immediate", initial: { title: "Initial" } } }, async view => {
    const { window, document, change, updateProps, submit, flush } = view;
    await updateProps({
      createEvent: async () => ({ ok: true, eventId: "created-now" }),
      router: { push: href => window.eventFormTest.navigate(href), refresh() { assert.fail("create must push"); } },
    });
    await change('[name="title"]', "Saved immediately");
    await flush();
    const key = "fn:draft:editor-1:event-create-immediate:event-form-v3";
    assert.ok(window.localStorage.getItem(key));
    await submit();
    assert.equal(window.eventFormTest.location().pathname, "/manage/events/created-now/edit");
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    assert.equal(document.querySelector("form"), null);
    await flush();
    assert.equal(window.localStorage.getItem(key), null);
  });
});

test("T03 the busy exception accepts departure and request settlement preserves the departing draft", async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  await withEventForm({ props: { updateEvent: () => pending } }, async view => {
    const { window, document, act, change, guarded, read } = view;
    await change('[name="title"]', "Pending edit");
    await act(async () => { document.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); });
    assert.equal(document.querySelector('button[type="submit"]').disabled, true);
    assert.equal(guarded(), false, "CURRENT dirty && !busy exception remains");
    await act(async () => window.eventFormTest.navigate("/left"));
    assert.equal(window.eventFormTest.location().pathname, "/left");
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    // React can entangle this navigation with the pending action: the router
    // location changes before the old DOM actually leaves. Check persistence
    // after that departure, not while the old owner is still connected.
    await act(async () => resolve({ ok: false, message: "Late failure" }));
    assert.equal(document.querySelector("form"), null);
    const departed = read();
    assert.equal(JSON.parse(departed).value.title, "Pending edit");
    await view.flush();
    assert.equal(read(), departed);
    assert.equal(document.body.textContent.includes("Late failure"), false);
  });
});
