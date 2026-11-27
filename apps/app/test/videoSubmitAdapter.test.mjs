// MIG-0714 U02a: actual CURRENT VideoForm action mode to injected SPA FormData parity.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canRestoreDraftField, isSectionDisabled, isFieldDisabled, restoreVideoDraftControls, buildVideoDraftControlledState } from "../.test-dist/apps/app/src/components/forms/videoFormDraftFields.js";
import {
  mapVideoSubmitMode,
  submitVideoForm,
  videoMemberAdapterProps,
} from "../.test-dist/apps/app/src/components/forms/videoSubmitAdapter.js";

test("U02a: CURRENT free/slot/edit maps exactly to injected free/slot/update", () => {
  assert.deepEqual(
    ["free", "slot", "edit"].map((mode) => mapVideoSubmitMode(mode)),
    ["free", "slot", "update"],
  );
  const legacy = readFileSync(new URL("../../../src/components/forms/VideoForm.tsx", import.meta.url), "utf8");
  assert.match(legacy, /mode === "slot"\s*\? submitSlotVideo/);
  assert.match(legacy, /mode === "edit"\s*\? updateVideo/);
  assert.match(legacy, /:\s*createFreeVideo;/);
});

test("U02a: preserves FormData identity, repeated entries, ordering and File data", async () => {
  const data = new FormData();
  data.append("youtube_url", "https://youtu.be/dQw4w9WgXcQ");
  data.append("event_ids", "event-A");
  data.append("event_ids", "event-B");
  data.append("members", "member-A");
  data.append("members", "member-B");
  data.append("custom_answers", "answer-A");
  data.append("custom_answers", "answer-B");
  const file = new File(["binary-icon"], "icon.png", { type: "image/png" });
  data.append("icon_file", file);
  let calls = 0;
  const sent = [...data.entries()];
  const response = { ok: true, message: "投稿完了", videoId: "v-1" };
  for (const mode of ["free", "slot", "edit"]) {
    const returned = await submitVideoForm(mode, data, async (actualMode, actualData) => {
      calls++;
      assert.equal(actualMode, mapVideoSubmitMode(mode));
      assert.strictEqual(actualData, data, "must not rebuild FormData and drop repeated fields");
      assert.deepEqual([...actualData.entries()], sent);
      assert.strictEqual(actualData.get("icon_file"), file);
      return response;
    });
    assert.strictEqual(returned, response);
  }
  assert.equal(calls, 3);
  assert.deepEqual(data.getAll("event_ids"), ["event-A", "event-B"]);
  assert.deepEqual(data.getAll("members"), ["member-A", "member-B"]);
  assert.deepEqual([...data.entries()], sent);
});

test("U02a: denies malformed runtime mode before invoking the submit adapter", async () => {
  const data = new FormData();
  let invoked = false;
  assert.throws(() => submitVideoForm("bad-mode", data, async () => {
    invoked = true;
    return { ok: true };
  }), { name: "TypeError", message: "Unsupported video submission mode" });
  assert.equal(invoked, false);
});

test("U02a: rejected API response remains unchanged, without extra browser redirect", async () => {
  const data = new FormData();
  data.append("title", "test");
  const rejected = { ok: false, reason: "tos_required", message: "規約に同意してください" };
  const result = await submitVideoForm("edit", data, async (mode, fd) => {
    assert.equal(mode, "update");
    assert.equal(fd.get("title"), "test");
    return rejected;
  });
  assert.strictEqual(result, rejected);
  // Guard redirects and draft changes remain in the future VideoForm caller.
});

test("U02a: adapter promise rejection propagates, rather than reporting false success", async () => {
  const data = new FormData();
  await assert.rejects(
    submitVideoForm("slot", data, async () => { throw new Error("synthetic D1 unavailable"); }),
    /synthetic D1 unavailable/,
  );
});

test("U02a: submission adapter contains no network, Next Server Action or direct storage fallback", () => {
  const source = readFileSync(new URL("../src/components/forms/videoSubmitAdapter.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\s+["']next(?:\/|["'])/);
  assert.doesNotMatch(source, /@\/lib\/actions|createFreeVideo|submitSlotVideo|updateVideo/);
  assert.doesNotMatch(source, /\bfetch\s*\(|localStorage|indexedDB|navigator\./);
});

test("U02b: mandatory member adapters are exact callable references, including AbortSignal", async () => {
  const controller = new AbortController();
  const seen = [];
  const searchOutput = {
    items: [{ id: "x_A", x_name: "Alice", score: 0.8, matchedBy: "name" }],
    hasMore: true,
    nextOffset: 20,
    hint: null,
  };
  const ports = {
    submit: async () => ({ ok: true }),
    searchXUsers: async (q, offset, signal) => {
      seen.push({ q, offset, signal });
      return searchOutput;
    },
    applyPermissionBatch: async () => ({ ok: true }),
  };
  const member = videoMemberAdapterProps(ports);
  assert.deepEqual(Object.keys(member), ["searchXUsers", "applyPermissionBatch"]);
  assert.strictEqual(member.searchXUsers, ports.searchXUsers);
  assert.strictEqual(member.applyPermissionBatch, ports.applyPermissionBatch);
  assert.ok(!("submit" in member), "member component cannot invoke the VideoForm submit port");
  assert.strictEqual(await member.searchXUsers("@Alice", 20, controller.signal), searchOutput);
  assert.deepEqual(seen, [{ q: "@Alice", offset: 20, signal: controller.signal }]);
  controller.abort();
  assert.equal(seen[0].signal.aborted, true, "no AbortSignal replacement");
});

test("U02b: member permission batch forwards all intents and privilege mode unchanged", async () => {
  const input = {
    videoId: "v-17",
    edit_privilege_mode: "event",
    notify: true,
    intents: [
      { x_user_id: "x_A", display_name: "Alice", intent: "on" },
      { x_user_id: "x_B", display_name: "Bob", intent: "off" },
    ],
  };
  const denied = { ok: false, message: "forbidden" };
  let calls = 0;
  const ports = {
    submit: async () => ({ ok: true }),
    searchXUsers: async () => ({ items: [] }),
    applyPermissionBatch: async (actual) => {
      calls += 1;
      assert.strictEqual(actual, input, "do not clone or strip permission intents");
      return denied;
    },
  };
  const member = videoMemberAdapterProps(ports);
  const outcome = await member.applyPermissionBatch(input);
  assert.strictEqual(outcome, denied, "do not turn permission failure into success");
  assert.equal(calls, 1);
  assert.equal(input.intents[1].intent, "off");
});

test("U02b: member adapter exceptions are not swallowed by the port forwarder", async () => {
  const sentinel = new Error("synthetic backend failure");
  const ports = {
    submit: async () => ({ ok: true }),
    searchXUsers: async () => { throw sentinel; },
    applyPermissionBatch: async () => { throw sentinel; },
  };
  const member = videoMemberAdapterProps(ports);
  await assert.rejects(member.searchXUsers("x", 0, new AbortController().signal), (e) => e === sentinel);
  await assert.rejects(member.applyPermissionBatch({ videoId: "v1", notify: true, intents: [] }), (e) => e === sentinel);
});

test("MIG-0714 part A: draft restoration respects every CURRENT section and field lock", () => {
  const groups = {
    submitter: ["display_name", "profile_text", "icon_url", "youtube_channel_url", "other_social_links"],
    video: ["title", "scheduled_time", "music", "music_reference_url", "credit", "youtube_url", "part"],
    descriptions: ["intro_comment", "highlights", "production_story", "used_software", "closing_comment", "custom_answers", "stage_permission"],
    members: ["is_collab", "members", "chapters"],
  };
  const entries = Object.entries(groups).flatMap(([section, names]) => names.map((name) => [
    name, section, name === "members" || name === "chapters" ? name : `${section}.${name}`,
  ]));
  entries.push(["event_ids", null, "event_ids"]);
  for (const [name, section, field] of entries) {
    assert.equal(canRestoreDraftField(name, undefined, undefined), true, name);
    for (const disabled of Object.keys(groups)) {
      assert.equal(canRestoreDraftField(name, [disabled], []), section !== disabled, `${name}: ${disabled}`);
    }
    for (const [, , disabled] of entries) {
      assert.equal(canRestoreDraftField(name, [], [disabled]), field !== disabled, `${name}: ${disabled}`);
    }
    assert.equal(canRestoreDraftField(name, Object.keys(groups), [field]), false, name);
  }
  // Chapters and membership have separate field locks in CURRENT.
  assert.equal(canRestoreDraftField("chapters", [], ["members"]), true);
  assert.equal(canRestoreDraftField("members", [], ["chapters"]), true);
});

test("MIG-0714 part A: omitted, unrelated and exact lock names keep CURRENT semantics", () => {
  assert.equal(isSectionDisabled(undefined, "video"), false);
  assert.equal(isFieldDisabled(undefined, "video.title"), false);
  assert.equal(isSectionDisabled(["video"], "video"), true);
  assert.equal(isFieldDisabled(["video.title"], "video.title"), true);
  assert.equal(isFieldDisabled(["VIDEO.TITLE", "video"], "video.title"), false);
  assert.equal(canRestoreDraftField("title", ["VIDEO"], ["title"]), true);
  assert.equal(canRestoreDraftField("event_ids", ["video", "members"], []), true);
  // The draft parser/caller limits actual restored fields; this helper is not authorization.
  assert.equal(canRestoreDraftField("unknown_field", ["video"], ["unknown_field"]), true);
});

test("MIG-0714 part A: restore native controls with CURRENT locks and repeated-value semantics", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM(`<form>
    <input name="title" value="server title">
    <input name="music" value="server music">
    <input name="display_name" value="server name">
    <input name="youtube_url" value="server url">
    <input name="credit" value="first"><input name="credit" value="second">
    <textarea name="intro_comment">server intro</textarea>
    <select name="used_software"><option value="old" selected>Old</option><option value="new">New</option></select>
    <input type="radio" name="part" value="A" checked><input type="radio" name="part" value="B">
    <input type="checkbox" name="highlights" checked>
    <input type="checkbox" name="production_story">
    <input type="checkbox" name="closing_comment" checked>
    <input type="checkbox" name="is_collab" checked>
    <input value="unnamed">
    <button name="title" value="button">Submit</button>
  </form>`);
  try {
    const form = dom.window.document.querySelector("form");
    const controls = name => [...form.querySelectorAll(`[name="${name}"]`)];
    let events = 0;
    form.addEventListener("input", () => events++);
    form.addEventListener("change", () => events++);
    restoreVideoDraftControls(form, {
      title: "draft title", music: "", display_name: "draft name",
      credit: ["first draft", "second draft"], intro_comment: "draft intro",
      used_software: ["new", "old"], part: ["B"],
      highlights: ["false", "true"], production_story: "1",
      closing_comment: "false",
    }, ["submitter"], ["video.title"]);
    assert.deepEqual(controls("title").map(x => x.value), ["server title", "button"]);
    assert.equal(controls("music")[0].value, "");
    assert.equal(controls("display_name")[0].value, "server name");
    assert.equal(controls("youtube_url")[0].value, "server url");
    assert.deepEqual(controls("credit").map(x => x.value), ["first draft", "first draft"]);
    assert.equal(controls("intro_comment")[0].value, "draft intro");
    assert.equal(controls("used_software")[0].value, "new");
    assert.deepEqual(controls("part").map(x => x.checked), [false, true]);
    assert.equal(controls("highlights")[0].checked, true);
    assert.equal(controls("production_story")[0].checked, true);
    assert.equal(controls("closing_comment")[0].checked, false);
    assert.equal(controls("is_collab")[0].checked, false);
    assert.equal(form.querySelector("input:not([name])").value, "unnamed");
    restoreVideoDraftControls(form, {}, ["descriptions", "members"], ["video.part"]);
    assert.equal(controls("highlights")[0].checked, true);
    assert.equal(controls("production_story")[0].checked, true);
    assert.deepEqual(controls("part").map(x => x.checked), [false, true]);
    assert.equal(controls("intro_comment")[0].value, "draft intro");
    assert.equal(events, 0, "CURRENT restores values without synthetic input/change events");
  } finally {
    dom.window.close();
  }
});

test("MIG-0714 part A: controlled draft patch preserves CURRENT event and field locks", () => {
  const member = (name, chapters) => ({ name, x_user_id: "", role: "", comment: "", chapters });
  const oldChapters = [{ time: "1:00", label: "old", note: "" }];
  const newChapters = [{ time: "2:00", label: "new", note: "" }];
  const draft = { schemaVersion: "video-form-v1", fields: { title: ["first", "second"], display_name: "draft", youtube_url: [] },
    selectedEventIds: ["b", "missing", "a", "b"], selectedPart: "B", isCollab: true,
    members: [member("draft", newChapters), member("added", newChapters)],
    customAnswers: [{ key: "q", value: ["a", "b"] }], stageAnswers: [{ id: "s", value: "yes" }],
    currentStep: 5, maxReachedStep: 2, metadata: {} };
  const input = { mode: "edit", canEditEvents: true, eventOptions: [{ id: "a" }, { id: "b" }],
    initialEventIdsForDraftSync: ["parent"], currentMembers: [member("current", oldChapters)], wizardStepCount: 4 };
  const patch = buildVideoDraftControlledState(draft, input);
  assert.deepEqual(patch.text, { title: "first", display_name: "draft", youtube_url: "", profile_text: "", icon_url: "", youtube_channel_url: "", other_social_links: "" });
  assert.deepEqual(patch.selectedEventIds, ["b", "a", "b"]);
  assert.deepEqual(patch.members, draft.members);
  assert.deepEqual(patch.customAnswers, { q: ["a", "b"] });
  assert.deepEqual(patch.stageAnswers, { s: "yes" });
  assert.deepEqual([patch.selectedPart, patch.isCollab, patch.currentStep, patch.maxReachedStep], ["B", true, 3, 3]);
  for (const options of [{ mode: "slot" }, { canEditEvents: false }]) {
    assert.deepEqual(buildVideoDraftControlledState(draft, { ...input, ...options }).selectedEventIds, ["parent"]);
  }
  const locked = buildVideoDraftControlledState(draft, { ...input, disabledSections: ["submitter", "descriptions"], disabledFields: ["video.title", "event_ids", "video.part", "members.is_collab", "chapters"] });
  assert.deepEqual(locked, { text: { youtube_url: "" }, members: [member("draft", oldChapters), member("added", [])], currentStep: 3, maxReachedStep: 3 });
  const noMembers = buildVideoDraftControlledState({ ...draft, members: [], isCollab: false }, input);
  assert.equal("members" in noMembers, false, "retain existing members on non-collab empty draft");
  assert.deepEqual(buildVideoDraftControlledState({ ...draft, members: [] }, input).members, [], "empty collab draft clears members");
  assert.equal("members" in buildVideoDraftControlledState(draft, { ...input, disabledFields: ["members"] }), false);
  assert.deepEqual(draft.members[0].chapters, newChapters, "no draft mutation");
});

test("MIG-0714 B01: submitter field preserves CURRENT readonly, unlock and profile FormData", async () => {
  const { JSDOM } = await import("jsdom");
  const ts = await import("typescript");
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const globals = ["window", "document", "navigator", "HTMLElement", "Node", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of globals) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? dom.window : dom.window[key],
    });
  }
  try {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { EditSubmitterField } = await import("../.test-dist/apps/app/src/components/forms/EditSubmitterField.js");
    const { Icon } = await import("../.test-dist/apps/app/src/routes/ui/Icon.js");
    const { normalizeXId } = await import("@flamenode/domain/xid");
    const legacy = readFileSync(new URL("../../../src/components/forms/VideoForm.tsx", import.meta.url), "utf8");
    const parsed = ts.createSourceFile("VideoForm.tsx", legacy, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const current = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "EditSubmitterField");
    assert.ok(current, "compare the actual CURRENT component, not a hand-maintained copy");
    const compiled = ts.transpileModule(current.getText(parsed), {
      compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
    const CurrentSubmitterField = new Function("React", "Icon", "normalizeXId", `${compiled}\nreturn EditSubmitterField;`)(React, Icon, normalizeXId);
    const defaults = {
      initialXId: "@ALICE", selectedDefault: "alice", hasSelectableXIds: true,
      xIdOptions: [{ id: "ALICE", x_name: "Alice" }, { id: "Bob", x_name: "Bob" }],
      disabled: false, sectionDisabled: false, canChangeSubmitter: true, lockNoteId: "submitter-lock-note",
    };
    async function withPair(props, inspect) {
      const mounts = [CurrentSubmitterField, EditSubmitterField].map((Component) => {
        const container = dom.window.document.createElement("div");
        dom.window.document.body.append(container);
        return { Component, container, root: createRoot(container) };
      });
      try {
        await React.act(async () => {
          for (const { Component, root } of mounts) root.render(React.createElement("form", null, React.createElement(Component, { ...defaults, ...props })));
        });
        const forms = mounts.map(({ container }) => container.querySelector("form"));
        const data = (form) => [...new dom.window.FormData(form).entries()];
        const parity = () => {
          assert.equal(forms[1].innerHTML, forms[0].innerHTML, "CURRENT and target markup/state must agree");
          assert.deepEqual(data(forms[1]), data(forms[0]), "CURRENT and target submitted fields must agree");
          assert.equal(forms[1].checkValidity(), forms[0].checkValidity());
          return forms[1];
        };
        const operate = async (fn) => {
          await React.act(async () => { for (const form of forms) fn(form); });
          return parity();
        };
        await inspect({ parity, operate, data });
      } finally {
        await React.act(async () => { for (const { root } of mounts) root.unmount(); });
        for (const { container } of mounts) container.remove();
      }
    }
    for (const props of [{ canChangeSubmitter: false }, { xIdOptions: [], hasSelectableXIds: false }]) {
      await withPair(props, async ({ parity, data }) => {
        const form = parity();
        const input = form.querySelector("#creator_x_user_id");
        assert.equal(input.readOnly, true);
        assert.equal(input.getAttribute("aria-readonly"), "true");
        assert.equal(input.getAttribute("aria-describedby"), "submitter-lock-note");
        assert.equal(form.querySelector('input[type="checkbox"]'), null);
        assert.deepEqual(data(form), [["creator_x_user_id", "@ALICE"]]);
      });
    }
    await withPair({ initialXId: "", xIdOptions: [], hasSelectableXIds: false }, async ({ parity, data }) => {
      const form = parity();
      assert.equal(form.textContent, "提出主体 X ID が設定されていません。");
      assert.deepEqual(data(form), []);
    });
    for (const props of [{ disabled: true }, { sectionDisabled: true }]) {
      await withPair(props, async ({ parity, operate, data }) => {
        const form = parity();
        assert.equal(form.querySelector('input[type="checkbox"]').disabled, true);
        await operate((node) => node.querySelector('input[type="checkbox"]').click());
        assert.equal(form.querySelector("select"), null, "disabled unlock cannot change the submission identity");
        assert.deepEqual(data(form), props.sectionDisabled ? [] : [["creator_x_user_id", "@ALICE"]]);
      });
    }
    await withPair({}, async ({ parity, operate, data }) => {
      assert.deepEqual(data(parity()), [["creator_x_user_id", "@ALICE"]]);
      let form = await operate((node) => node.querySelector('input[type="checkbox"]').click());
      // jsdom 26 reflects a reused text->hidden input differently from Chromium.
      // Full FormData equality above pins CURRENT parity; real-browser evidence checks flag "1".
      const identityData = (node) => {
        assert.equal(new dom.window.FormData(node).has("allow_submitter_change"), true);
        return data(node).filter(([name]) => name !== "allow_submitter_change");
      };
      assert.deepEqual(identityData(form), [["creator_x_user_id", "alice"]]);
      assert.equal(form.querySelector("fieldset"), null, "normalized initial identity has not changed");
      const choose = (value) => (node) => {
        const select = node.querySelector("select");
        select.value = value;
        select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      };
      form = await operate(choose("bob"));
      assert.equal(form.checkValidity(), false, "identity change requires an explicit profile choice");
      assert.deepEqual(identityData(form), [["creator_x_user_id", "bob"]]);
      for (const action of ["keep", "copy_default"]) {
        form = await operate((node) => node.querySelector(`input[value="${action}"]`).click());
        assert.equal(form.checkValidity(), true);
        assert.deepEqual(identityData(form), [["creator_x_user_id", "bob"], ["submitter_profile_action", action]]);
      }
      form = await operate((node) => node.querySelector("button").click());
      assert.deepEqual(data(form), [["creator_x_user_id", "@ALICE"]]);
      assert.equal(form.querySelector("fieldset"), null);
      form = await operate((node) => node.querySelector('input[type="checkbox"]').click());
      assert.equal(form.querySelector("select").value, "bob", "CURRENT keeps the tentative X selection after cancel");
      assert.equal(form.checkValidity(), false, "cancel clears the former profile choice");
      form = await operate((node) => node.querySelector('input[value="keep"]').click());
      form = await operate(choose("alice"));
      assert.equal(form.querySelector("fieldset"), null);
      assert.deepEqual(identityData(form), [["creator_x_user_id", "alice"]]);
      form = await operate(choose("bob"));
      assert.equal(form.checkValidity(), false, "returning to original identity also resets the profile choice");
      assert.equal(new dom.window.FormData(form).has("submitter_profile_action"), false);
    });
  } finally {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("MIG-0714 B02: feedback matches CURRENT result, CTA and blocked-state rendering", async () => {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { JSDOM } = await import("jsdom");
  const ts = await import("typescript");
  const { VideoFormFeedback } = await import("../.test-dist/apps/app/src/components/forms/VideoFormFeedback.js");
  const { Icon } = await import("../.test-dist/apps/app/src/routes/ui/Icon.js");
  const { ErrorCallout } = await import("../.test-dist/apps/app/src/components/ui/ErrorCallout.js");
  const { PublicReflectionDelayNotice } = await import("../.test-dist/apps/app/src/components/ui/PublicReflectionDelayNotice.js");
  const { PUBLIC_REFLECTION_DELAY_MESSAGE } = await import("../.test-dist/apps/app/src/lib/publicReflectionNotice.js");
  const { videoPageHref } = await import("../.test-dist/apps/app/src/lib/youtubeId.js");
  const legacy = readFileSync(new URL("../../../src/components/forms/VideoForm.tsx", import.meta.url), "utf8");
  const start = legacy.indexOf("      {result && !result.ok ? (");
  const end = legacy.indexOf("      </div>\n\n      <aside", start);
  assert.ok(start !== -1 && end > start, "the actual CURRENT feedback block must still exist");
  const fragment = legacy.slice(start, end);
  const css = readFileSync(new URL("../../../src/components/forms/VideoForm.module.css", import.meta.url), "utf8");
  const names = [...new Set([...fragment.matchAll(/styles\.(\w+)/g)].map((match) => match[1]))];
  assert.equal(names.length, 6, "only the six feedback styles belong to this port");
  for (const name of names) assert.match(css, new RegExp(`\\.${name}\\b`));
  const compiled = ts.transpileModule(`function CurrentFeedback({mode,result,submitBlockedReason,noEditableFormSections,permissionSubmitBlockedHint}) { return <>\n${fragment}</>; }`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  // Next Link becomes the approved native anchor; child components already have MIG-0738 parity coverage.
  const Link = (props) => React.createElement("a", props);
  const CurrentFeedback = new Function("React", "Link", "Icon", "ErrorCallout", "PublicReflectionDelayNotice", "videoPageHref", "styles", `${compiled}\nreturn CurrentFeedback;`)(
    React, Link, Icon, ErrorCallout, PublicReflectionDelayNotice, videoPageHref,
    Object.fromEntries(names.map((name) => [name, `vform-${name}`])),
  );
  const cases = [
    { name: "empty", props: {}, text: "", links: [], roles: [] },
    { name: "default failure", props: { result: { ok: false } }, text: "提出に失敗しました。", links: [], roles: ["alert"] },
    { name: "explicit empty failure message", props: { result: { ok: false, message: "" } }, text: "", links: [], roles: [] },
    { name: "terms denial", props: { result: { ok: false, reason: "tos_required", message: "規約の再確認" } }, text: "規約の再確認", links: ["/onboarding?next=%2F"], roles: ["alert"] },
    { name: "free success", props: { result: { ok: true, videoId: "video-a", youtubeVideoId: "dQw4w9WgXcQ", eventId: "event-a", pendingPublicReflection: true } }, text: "提出が完了しました。", links: ["/dQw4w9WgXcQ", "/event/event-a", "/dashboard/edit/video-a"], roles: ["status"], pending: true },
    { name: "slot success without YouTube", props: { mode: "slot", result: { ok: true, videoId: "video-a", eventId: "event-a" } }, text: "YouTube URLが未設定でも作品情報は公開できます。", links: ["/video-a", "/event/event-a", "/dashboard/edit/video-a"], roles: ["status"] },
    { name: "edit success", props: { mode: "edit", result: { ok: true, videoId: "video-a", eventId: "event-a", pendingPublicReflection: true } }, text: "保存しました。", links: ["/video-a", "/event/event-a"], roles: ["status"], pending: true },
    { name: "success without IDs", props: { result: { ok: true } }, text: "提出が完了しました。", links: [], roles: ["status"] },
    { name: "invalid YouTube falls back to internal ID", props: { mode: "edit", result: { ok: true, videoId: "video-a", youtubeVideoId: "//foreign.example/video" } }, text: "保存しました。", links: ["/video-a"], roles: ["status"] },
    { name: "invalid public IDs fall back to list", props: { mode: "edit", result: { ok: true, videoId: "../foreign", youtubeVideoId: "//foreign.example/video" } }, text: "保存しました。", links: ["/list"], roles: ["status"] },
    { name: "blocked wins over permission hint", props: { submitBlockedReason: "一時停止", noEditableFormSections: true, permissionSubmitBlockedHint: "権限モードを選択" }, text: "一時停止", links: [], roles: ["alert"], excluded: "権限モードを選択" },
    { name: "permission hint", props: { noEditableFormSections: true, permissionSubmitBlockedHint: "権限モードを選択" }, text: "権限モードを選択", links: [], roles: ["status"] },
    { name: "editable sections suppress permission hint", props: { permissionSubmitBlockedHint: "権限モードを選択" }, text: "", links: [], roles: [] },
    { name: "failure and blocked notice coexist", props: { result: { ok: false, message: "保存失敗" }, submitBlockedReason: "一時停止" }, text: "保存失敗", links: [], roles: ["alert", "alert"] },
  ];
  for (const scenario of cases) {
    const props = Object.freeze({ mode: "free", result: null, noEditableFormSections: false, permissionSubmitBlockedHint: null, ...scenario.props });
    if (props.result) Object.freeze(props.result);
    const target = renderToStaticMarkup(React.createElement(VideoFormFeedback, props));
    assert.equal(target, renderToStaticMarkup(React.createElement(CurrentFeedback, props)), scenario.name);
    const dom = new JSDOM(`<form><input name="title" value="existing">${target}</form>`);
    try {
      const form = dom.window.document.querySelector("form");
      if (scenario.text === "") assert.equal(target, "", scenario.name);
      else assert.ok(form.textContent.includes(scenario.text), scenario.name);
      assert.deepEqual([...form.querySelectorAll("a")].map((link) => link.getAttribute("href")), scenario.links, scenario.name);
      assert.deepEqual([...form.querySelectorAll("[role]")].map((element) => element.getAttribute("role")), scenario.roles, scenario.name);
      assert.equal(form.textContent.includes(PUBLIC_REFLECTION_DELAY_MESSAGE), Boolean(scenario.pending), scenario.name);
      if (scenario.excluded) assert.equal(form.textContent.includes(scenario.excluded), false, scenario.name);
      assert.deepEqual([...new dom.window.FormData(form)], [["title", "existing"]], "feedback cannot add or alter submitted fields");
      assert.equal(form.querySelector("button"), null, "feedback links cannot implicitly submit the form");
    } finally {
      dom.window.close();
    }
  }
  const targetSource = readFileSync(new URL("../src/components/forms/VideoFormFeedback.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(targetSource, /\bfetch\s*\(|localStorage|indexedDB|from\s+["']next(?:\/|["'])|@\/lib\/actions/);
});
