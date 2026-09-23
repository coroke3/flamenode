import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { parseCanonicalXId } from "../../lib/utils/xid.ts";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("./VideoCollabPermsManager.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText;

function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== "object" || !node.props) return [];
  return [node, ...descendants(node.props.children)];
}

function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object") return textContent(node.props?.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}

// Execute the real component's event handlers. Hooks are deterministic here so
// a second click can be delivered before React commits its pending-state render.
function harness({ action, refresh = () => {}, mode = "event" }) {
  const slots = [];
  let cursor = 0;
  const transitions = [];
  const calls = [];
  let refreshCount = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value) => {
        slots[index] = typeof value === "function" ? value(slots[index]) : value;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useTransition() {
      return [false, (run) => {
        transitions.push(Promise.resolve().then(run).then(
          () => ({ ok: true }),
          (error) => ({ ok: false, error }),
        ));
      }];
    },
  };
  const recordAction = (kind) => async (input) => {
    calls.push({ kind, input });
    return action(input);
  };
  const mocks = {
    react,
    "next/navigation": { useRouter: () => ({ refresh: () => {
      refreshCount += 1;
      refresh();
    } }) },
    "@/components/ui/Icon": { Icon: () => null },
    "@/lib/actions/video-collab-perms": {
      upsertVideoCollaborator: recordAction("grant"),
      applyVideoCollaboratorPermissionsBatch: recordAction("revoke"),
    },
    "@/lib/notifications/templates/video": {
      buildVideoEditPermissionGrantedNotification: () => ({ content: "通知プレビュー" }),
    },
    "@/lib/utils/xid": { parseCanonicalXId },
    "./VideoCollabPermsManager.module.css": {},
  };
  const testModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (id) => Object.hasOwn(mocks, id) ? mocks[id] : require(id),
    testModule,
    testModule.exports,
  );
  function render() {
    cursor = 0;
    return testModule.exports.VideoCollabPermsManager({
      videoId: "vid-test",
      videoTitle: "作品",
      editPrivilegeMode: mode,
      subjects: [{
        x_user_id: "alice", user_id: null, display_name: "Alice",
        can_edit: 1, is_public_member: 1,
      }],
    });
  }
  function confirmation(kind) {
    let tree = render();
    if (kind === "grant") {
      const add = descendants(tree).find((node) => node.type?.name === "AddHiddenEditorForm");
      add.props.onAdd({ x_user_id: "@Bob", display_name: "Bob" });
    } else {
      const button = descendants(tree).find((node) =>
        node.type === "button" && textContent(node) === "変更");
      button.props.onClick();
    }
    tree = render();
    const dialog = descendants(tree).find((node) =>
      node.type?.name === "PermissionDialog" && node.props.open);
    return dialog.props.actions[0].onClick;
  }
  return {
    calls, confirmation, render,
    get refreshCount() { return refreshCount; },
    async settle() {
      const results = await Promise.all(transitions);
      assert.ok(results.every((result) => result.ok), "action rejection must not escape the transition");
    },
  };
}

for (const kind of ["grant", "revoke"]) {
  test(`${kind}: transport failure stays on the permission screen and allows an explicit retry`, async () => {
    let attempt = 0;
    const h = harness({ action: async () => {
      if (++attempt === 1) throw new Error("private upstream failure");
      return { ok: true, message: "権限を保存しました。" };
    } });
    h.confirmation(kind)();
    await h.settle();
    const alert = descendants(h.render()).find((node) => node.props.role === "alert");
    assert.ok(alert, "a retryable error must be shown");
    assert.match(textContent(alert), /確認/);
    assert.doesNotMatch(textContent(alert), /private upstream/);
    assert.equal(h.refreshCount, 0);
    h.confirmation(kind)();
    await h.settle();
    assert.equal(h.calls.length, 2);
    assert.equal(h.refreshCount, 1);
    assert.equal(descendants(h.render()).some((node) => node.props.role === "alert"), false);
  });

  test(`${kind}: double confirmation sends exactly one request before pending renders`, async () => {
    let resolve;
    const result = new Promise((done) => { resolve = done; });
    const h = harness({ action: () => result });
    const click = h.confirmation(kind);
    click();
    click();
    await Promise.resolve();
    assert.equal(h.calls.length, 1);
    const input = h.calls[0].input;
    assert.equal(input instanceof FormData ? input.get("edit_privilege_mode") : input.edit_privilege_mode, "event");
    if (kind === "grant") assert.equal(input.get("x_user_id"), "bob");
    else assert.equal(input.intents[0].intent, "off");
    resolve({ ok: true });
    await h.settle();
    assert.equal(h.refreshCount, 1);
  });

  test(`${kind}: a server denial remains a denial without refreshing`, async () => {
    const h = harness({ action: async () => ({ ok: false, message: "権限がありません。" }) });
    h.confirmation(kind)();
    await h.settle();
    const alert = descendants(h.render()).find((node) => node.props.role === "alert");
    assert.equal(textContent(alert).trim(), "権限がありません。");
    assert.equal(h.refreshCount, 0);
  });

  test(`${kind}: refresh failure cannot reverse a successful permission change`, async () => {
    const h = harness({
      action: async () => ({ ok: true, message: "権限を保存しました。" }),
      refresh: () => { throw new Error("refresh unavailable"); },
    });
    h.confirmation(kind)();
    await h.settle();
    assert.match(textContent(h.render()), /権限を保存しました/);
    assert.match(textContent(h.render()), /再読み込み/);
    assert.equal(descendants(h.render()).some((node) => node.props.role === "alert"), false);
    assert.equal(h.calls.length, 1);
  });
}
