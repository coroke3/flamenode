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
