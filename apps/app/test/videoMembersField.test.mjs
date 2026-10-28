// MIG-0713 U02: the field port may render/edit entirely in-browser, without direct fetch/Server Actions.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

// React DOM must be imported AFTER jsdom globals are installed: otherwise
// its event plugin detects a non-DOM environment and controlled onChange
// input/textarea events cannot update component state in this Node test.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://flamenode.test/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { renderToStaticMarkup } = await import("react-dom/server");
const { VideoMembersField } = await import("../.test-dist/apps/app/src/components/forms/VideoMembersField.js");

const noopAdapters = {
  searchXUsers: async () => ({ items: [], hasMore: false, nextOffset: null }),
  applyPermissionBatch: async () => ({ ok: false, message: "not authorized" }),
};
const alice = { name: "Alice", x_user_id: "alice", role: "映像", comment: "", chapters: [] };

test("MIG-0713 U02: empty field is network-free and serializes no blank member into members_json", () => {
  const markup = renderToStaticMarkup(React.createElement(VideoMembersField, { ...noopAdapters }));
  assert.match(markup, /name="members_json"/);
  assert.match(markup, /value="\[\]"/);
  assert.match(markup, /メンバー編集の表示モード/);
  assert.match(markup, /vmembers-root/);
  assert.match(markup, /候補から|活動名/);
});

test("MIG-0713 U02: initial rows preserve the CURRENT form data and option display", () => {
  const markup = renderToStaticMarkup(React.createElement(VideoMembersField, {
    ...noopAdapters,
    initialMembers: [alice],
    collabPermsHref: "/dashboard/edit/vid1/permissions",
  }));
  assert.match(markup, /Alice/);
  assert.match(markup, /alice/);
  assert.match(markup, /編集できる人を設定/);
  assert.match(markup, /dashboard\/edit\/vid1\/permissions/);
  assert.match(markup, /name="members_json"/);
});

test("MIG-0713 U02: table/card switching preserves serialized hidden rows", async () => {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  const props = { ...noopAdapters, initialMembers: [alice] };
  try {
    await act(async () => root.render(React.createElement(VideoMembersField, props)));
    const original = container.querySelector('input[name="members_json"]').value;
    assert.match(original, /Alice/);
    const tableButton = [...container.querySelectorAll("button")].find(x => x.textContent.trim() === "表");
    assert.ok(tableButton);
    await act(async () => tableButton.click());
    assert.equal(tableButton.getAttribute("aria-pressed"), "true");
    assert.equal(container.querySelector('input[name="members_json"]').value, original);
    const cardButton = [...container.querySelectorAll("button")].find(x => x.textContent.trim() === "カード");
    await act(async () => cardButton.click());
    assert.equal(container.querySelector('input[name="members_json"]').value, original);
  } finally { await act(async () => root.unmount()); }
});

test("MIG-0713 U03: onChange stays synchronized with member order, edits, additions and members_json", async () => {
  const changes = [];
  const initial = [
    alice,
    { name: "Bob", x_user_id: "bob", role: "作画", comment: "", chapters: [] },
  ];
  const onChange = (members) => {
    changes.push(members.map((member) => ({
      name: member.name, x_user_id: member.x_user_id, role: member.role,
    })));
  };
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  const ids = () => JSON.parse(container.querySelector('input[name="members_json"]').value)
    .map((member) => member.x_user_id);
  const lastIds = () => changes.at(-1).map((member) => member.x_user_id);
  try {
    await act(async () => root.render(React.createElement(VideoMembersField, {
      ...noopAdapters, initialMembers: initial, onChange,
    })));
    assert.deepEqual(ids(), ["alice", "bob"]);
    assert.deepEqual(lastIds(), ["alice", "bob"]);
    await act(async () => container.querySelector('[aria-label="2人目を上へ移動"]').click());
    assert.deepEqual(ids(), ["bob", "alice"], "reordering updates the hidden payload");
    assert.deepEqual(lastIds(), ids(), "reordering notifies the parent");
    await act(async () => container.querySelector('[aria-label="1人目を削除"]').click());
    assert.deepEqual(ids(), ["alice"], "removing a row updates the hidden payload");
    assert.deepEqual(lastIds(), ids(), "removing a row notifies the parent");
    const role = container.querySelector('input[placeholder="作画 / 編集 / 音響など"]');
    assert.ok(role);
    await act(async () => typeInto(role, "編集"));
    assert.equal(changes.at(-1)[0].role, "編集");
    assert.equal(JSON.parse(container.querySelector('input[name="members_json"]').value)[0].role, "編集");

    await act(async () => buttonNamed(container, "行を追加").click());
    assert.deepEqual(ids(), ["alice"], "blank rows are excluded from member serialization");
    const names = container.querySelectorAll('input[placeholder="表示名"]');
    assert.equal(names.length, 2, "the form exposes the added blank row");
    await act(async () => typeInto(names[1], "Cara"));
    assert.deepEqual(ids(), ["alice", ""], "a name-only member is kept with an empty X ID");
    assert.deepEqual(lastIds(), ids(), "adding and editing rows notifies the parent");
    assert.equal(changes.at(-1)[1].name, "Cara");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("MIG-0713 U03: unique creator name populates X ID on blur, but ambiguous names never resolve", async () => {
  for (const { suggestions, shouldFill } of [
    { suggestions: [{ name: "Alice", x_user_id: "alice" }], shouldFill: "alice" },
    { suggestions: [
      { name: "Alice", x_user_id: "alice_one" },
      { name: "Alice", x_user_id: "alice_two" },
    ], shouldFill: "" },
  ]) {
    const container = dom.window.document.createElement("div");
    dom.window.document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(React.createElement(VideoMembersField, {
        ...noopAdapters, suggestions,
      })));
      const nameInput = container.querySelector('input[placeholder="表示名"]');
      assert.ok(nameInput);
      await act(async () => {
        typeInto(nameInput, "Alice");
        nameInput.dispatchEvent(new dom.window.FocusEvent("focusout", { bubbles: true }));
      });
      const members = JSON.parse(container.querySelector('input[name="members_json"]').value);
      assert.equal(members.length, 1);
      assert.equal(members[0].name, "Alice");
      assert.equal(members[0].x_user_id, shouldFill,
        "only an unambiguous creator name may auto-assign an X account");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  }
});

test("MIG-0713 U03: matching an X ID on blur fills name and canonicalizes the handle", async () => {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(VideoMembersField, {
      ...noopAdapters, suggestions: [{ name: "Bob", x_user_id: "bob" }],
    })));
    const xidInput = container.querySelector('input[placeholder="@なし"]');
    assert.ok(xidInput);
    await act(async () => {
      typeInto(xidInput, "@BoB");
      xidInput.dispatchEvent(new dom.window.FocusEvent("focusout", { bubbles: true }));
    });
    const members = JSON.parse(container.querySelector('input[name="members_json"]').value);
    assert.equal(members.length, 1);
    assert.equal(members[0].x_user_id, "bob");
    assert.equal(members[0].name, "Bob", "a known X handle suggests the matching display name");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("MIG-0713 U02: component has injected search/permission adapters, never directly fetches or invokes a Server Action", async () => {
  const source = await readFile(new URL("../src/components/forms/VideoMembersField.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\bapplyVideoCollaboratorPermissionsBatch\s*\(/);
  assert.match(source, /await searchXUsers\(/);
  assert.match(source, /await applyPermissionBatch\(/);
  assert.match(source, /MAX_COLLABORATOR_PERMISSION_BATCH/);
  assert.doesNotMatch(source, /from\s+["'](?:@\/|next\/)/);
});


/** React's controlled input requires the native value setter before a bubbling input event. */
function typeInto(input, value) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
  assert.ok(setter, "native input value setter");
  setter.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

test("MIG-0713 U03: each vmembers class used by the form is defined in ported CSS", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("../src/components/forms/VideoMembersField.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/video-members.css", import.meta.url), "utf8"),
  ]);
  const used = new Set([...component.matchAll(/\bvmembers-[A-Za-z][\w-]*/g)].map((m) => m[0]));
  const defined = new Set([...css.matchAll(/\.vmembers-[A-Za-z][\w-]*/g)].map((m) => m[0].slice(1)));
  assert.ok(used.size > 10, "the member-form CSS scope must be represented");
  assert.deepEqual([...used].filter((name) => !defined.has(name)), [],
    "ported form classes must have a stylesheet definition");
  assert.deepEqual([...defined].filter((name) => !used.has(name)), [],
    "generated member classes should match the migrated form");
  assert.match(css, /\.vmembers-sampleTableScroll\s*\{[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;/s,
    "on mobile, wide TSV tables must scroll inside the form instead of overflowing the viewport");
  assert.match(css, /\.vmembers-sampleTable\s*\{[^}]*min-width:\s*620px;/s,
    "CURRENT table width is preserved inside the scrollable wrapper");
});

test("MIG-0713 U03 T01: search debounce invokes only the last query, preserves 250ms and aborts on unmount", async () => {
  const calls = [];
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(VideoMembersField, {
      ...noopAdapters,
      searchXUsers: async (query, offset, signal) => {
        calls.push({ query, offset, signal });
        return { items: [{ id: "alice", x_name: "Alice" }], hasMore: false, nextOffset: null };
      },
    })));
    const input = container.querySelector('input[placeholder="表示名"]');
    assert.ok(input, "name field is present");
    await act(async () => typeInto(input, "al"));
    await act(async () => typeInto(input, "ali"));
    await act(async () => typeInto(input, "alice"));
    assert.equal(calls.length, 0, "no search before debounce");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 320)); });
    assert.equal(calls.length, 1, "intermediate queries must be cancelled");
    assert.equal(calls[0].query, "alice");
    assert.equal(calls[0].offset, 0);
    assert.equal(calls[0].signal.aborted, false);
    await act(async () => root.unmount());
    assert.equal(calls[0].signal.aborted, true, "unmount aborts in-flight search signal");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});


test("MIG-0713 U03 T01: equivalent parent adapter re-render preserves in-flight search", async () => {
  const calls = [];
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  let settleSearch;
  const newAdapter = () => (query, offset, signal) => {
    calls.push({ query, offset, signal });
    // Keep the first request pending across the parent render.
    return new Promise((resolve) => { settleSearch = resolve; });
  };
  const props = { ...noopAdapters, searchXUsers: newAdapter() };
  try {
    await act(async () => root.render(React.createElement(VideoMembersField, props)));
    const input = container.querySelector('input[placeholder="表示名"]');
    assert.ok(input);
    await act(async () => typeInto(input, "alice"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 320)); });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].signal.aborted, false);
    await act(async () => root.render(React.createElement(VideoMembersField, {
      ...props,
      searchXUsers: newAdapter(),
    })));
    assert.equal(calls[0].signal.aborted, false, "parent rerender must not abort an in-flight search");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 320)); });
    assert.equal(calls.length, 1, "the unchanged query must not trigger another request");
    await act(async () => settleSearch({
      items: [{ id: "alice", x_name: "Alice" }], hasMore: false, nextOffset: null,
    }));
    assert.ok(container.querySelector('#member-name-suggestions option[value="Alice"]'), "the original request can still render a suggestion");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("MIG-0713 U03 T01: pending debounce uses the latest injected search adapter", async () => {
  const oldCalls = [];
  const newCalls = [];
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  const props = {
    ...noopAdapters,
    searchXUsers: async (...args) => {
      oldCalls.push(args);
      return { items: [], hasMore: false, nextOffset: null };
    },
  };
  try {
    await act(async () => root.render(React.createElement(VideoMembersField, props)));
    const input = container.querySelector('input[placeholder="表示名"]');
    assert.ok(input);
    await act(async () => typeInto(input, "alice"));
    await act(async () => root.render(React.createElement(VideoMembersField, {
      ...props,
      searchXUsers: async (...args) => {
        newCalls.push(args);
        return { items: [], hasMore: false, nextOffset: null };
      },
    })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 320)); });
    assert.equal(oldCalls.length, 0, "stale adapter must never run after the parent updates it");
    assert.equal(newCalls.length, 1, "the same query is sent only once");
    assert.equal(newCalls[0][0], "alice");
    assert.equal(newCalls[0][1], 0);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("MIG-0713 U03 T01: stale X search response never overwrites newer results", async () => {
  const requests = [];
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(VideoMembersField, {
      ...noopAdapters,
      searchXUsers: (query, offset, signal) => new Promise((resolve) => {
        requests.push({ query, offset, signal, resolve });
      }),
    })));
    const input = container.querySelector('input[placeholder="表示名"]');
    assert.ok(input);
    await act(async () => typeInto(input, "alice"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 320)); });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].query, "alice");

    await act(async () => typeInto(input, "bob"));
    assert.equal(requests[0].signal.aborted, true, "the superseded search is aborted");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 320)); });
    assert.equal(requests.length, 2);
    assert.equal(requests[1].query, "bob");
    await act(async () => requests[1].resolve({
      items: [{ id: "bob", x_name: "Bob" }], hasMore: false, nextOffset: null,
    }));

    const names = () => [...container.querySelectorAll("#member-name-suggestions option")]
      .map((node) => node.value);
    assert.deepEqual(names(), ["Bob"], "new query results are visible");
    await act(async () => requests[0].resolve({
      items: [{ id: "alice", x_name: "Alice" }], hasMore: false, nextOffset: null,
    }));
    assert.deepEqual(names(), ["Bob"], "late results for the aborted query are ignored");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("MIG-0713 U03: paginated X suggestions preserve prior results and dedupe canonical handles", async () => {
  const offsets = [];
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(VideoMembersField, {
      ...noopAdapters,
      searchXUsers: async (query, offset, signal) => {
        offsets.push({ query, offset, signal });
        return offset === 0
          ? { items: [{ id: "alice", x_name: "Alice" }], hasMore: true, nextOffset: 20 }
          : { items: [
              { id: "ALICE", x_name: "Alice Updated" },
              { id: "bob", x_name: "Bob" },
            ], hasMore: false, nextOffset: null };
      },
    })));
    const input = container.querySelector('input[placeholder="表示名"]');
    assert.ok(input);
    await act(async () => typeInto(input, "alice"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 320)); });
    assert.deepEqual(offsets.map((call) => call.offset), [0]);
    assert.equal(offsets[0].query, "alice");
    const more = buttonNamed(container, "候補をさらに読み込む");
    await act(async () => more.click());
    assert.deepEqual(offsets.map((call) => call.offset), [0, 20]);
    assert.equal(offsets[1].query, "alice");
    assert.equal(offsets[1].signal.aborted, false);
    const names = [...container.querySelectorAll("#member-name-suggestions option")]
      .map((node) => node.value);
    assert.equal(names.length, 2, "the two page responses dedupe the case-insensitive X handle");
    assert.ok(names.includes("Alice Updated"), "the later page wins for duplicate handles");
    assert.ok(names.includes("Bob"), "the first page is retained when loading more");
    assert.ok(!container.textContent.includes("候補をさらに読み込む"), "no further page after hasMore:false");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("MIG-0713 U03: rejected X search reports failure and recovers on next input", async () => {
  const queries = [];
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(VideoMembersField, {
      ...noopAdapters,
      searchXUsers: async (query) => {
        queries.push(query);
        if (query === "error") throw new Error("backend unavailable");
        return { items: [{ id: "alice", x_name: "Alice" }], hasMore: false, nextOffset: null };
      },
    })));
    const input = container.querySelector('input[placeholder="表示名"]');
    assert.ok(input);
    await act(async () => typeInto(input, "error"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 320)); });
    assert.match(container.textContent, /候補の取得に失敗しました。少し待って再入力してください。/);
    await act(async () => typeInto(input, "alice"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 320)); });
    assert.deepEqual(queries, ["error", "alice"]);
    const names = [...container.querySelectorAll("#member-name-suggestions option")]
      .map((node) => node.value);
    assert.deepEqual(names, ["Alice"], "success after failure renders the new suggestions");
    assert.doesNotMatch(container.textContent, /候補の取得に失敗しました。/);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("MIG-0713 U03: disabling the form aborts an in-flight search and ignores late results", async () => {
  let resolveSearch;
  const calls = [];
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  const props = {
    ...noopAdapters,
    searchXUsers: (query, offset, signal) => new Promise((resolve) => {
      calls.push({ query, offset, signal });
      resolveSearch = resolve;
    }),
  };
  try {
    await act(async () => root.render(React.createElement(VideoMembersField, props)));
    const input = container.querySelector('input[placeholder="表示名"]');
    assert.ok(input);
    await act(async () => typeInto(input, "alice"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 320)); });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].signal.aborted, false);
    await act(async () => root.render(React.createElement(VideoMembersField, {
      ...props,
      disabled: true,
    })));
    assert.equal(calls[0].signal.aborted, true, "disabled form must cancel its active search");
    await act(async () => resolveSearch({
      items: [{ id: "alice", x_name: "Alice" }], hasMore: true, nextOffset: 20,
    }));
    assert.equal(container.querySelectorAll("#member-name-suggestions option").length, 0);
    assert.equal(container.querySelectorAll("#member-xid-suggestions option").length, 0);
    assert.equal([...container.querySelectorAll("button")]
      .some((button) => button.textContent.trim() === "候補をさらに読み込む"), false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("MIG-0713 U03 T01: fewer than two searchable characters never call the search adapter", async () => {
  const calls = [];
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(VideoMembersField, {
      ...noopAdapters,
      searchXUsers: async (...args) => {
        calls.push(args);
        return { items: [], hasMore: false, nextOffset: null };
      },
    })));
    const input = container.querySelector('input[placeholder="表示名"]');
    assert.ok(input);
    await act(async () => typeInto(input, "@"));
    await act(async () => typeInto(input, "@a"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    assert.equal(calls.length, 0, "punctuation is excluded from the search length");
  } finally {
    await act(async () => root.unmount());
  }
});


function buttonNamed(container, label) {
  const button = [...container.querySelectorAll("button")]
    .find((node) => node.textContent.trim() === label);
  assert.ok(button, "button " + label + " is present");
  return button;
}

async function previewTsv(container, data) {
  const textarea = container.querySelector("#members-tsv-input");
  assert.ok(textarea);
  await act(async () => typeInto(textarea, data));
  await act(async () => buttonNamed(container, "内容を確認").click());
}

test("MIG-0713 U03 T02: 100 TSV members are previewed but 101 fail closed without partial import", async () => {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  const tsv = (count) => Array.from({ length: count }, (_, i) => "Name" + i + "\tx" + i + "\t\t\t\tON").join("\n");
  try {
    await act(async () => root.render(React.createElement(VideoMembersField, { ...noopAdapters })));
    await previewTsv(container, tsv(100));
    assert.match(container.textContent, /確認（100行）/);
    assert.equal(container.querySelectorAll(".vmembers-bulkPreviewTable tbody tr").length, 100);
    await previewTsv(container, tsv(101));
    assert.match(container.textContent, /最大100人/);
    assert.match(container.textContent, /確認（0行）/);
    assert.equal(buttonNamed(container, "追加").disabled, true);
    assert.equal(container.querySelector('input[name="members_json"]').value, "[]", "no implicit partial import");
  } finally {
    await act(async () => root.unmount());
  }
});

test("MIG-0713 U03 T03: a new video imports member TSV without writing edit permissions", async () => {
  const permissionCalls = [];
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(VideoMembersField, {
      ...noopAdapters,
      applyPermissionBatch: async (input) => {
        permissionCalls.push(input);
        return { ok: true };
      },
    })));
    assert.match(container.textContent, /この画面ではメンバー情報だけ取り込みます/);
    await previewTsv(container, "Alice\talice\t\t映像\t\tON");
    assert.match(container.textContent, /確認（1行）/);
    await act(async () => buttonNamed(container, "追加").click());
    assert.equal(container.querySelector('[role="alertdialog"]'), null,
      "new videos must not prompt for a permission write without a video ID");
    assert.deepEqual(permissionCalls, [], "permission adapter must not run on create");
    const members = JSON.parse(container.querySelector('input[name="members_json"]').value);
    assert.equal(members.length, 1);
    assert.equal(members[0].name, "Alice");
    assert.equal(members[0].x_user_id, "alice");
    assert.equal(Object.hasOwn(members[0], "can_edit"), false,
      "the TSV privilege must not be included in members_json");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("MIG-0713 U03 T03: permission intents use one injected batch of at most 100, never a direct Server Action", async () => {
  const calls = [];
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  const rows = Array.from({ length: 100 }, (_, i) => "Name" + i + "\tx" + i + "\t\t\t\t" + (i % 2 ? "OFF" : "ON")).join("\n");
  try {
    await act(async () => root.render(React.createElement(VideoMembersField, {
      ...noopAdapters,
      permissionTargetVideoId: "vid1",
      applyPermissionBatch: async (input) => {
        calls.push(input);
        return { ok: true };
      },
    })));
    await previewTsv(container, rows);
    await act(async () => buttonNamed(container, "追加").click());
    assert.match(container.querySelector('[role="alertdialog"]').textContent, /以下の編集権限を変更します/);
    await act(async () => buttonNamed(container, "変更を反映").click());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].videoId, "vid1");
    assert.equal(calls[0].notify, true);
    assert.equal(Object.hasOwn(calls[0], "edit_privilege_mode"), false, "normal mode leaves permission scope to the server");
    assert.equal(calls[0].intents.length, 100);
    assert.deepEqual(calls[0].intents[0], { x_user_id: "x0", display_name: "Name0", intent: "on" });
    assert.deepEqual(calls[0].intents[1], { x_user_id: "x1", display_name: "Name1", intent: "off" });
    assert.equal(JSON.parse(container.querySelector('input[name="members_json"]').value).length, 100);
  } finally {
    await act(async () => root.unmount());
  }
});

test("MIG-0713 U03 T03: privileged event replace requires confirmation and keeps permission flags out of members_json", async () => {
  const previousUrl = dom.window.location.href;
  dom.window.history.replaceState({}, "", "/dashboard/edit/vid1?privileged=event");
  const calls = [];
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(VideoMembersField, {
      ...noopAdapters,
      initialMembers: [alice],
      permissionTargetVideoId: "vid1",
      applyPermissionBatch: async (input) => {
        calls.push(input);
        return { ok: true, message: "saved" };
      },
    })));
    const hidden = () => JSON.parse(container.querySelector('input[name="members_json"]').value);
    assert.equal(hidden()[0].x_user_id, "alice");
    await previewTsv(container, "Bob\tbob\t\t\t\tON");
    await act(async () => buttonNamed(container, "現在のメンバーを置き換え").click());
    assert.match(container.querySelector('[role="alertdialog"]').textContent, /現在のメンバーを置き換えますか/);
    assert.equal(calls.length, 0);
    assert.equal(hidden()[0].x_user_id, "alice", "preview does not write member data");

    await act(async () => buttonNamed(container, "キャンセル").click());
    assert.equal(container.querySelector('[role="alertdialog"]'), null);
    assert.equal(hidden()[0].x_user_id, "alice", "cancel preserves existing data");
    await act(async () => buttonNamed(container, "現在のメンバーを置き換え").click());
    await act(async () => buttonNamed(container, "置き換える").click());
    assert.match(container.querySelector('[role="alertdialog"]').textContent, /以下の編集権限を変更します/);
    assert.equal(hidden()[0].x_user_id, "alice", "members remain unchanged before permission success");

    await act(async () => buttonNamed(container, "変更を反映").click());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].videoId, "vid1");
    assert.equal(calls[0].edit_privilege_mode, "event", "explicit privileged event is forwarded");
    assert.equal(calls[0].notify, true);
    assert.deepEqual(calls[0].intents, [{ x_user_id: "bob", display_name: "Bob", intent: "on" }]);
    assert.equal(container.querySelector('[role="alertdialog"]'), null);
    const members = hidden();
    assert.equal(members.length, 1);
    assert.equal(members[0].x_user_id, "bob", "successful replace commits the new rows");
    assert.equal(Object.hasOwn(members[0], "can_edit"), false, "permissions must never be serialized in members_json");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.history.replaceState({}, "", previousUrl);
  }
});

test("MIG-0713 U03 T03: pending permission batch prevents duplicate writes or early member commits", async () => {
  const calls = [];
  let finishWrite;
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(VideoMembersField, {
      ...noopAdapters,
      permissionTargetVideoId: "vid1",
      applyPermissionBatch: (input) => new Promise((resolve) => {
        calls.push(input);
        finishWrite = resolve;
      }),
    })));
    await previewTsv(container, "Alice\talice\t\t\t\tON");
    await act(async () => buttonNamed(container, "追加").click());
    await act(async () => buttonNamed(container, "変更を反映").click());
    assert.equal(calls.length, 1);
    assert.equal(buttonNamed(container, "反映中...").disabled, true, "submit is disabled until the adapter settles");
    assert.equal(buttonNamed(container, "キャンセル").disabled, true, "pending permission change cannot be dismissed");
    buttonNamed(container, "反映中...").click();
    assert.equal(calls.length, 1, "a second click must never start another permission write");
    assert.equal(container.querySelector('input[name="members_json"]').value, "[]",
      "member data is not committed before server confirmation");
    await act(async () => finishWrite({ ok: true }));
    assert.equal(container.querySelector('[role="alertdialog"]'), null);
    assert.equal(JSON.parse(container.querySelector('input[name="members_json"]').value).length, 1,
      "members are committed exactly once after permission success");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("MIG-0713 U03 T04: rejected and failed permission adapters leave member payload unchanged", async () => {
  for (const adapter of [
    async () => ({ ok: false, message: "permission denied" }),
    async () => { throw new Error("backend unavailable"); },
  ]) {
    const container = dom.window.document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(React.createElement(VideoMembersField, {
        ...noopAdapters,
        permissionTargetVideoId: "vid1",
        applyPermissionBatch: adapter,
      })));
      await previewTsv(container, "Alice\talice\t\t\t\tON");
      await act(async () => buttonNamed(container, "追加").click());
      await act(async () => buttonNamed(container, "変更を反映").click());
      const dialog = container.querySelector('[role="alertdialog"]');
      assert.ok(dialog, "no successful transition on failed write");
      assert.match(dialog.textContent, /permission denied|編集権限の反映中にエラーが発生しました/);
      assert.equal(container.querySelector('input[name="members_json"]').value, "[]");
    } finally {
      await act(async () => root.unmount());
    }
  }
});
