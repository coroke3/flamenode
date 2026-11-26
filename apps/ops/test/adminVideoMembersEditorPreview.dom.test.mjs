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
const { MemoryRouter } = await import("react-router-dom");
const { AdminVideoMembersEditorPreview: UnmountedAdminVideoMembersEditorPreview } = await import(
  "../.test-dist/apps/ops/src/routes/admin/AdminVideoMembersEditorPreview.js"
);
// Each DOM fixture mounts through the same React Router context as the Ops
// application. Preserve the Preview component identity across rerenders so
// capability-epoch and pending-write isolation tests remain meaningful.
function AdminVideoMembersEditorPreview(props) {
  return React.createElement(MemoryRouter, null,
    React.createElement(UnmountedAdminVideoMembersEditorPreview, props));
}
const { VideoMembersField } = await import("@flamenode/ui");

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
  // U02az deliberately keeps the editor DOM mounted during a local OFF draft.
  // The retained disabled fieldset is not the active payload: only the
  // synthesized direct form section's [] may be submitted while OFF. In
  // read-only previews, inspect the canonical shared hidden input while ON
  // even though the whole editor fieldset is disabled for authorization.
  const input = target.querySelector('form > section > input[name="members_json"]') ??
    target.querySelector('fieldset input[name="members_json"]') ??
    // Some regressions mount VideoMembersField directly, without the Ops form.
    // In those tests there is no fieldset or synthetic OFF input.
    target.querySelector('input[name="members_json"]');
  assert.ok(input, "the form must provide a canonical or synthetic member payload");
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

test("MIG-0730 U02p/U02q: removing edit adapters retires a still-open privileged confirmation", async () => {
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

    // Adapter withdrawal retires the entire confirmation, not merely its button.
    await render(undefined);
    assert.equal(target.querySelector('[role="alertdialog"]'), null);
    assert.equal(target.querySelector('button[type="submit"]'), null);
    assert.equal(calls.length, 0);
    assert.deepEqual(formPayload(target).map(x => x.name), ["CURRENT"]);
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});


test("MIG-0730 U02q: pending permission success after revocation cannot revive obsolete member edits", async () => {
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
  const render = async save => React.act(async () => {
    root.render(React.createElement(AdminVideoMembersEditorPreview, {
      videoId: "A", data: data("A", "CURRENT"), ...adapters, save,
    }));
  });
  try {
    await render(adapters.save);
    await previewPermissionTsv(target, "Bob\tbob\t\t\t\tON");
    await React.act(async () => buttonNamed(target, "変更を反映").click());
    assert.equal(calls.length, 1);
    assert.equal(buttonNamed(target, "反映中...").disabled, true);
    assert.deepEqual(formPayload(target).map(x => x.name), ["CURRENT"]);

    await render(undefined);
    assert.equal(target.querySelector('[role="alertdialog"]'), null);
    assert.equal(target.querySelector('button[type="submit"]'), null);
    assert.deepEqual(formPayload(target).map(x => x.name), ["CURRENT"]);

    await React.act(async () => settle({ ok: true, message: "late permission success" }));
    assert.equal(target.querySelector('[role="alertdialog"]'), null);
    assert.deepEqual(formPayload(target).map(x => x.name), ["CURRENT"],
      "obsolete success must not commit imported rows");
    assert.equal(calls.length, 1);
    assert.doesNotMatch(target.textContent, /late permission success/);

    await render(adapters.save);
    assert.equal(target.querySelector('[role="alertdialog"]'), null);
    assert.deepEqual(formPayload(target).map(x => x.name), ["CURRENT"]);
    assert.ok(target.querySelector('button[type="submit"]'));
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});

test("MIG-0730 U02t: shared Personal field ignores privilege success after disabled toggle without remount", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const calls = [];
  let settle;
  const adapter = input => {
    calls.push(input);
    return new Promise(resolve => { settle = resolve; });
  };
  const render = async (disabled, permissionTargetVideoId = "A") => React.act(async () => {
    root.render(React.createElement(VideoMembersField, {
      initialMembers: [member("CURRENT")],
      disabled,
      permissionTargetVideoId,
      applyPermissionBatch: adapter,
      searchXUsers: async () => ({ items: [], hasMore: false, nextOffset: null, hint: null }),
    }));
  });
  try {
    await render(false);
    await previewPermissionTsv(target, "Bob\tbob\t\t\t\tON");
    await React.act(async () => buttonNamed(target, "変更を反映").click());
    assert.equal(calls.length, 1);
    assert.deepEqual(formPayload(target).map(x => x.name), ["CURRENT"]);

    // The shared field stays mounted: unlike the Ops preview it is not keyed
    // by a parent authorization snapshot in every Personal consumer.
    await render(true);
    assert.equal(target.querySelector('[role="alertdialog"]'), null);
    await render(false);
    await React.act(async () => settle({ ok: true, message: "STALE PRIVILEGE OK" }));
    assert.equal(target.querySelector('[role="alertdialog"]'), null);
    assert.deepEqual(formPayload(target).map(x => x.name), ["CURRENT"]);
    assert.doesNotMatch(target.textContent, /STALE PRIVILEGE OK/);
    assert.equal(calls.length, 1);
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});

test("MIG-0730 U02t: same mounted field rejects previous video's permission completion", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  let settle;
  const adapter = () => new Promise(resolve => { settle = resolve; });
  const render = async videoId => React.act(async () => {
    root.render(React.createElement(VideoMembersField, {
      initialMembers: [member("CURRENT")],
      permissionTargetVideoId: videoId,
      applyPermissionBatch: adapter,
      searchXUsers: async () => ({ items: [], hasMore: false, nextOffset: null, hint: null }),
    }));
  });
  try {
    await render("A");
    await previewPermissionTsv(target, "Bob\tbob\t\t\t\tON");
    await React.act(async () => buttonNamed(target, "変更を反映").click());
    await render("B");
    assert.equal(target.querySelector('[role="alertdialog"]'), null);
    await React.act(async () => settle({ ok: true, message: "A OLD PRIVILEGE" }));
    assert.deepEqual(formPayload(target).map(x => x.name), ["CURRENT"]);
    assert.doesNotMatch(target.textContent, /A OLD PRIVILEGE/);
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});

test("MIG-0730 U02x: reused shared field must not carry video A draft into video B", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const render = async (videoId, name) => React.act(async () => {
    root.render(React.createElement(VideoMembersField, {
      initialMembers: [member(name)],
      permissionTargetVideoId: videoId,
      searchXUsers: async () => ({ items: [], hasMore: false, nextOffset: null, hint: null }),
      applyPermissionBatch: async () => ({ ok: false }),
    }));
  });
  try {
    await render("A", "A ONLY");
    assert.deepEqual(formPayload(target).map(x => x.name), ["A ONLY"]);

    // A same-video metadata refresh must preserve the in-progress local draft.
    await render("A", "A SERVER REFRESH");
    assert.deepEqual(formPayload(target).map(x => x.name), ["A ONLY"]);

    // The parent intentionally reuses the same root and component type.
    // The target change must replace its state BEFORE B can submit.
    await render("B", "B ONLY");
    assert.deepEqual(formPayload(target).map(x => x.name), ["B ONLY"]);
    assert.doesNotMatch(target.querySelector('input[name="members_json"]').value, /A ONLY/);

    await render("B", "B SERVER REFRESH");
    assert.deepEqual(formPayload(target).map(x => x.name), ["B ONLY"]);
    await render("A", "A NEW SESSION");
    assert.deepEqual(formPayload(target).map(x => x.name), ["A NEW SESSION"]);
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});

test("MIG-0730 U02z: same-video permission adapter replacement retires stale success or rejection", async () => {
  for (const outcome of ["success", "failure"]) {
    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);
    let finishOld;
    let oldCalls = 0, newCalls = 0;
    const oldAdapter = () => {
      oldCalls++;
      return new Promise((resolve, reject) => { finishOld = { resolve, reject }; });
    };
    const newAdapter = async () => { newCalls++; return { ok: true, message: "NEW PERMISSION" }; };
    const search = async () => ({ items: [], hasMore: false, nextOffset: null, hint: null });
    const render = async adapter => React.act(async () => {
      root.render(React.createElement(VideoMembersField, {
        initialMembers: [member("CURRENT")],
        permissionTargetVideoId: "A",
        searchXUsers: search,
        applyPermissionBatch: adapter,
      }));
    });
    try {
      await render(oldAdapter);
      await previewPermissionTsv(target, "Bob\tbob\t\t\t\tON");
      await React.act(async () => buttonNamed(target, "変更を反映").click());
      assert.equal(oldCalls, 1);
      assert.deepEqual(formPayload(target).map(x => x.name), ["CURRENT"]);
      await render(newAdapter);
      assert.equal(target.querySelector('[role="alertdialog"]'), null,
        "adapter change revokes old permission confirmation on the SAME mounted video");
      if (outcome === "success") {
        await React.act(async () => finishOld.resolve({ ok: true, message: "OBSOLETE PERMISSION" }));
      } else {
        await React.act(async () => finishOld.reject(new Error("old permission request failed")));
      }
      assert.equal(newCalls, 0, "no automatic retry through replacement adapter");
      assert.deepEqual(formPayload(target).map(x => x.name), ["CURRENT"]);
      assert.doesNotMatch(target.textContent, /OBSOLETE PERMISSION|編集権限の反映中にエラー/);

      await previewPermissionTsv(target, "Bob\tbob\t\t\t\tON");
      await React.act(async () => buttonNamed(target, "変更を反映").click());
      assert.equal(newCalls, 1);
      assert.deepEqual(formPayload(target).map(x => x.name).sort(), ["Bob", "CURRENT"]);
    } finally {
      await React.act(async () => root.unmount());
      target.remove();
    }
  }
});


test("MIG-0730 U02aa: same-video X-user search port rotation retires old results and re-fetches", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const oldCalls = [], newCalls = [], thirdCalls = [];
  const oldAdapter = (_query, _offset, signal) => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    oldCalls.push({ signal, resolve });
    return promise;
  };
  const newAdapter = (_query, _offset, signal) => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    newCalls.push({ signal, resolve });
    return promise;
  };
  const thirdAdapter = (_query, _offset, signal) => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    thirdCalls.push({ signal, resolve });
    return promise;
  };
  const permission = async () => ({ ok: false });
  const render = adapter => React.act(async () => {
    root.render(React.createElement(VideoMembersField, {
      initialMembers: [member("CURRENT")],
      permissionTargetVideoId: "A",
      searchXUsers: adapter,
      applyPermissionBatch: permission,
    }));
  });
  const waitFor = async (predicate) => {
    for (let i = 0; i < 80; i++) {
      if (predicate()) return;
      await React.act(async () => {
        await new Promise(resolve => setTimeout(resolve, 40));
      });
    }
    assert.fail("timed out waiting for debounced X-user search");
  };
  const options = () =>
    [...target.querySelectorAll("#member-name-suggestions option")].map(x => x.value);
  try {
    await render(oldAdapter);
    const input = target.querySelector('input[placeholder="表示名"]');
    assert.ok(input);
    await React.act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
      assert.ok(setter);
      setter.call(input, "AB");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await waitFor(() => oldCalls.length === 1);
    assert.equal(oldCalls.length, 1);

    // The old request is still pending when the parent switches same-video
    // search authority. A late response cannot populate the new adapter's UI.
    await render(newAdapter);
    assert.equal(oldCalls[0].signal.aborted, true);
    await React.act(async () => oldCalls[0].resolve({
      items: [{ id: "old_creator", x_name: "OLD SEARCH RESULT" }],
      hasMore: false, nextOffset: null, hint: null,
    }));
    assert.doesNotMatch(options().join("|"), /OLD SEARCH RESULT/);
    await waitFor(() => newCalls.length === 1);
    await React.act(async () => newCalls[0].resolve({
      items: [{ id: "new_creator", x_name: "NEW SEARCH RESULT" }],
      hasMore: false, nextOffset: null, hint: null,
    }));
    assert.ok(options().includes("NEW SEARCH RESULT"));
    assert.equal(newCalls.length, 1);

    // Cached successful candidates must also disappear without changing query.
    await render(thirdAdapter);
    assert.doesNotMatch(options().join("|"), /OLD SEARCH RESULT|NEW SEARCH RESULT/);
    await waitFor(() => thirdCalls.length === 1);
    await React.act(async () => thirdCalls[0].resolve({
      items: [{ id: "third_creator", x_name: "THIRD RESULT" }],
      hasMore: false, nextOffset: null, hint: null,
    }));
    assert.ok(options().includes("THIRD RESULT"));
    assert.deepEqual(formPayload(target).map(x => x.name), ["AB"],
      "search port rotation must not discard same-video unsaved member edits");
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});


test("MIG-0730 U02ab: query change never offers stale remote suggestions before next search resolves", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const requests = [];
  const searchXUsers = (query, offset, signal) => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    requests.push({ query, offset, signal, resolve });
    return promise;
  };
  const waitFor = async (predicate) => {
    for (let i = 0; i < 80; i++) {
      if (predicate()) return;
      await React.act(async () => {
        await new Promise(resolve => setTimeout(resolve, 40));
      });
    }
    assert.fail("timed out waiting for new X-user request");
  };
  const edit = async value => {
    const input = target.querySelector('input[placeholder="表示名"]');
    assert.ok(input);
    await React.act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
      assert.ok(setter);
      setter.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  };
  const options = () =>
    [...target.querySelectorAll("#member-name-suggestions option")].map(x => x.value);
  try {
    await React.act(async () => root.render(React.createElement(VideoMembersField, {
      initialMembers: [member("CURRENT")],
      permissionTargetVideoId: "A",
      searchXUsers,
      applyPermissionBatch: async () => ({ ok: false }),
    })));

    await edit("Alpha");
    await waitFor(() => requests.length === 1);
    assert.equal(requests[0].query, "Alpha");
    await React.act(async () => requests[0].resolve({
      items: [{ id: "alpha_creator", x_name: "ALPHA CANDIDATE" }],
      hasMore: true, nextOffset: 20, hint: "ALPHA PRIVATE QUERY HINT",
    }));
    assert.ok(options().includes("ALPHA CANDIDATE"));
    assert.match(target.textContent, /ALPHA PRIVATE QUERY HINT/,
      "an authorized result may show the matching query's hint");
    assert.ok([...target.querySelectorAll("button")].some(button =>
      button.textContent.includes("候補をさらに読み込む")));

    await edit("Bravo");
    assert.doesNotMatch(target.textContent, /ALPHA PRIVATE QUERY HINT/,
      "previous query hint must disappear immediately, not after the 250ms debounce");
    assert.ok(![...target.querySelectorAll("button")].some(button =>
      button.textContent.includes("候補をさらに読み込む")),
      "old query pagination cursor must not survive an input change");
    assert.ok(!options().includes("ALPHA CANDIDATE"),
      "old query candidates must disappear on the input commit, before debounce");
    await waitFor(() => requests.length === 2);
    assert.equal(requests[1].query, "Bravo");
    await React.act(async () => requests[1].resolve({
      items: [{ id: "bravo_creator", x_name: "BRAVO CANDIDATE" }],
      hasMore: false, nextOffset: null, hint: "BRAVO AUTHORIZED QUERY HINT",
    }));
    assert.ok(options().includes("BRAVO CANDIDATE"));
    assert.match(target.textContent, /BRAVO AUTHORIZED QUERY HINT/);
    assert.doesNotMatch(target.textContent, /ALPHA PRIVATE QUERY HINT/);
    assert.ok(!options().includes("ALPHA CANDIDATE"));
    assert.deepEqual(formPayload(target).map(x => x.name), ["Bravo"],
      "search snapshot partition must not reset the member draft");
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});


test("MIG-0730 U02ae: rejected X-user pagination retires cached private candidates", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const calls = [];
  const searchXUsers = async (query, offset) => {
    calls.push({ query, offset });
    if (offset > 0) throw new Error("HTTP 403: X-user search access revoked");
    return {
      items: [{ id: "private_creator", x_name: "PRIVATE CANDIDATE" }],
      hasMore: true, nextOffset: 20, hint: null,
    };
  };
  const permission = async () => ({ ok: false });
  const options = () => [...target.querySelectorAll("#member-name-suggestions option")]
    .map(node => node.value);
  try {
    await React.act(async () => root.render(React.createElement(VideoMembersField, {
      initialMembers: [member("CURRENT")],
      permissionTargetVideoId: "A",
      searchXUsers,
      applyPermissionBatch: permission,
    })));
    const input = target.querySelector('input[placeholder="表示名"]');
    assert.ok(input);
    await React.act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
      assert.ok(setter);
      setter.call(input, "Alice");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await React.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 320));
    });
    assert.deepEqual(calls, [{ query: "Alice", offset: 0 }]);
    assert.ok(options().includes("PRIVATE CANDIDATE"));
    const loadMore = [...target.querySelectorAll("button")]
      .find(button => button.textContent.includes("候補をさらに読み込む"));
    assert.ok(loadMore);

    // A later page can return HTTP 401/403 after the first page succeeded.
    // All remote candidates must disappear; a failure is not an empty page.
    await React.act(async () => loadMore.click());
    assert.deepEqual(calls, [
      { query: "Alice", offset: 0 },
      { query: "Alice", offset: 20 },
    ]);
    assert.ok(!options().includes("PRIVATE CANDIDATE"),
      "cached private candidates cannot survive a rejected pagination request");
    assert.ok(![...target.querySelectorAll("button")]
      .some(button => button.textContent.includes("候補をさらに読み込む")),
      "rejected request invalidates the old paging cursor");
    assert.match(target.textContent, /候補の取得に失敗しました/);
    assert.deepEqual(formPayload(target).map(row => row.name), ["Alice"],
      "revoking suggestions must not discard unsaved member edits");
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});


test("MIG-0730 U02af: disable hides cached private suggestions before render effects", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const requests = [];
  const searchXUsers = (q, offset, signal) => {
    let resolve;
    const response = new Promise(done => { resolve = done; });
    requests.push({ q, offset, signal, resolve });
    return response;
  };
  const permission = async () => ({ ok: false });
  const beforePassiveEffects = [];
  const LayoutProbe = ({ disabled }) => {
    React.useLayoutEffect(() => {
      if (disabled) beforePassiveEffects.push(target.textContent);
    }, [disabled]);
    return null;
  };
  const render = disabled => React.act(async () => root.render(
    React.createElement(React.Fragment, null,
      React.createElement(VideoMembersField, {
        initialMembers: [member("CURRENT")],
        permissionTargetVideoId: "A",
        searchXUsers,
        applyPermissionBatch: permission,
        disabled,
      }),
      React.createElement(LayoutProbe, { disabled }),
    )
  ));
  const names = () => [...target.querySelectorAll("#member-name-suggestions option")]
    .map(node => node.value);
  const hasMore = () => [...target.querySelectorAll("button")]
    .some(button => button.textContent.includes("候補をさらに読み込む"));
  try {
    await render(false);
    const input = target.querySelector('input[placeholder="表示名"]');
    assert.ok(input);
    await React.act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
      assert.ok(setter);
      setter.call(input, "Alice");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await React.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 320));
    });
    assert.equal(requests.length, 1);
    await React.act(async () => requests[0].resolve({
      items: [{ id: "revoked", x_name: "OLD PRIVATE" }],
      hasMore: true, nextOffset: 20, hint: "PRIVATE AUDIT HINT",
    }));
    assert.match(target.textContent, /PRIVATE AUDIT HINT/);
    assert.ok(names().includes("OLD PRIVATE"));
    assert.equal(hasMore(), true);

    await render(true);
    assert.equal(beforePassiveEffects.length, 1,
      "layout probe must inspect the committed disabled render before effects");
    assert.doesNotMatch(beforePassiveEffects[0], /PRIVATE AUDIT HINT/,
      "no private search metadata may paint in the disabled commit");
    assert.doesNotMatch(target.textContent, /PRIVATE AUDIT HINT/);
    assert.deepEqual(names(), [], "disabled render must hide private datalist suggestions");
    assert.equal(hasMore(), false, "disabled render must hide old pagination action");
    assert.deepEqual(formPayload(target).map(row => row.name), ["Alice"],
      "read permission revocation must not silently discard draft edits");

    await render(false);
    assert.ok(!names().includes("OLD PRIVATE"),
      "reenabling before fresh authorization must not resurrect cached results");
    await React.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 320));
    });
    assert.equal(requests.length, 2, "reenabling requires a fresh search");
    await React.act(async () => requests[1].resolve({
      items: [{ id: "fresh", x_name: "NEW AUTHORIZED" }],
      hasMore: false, nextOffset: null, hint: null,
    }));
    assert.ok(names().includes("NEW AUTHORIZED"));
    assert.ok(!names().includes("OLD PRIVATE"));
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});


test("MIG-0730 U02ag: global disabled blocks chapter inputs in both card and table modes", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const searchXUsers = async () => ({ items: [], hasMore: false, nextOffset: null, hint: null });
  const applyPermissionBatch = async () => ({ ok: false });
  const render = (disabled, chaptersDisabled = false) => React.act(async () => root.render(
    React.createElement(VideoMembersField, {
      initialMembers: [member("CURRENT")],
      permissionTargetVideoId: "A",
      searchXUsers,
      applyPermissionBatch,
      disabled,
      chaptersDisabled,
    })
  ));
  const changeChapter = async value => {
    const input = target.querySelector('input[placeholder="0:12;1:05"]');
    assert.ok(input, "a chapter editor is present");
    await React.act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
      assert.ok(setter);
      setter.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    return input;
  };
  try {
    await render(true);
    const original = formPayload(target);
    const card = target.querySelector('input[placeholder="0:12;1:05"]');
    assert.equal(card.disabled, true, "read-only card mode must not offer chapter editing");
    await changeChapter("1:23");
    assert.deepEqual(formPayload(target), original, "read-only card must ignore synthetic changes");

    await React.act(async () => buttonNamed(target, "表").click());
    const table = target.querySelector('input[placeholder="0:12;1:05"]');
    assert.equal(table.disabled, true, "read-only table mode must not offer chapter editing");
    await changeChapter("2:34");
    assert.deepEqual(formPayload(target), original, "read-only table must not update hidden JSON");

    await render(false, true);
    assert.equal(target.querySelector('input[placeholder="0:12;1:05"]').disabled, true,
      "chaptersDisabled independently locks chapters even when other member fields are writable");
    await changeChapter("3:45");
    assert.deepEqual(formPayload(target), original);

    await render(false, false);
    assert.equal(target.querySelector('input[placeholder="0:12;1:05"]').disabled, false,
      "authorized editing must remain available");
    await changeChapter("1:23");
    assert.equal(formPayload(target)[0].chapters.length, 1,
      "authorized chapter editing must still serialize into members_json");

    await render(true, false);
    assert.equal(target.querySelector('input[placeholder="0:12;1:05"]').disabled, true);
    assert.equal(formPayload(target)[0].chapters.length, 1,
      "revoking edit capability must not erase a local unsaved chapter draft");
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});


test("MIG-0730 U02aj: no-target replacement confirmation retires on read-only transition", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const props = {
    initialMembers: [member("CURRENT")],
    searchXUsers: async () => ({ items: [], hasMore: false, nextOffset: null }),
    applyPermissionBatch: async () => ({ ok: false }),
    // An unsaved Personal video has no permissionTargetVideoId. Its
    // permissionCapability stays null even when disabled toggles.
  };
  const render = disabled => React.act(async () => root.render(
    React.createElement(VideoMembersField, { ...props, disabled })
  ));
  try {
    await render(false);
    const original = formPayload(target);
    const textarea = target.querySelector("#members-tsv-input");
    assert.ok(textarea);
    await React.act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), "value")?.set;
      assert.ok(setter);
      setter.call(textarea, "NEXT\tnext\t\t\t\t");
      textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await React.act(async () => buttonNamed(target, "内容を確認").click());
    assert.match(target.textContent, /確認（1行）/);
    await React.act(async () => buttonNamed(target, "現在のメンバーを置き換え").click());
    assert.ok(target.querySelector('[role="alertdialog"]'));
    assert.deepEqual(formPayload(target), original);

    await render(true);
    assert.equal(target.querySelector('[role="alertdialog"]'), null,
      "permission loss must retire the replace confirmation even without a permission video target");
    assert.deepEqual(formPayload(target), original,
      "a stale confirmation must not replace members after editing is disabled");
    await render(false);
    assert.equal(target.querySelector('[role="alertdialog"]'), null,
      "restoring edit capability cannot resurrect the old confirmation");
    assert.deepEqual(formPayload(target), original);
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});

test("MIG-0730 U02bg: fresh same-video snapshot cannot bypass pending public-member PUT latch", async () => {
  for (const path of ["same-video-refresh", "A-B-A"]) {
    for (const outcome of ["success", "failure"]) {
      const target = document.createElement("div");
      document.body.append(target);
      const root = createRoot(target);
      const writes = [];
      let finish, reject;
      let refreshes = 0;
      const first = new Promise((resolve, rejectFirst) => {
        finish = resolve; reject = rejectFirst;
      });
      const save = async formData => {
        writes.push({
          videoId: formData.get("video_id"),
          names: JSON.parse(formData.get("members_json")).map(row => row.name),
        });
        return writes.length === 1 ? first : { ok: true, message: "LATEST SAVE" };
      };
      const searchXUsers = async () => ({ items: [], hasMore: false, nextOffset: null });
      const applyPermissionBatch = async () => ({ ok: true });
      const render = async (id, name) => React.act(async () => root.render(
        React.createElement(AdminVideoMembersEditorPreview, {
          videoId: id, data: data(id, name), save, searchXUsers, applyPermissionBatch,
          onSaved: () => { refreshes++; },
        }),
      ));
      const submit = async () => React.act(async () => {
        const event = new dom.window.Event("submit", { bubbles: true, cancelable: true });
        target.querySelector("form").dispatchEvent(event);
        assert.equal(event.defaultPrevented, true);
      });
      try {
        await render("A", "Alice");
        await submit();
        assert.deepEqual(writes, [{ videoId: "A", names: ["Alice"] }]);
        assert.equal(target.querySelector('button[type="submit"]').disabled, true);

        // Changes to the authorized membership snapshot remount the form and
        // discard its local pending ref. Do not allow that new form to PUT
        // while the old A request has an uncertain commit state.
        if (path === "A-B-A") await render("B", "Other");
        await render("A", "Bob");
        assert.deepEqual(formPayload(target).map(row => row.name), ["Bob"]);
        assert.equal(target.querySelector('button[type="submit"]').disabled, false);
        await submit();
        assert.equal(writes.length, 1, "remounted form cannot issue an overlapping PUT");
        assert.match(target.textContent, /前の保存処理が完了していません/);
        assert.equal(refreshes, 0);

        if (outcome === "success") {
          await React.act(async () => finish({ ok: true, message: "OBSOLETE ALICE SAVE" }));
        } else {
          await React.act(async () => reject(new Error("old A write result unknown")));
        }
        assert.equal(writes.length, 1, "ambiguous old write is never replayed");
        assert.equal(refreshes, 0, "unmounted old form may not refresh the new snapshot");
        assert.doesNotMatch(target.textContent, /OBSOLETE ALICE SAVE|保存中にエラー/);

        // Only a new explicit user submit after the old request settles may
        // save the fresh authorized snapshot.
        await submit();
        assert.deepEqual(writes[1], { videoId: "A", names: ["Bob"] });
        assert.equal(writes.length, 2);
        assert.equal(refreshes, 1);
        assert.match(target.textContent, /LATEST SAVE/);
      } finally {
        await React.act(async () => root.unmount());
        target.remove();
      }
    }
  }
});

test("MIG-0730 U02bh: full Preview unmount/remount cannot overlap same-video PUT", async () => {
  const oldTarget = document.createElement("div");
  const newTarget = document.createElement("div");
  document.body.append(oldTarget, newTarget);
  const oldRoot = createRoot(oldTarget);
  const newRoot = createRoot(newTarget);
  const writes = [];
  let settleOld;
  const first = new Promise(resolve => { settleOld = resolve; });
  const save = async formData => {
    writes.push({
      id: formData.get("video_id"),
      names: JSON.parse(formData.get("members_json")).map(row => row.name),
    });
    return writes.length === 1 ? first : { ok: true, message: "NEW SAVE" };
  };
  const searchXUsers = async () => ({ items: [], hasMore: false, nextOffset: null });
  const applyPermissionBatch = async () => ({ ok: true });
  const render = async (root, name, onSaved) => React.act(async () =>
    root.render(React.createElement(AdminVideoMembersEditorPreview, {
      videoId: "A", data: data("A", name), save,
      searchXUsers, applyPermissionBatch, onSaved,
    }))
  );
  const submit = async target => React.act(async () => {
    const event = new dom.window.Event("submit", { bubbles: true, cancelable: true });
    target.querySelector("form").dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  });
  let oldMounted = true;
  let oldRefreshes = 0;
  let newRefreshes = 0;
  try {
    await render(oldRoot, "OLD", () => { oldRefreshes++; });
    await submit(oldTarget);
    assert.deepEqual(writes, [{ id: "A", names: ["OLD"] }]);
    await React.act(async () => oldRoot.unmount());
    oldMounted = false;

    // The React ref belonging to the first Preview no longer exists.
    // The second root must still reject another possibly-conflicting PUT.
    await render(newRoot, "FRESH", () => { newRefreshes++; });
    await submit(newTarget);
    assert.equal(writes.length, 1);
    assert.match(newTarget.textContent, /前の保存処理が完了していません/);
    assert.equal(newRefreshes, 0);

    await React.act(async () => settleOld({ ok: true, message: "OBSOLETE SAVE" }));
    assert.equal(oldRefreshes, 0, "unmounted Preview cannot refresh the new page");
    assert.doesNotMatch(newTarget.textContent, /OBSOLETE SAVE/);
    assert.equal(writes.length, 1, "old PUT is not retried automatically");

    await submit(newTarget);
    assert.deepEqual(writes[1], { id: "A", names: ["FRESH"] });
    assert.equal(newRefreshes, 1);
    assert.match(newTarget.textContent, /NEW SAVE/);
  } finally {
    settleOld({ ok: false });
    if (oldMounted) await React.act(async () => oldRoot.unmount());
    await React.act(async () => newRoot.unmount());
    oldTarget.remove();
    newTarget.remove();
  }
});

test("MIG-0730 U02bq: zero-row V2 refinement displays its hint rather than a false no-results message", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const calls = [];
  const hint = "候補が多いため、名前またはX IDを追加で入力してください。";
  const searchXUsers = async (query, offset) => {
    calls.push({ query, offset });
    return query === "WIDE"
      ? { items: [], hasMore: true, nextOffset: null, hint }
      : { items: [], hasMore: false, nextOffset: null, hint: null };
  };
  const edit = async value => {
    const input = target.querySelector('input[placeholder="表示名"]');
    assert.ok(input);
    await React.act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
      assert.ok(setter);
      setter.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await React.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 320));
    });
  };
  try {
    await React.act(async () => root.render(React.createElement(VideoMembersField, {
      initialMembers: [member("CURRENT")],
      permissionTargetVideoId: "A",
      searchXUsers,
      applyPermissionBatch: async () => ({ ok: false }),
    })));
    await edit("WIDE");
    assert.deepEqual(calls, [{ query: "WIDE", offset: 0 }]);
    assert.match(target.textContent, /候補が多いため、名前またはX IDを追加で入力してください/);
    assert.doesNotMatch(target.textContent, /候補が見つかりません/,
      "V2 refinement is not an empty successful search");
    assert.ok(![...target.querySelectorAll("button")].some(button =>
      button.textContent.includes("候補をさらに読み込む")),
      "cursorless refinement must not show a pagination action");

    await edit("NONE");
    assert.deepEqual(calls, [
      { query: "WIDE", offset: 0 },
      { query: "NONE", offset: 0 },
    ]);
    assert.match(target.textContent, /候補が見つかりません/,
      "a genuinely completed empty page still shows the no-candidates message");
    assert.doesNotMatch(target.textContent, /候補が多いため/,
      "a prior query's private refinement hint must not survive a query change");
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});

test("MIG-0730 U02br: malformed permission port results cannot apply collaborators or leak private messages", async () => {
  const forgedResults = [
    { ok: "true", message: "PRIVATE_FORGED_SUCCESS" },
    { ok: 1, message: "PRIVATE_FORGED_SUCCESS" },
    { ok: true, message: { private: "PRIVATE_FORGED_SUCCESS" } },
    { ok: true, message: "x".repeat(301) },
    null,
  ];
  for (const forged of forgedResults) {
    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);
    let requests = 0;
    try {
      const adapters = {
        save: async () => ({ ok: true }),
        searchXUsers: async () => ({ items: [], hasMore: false, nextOffset: null, hint: null }),
        applyPermissionBatch: async () => { requests++; return forged; },
      };
      await React.act(async () => root.render(React.createElement(
        AdminVideoMembersEditorPreview,
        { videoId: "A", data: data("A", "CURRENT"), ...adapters },
      )));
      await previewPermissionTsv(target, "Bob\\tbob\\t\\t\\t\\tON".replaceAll("\\t", "\t"));
      await React.act(async () => buttonNamed(target, "変更を反映").click());
      assert.equal(requests, 1, "one forged receipt must not cause a second POST");
      assert.ok(target.querySelector('[role="alertdialog"]'),
        "a malformed success must not close the permission confirmation");
      assert.deepEqual(formPayload(target).map(x => x.name), ["CURRENT"],
        "unverified permissions must not apply imported collaborator rows");
      assert.match(target.querySelector('[role="alertdialog"]').textContent,
        /編集権限の反映結果を確認できませんでした。状態を再取得してください。/);
      assert.doesNotMatch(target.textContent, /PRIVATE_FORGED_SUCCESS/,
        "private untrusted adapter messages must never be rendered");
    } finally {
      await React.act(async () => root.unmount());
      target.remove();
    }
  }
});

test("MIG-0730 U02bs: rejected Ops permission port is unverified, never a proved rollback", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  let calls = 0;
  const adapters = {
    save: async () => ({ ok: true }),
    searchXUsers: async () => ({ items: [], hasMore: false, nextOffset: null, hint: null }),
    applyPermissionBatch: async () => {
      calls++;
      throw new Error("PRIVATE_NETWORK_SECRET after server possibly committed");
    },
  };
  try {
    await React.act(async () => root.render(React.createElement(
      AdminVideoMembersEditorPreview,
      { videoId: "A", data: data("A", "CURRENT"), ...adapters },
    )));
    const tsv = ["Bob", "bob", "", "", "", "ON"].join("\t");
    await previewPermissionTsv(target, tsv);
    await React.act(async () => buttonNamed(target, "変更を反映").click());
    assert.equal(calls, 1, "ambiguous permission writes must not auto-retry");
    const dialog = target.querySelector('[role="alertdialog"]');
    assert.ok(dialog, "unverified permissions must keep the confirmation visible");
    assert.deepEqual(formPayload(target).map(row => row.name), ["CURRENT"],
      "a possibly committed permission response must not update local member rows");
    assert.match(dialog.textContent,
      /編集権限の反映結果を確認できませんでした。状態を再取得してください。/,
      "an unknown result must instruct re-fetch rather than declare rollback");
    assert.doesNotMatch(target.textContent,
      /PRIVATE_NETWORK_SECRET|編集権限の反映中にエラーが発生しました/,
      "the private exception and generic CURRENT fallback must not reach Ops");
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});

test("MIG-0730 U02bt: two Ops Preview roots share the video write gate across permission POST and member PUT", async () => {
  const firstTarget = document.createElement("div");
  const secondTarget = document.createElement("div");
  document.body.append(firstTarget, secondTarget);
  const firstRoot = createRoot(firstTarget);
  const secondRoot = createRoot(secondTarget);
  const posts = [], saves = [];
  let settleFirst;
  const pending = new Promise(resolve => { settleFirst = resolve; });
  const applyPermissionBatch = async input => {
    posts.push(input);
    return posts.length === 1 ? pending : { ok: true };
  };
  const save = async formData => {
    saves.push(formData.get("video_id"));
    return { ok: true, message: "AFTER SETTLE" };
  };
  const searchXUsers = async () => ({ items: [], hasMore: false, nextOffset: null });
  const render = (root, name) => React.act(async () => root.render(
    React.createElement(AdminVideoMembersEditorPreview, {
      videoId: "U02BT", data: data("U02BT", name),
      save, searchXUsers, applyPermissionBatch,
    }),
  ));
  const submit = target => React.act(async () => {
    const event = new dom.window.Event("submit", { bubbles: true, cancelable: true });
    target.querySelector("form").dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  });
  try {
    await render(firstRoot, "OLD");
    await previewPermissionTsv(firstTarget, ["Bob", "bob", "", "", "", "ON"].join("\t"));
    await React.act(async () => buttonNamed(firstTarget, "変更を反映").click());
    assert.equal(posts.length, 1);
    assert.deepEqual(formPayload(firstTarget).map(row => row.name), ["OLD"]);

    // An unrelated React root for the SAME video must not PUT while that POST
    // could have committed without a response.
    await render(secondRoot, "FRESH");
    await submit(secondTarget);
    assert.deepEqual(saves, [], "pending permission POST must block a same-video member PUT");
    assert.match(secondTarget.textContent, /前の権限変更処理が完了していません/);

    await previewPermissionTsv(secondTarget, ["Alice", "alice", "", "", "", "ON"].join("\t"));
    await React.act(async () => buttonNamed(secondTarget, "変更を反映").click());
    assert.equal(posts.length, 1, "another Preview cannot overlap the pending permission POST");
    assert.match(secondTarget.textContent, /前の変更処理が完了していません/);
    assert.deepEqual(formPayload(secondTarget).map(row => row.name), ["FRESH"],
      "neither blocked write may apply unverified member rows");

    // A failed or lost first response is not retried. A fresh explicit action
    // is allowed only after the first operation settles and releases the lock.
    await React.act(async () => settleFirst({
      ok: false, message: "編集権限の反映結果を確認できませんでした。状態を再取得してください。",
    }));
    assert.equal(posts.length, 1);
    assert.deepEqual(saves, []);
    await React.act(async () => buttonNamed(secondTarget, "変更を反映").click());
    assert.equal(posts.length, 2);
    assert.deepEqual(formPayload(secondTarget).map(row => row.name).sort(),
      ["Alice", "FRESH"]);
    await submit(secondTarget);
    assert.deepEqual(saves, ["U02BT"], "PUT may proceed only after permission POST settled");
  } finally {
    settleFirst({ ok: false });
    await React.act(async () => { firstRoot.unmount(); secondRoot.unmount(); });
    firstTarget.remove(); secondTarget.remove();
  }
});

test("MIG-0730 U02bu: forged or duplicate hidden video_id cannot reach injected SA-085 save", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const saves = [];
  let refreshed = 0;
  const adapters = {
    save: async payload => {
      saves.push(payload.getAll("video_id"));
      return { ok: true, message: "SAVED_VALID_VIDEO" };
    },
    searchXUsers: async () => ({ items: [], hasMore: false, nextOffset: null, hint: null }),
    applyPermissionBatch: async () => ({ ok: true }),
    onSaved: () => { refreshed++; },
  };
  const submit = async () => React.act(async () => {
    const event = new dom.window.Event("submit", { bubbles: true, cancelable: true });
    target.querySelector("form").dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  });
  try {
    await React.act(async () => root.render(React.createElement(AdminVideoMembersEditorPreview, {
      videoId: "U02BU", data: data("U02BU", "CURRENT"), ...adapters,
    })));
    const form = target.querySelector("form");
    const identity = form.querySelector('input[name="video_id"]');
    assert.ok(identity);
    identity.value = "DIFFERENT_VIDEO";
    await submit();
    assert.deepEqual(saves, [], "a tampered hidden ID must fail before injected HTTP write");
    assert.equal(refreshed, 0);
    assert.match(target.textContent, /参加者設定の入力を確認してください/);
    assert.doesNotMatch(target.textContent, /SAVED_VALID_VIDEO/);

    identity.value = "U02BU";
    const duplicate = document.createElement("input");
    duplicate.type = "hidden";
    duplicate.name = "video_id";
    duplicate.value = "U02BU";
    form.append(duplicate);
    await submit();
    assert.deepEqual(saves, [], "duplicate even matching video IDs must be rejected");
    assert.equal(refreshed, 0);
    duplicate.remove();

    await submit();
    assert.deepEqual(saves, [["U02BU"]], "canonical single ID may reach the port");
    assert.equal(refreshed, 1, "only the verified canonical submit may refresh");
    assert.match(target.textContent, /SAVED_VALID_VIDEO/);
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});

test("MIG-0730 U02bv/U02bw: forged, duplicate and unexpected FormData fields cannot reach injected save", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const sent = [];
  let refreshes = 0;
  const adapters = {
    save: async payload => {
      sent.push({
        ids: payload.getAll("video_id"),
        flags: payload.getAll("is_collab"),
        members: payload.getAll("members_json"),
      });
      return { ok: true, message: "VALIDATED_SAVE" };
    },
    searchXUsers: async () => ({ items: [], hasMore: false, nextOffset: null }),
    applyPermissionBatch: async () => ({ ok: true }),
    onSaved: () => { refreshes++; },
  };
  const submit = async () => React.act(async () => {
    const e = new dom.window.Event("submit", { bubbles: true, cancelable: true });
    target.querySelector("form").dispatchEvent(e);
    assert.equal(e.defaultPrevented, true);
  });
  const hidden = (name, value) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    target.querySelector("form").append(input);
    return input;
  };
  try {
    await React.act(async () => root.render(React.createElement(AdminVideoMembersEditorPreview, {
      videoId: "U02BV", data: data("U02BV", "CURRENT"), ...adapters,
    })));
    const extraMember = hidden("members_json", "[]");
    await submit();
    assert.equal(sent.length, 0, "duplicate member payload must not pass to save");
    assert.equal(refreshes, 0);
    assert.match(target.textContent, /参加者設定の入力を確認してください/);
    extraMember.remove();

    const extraFlag = hidden("is_collab", "true");
    await submit();
    assert.equal(sent.length, 0, "trailing duplicate ON flag must not pass");
    extraFlag.remove();

    const baseFlag = target.querySelector('input[name="is_collab"][type="hidden"]');
    assert.ok(baseFlag);
    baseFlag.value = "true";
    await submit();
    assert.equal(sent.length, 0, "forged hidden true cannot authorize an ON write");
    baseFlag.value = "false";

    const injectedPrivilege = hidden("can_edit", "true");
    await submit();
    assert.equal(sent.length, 0, "unexpected privilege field must not reach an injected save port");
    assert.equal(refreshes, 0, "unexpected field must not cause an authorized refresh");
    injectedPrivilege.remove();

    await submit();
    assert.equal(sent.length, 1, "valid ON form still saves");
    assert.deepEqual(sent[0].ids, ["U02BV"]);
    assert.deepEqual(sent[0].flags, ["false", "true"]);
    assert.deepEqual(sent[0].members.map(v => JSON.parse(v).map(x => x.name)), [["CURRENT"]]);
    assert.equal(refreshes, 1);

    const checkbox = target.querySelector('input[name="is_collab"][type="checkbox"]');
    await React.act(async () => checkbox.click());
    assert.equal(checkbox.checked, false);
    const synthetic = target.querySelector('form > section > input[name="members_json"]');
    assert.ok(synthetic);
    synthetic.value = '[{"name":"FORGED_OFF"}]';
    await submit();
    assert.equal(sent.length, 1, "OFF may not smuggle nonempty members");
    synthetic.value = "[]";
    const injectedUnknown = hidden("unrecognized_field", "untrusted");
    await submit();
    assert.equal(sent.length, 1, "unexpected OFF form field must not reach save port");
    assert.equal(refreshes, 1, "unexpected OFF form field must not refresh");
    injectedUnknown.remove();
    await submit();
    assert.equal(sent.length, 2, "canonical OFF request must still save");
    assert.deepEqual(sent[1].flags, ["false"]);
    assert.deepEqual(sent[1].members, ["[]"]);
    assert.equal(refreshes, 2);
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});


test("MIG-0730 U02dq: same-video host authority rotation retires draft and confirmation; stable epoch preserves them", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  let writes = 0;
  const save = async () => { writes++; return { ok: true }; };
  const searchXUsers = async () => ({ items: [], hasMore: false, nextOffset: null });
  const applyPermissionBatch = async () => { writes++; return { ok: true }; };
  const render = async (authorityEpoch, title = "A") => React.act(async () => {
    const snapshot = data("A", "CURRENT");
    snapshot.video.title = title;
    root.render(React.createElement(AdminVideoMembersEditorPreview, {
      videoId: "A", data: snapshot, authorityEpoch, save, searchXUsers, applyPermissionBatch,
    }));
  });
  const editName = async value => {
    const input = target.querySelector('input[placeholder="表示名"]');
    assert.ok(input);
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    assert.equal(formPayload(target)[0].name, value);
  };
  try {
    await render(1);
    await editName("PRIVATE A DRAFT");
    const oldForm = target.querySelector("form");
    await previewPermissionTsv(target, "Bob\tbob\t\t\t\tON");
    await render(1, "renamed metadata");
    assert.equal(target.querySelector("form"), oldForm);
    assert.equal(formPayload(target)[0].name, "PRIVATE A DRAFT");
    assert.ok(target.querySelector('[role="alertdialog"]'));

    // Identical video, canonical members and callable ports; only the host
    // authority changes. Neither private draft nor confirmation may survive.
    await render(2);
    assert.notEqual(target.querySelector("form"), oldForm);
    assert.equal(target.querySelector('[role="alertdialog"]'), null);
    assert.deepEqual(formPayload(target).map(row => row.name), ["CURRENT"]);
    assert.equal(target.querySelector('input[placeholder="表示名"]').value, "CURRENT");
    assert.ok(target.querySelector('button[type="submit"]'));
    await editName("PRIVATE B DRAFT");

    // Return to the original actor via a NEW generation, not a reused token.
    await render(3);
    assert.deepEqual(formPayload(target).map(row => row.name), ["CURRENT"]);
    assert.equal(target.querySelector('input[placeholder="表示名"]').value, "CURRENT");
    assert.equal(target.querySelector('[role="alertdialog"]'), null);
    assert.equal(writes, 0);
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});

test("MIG-0730 U02dq: same-video host rotation cannot apply a late permission receipt to the replacement form", async () => {
  for (const outcome of ["success", "failure"]) {
    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);
    let calls = 0, finish, reject;
    const first = new Promise((resolve, fail) => { finish = resolve; reject = fail; });
    const adapters = {
      save: async () => ({ ok: true }),
      searchXUsers: async () => ({ items: [], hasMore: false, nextOffset: null }),
      applyPermissionBatch: () => ++calls === 1 ? first : Promise.resolve({ ok: true }),
    };
    const render = async authorityEpoch => React.act(async () =>
      root.render(React.createElement(AdminVideoMembersEditorPreview, {
        videoId: "A", data: data("A", "CURRENT"), authorityEpoch, ...adapters,
      })));
    try {
      await render(1);
      await previewPermissionTsv(target, "Bob\tbob\t\t\t\tON");
      await React.act(async () => buttonNamed(target, "変更を反映").click());
      assert.equal(calls, 1);
      await render(2);
      await render(3);
      assert.equal(target.querySelector('[role="alertdialog"]'), null);
      assert.deepEqual(formPayload(target).map(row => row.name), ["CURRENT"]);
      if (outcome === "success") {
        await React.act(async () => finish({ ok: true, message: "OLD AUTHORITY RECEIPT" }));
      } else {
        await React.act(async () => reject(new Error("OLD AUTHORITY RECEIPT")));
      }
      assert.equal(calls, 1);
      assert.deepEqual(formPayload(target).map(row => row.name), ["CURRENT"]);
      assert.doesNotMatch(target.textContent, /OLD AUTHORITY RECEIPT/);
      await previewPermissionTsv(target, "New\tnewuser\t\t\t\tON");
      await React.act(async () => buttonNamed(target, "変更を反映").click());
      assert.equal(calls, 2);
      assert.deepEqual(formPayload(target).map(row => row.name).sort(), ["CURRENT", "New"]);
    } finally {
      finish({ ok: false });
      await React.act(async () => root.unmount());
      target.remove();
    }
  }
});

test("MIG-0730 U02dq: same-video host rotation keeps pending PUT latch and retires old save receipt", async () => {
  for (const outcome of ["success", "failure"]) {
    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);
    const writes = [];
    let refreshes = 0, finish, reject;
    const first = new Promise((resolve, fail) => { finish = resolve; reject = fail; });
    const adapters = {
      save: form => {
        writes.push({ flags: form.getAll("is_collab"), names: JSON.parse(form.get("members_json")).map(row => row.name) });
        return writes.length === 1 ? first : Promise.resolve({ ok: true, message: "NEW AUTHORITY SAVE" });
      },
      searchXUsers: async () => ({ items: [], hasMore: false, nextOffset: null }),
      applyPermissionBatch: async () => ({ ok: true }),
      onSaved: () => { refreshes++; },
    };
    const render = async authorityEpoch => React.act(async () =>
      root.render(React.createElement(AdminVideoMembersEditorPreview, {
        videoId: "A", data: data("A", "CURRENT"), authorityEpoch, ...adapters,
      })));
    const submit = async () => React.act(async () => {
      const event = new dom.window.Event("submit", { bubbles: true, cancelable: true });
      target.querySelector("form").dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
    });
    try {
      await render(1);
      await React.act(async () => target.querySelector('input[name="is_collab"][type="checkbox"]').click());
      assert.deepEqual(formPayload(target), []);
      await submit();
      assert.deepEqual(writes, [{ flags: ["false"], names: [] }]);
      await render(2);
      await render(3);
      assert.deepEqual(formPayload(target).map(row => row.name), ["CURRENT"]);
      await submit();
      assert.equal(writes.length, 1, "old same-video PUT remains latched across authority remount");
      assert.match(target.textContent, /前の保存処理が完了していません/);
      if (outcome === "success") {
        await React.act(async () => finish({ ok: true, message: "OLD AUTHORITY SAVE" }));
      } else {
        await React.act(async () => reject(new Error("OLD AUTHORITY SAVE")));
      }
      assert.equal(refreshes, 0);
      assert.doesNotMatch(target.textContent, /OLD AUTHORITY SAVE/);
      assert.equal(writes.length, 1);
      await submit();
      assert.deepEqual(writes[1], { flags: ["false", "true"], names: ["CURRENT"] });
      assert.equal(refreshes, 1);
      assert.match(target.textContent, /NEW AUTHORITY SAVE/);
    } finally {
      finish({ ok: false });
      await React.act(async () => root.unmount());
      target.remove();
    }
  }
});

test("MIG-0730 U02dq: malformed supplied host generation fails closed before reading member DTO", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  let reads = 0;
  const payload = { get initialMembers() { reads++; throw new Error("PRIVATE"); } };
  try {
    for (const authorityEpoch of [null, "1", NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await React.act(async () => root.render(React.createElement(AdminVideoMembersEditorPreview, {
        videoId: "A", data: payload, authorityEpoch,
        save: async () => ({ ok: true }),
        searchXUsers: async () => ({ items: [] }),
        applyPermissionBatch: async () => ({ ok: true }),
      })));
      assert.match(target.textContent, /参加者データを表示できません/);
      assert.equal(target.querySelector('input[name="members_json"]'), null);
      assert.equal(target.querySelector('button[type="submit"]'), null);
    }
    assert.equal(reads, 0);
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});

test("MIG-0730 U02ds: bound editor cannot read a DTO or enable writes when authority becomes unknown", async () => {
  for (const unknown of [undefined, null]) {
    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);
    let reads = 0, writes = 0, searches = 0;
    const privatePayload = { get initialMembers() { reads++; throw Error("OLD_AUTHORITY"); } };
    const adapters = {
      save: async () => { writes++; return { ok: true }; },
      searchXUsers: async () => { searches++; return { items: [], hasMore: false, nextOffset: null }; },
      applyPermissionBatch: async () => { writes++; return { ok: true }; },
    };
    const render = async (authorityEpoch, payload) => React.act(async () =>
      root.render(React.createElement(AdminVideoMembersEditorPreview, {
        videoId: "A", data: payload, authorityEpoch, ...adapters,
      })));
    try {
      await render(7, data("A", "OLD_AUTHORITY"));
      assert.equal(formPayload(target)[0].name, "OLD_AUTHORITY");
      await previewPermissionTsv(target, "Bob\tbob\t\t\t\tON");
      assert.ok(target.querySelector('[role="alertdialog"]'));
      await render(unknown, privatePayload);
      await render(undefined, privatePayload);
      assert.match(target.textContent, /参加者データを表示できません/);
      assert.equal(target.querySelector("form"), null);
      assert.equal(target.querySelector('[role="alertdialog"]'), null);
      assert.doesNotMatch(target.textContent, /OLD_AUTHORITY/);
      assert.equal(reads, 0);
      assert.equal(writes, 0);
      const searchesBeforeReentry = searches;
      await render(8, data("A", "FRESH_AUTHORITY"));
      assert.equal(formPayload(target)[0].name, "FRESH_AUTHORITY");
      assert.equal(target.querySelector('[role="alertdialog"]'), null);
      assert.ok(target.querySelector('button[type="submit"]'));
      assert.equal(writes, 0);
      assert.equal(searches, searchesBeforeReentry);
    } finally {
      await React.act(async () => root.unmount());
      target.remove();
    }
  }
});

test("MIG-0730 U02ds: explicit unknown editor authority from first render remains closed on omission", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  let reads = 0;
  const payload = { get initialMembers() { reads++; throw Error("PRIVATE"); } };
  const render = async (authorityEpoch, snapshot) => React.act(async () =>
    root.render(React.createElement(AdminVideoMembersEditorPreview, {
      videoId: "A", data: snapshot, authorityEpoch,
    })));
  try {
    await render(null, payload);
    await render(undefined, payload);
    assert.equal(reads, 0);
    assert.match(target.textContent, /参加者データを表示できません/);
    assert.equal(target.querySelector("form"), null);
    await render(0, data("A", "FRESH_AUTHORITY"));
    assert.equal(formPayload(target)[0].name, "FRESH_AUTHORITY");
  } finally {
    await React.act(async () => root.unmount());
    target.remove();
  }
});


test("MIG-0730 U02dw: injected permission receipt fields are snapshotted before applying rows", async () => {
  const unverified = "編集権限の反映結果を確認できませんでした。状態を再取得してください。";
  const cases = [
    { label: "failure cannot turn into success", firstOk: false, laterOk: true,
      firstMessage: "確認済みの拒否", expected: "確認済みの拒否", applied: false },
    { label: "confirmed success cannot turn into failure", firstOk: true, laterOk: false,
      firstMessage: "確認済みの成功", applied: true },
    { label: "absent message cannot become private text", firstOk: false, laterOk: false,
      firstMessage: undefined, expected: "反映に失敗しました。", applied: false },
    { label: "oversized message cannot become a valid success", firstOk: true, laterOk: true,
      firstMessage: "x".repeat(301), expected: unverified, applied: false },
    { label: "throwing message is an unverified receipt", firstOk: true, laterOk: true,
      throwMessage: true, expected: unverified, applied: false },
    { label: "malformed ok must not read message", firstOk: "true", laterOk: true,
      throwMessage: true, expected: unverified, applied: false },
  ];
  for (const scenario of cases) {
    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);
    let requests = 0, okReads = 0, messageReads = 0;
    const receipt = {
      get ok() { return ++okReads === 1 ? scenario.firstOk : scenario.laterOk; },
      get message() {
        messageReads++;
        if (scenario.throwMessage) throw Error("PRIVATE_THROW");
        return messageReads === 1 ? scenario.firstMessage : "PRIVATE_LATER";
      },
    };
    try {
      await React.act(async () => root.render(React.createElement(
        AdminVideoMembersEditorPreview, {
          videoId: "A", data: data("A", "CURRENT"),
          save: async () => ({ ok: true }),
          searchXUsers: async () => ({ items: [], hasMore: false, nextOffset: null }),
          applyPermissionBatch: async () => { requests++; return receipt; },
        },
      )));
      await previewPermissionTsv(target, "Bob\tbob\t\t\t\tON");
      await React.act(async () => buttonNamed(target, "変更を反映").click());
      assert.equal(requests, 1, scenario.label);
      assert.equal(okReads, 1, scenario.label + " ok read count");
      assert.equal(messageReads, typeof scenario.firstOk === "boolean" ? 1 : 0,
        scenario.label + " message read count");
      const dialog = target.querySelector('[role="alertdialog"]');
      if (scenario.applied) {
        assert.equal(dialog, null, scenario.label);
        assert.deepEqual(formPayload(target).map(x => x.name).sort(), ["Bob", "CURRENT"]);
      } else {
        assert.ok(dialog, scenario.label);
        assert.deepEqual(formPayload(target).map(x => x.name), ["CURRENT"]);
        assert.ok(dialog.textContent.includes(scenario.expected), scenario.label);
        assert.equal(buttonNamed(target, "変更を反映").disabled, false,
          "settled refusal releases the UI latch for an explicit later action");
      }
      assert.doesNotMatch(target.textContent, /PRIVATE_LATER|PRIVATE_THROW/);
    } finally {
      await React.act(async () => root.unmount());
      target.remove();
    }
  }
});
