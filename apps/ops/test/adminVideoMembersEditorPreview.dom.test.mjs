// MIG-0730 U02d: parent A→B→A navigation must not carry old member form state.
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://flamenode.test/admin/videos/v1/members",
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "FormData"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { AdminVideoMembersEditorPreview } = await import(
  "../.test-dist/apps/ops/src/routes/admin/AdminVideoMembersEditorPreview.js"
);

function member(name, i = 0) {
  return {
    name, x_user_id: "user_" + i, role: "役割", comment: "",
    order_index: i, can_edit: 0, is_public_member: 1, chapters: [],
  };
}
function data(id, name, collab = "collab") {
  return {
    video: { id, title: id, youtube_video_id: null, collaboration_type: collab },
    initialMembers: name ? [member(name)] : [],
  };
}
function formPayload(target) {
  const input = target.querySelector('input[name="members_json"]');
  assert.ok(input, "the canonical shared VideoMembersField must provide a hidden payload");
  return JSON.parse(input.value);
}
test("MIG-0730 U02d: A→B→A resets field values, collaboration state and save gate", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const render = async (videoId, payload) => React.act(async () => {
    root.render(React.createElement(AdminVideoMembersEditorPreview, { videoId, data: payload }));
  });
  try {
    await render("A", data("A", "A OLD"));
    assert.equal(target.querySelector('input[name="video_id"]').value, "A");
    assert.equal(formPayload(target)[0].name, "A OLD");
    assert.equal(target.querySelector('input[name="is_collab"][type="checkbox"]').checked, true);
    assert.equal(target.querySelector('button[type="submit"]'), null);

    await render("B", data("B", "B ONLY"));
    assert.equal(target.querySelector('input[name="video_id"]').value, "B");
    assert.equal(formPayload(target)[0].name, "B ONLY");
    assert.doesNotMatch(target.textContent, /A OLD/);
    assert.equal(target.querySelector('button[type="submit"]'), null);

    await render("A", data("A", "A FRESH", null));
    assert.equal(target.querySelector('input[name="video_id"]').value, "A");
    assert.equal(formPayload(target)[0].name, "A FRESH");
    assert.doesNotMatch(target.textContent, /B ONLY|A OLD/);
    assert.equal(target.querySelector('button[type="submit"]'), null);
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});

test("MIG-0730 U02d: forbidden snapshot after a valid preview removes the old hidden payload", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const render = async payload => React.act(async () => {
    root.render(React.createElement(AdminVideoMembersEditorPreview, { videoId: "A", data: payload }));
  });
  try {
    await render(data("A", "VISIBLE"));
    assert.equal(formPayload(target)[0].name, "VISIBLE");
    await render(data("B", "SECRET"));
    assert.match(target.textContent, /参加者データを表示できません/);
    assert.equal(target.querySelector('input[name="members_json"]'), null);
    assert.doesNotMatch(target.textContent, /VISIBLE|SECRET/);
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});


test("MIG-0730 U02h: same-ID member revocation replaces stale hidden rows on fresh server snapshot", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const render = async payload => React.act(async () => {
    root.render(React.createElement(AdminVideoMembersEditorPreview, { videoId: "A", data: payload }));
  });
  try {
    await render(data("A", "REVOKED OLD"));
    assert.equal(formPayload(target)[0].name, "REVOKED OLD");
    assert.equal(target.querySelector('input[name="is_collab"][type="checkbox"]').checked, true);

    // The route ID remains A; only the authoritative GET payload has changed.
    await render(data("A", "AUTHORIZED NEW"));
    assert.deepEqual(formPayload(target).map(row => row.name), ["AUTHORIZED NEW"]);
    assert.doesNotMatch(target.textContent, /REVOKED OLD/);
    assert.equal(target.querySelector('button[type="submit"]'), null);

    // Removing the last participant must also clear the old collab checkbox
    // and canonical members_json, not just the visible member cards.
    await render(data("A", null, "individual"));
    assert.equal(target.querySelector('input[name="is_collab"][type="checkbox"]').checked, false);
    assert.deepEqual(formPayload(target), []);
    assert.doesNotMatch(target.textContent, /AUTHORIZED NEW|REVOKED OLD/);
    assert.equal(target.querySelector('button[type="submit"]'), null);
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});

test("MIG-0730 U02h: equal-value same-ID refresh does not reset local collaboration draft", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const render = async payload => React.act(async () => {
    root.render(React.createElement(AdminVideoMembersEditorPreview, { videoId: "A", data: payload }));
  });
  try {
    await render(data("A", "CURRENT"));
    let checkbox = target.querySelector('input[name="is_collab"][type="checkbox"]');
    assert.equal(checkbox.checked, true);
    await React.act(async () => checkbox.click());
    checkbox = target.querySelector('input[name="is_collab"][type="checkbox"]');
    assert.equal(checkbox.checked, false);
    assert.deepEqual(formPayload(target), []);

    // Object identity changed, but the sanitized snapshot is equivalent.
    await render(data("A", "CURRENT"));
    checkbox = target.querySelector('input[name="is_collab"][type="checkbox"]');
    assert.equal(checkbox.checked, false);
    assert.deepEqual(formPayload(target), []);
    assert.equal(target.querySelector('button[type="submit"]'), null);
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});


test("MIG-0730 U02o: title-only same-video GET refresh preserves draft while membership change resets it", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const render = async snapshot => React.act(async () => {
    root.render(React.createElement(AdminVideoMembersEditorPreview, { videoId: "A", data: snapshot }));
  });
  try {
    await render(data("A", "CURRENT"));
    await React.act(async () =>
      target.querySelector('input[name="is_collab"][type="checkbox"]').click());
    assert.equal(target.querySelector('input[name="is_collab"][type="checkbox"]').checked, false);
    assert.deepEqual(formPayload(target), []);

    const fresh = data("A", "CURRENT");
    fresh.video.title = "A renamed";
    fresh.video.youtube_video_id = "new_video_id";
    await render(fresh);
    assert.equal(target.querySelector('input[name="is_collab"][type="checkbox"]').checked, false,
      "metadata-only authorized refresh must not discard an unsaved local draft");
    assert.deepEqual(formPayload(target), []);
    assert.equal(target.querySelector('button[type="submit"]'), null);

    await render(data("A", "AUTHORIZED NEW"));
    assert.equal(target.querySelector('input[name="is_collab"][type="checkbox"]').checked, true,
      "changed authorized members must invalidate the old local draft");
    assert.deepEqual(formPayload(target).map(x => x.name), ["AUTHORIZED NEW"]);
    assert.doesNotMatch(target.textContent, /CURRENT/);
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});


// MIG-0730 U02p: the shared field is still unmounted in Ops. A future privileged
// editor must not issue duplicate collaborator writes or write after adapters
// are revoked while an existing confirmation dialog is still visible.
function buttonNamed(target, label) {
  const node = [...target.querySelectorAll("button")].find(
    button => button.textContent.trim() === label,
  );
  assert.ok(node, "button " + label + " is present");
  return node;
}
async function previewPermissionTsv(target, tsv) {
  const textarea = target.querySelector("#members-tsv-input");
  assert.ok(textarea, "shared TSV textarea exists");
  await React.act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), "value")?.set;
    assert.ok(setter);
    setter.call(textarea, tsv);
    textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await React.act(async () => buttonNamed(target, "内容を確認").click());
  assert.match(target.textContent, /確認（1行）/);
  await React.act(async () => buttonNamed(target, "追加").click());
  assert.match(target.querySelector('[role="alertdialog"]').textContent, /以下の編集権限を変更します/);
}

test("MIG-0730 U02p: two permission confirmations in one React batch write exactly once", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const calls = [];
  let settle;
  const adapters = {
    save: async () => ({ ok: true }),
    searchXUsers: async () => ({ items: [], hasMore: false, nextOffset: null, hint: null }),
    applyPermissionBatch: input => {
      calls.push(input);
      return new Promise(resolve => { settle = resolve; });
    },
  };
  try {
    await React.act(async () => root.render(React.createElement(
      AdminVideoMembersEditorPreview,
      { videoId: "A", data: data("A", "CURRENT"), ...adapters },
    )));
    await previewPermissionTsv(target, "Bob\tbob\t\t\t\tON");
    assert.deepEqual(formPayload(target).map(x => x.name), ["CURRENT"]);

    // Do NOT flush React updates between two clicks: this is exactly where a
    // permPending state-only guard can issue two POSTs.
    await React.act(async () => {
      const submit = buttonNamed(target, "変更を反映");
      submit.click();
      submit.click();
    });
    assert.equal(calls.length, 1, "synchronous duplicate clicks must send one permission batch");
    assert.equal(calls[0].videoId, "A");
    assert.equal(calls[0].intents.length, 1);
    assert.equal(buttonNamed(target, "反映中...").disabled, true);
    assert.deepEqual(formPayload(target).map(x => x.name), ["CURRENT"],
      "unconfirmed permission writes must not commit member rows");

    await React.act(async () => settle({ ok: true }));
    assert.equal(target.querySelector('[role="alertdialog"]'), null);
    assert.equal(calls.length, 1);
    assert.deepEqual(formPayload(target).map(x => x.name).sort(), ["Bob", "CURRENT"]);
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});

test("MIG-0730 U02p: removing edit adapters disables a still-open privileged confirmation", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const calls = [];
  const adapters = {
    save: async () => ({ ok: true }),
    searchXUsers: async () => ({ items: [], hasMore: false, nextOffset: null, hint: null }),
    applyPermissionBatch: async input => { calls.push(input); return { ok: true }; },
  };
  const render = async save => React.act(async () => {
    root.render(React.createElement(AdminVideoMembersEditorPreview, {
      videoId: "A", data: data("A", "CURRENT"),
      ...adapters, save,
    }));
  });
  try {
    await render(adapters.save);
    await previewPermissionTsv(target, "Bob\tbob\t\t\t\tON");
    assert.equal(buttonNamed(target, "変更を反映").disabled, false);

    // Same video/snapshot; only adapter privilege was withdrawn. The old
    // confirmation remains in React state but it must no longer write.
    await render(undefined);
    const confirm = buttonNamed(target, "変更を反映");
    assert.equal(confirm.disabled, true);
    await React.act(async () => confirm.click());
    assert.equal(calls.length, 0);
    assert.deepEqual(formPayload(target).map(x => x.name), ["CURRENT"]);
    assert.equal(target.querySelector('button[type="submit"]'), null);
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});
