import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "node:url";
import { MessageChannel } from "node:worker_threads";

const source = await readFile(new URL("./EventForm.tsx", import.meta.url), "utf8");
const unsavedGuardSource = await readFile(
  new URL("../../lib/interactions/useUnsavedChangesGuard.ts", import.meta.url),
  "utf8",
);
const adminNewSource = await readFile(
  new URL("../../../app/(admin)/admin/events/new/page.tsx", import.meta.url),
  "utf8",
);
const manageEditSource = await readFile(
  new URL("../../../app/(manage)/manage/events/[id]/edit/page.tsx", import.meta.url),
  "utf8",
);

test("EventForm keeps authenticated drafts isolated and guards unsaved changes", () => {
  assert.match(source, /useFormDraft/);
  assert.match(source, /useUnsavedChangesGuard/);
  assert.match(source, /buildFormDraftStorageKey/);
  assert.match(source, /event-form-v1/);
  assert.match(unsavedGuardSource, /beforeunload/);
  assert.match(source, /clearDraft\(\)/);
  assert.match(source, /setDirty\(false\)/);
  assert.match(source, /formDataToDraftValue/);
});

test("event create and edit pages scope drafts to the authenticated user", () => {
  assert.match(adminNewSource, /draftAuthUserId=\{user\?\.id\}/);
  assert.match(manageEditSource, /draftAuthUserId=\{user\.id\}/);
});

// Exercise the real form, children and hooks; only the server/navigation boundary
// is replaced. Source-text checks cannot observe pre-commit FormData snapshots.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const bundle = await build({
  stdin: {
    contents: `import * as React from "react";
      import { createRoot } from "react-dom/client";
      import { EventForm } from "./src/components/admin/EventForm.tsx";
      const root = createRoot(document.getElementById("root"));
      window.eventFormTest = {
        act: React.act,
        render: (props, strict) => React.act(async () => root.render(strict
          ? React.createElement(React.StrictMode, null, React.createElement(EventForm, props))
          : React.createElement(EventForm, props))),
        unmount: () => React.act(async () => root.unmount()),
      };`,
    resolveDir: repoRoot, loader: "tsx", sourcefile: "event-form-draft-fixture.tsx",
  },
  bundle: true, platform: "browser", format: "iife", write: false,
  outdir: "event-form-draft-fixture", jsx: "automatic",
  tsconfig: `${repoRoot}/tsconfig.json`, loader: { ".css": "local-css" },
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "event-form-boundaries", setup(builder) {
    builder.onResolve({ filter: /^(next\/navigation|@\/lib\/actions\/event-admin)$/ },
      ({ path }) => ({ path, namespace: "event-form-boundary" }));
    builder.onLoad({ filter: /.*/, namespace: "event-form-boundary" }, ({ path }) => ({
      contents: path === "next/navigation"
        ? "export const useRouter = () => window.eventFormRouter;"
        : "export const createEvent = (data) => window.eventFormAction(data); export const updateEvent = createEvent;",
      loader: "js",
    }));
  } }],
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
  window.TextEncoder = TextEncoder;
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
  let currentProps = { mode: "edit", initial, draftAuthUserId: "editor-1", ...props };
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
