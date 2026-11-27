// MIG-0714 U02a: actual CURRENT VideoForm action mode to injected SPA FormData parity.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isSectionDisabled, isFieldDisabled, restoreVideoDraftControls, buildVideoDraftControlledState } from "../.test-dist/apps/app/src/components/forms/videoFormDraftFields.js";
import { submitVideoForm } from "../.test-dist/apps/app/src/components/forms/videoSubmitAdapter.js";

test("U02a: CURRENT free/slot/edit maps exactly to injected free/slot/update", async () => {
  const legacy = readFileSync(new URL("../../../src/components/forms/VideoForm.tsx", import.meta.url), "utf8");
  assert.match(legacy, /mode === "slot"\s*\? submitSlotVideo/);
  assert.match(legacy, /mode === "edit"\s*\? updateVideo/);
  assert.match(legacy, /:\s*createFreeVideo;/);
  const data = new FormData();
  for (const [mode, expected] of [["free", "free"], ["slot", "slot"], ["edit", "update"]]) {
    const result = await submitVideoForm(mode, data, async (actualMode, actualData) => {
      assert.equal(actualMode, expected);
      assert.strictEqual(actualData, data);
      return { ok: true, mode: actualMode };
    });
    assert.deepEqual(result, { ok: true, mode: expected });
  }
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
      assert.equal(actualMode, mode === "edit" ? "update" : mode);
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

test("U02b: actual members section forwards search and permission ports unchanged", async () => {
  const { React, target, VideoMembersField } = await videoSectionFixture();
  const defaults = videoSectionDefaults();
  const controller = new AbortController();
  const searchOutput = {
    items: [{ id: "x_A", x_name: "Alice", score: 0.8, matchedBy: "name" }],
    hasMore: true,
    nextOffset: 20,
    hint: null,
  };
  const searchCalls = [];
  const searchXUsers = async (query, offset, signal) => {
    searchCalls.push({ query, offset, signal });
    return searchOutput;
  };
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
  const permissionCalls = [];
  const applyPermissionBatch = async (actual) => {
    permissionCalls.push(actual);
    return denied;
  };
  const findElement = (node, type) => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findElement(child, type);
        if (found) return found;
      }
      return null;
    }
    if (!React.isValidElement(node)) return null;
    if (node.type === type) return node;
    return findElement(node.props.children, type);
  };
  const section = target.members({ ...defaults, searchXUsers, applyPermissionBatch });
  const memberField = findElement(section, VideoMembersField);
  assert.ok(memberField, "the actual VideoFormMembersSection must render VideoMembersField");
  assert.strictEqual(memberField.props.searchXUsers, searchXUsers);
  assert.strictEqual(memberField.props.applyPermissionBatch, applyPermissionBatch);
  assert.ok(!("submit" in memberField.props), "member component cannot invoke the VideoForm submit port");
  const found = await memberField.props.searchXUsers("@Alice", 20, controller.signal);
  assert.strictEqual(found, searchOutput);
  assert.deepEqual(searchCalls, [{ query: "@Alice", offset: 20, signal: controller.signal }]);
  assert.equal(searchCalls[0].signal.aborted, false);
  const outcome = await memberField.props.applyPermissionBatch(input);
  assert.strictEqual(outcome, denied);
  assert.strictEqual(permissionCalls[0], input, "do not clone or strip permission intents");
  assert.equal(input.edit_privilege_mode, "event");
  assert.deepEqual(input.intents.map((item) => item.intent), ["on", "off"]);

  const sentinel = new Error("synthetic backend failure");
  const failedSection = target.members({
    ...defaults,
    searchXUsers: async () => { throw sentinel; },
    applyPermissionBatch: async () => { throw sentinel; },
  });
  const failedField = findElement(failedSection, VideoMembersField);
  await assert.rejects(failedField.props.searchXUsers("x", 0, new AbortController().signal), (error) => error === sentinel);
  await assert.rejects(failedField.props.applyPermissionBatch(input), (error) => error === sentinel);
});

test("MIG-0714 part A: native restoration respects every CURRENT section and field lock", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<form></form>");
  try {
    const form = dom.window.document.querySelector("form");
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
    const controls = new Map();
    for (const [name] of entries) {
      const input = dom.window.document.createElement("input");
      input.name = name;
      input.value = "server";
      form.append(input);
      controls.set(name, input);
    }
    const reset = () => {
      for (const input of controls.values()) input.value = "server";
    };
    for (const [name, section, field] of entries) {
      reset();
      restoreVideoDraftControls(form, { [name]: "draft" }, undefined, undefined);
      assert.equal(controls.get(name).value, "draft", name);
      for (const disabled of Object.keys(groups)) {
        reset();
        restoreVideoDraftControls(form, { [name]: "draft" }, [disabled], []);
        assert.equal(controls.get(name).value, section !== disabled ? "draft" : "server", `${name}: ${disabled}`);
      }
      for (const [, , disabled] of entries) {
        reset();
        restoreVideoDraftControls(form, { [name]: "draft" }, [], [disabled]);
        assert.equal(controls.get(name).value, field !== disabled ? "draft" : "server", `${name}: ${disabled}`);
      }
      reset();
      restoreVideoDraftControls(form, { [name]: "draft" }, Object.keys(groups), [field]);
      assert.equal(controls.get(name).value, "server", name);
    }
  } finally {
    dom.window.close();
  }
});

test("MIG-0714 part A: lock matching is exact and unknown fields retain CURRENT behavior", async () => {
  assert.equal(isSectionDisabled(undefined, "video"), false);
  assert.equal(isFieldDisabled(undefined, "video.title"), false);
  assert.equal(isSectionDisabled(["video"], "video"), true);
  assert.equal(isFieldDisabled(["video.title"], "video.title"), true);
  assert.equal(isFieldDisabled(["VIDEO.TITLE", "video"], "video.title"), false);
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<form><input name='title' value='server'><input name='unknown_field' value='server'></form>");
  try {
    const form = dom.window.document.querySelector("form");
    const title = form.querySelector('[name="title"]');
    const unknown = form.querySelector('[name="unknown_field"]');
    restoreVideoDraftControls(form, { title: "draft", unknown_field: "unknown draft" }, ["VIDEO"], ["title"]);
    assert.equal(title.value, "draft", "unrelated section/field names do not lock a known field");
    assert.equal(unknown.value, "unknown draft", "unknown fields remain governed by the parser/caller");
    title.value = "server";
    restoreVideoDraftControls(form, { title: "draft" }, ["video"], ["video.title"]);
    assert.equal(title.value, "server", "exact section and field locks prevent restoration");
  } finally {
    dom.window.close();
  }
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

function videoSectionDefaults() {
  const ignore = () => {};
  const initial = {
    title: "First Light", music: "Artist - Track", music_reference_url: "https://example.test/music",
    credit: "Credits", intro_comment: "Introduction", highlights: "Highlights", production_story: "Story",
    used_software: "AviUtl", closing_comment: "Thanks", part: "Part A", event_ids: ["event-a"], icon_url: "",
  };
  return {
    mode: "edit", showPermissionUi: false, permissionView: undefined,
    fieldDisabled: () => false, isOptionalFieldRequired: () => false, stepError: null, setDirty: ignore,
    initial, defaultProfile: { display_name: "Default Alice", icon_url: "" },
    submitterDisabled: false, identityPermissionState: "editable", handleReapplyDefaultProfile: ignore,
    isActiveXFixed: false, normalizedActiveXId: "alice", normalizedInitialXId: "alice",
    xIdOptions: [{ id: "alice", x_name: "Alice" }, { id: "bob", x_name: "Bob" }],
    hasSelectableXIds: true, selectedDefault: "alice", disabledSections: [], canChangeSubmitter: false,
    submitterDisplayName: "Alice", setSubmitterDisplayName: ignore, submitterFieldsKey: 0,
    iconCandidates: [], submitterIconUrl: "", setSubmitterIconUrl: ignore, restoredUploadFile: null,
    handleUploadFileChange: ignore, setDraftFileError: ignore, submitterProfileText: "Profile",
    setSubmitterProfileText: ignore, submitterYoutubeChannel: "", setSubmitterYoutubeChannel: ignore,
    channelCandidates: [], submitterSocialLinks: "", setSubmitterSocialLinks: ignore,
    videoSectionDisabled: false, videoPermissionState: "editable", videoSectionPermissions: [],
    eventOptions: [{ id: "event-a", title: "Event A" }, { id: "event-b", title: "Event B" }],
    setTitlePreview: ignore, isWizard: false, isYoutubeUrlRequired: false,
    youtubeUrl: "https://youtu.be/dQw4w9WgXcQ", setYoutubeUrl: ignore, isYoutubeFieldDisabled: false,
    showYoutubeAddBlockedHint: false, youtubeId: "dQw4w9WgXcQ", slotId: undefined,
    selectedEventIds: ["event-a"], canEditEvents: true, setSelectedEventIds: ignore,
    schedulingType: "manual", availableParts: ["Part A", "Part B"], selectedPart: "Part A", setSelectedPart: ignore,
    selectedDescriptionEvent: null, youtubeDescriptionRenderContext: {}, youtubeDescriptionQuestionValues: { dynamicVariables: [] },
    descriptionsDisabled: false, descriptionsPermissionState: "editable", softwareSuggestions: ["AviUtl"],
    selectedStagePermissionFields: [], stageAnswers: {}, setStageAnswers: ignore,
    selectedCustomQuestions: [], customAnswers: {}, setCustomAnswers: ignore,
    membersSectionDisabled: false, membersPermissionState: "editable", membersSectionPermissions: [],
    isCollabFieldDisabled: false, isCollab: true, setIsCollab: ignore, membersFieldsKey: 0,
    members: [
      { name: "Alice", x_user_id: "alice", role: "編集", comment: "A", chapters: [{ time: "0:00", label: "Intro", note: "" }] },
      { name: "Bob", x_user_id: "bob", role: "作画", comment: "B", chapters: [] },
    ],
    memberSuggestions: [], membersListDisabled: false, chaptersFieldDisabled: false, handleMembersChange: ignore,
    videoId: "video-a", searchXUsers: async () => ({ items: [] }), applyPermissionBatch: async () => ({ ok: true }),
    displayNamePreview: "Alice", titlePreview: "First Light", selectedEventLabels: ["Event A"], memberCount: 2,
    incompleteRequiredStageQuestionCount: 0, incompleteRequiredCustomQuestionCount: 0, jumpToWizardStep: ignore,
    showSidePreview: true, sidePreviewTitle: "First Light", sidePreviewName: "Alice",
    youtubePreviewOk: true, youtubePreviewPending: false, youtubePreviewOptional: false,
  };
}

function videoSectionPermissionView(locked) {
  const view = {
    privilegeMode: "normal", ownership: { isOwner: true, isCreatorOwner: true, isCollaboratorOwner: false },
    canOfferAdminMode: true, canOfferEventMode: true,
  };
  for (const key of ["identity", "basics", "youtube", "credits", "descriptions", "members", "memberChapters", "primaryEvent", "visibility", "permissions"]) {
    view[key] = { editable: !locked.includes(key), source: "owner_general", reason: locked.includes(key) ? "owner_policy_denied" : "allowed", label: key };
  }
  return view;
}

async function videoSectionFixture() {
  const React = await import("react");
  const ts = await import("typescript");
  const load = (path) => import(`../.test-dist/apps/app/src/${path}.js`);
  const dependencies = {
    React, Link: (props) => React.createElement("a", props),
    ...await load("routes/ui/Icon"), ...await load("components/permission/PermissionBadge"),
    ...await load("components/permission/FieldLockNote"), ...await load("components/permission/PermissionFieldLabel"),
    ...await load("components/forms/EditSubmitterField"), ...await load("components/forms/VideoIconPicker"),
    ...await load("components/shared/YoutubeChannelPicker"), ...await load("components/shared/SocialLinksEditor"),
    ...await load("components/forms/YoutubeDescriptionPreview"), ...await load("components/forms/CustomQuestionFields"),
    ...await load("components/forms/VideoMembersField"), ...await load("lib/youtubeId"),
    ...await load("lib/permissionUnlockHint"), ...await load("lib/customQuestions"),
    ...await import("@flamenode/domain/video/atomicLimits"),
    isSectionDisabled,
  };
  const legacy = readFileSync(new URL("../../../src/components/forms/VideoForm.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("VideoForm.tsx", legacy, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sections = {};
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(parsed) === "section") {
      const attribute = node.openingElement.attributes.properties.find((item) => item.name?.getText(parsed) === "aria-labelledby");
      const key = attribute?.initializer?.getText(parsed).match(/^"video-form-section-(\w+)-title"$/)?.[1];
      if (key) sections[key] = node;
      if (node.children.some((child) => ts.isJsxElement(child) && child.openingElement.tagName.getText(parsed) === "h2" && child.getText(parsed).includes("確認・送信"))) sections.confirm = node;
    }
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(parsed) === "aside" && node.openingElement.getText(parsed).includes("投稿内容プレビュー")) sections.preview = node;
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  const helperNames = ["cx", "videoFormLockNoteId", "mergeDescribedBy", "customAnswerKey", "customQuestionFieldId", "customAnswerValues", "acceptedCustomAnswerValues", "PreviewCheck"];
  const helpers = helperNames.map((name) => {
    const node = parsed.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
    assert.ok(node, `actual CURRENT helper ${name}`);
    return node.getText(parsed);
  }).join("\n");
  const css = readFileSync(new URL("../../../src/components/forms/VideoForm.module.css", import.meta.url), "utf8");
  dependencies.styles = Object.fromEntries([...new Set([...legacy.matchAll(/styles\.(\w+)/g)].map((match) => match[1]))].map((name) => {
    assert.match(css, new RegExp(`\\.${name}\\b`));
    return [name, `vform-${name}`];
  }));
  const current = {}, target = {};
  const exports = {
    identity: ["VideoFormSubmitterSection", "VideoFormSubmitterSection"],
    video: ["VideoFormBasicsSection", "VideoFormBasicsSection"],
    descriptions: ["VideoFormDescriptionsSection", "VideoFormDescriptionsSection"],
    members: ["VideoFormMembersSection", "VideoFormMembersSection"],
    confirm: ["VideoFormReviewPanels", "VideoFormConfirmationSection"],
    preview: ["VideoFormReviewPanels", "VideoFormSidePreview"],
  };
  for (const [key, [module, name]] of Object.entries(exports)) {
    assert.ok(sections[key], `actual CURRENT ${key} section`);
    let fragment = sections[key].getText(parsed);
    if (key === "descriptions") {
      const start = legacy.indexOf("      {selectedDescriptionEvent ? (", sections.video.end);
      assert.ok(start > sections.video.end);
      fragment = legacy.slice(start, sections.descriptions.end);
    }
    // CURRENT's action-backed child needs the approved two injected ports; all JSX/handlers stay actual source.
    if (key === "members") fragment = fragment.replace("onChange={handleMembersChange}", "onChange={handleMembersChange} searchXUsers={searchXUsers} applyPermissionBatch={applyPermissionBatch}");
    const compiled = ts.transpileModule(`${helpers}\nfunction CurrentSection({${Object.keys(videoSectionDefaults()).join(",")}}) { return <>\n${fragment}\n</>; }`, {
      compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
    current[key] = new Function(...Object.keys(dependencies), `${compiled}\nreturn CurrentSection;`)(...Object.values(dependencies));
    target[key] = (await load(`components/forms/${module}`))[name];
  }
  return { React, current, target, ...dependencies };
}

function videoSectionData(form, window) {
  return [...new window.FormData(form)].map(([key, value]) => [key, typeof value === "string" ? value : { name: value.name, type: value.type, size: value.size }]);
}

test("MIG-0714 B03: four sections preserve actual CURRENT markup, permission states and successful controls", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { JSDOM } = await import("jsdom");
  const { React, current, target, MAX_ATOMIC_VIDEO_EVENTS } = await videoSectionFixture();
  const defaults = videoSectionDefaults();
  const view = videoSectionPermissionView(["identity", "youtube", "credits", "descriptions", "members", "primaryEvent"]);
  const locked = { showPermissionUi: true, permissionView: view, fieldDisabled: () => true };
  const eventOptions = Array.from({ length: MAX_ATOMIC_VIDEO_EVENTS + 1 }, (_, index) => ({ id: `event-${index}`, title: `Event ${index}` }));
  const questions = ["text", "textarea", "select", "radio", "checkbox"].map((type) => ({
    event: defaults.eventOptions[0], question: { id: type, question_key: type, label: type, type, options: ["A", "B"], required: true, placeholder: "Answer", max_length: null },
  }));
  const questionProps = {
    selectedEventIds: ["event-a", "event-b"], selectedCustomQuestions: questions,
    selectedStagePermissionFields: [
      { id: "stage_permission", label: "Rights", required: true, description: "Permission", placeholder: "Granted" },
      { id: "stage_permission_2", label: "Materials", required: false, description: "", placeholder: "Source" },
    ],
    stageAnswers: { stage_permission: "Granted", stage_permission_2: "Original" },
    customAnswers: { "event-a:text": " Text ", "event-a:textarea": " Paragraph ", "event-a:select": "orphan", "event-a:radio": "B", "event-a:checkbox": ["A", "orphan", "B"] },
  };
  const cases = [
    ["identity", {}], ["identity", { mode: "free", isActiveXFixed: true }],
    ["identity", { mode: "slot", isActiveXFixed: true, normalizedActiveXId: "" }],
    ["identity", { canChangeSubmitter: true, stepError: { fieldId: "display_name", step: "submitter", message: "Required" } }],
    ["identity", { ...locked, submitterDisabled: true, identityPermissionState: "locked", disabledSections: ["submitter"] }],
    ["video", {}], ["video", { mode: "free", isWizard: true }],
    ["video", { mode: "slot", slotId: "slot-a", initial: { ...defaults.initial, part: "Fixed slot" } }],
    ["video", { schedulingType: "slotted", initial: { ...defaults.initial, part: null } }],
    ["video", { availableParts: [], eventOptions: [] }],
    ["video", { eventOptions, selectedEventIds: eventOptions.slice(0, -1).map((event) => event.id) }],
    ["video", { ...locked, videoPermissionState: "mixed", videoSectionPermissions: [view.basics, view.youtube], canEditEvents: false, isYoutubeFieldDisabled: true, showYoutubeAddBlockedHint: true, youtubeUrl: "", youtubeId: null }],
    ["video", { isYoutubeUrlRequired: true, stepError: { fieldId: "title", step: "work", message: "Required" }, isOptionalFieldRequired: () => true }],
    ["descriptions", {}], ["descriptions", questionProps],
    ["descriptions", { ...questionProps, ...locked, descriptionsDisabled: true, descriptionsPermissionState: "locked", stepError: { fieldId: "custom_question_stage_permission", step: "work", message: "Required" } }],
    ["descriptions", { ...questionProps, selectedDescriptionEvent: { id: "event-a", title: "Event A", youtube_description_template: "{{title}}" }, youtubeDescriptionRenderContext: { title: "Preview title" }, isOptionalFieldRequired: () => true }],
    ["members", {}], ["members", { isCollab: false }],
    ["members", { isCollabFieldDisabled: true, isCollab: false }],
    ["members", { ...locked, membersSectionDisabled: true, membersPermissionState: "locked", membersSectionPermissions: [view.members], isCollabFieldDisabled: true, membersListDisabled: true, chaptersFieldDisabled: true }],
    ["members", { showPermissionUi: true, permissionView: view, membersPermissionState: "mixed", membersSectionPermissions: [view.members, view.memberChapters], membersListDisabled: true, chaptersFieldDisabled: false }],
  ];
  for (const [key, overrides] of cases) {
    const props = { ...defaults, ...overrides };
    const render = (Component) => renderToStaticMarkup(React.createElement(Component, props));
    const expected = render(current[key]), actual = render(target[key]);
    assert.equal(actual, expected, `${key}: ${JSON.stringify(overrides)}`);
    const dom = new JSDOM(`<form id="current">${expected}</form><form id="target">${actual}</form>`);
    try {
      const [reference, candidate] = dom.window.document.querySelectorAll("form");
      assert.deepEqual(videoSectionData(candidate, dom.window), videoSectionData(reference, dom.window));
      assert.equal(candidate.checkValidity(), reference.checkValidity());
      if (key === "video") {
        const part = candidate.querySelector('[name="part"]');
        assert.ok(part, "part control is present in selectable, hidden and fixed modes");
        assert.equal(new dom.window.FormData(candidate).has("part"), !part.disabled, "CURRENT disabled selects are not successful controls");
        if (props.mode === "slot") assert.equal(candidate.querySelector('.vform-eventOption input').disabled, true);
        if (props.eventOptions === eventOptions) assert.equal(candidate.querySelectorAll('.vform-eventOption input')[MAX_ATOMIC_VIDEO_EVENTS].disabled, true);
      }
      if (key === "descriptions" && props.selectedStagePermissionFields.length) {
        const data = new dom.window.FormData(candidate);
        assert.deepEqual(data.getAll("custom_question_answer_id"), ["stage_permission", "stage_permission_2"]);
        assert.deepEqual(data.getAll("custom_question_answer_value"), ["Granted", "Original"], "readonly stage answers remain successful controls");
        assert.deepEqual(data.getAll("custom_answer:event-a:checkbox"), props.descriptionsDisabled ? [] : ["A", "B"], "orphan options cannot be submitted");
        assert.equal(candidate.querySelector('#custom_answer_event-a_text').maxLength, 200);
        assert.equal(candidate.querySelector('#custom_answer_event-a_textarea').maxLength, 1000);
      }
      if (key === "members") assert.deepEqual(new dom.window.FormData(candidate).getAll("is_collab"), props.isCollabFieldDisabled ? [String(props.isCollab)] : props.isCollab ? ["false", "true"] : ["false"]);
      if (key === "identity" && props.submitterDisabled) {
        const data = new dom.window.FormData(candidate);
        assert.equal(data.has("creator_x_user_id"), false);
        assert.equal(data.get("display_name"), "Alice", "readonly identity text remains in FormData");
      }
    } finally { dom.window.close(); }
  }
  for (const name of ["Submitter", "Basics", "Descriptions", "Members"]) {
    const source = readFileSync(new URL(`../src/components/forms/VideoForm${name}Section.tsx`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(|localStorage|indexedDB|from\s+["']next(?:\/|["'])|@\/lib\/actions/);
  }
});

test("MIG-0714 B03: controlled edits, event selection and real member notifications retain CURRENT payloads", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://fixture.test/" });
  const globals = ["window", "document", "navigator", "HTMLElement", "Node", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? dom.window : dom.window[key] });
  try {
    const { React, current, target, VideoMembersField } = await videoSectionFixture();
    const { createRoot } = await import("react-dom/client");
    const setters = {
      setSubmitterDisplayName: "submitterDisplayName", setSubmitterIconUrl: "submitterIconUrl",
      setSubmitterProfileText: "submitterProfileText", setSubmitterYoutubeChannel: "submitterYoutubeChannel",
      setSubmitterSocialLinks: "submitterSocialLinks", setTitlePreview: "titlePreview", setYoutubeUrl: "youtubeUrl",
      setSelectedEventIds: "selectedEventIds", setSelectedPart: "selectedPart", setStageAnswers: "stageAnswers",
      setCustomAnswers: "customAnswers", setIsCollab: "isCollab", handleMembersChange: "members",
    };
    const typeInto = (element, value) => {
      const prototype = element.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
      element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    };
    const choose = (element, value) => {
      element.value = value;
      element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    };
    const buttonNamed = (form, label) => [...form.querySelectorAll("button")].find((button) => button.textContent.trim() === label);
    async function withPair(key, overrides, inspect) {
      const mounts = [current[key], target[key]].map((Component) => {
        const container = dom.window.document.createElement("div");
        dom.window.document.body.append(container);
        const mount = { container, root: createRoot(container), changes: [] };
        function Host() {
          const [state, setState] = React.useState(() => ({ ...videoSectionDefaults(), ...overrides }));
          const [tick, setTick] = React.useState(0);
          mount.rerender = () => setTick((value) => value + 1);
          // Stable parent callbacks are essential: VideoMembersField notifies from an effect.
          const handlers = React.useMemo(() => ({
            ...Object.fromEntries(Object.entries(setters).map(([name, field]) => [name, (value) => {
              mount.changes.push([name, typeof value === "function" ? "updater" : value]);
              setState((old) => {
                const next = typeof value === "function" ? value(old[field]) : value;
                return Object.is(next, old[field]) ? old : { ...old, [field]: next };
              });
            }])),
            setDirty: (value) => mount.changes.push(["setDirty", value]),
            handleReapplyDefaultProfile: () => mount.changes.push(["reapply"]),
            jumpToWizardStep: (step) => mount.changes.push(["jump", step]),
          }), []);
          return React.createElement("form", { "data-parent-render": tick }, React.createElement(Component, { ...state, ...handlers }));
        }
        mount.Host = Host;
        return mount;
      });
      try {
        await React.act(async () => { for (const mount of mounts) mount.root.render(React.createElement(mount.Host)); });
        const forms = mounts.map((mount) => mount.container.querySelector("form"));
        const data = (form) => new dom.window.FormData(form);
        const parity = () => {
          assert.equal(forms[1].innerHTML, forms[0].innerHTML, `${key} interactive DOM`);
          assert.deepEqual(videoSectionData(forms[1], dom.window), videoSectionData(forms[0], dom.window), `${key} interactive FormData`);
          assert.deepEqual(mounts[1].changes, mounts[0].changes, `${key} parent callbacks and order`);
          return forms[1];
        };
        const operate = async (operation) => {
          await React.act(async () => { for (const form of forms) operation(form); });
          return parity();
        };
        const rerender = async () => {
          await React.act(async () => { for (const mount of mounts) mount.rerender(); });
          return parity();
        };
        await inspect({ parity, operate, rerender, data, changes: mounts[1].changes });
      } finally {
        await React.act(async () => { for (const mount of mounts) mount.root.unmount(); });
        for (const mount of mounts) mount.container.remove();
      }
    }
    await withPair("identity", {}, async ({ parity, operate, data, changes }) => {
      parity();
      let form = await operate((node) => typeInto(node.querySelector('#display_name'), "Changed Alice"));
      assert.equal(data(form).get("display_name"), "Changed Alice");
      assert.ok(changes.some(([name, value]) => name === "setSubmitterDisplayName" && value === "Changed Alice"));
      form = await operate((node) => typeInto(node.querySelector('#profile_text'), "Changed profile"));
      assert.equal(data(form).get("profile_text"), "Changed profile");
      await operate((node) => buttonNamed(node, "現在の既定プロフィールを再適用").click());
      assert.deepEqual(changes.at(-1), ["reapply"], "the parent still owns profile reapplication");
    });
    await withPair("video", {}, async ({ parity, operate, data, changes }) => {
      assert.equal(data(parity()).get("event_ids"), "event-a");
      let form = await operate((node) => node.querySelectorAll('.vform-eventOption input')[1].click());
      assert.equal(data(form).get("event_ids"), "event-a,event-b");
      form = await operate((node) => node.querySelectorAll('.vform-eventOption input')[0].click());
      assert.equal(data(form).get("event_ids"), "event-b");
      form = await operate((node) => choose(node.querySelector('#part'), "Part B"));
      assert.equal(data(form).get("part"), "Part B");
      form = await operate((node) => typeInto(node.querySelector('#title'), "Changed title"));
      assert.equal(data(form).get("title"), "Changed title");
      assert.ok(changes.some(([name, value]) => name === "setTitlePreview" && value === "Changed title"));
      form = await operate((node) => typeInto(node.querySelector('#youtube_url'), ""));
      assert.equal(data(form).get("youtube_url"), "", "the section permits CURRENT privileged clearing when the parent marks YouTube optional");
    });
    await withPair("descriptions", {
      selectedStagePermissionFields: [{ id: "stage_permission", label: "Rights", required: true, description: "", placeholder: "Granted" }],
      stageAnswers: { stage_permission: "Before" },
      selectedCustomQuestions: [{ event: { id: "event-a", title: "Event A" }, question: { id: "choice", question_key: "choice", label: "Choice", type: "checkbox", options: ["A", "B"], required: true } }],
      customAnswers: { "event-a:choice": ["A", "orphan"] },
    }, async ({ parity, operate, data, changes }) => {
      assert.deepEqual(data(parity()).getAll("custom_answer:event-a:choice"), ["A"]);
      let form = await operate((node) => typeInto(node.querySelector('#custom_question_stage_permission'), "After"));
      assert.deepEqual(data(form).getAll("custom_question_answer_id"), ["stage_permission"]);
      assert.deepEqual(data(form).getAll("custom_question_answer_value"), ["After"]);
      form = await operate((node) => node.querySelector('#custom_answer_event-a_choice_1').click());
      assert.deepEqual(data(form).getAll("custom_answer:event-a:choice"), ["A", "B"]);
      form = await operate((node) => node.querySelector('#custom_answer_event-a_choice').click());
      assert.deepEqual(data(form).getAll("custom_answer:event-a:choice"), ["B"]);
      assert.ok(changes.filter(([name]) => name === "setDirty").length >= 3);
    });
    await withPair("members", {}, async ({ parity, operate, rerender, data, changes }) => {
      const members = (form) => JSON.parse(data(form).get("members_json"));
      const latest = () => changes.filter(([name]) => name === "handleMembersChange").at(-1)[1];
      assert.deepEqual(members(parity()).map((member) => member.x_user_id), ["alice", "bob"]);
      const count = changes.length;
      await rerender();
      assert.equal(changes.length, count, "ordinary parent renders must not recreate the member change callback/effect");
      let form = await operate((node) => node.querySelector('[aria-label="2人目を上へ移動"]').click());
      assert.deepEqual(members(form).map((member) => member.x_user_id), ["bob", "alice"]);
      assert.deepEqual(latest(), members(form), "reorder is observable even without a native input event");
      form = await operate((node) => node.querySelector('[aria-label="1人目を削除"]').click());
      assert.deepEqual(members(form).map((member) => member.x_user_id), ["alice"]);
      form = await operate((node) => buttonNamed(node, "行を追加").click());
      assert.equal(form.querySelectorAll('input[placeholder="表示名"]').length, 2);
      assert.equal(members(form).length, 1, "blank rows are excluded");
      form = await operate((node) => typeInto(node.querySelectorAll('input[placeholder="表示名"]')[1], "Cara"));
      assert.deepEqual(members(form).map((member) => member.name), ["Alice", "Cara"]);
      assert.deepEqual(latest(), members(form), "added/edited member payload reaches the same parent callback");
      form = await operate((node) => node.querySelector('input[name="is_collab"][type="checkbox"]').click());
      assert.deepEqual(data(form).getAll("is_collab"), ["false"]);
      assert.equal(data(form).has("members_json"), false);
    });
    await withPair("confirm", {}, async ({ parity, operate, changes, data }) => {
      assert.deepEqual([...data(parity())], [], "review adds no native fields");
      for (let index = 0; index < 3; index++) {
        await operate((node) => {
          const button = node.querySelectorAll("button")[index];
          assert.equal(button.type, "button", "repair never implicitly submits");
          button.click();
        });
      }
      assert.deepEqual(changes, [["jump", "submitter"], ["jump", "work"], ["jump", "youtube"]]);
    });
    const props = videoSectionDefaults();
    let memberElement;
    function findMember(node) {
      if (!React.isValidElement(node)) return;
      if (node.type === VideoMembersField) memberElement = node;
      React.Children.forEach(node.props.children, findMember);
    }
    findMember(target.members(props));
    assert.ok(memberElement);
    assert.strictEqual(memberElement.props.onChange, props.handleMembersChange);
    assert.strictEqual(memberElement.props.searchXUsers, props.searchXUsers);
    assert.strictEqual(memberElement.props.applyPermissionBatch, props.applyPermissionBatch);
    assert.equal(memberElement.props.permissionTargetVideoId, "video-a");
  } finally {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("MIG-0714 B03R: confirmation and side preview preserve CURRENT summaries, checklists and native form fields", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { JSDOM } = await import("jsdom");
  const { React, current, target } = await videoSectionFixture();
  const defaults = videoSectionDefaults();
  const question = { id: "choice", question_key: "choice", label: "Choice", type: "checkbox", options: ["A", "B"], required: true };
  const scenarios = [
    {},
    { mode: "free", youtubeId: null, normalizedActiveXId: "", normalizedInitialXId: "", displayNamePreview: " ", titlePreview: " ", selectedEventLabels: [], isCollab: false, memberCount: 0, youtubePreviewOk: false },
    { mode: "slot", youtubeId: null, memberCount: 0, incompleteRequiredStageQuestionCount: 2, incompleteRequiredCustomQuestionCount: 1, youtubePreviewOk: false, youtubePreviewPending: true, youtubePreviewOptional: true, selectedStagePermissionFields: [{ id: "rights" }], selectedCustomQuestions: [{ event: defaults.eventOptions[0], question }] },
    { selectedEventLabels: ["A", "B", "C", "D", "E"], selectedEventIds: ["event-a", "event-b"], selectedCustomQuestions: [{ event: defaults.eventOptions[0], question }], customAnswers: { "event-a:choice": ["A", "orphan", "B"] }, selectedStagePermissionFields: [{ id: "rights" }], youtubePreviewOk: true, youtubePreviewPending: true },
    { isWizard: true, showSidePreview: false },
    { isWizard: true, showSidePreview: true },
    { isWizard: false, showSidePreview: false },
  ];
  for (const overrides of scenarios) {
    const props = { ...defaults, ...overrides };
    for (const key of ["confirm", "preview"]) {
      const actual = renderToStaticMarkup(React.createElement(target[key], props));
      assert.equal(actual, renderToStaticMarkup(React.createElement(current[key], props)), `${key}: ${JSON.stringify(overrides)}`);
      const dom = new JSDOM(`<form><input name="keep" value="first"><input name="keep" value="second">${actual}</form>`);
      try {
        const form = dom.window.document.querySelector("form");
        assert.deepEqual([...new dom.window.FormData(form)], [["keep", "first"], ["keep", "second"]]);
        assert.doesNotMatch(form.textContent, /orphan/);
        if (key === "confirm") {
          assert.equal(form.querySelectorAll('button[type="button"]').length, 3);
          assert.equal(form.querySelector('[type="submit"]'), null);
          if (props.mode === "slot" && !props.youtubeId) assert.match(form.textContent, /未入力（後から追加可）/);
          if (props.selectedEventIds.length > 1) {
            assert.match(form.textContent, /Event A: Choice \*/);
            assert.match(form.textContent, /A、B/);
          }
        } else {
          const aside = form.querySelector('aside[aria-label="投稿内容プレビュー"]');
          assert.equal(aside.hidden, props.isWizard && !props.showSidePreview);
          assert.equal(form.querySelectorAll('button,input:not([name="keep"])').length, 0);
          assert.equal(aside.querySelectorAll('.vform-previewChecklist > div').length, props.selectedCustomQuestions.length ? 6 : 5);
          if (props.selectedEventLabels.length > 3) {
            assert.deepEqual([...aside.querySelectorAll('.vform-previewEvents span')].map((node) => node.textContent), ["events", "A", "B", "C", "ほか 2 件"]);
          }
          const youtubeCheck = aside.querySelector('.vform-previewChecklist > div');
          assert.equal(youtubeCheck.className, props.youtubePreviewOk ? "vform-checkOk" : props.youtubePreviewPending ? "vform-checkPending" : "vform-checkTodo");
        }
      } finally { dom.window.close(); }
    }
  }
  const source = readFileSync(new URL("../src/components/forms/VideoFormReviewPanels.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(|localStorage|indexedDB|from\s+["']next(?:\/|["'])|@\/lib\/actions/);
});

test("MIG-0714 B04: complete form preserves all-mode native controls, hidden wizard fields and repeated event answers", async () => {
  const React = await import("react"), { renderToStaticMarkup } = await import("react-dom/server");
  const { MemoryRouter } = await import("react-router-dom"), { JSDOM } = await import("jsdom");
  const { VideoForm } = await import("../.test-dist/apps/app/src/components/forms/VideoForm.js");
  const members = videoSectionDefaults().members;
  const question = { id: "choice", question_key: "choice", label: "Choice", type: "checkbox", options: ["A", "B"], required: false };
  const events = ["event-a", "event-b"].map(id => ({ id, title: id, parts_json: '["Part A"]', custom_questions: [question], video_form_settings_json: '{"stage_permission_fields":[{"id":"rights","label":"Rights","required":false}]}' }));
  for (const mode of ["free", "slot", "edit"]) {
    const initial = { display_name: "Alice", creator_x_user_id: "alice", title: "Native title", youtube_url: "https://youtu.be/dQw4w9WgXcQ", updated_at: 42,
      intro_comment: "Native introduction", is_collab: true, members, event_ids: events.map(event => event.id), part: "Part A",
      custom_answers: { "event-a:choice": ["A", "B", "orphan"], "event-b:choice": ["B"] } };
    const markup = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(VideoForm, {
      mode, initial, activeXId: "@ALICE", activeXSnapshot: "@Snapshot", eventOptions: events,
      slotId: mode === "slot" ? "slot-1" : undefined, videoId: mode === "edit" ? "video-1" : undefined, editPrivilegeMode: "admin",
      submit: async () => assert.fail("render does not submit"), onRefresh: () => assert.fail("render does not refresh"),
      searchXUsers: async () => assert.fail("render does not search"), applyPermissionBatch: async () => assert.fail("render does not change permissions"),
    })));
    const dom = new JSDOM(markup);
    try {
      const form = dom.window.document.querySelector("form"), data = new dom.window.FormData(form);
      assert.equal(dom.window.document.querySelectorAll("form").length, 1);
      assert.equal(form.noValidate, mode !== "edit"); assert.equal(form.querySelectorAll("[hidden].vform-stepPanel").length, mode === "edit" ? 0 : 3);
      assert.equal(data.get("title"), initial.title); assert.equal(data.get("intro_comment"), initial.intro_comment);
      assert.equal(data.get("event_ids"), "event-a,event-b"); assert.equal(data.get("part"), "Part A");
      assert.deepEqual(JSON.parse(data.get("members_json")), members); assert.deepEqual(data.getAll("is_collab"), ["false", "true"]);
      assert.deepEqual(data.getAll("custom_answer:event-a:choice"), ["A", "B"]); assert.deepEqual(data.getAll("custom_answer:event-b:choice"), ["B"]);
      assert.equal(data.get("active_x_snapshot"), mode === "edit" ? null : "snapshot");
      assert.equal(data.get("revision"), mode === "edit" ? "42" : null);
      assert.equal(data.get("edit_privilege_mode"), mode === "edit" ? "admin" : null);
      assert.equal(data.get("slot_id"), mode === "slot" ? "slot-1" : null); assert.equal(data.get("video_id"), mode === "edit" ? "video-1" : null);
    } finally { dom.window.close(); }
  }
});
