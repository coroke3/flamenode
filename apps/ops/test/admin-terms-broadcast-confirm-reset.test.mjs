import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { JSDOM } from "jsdom";
import { TermsReacceptBroadcastButton } from
  "../.test-dist/apps/ops/src/routes/admin/TermsReacceptBroadcastButton.js";

async function withBroadcast(api, run) {
  const dom = new JSDOM("<div id='root'></div>", {
    url: "https://flamenode.test/admin/rules",
  });
  const names = [
    "window", "document", "navigator", "Element", "HTMLElement",
    "HTMLInputElement", "Node", "FormData", "Event", "MouseEvent",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  for (const name of names) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name],
    });
  }
  const { createRoot } = await import("react-dom/client");
  const target = dom.window.document.getElementById("root");
  const root = createRoot(target);
  try {
    await React.act(async () => root.render(React.createElement(TermsReacceptBroadcastButton, {
      termsId: "published-terms",
      versionLabel: "2026-11",
      affectedCount: 30,
      api,
    })));
    await run(target, dom.window);
  } finally {
    await React.act(async () => root.unmount());
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    dom.window.close();
  }
}

async function openDialog(target) {
  const trigger = target.querySelector("button");
  assert.ok(trigger);
  await React.act(async () => trigger.click());
  const dialog = target.querySelector('[role="alertdialog"]');
  assert.ok(dialog);
  return dialog;
}

async function confirm(dialog, win) {
  const input = dialog.querySelectorAll("input")[1];
  assert.ok(input);
  await React.act(async () => {
    const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value").set;
    setter.call(input, "TERMS");
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
  const submit = [...dialog.querySelectorAll("button")].find(
    (button) => button.textContent.includes("30 件 enqueue"),
  );
  assert.ok(submit);
  assert.equal(submit.disabled, false);
  return submit;
}

test("backdrop dismissal clears TERMS confirmation just like the Close button", async () => {
  let writes = 0;
  await withBroadcast({ broadcast: async () => { writes++; return { ok: true }; } },
    async (target, win) => {
      const initial = await openDialog(target);
      await confirm(initial, win);
      await React.act(async () => initial.parentElement.click());
      assert.equal(target.querySelector('[role="alertdialog"]'), null);

      const reopened = await openDialog(target);
      assert.equal(reopened.querySelectorAll("input")[1].value, "");
      assert.equal(reopened.querySelectorAll("button")[1].disabled, true,
        "dismissed confirmation must not stay armed");
      await confirm(reopened, win);
      await React.act(async () => {
        [...reopened.querySelectorAll("button")].find((b) => b.textContent === "閉じる").click();
      });
      const reopenedAgain = await openDialog(target);
      assert.equal(reopenedAgain.querySelectorAll("input")[1].value, "");
      assert.equal(reopenedAgain.querySelectorAll("button")[1].disabled, true);
      assert.equal(writes, 0, "dismissing never sends any notification");
    });
});

test("backdrop cancellation preserves batch cursor while requiring fresh TERMS consent", async () => {
  const calls = [];
  await withBroadcast({ broadcast: async (id, confirmation, cursor, content) => {
    calls.push({ id, confirmation, cursor, content });
    return { ok: true, enqueued: calls.length === 1 ? 7 : 5,
      cursor: calls.length === 1 ? "user-1" : "user-2" };
  } }, async (target, win) => {
    const first = await openDialog(target);
    const firstSend = await confirm(first, win);
    await React.act(async () => firstSend.click());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cursor, "");
    assert.equal(first.querySelectorAll("input")[0].value, "user-1");

    await React.act(async () => first.parentElement.click());
    const reopened = await openDialog(target);
    assert.equal(reopened.querySelectorAll("input")[0].value, "user-1",
      "do not lose successful batch progress");
    assert.equal(reopened.querySelectorAll("input")[1].value, "",
      "reopening is not permission to immediately send another batch");
    assert.match(reopened.textContent, /合計 enqueued: 7/);
    assert.equal(calls.length, 1);
    const nextSend = await confirm(reopened, win);
    await React.act(async () => nextSend.click());
    assert.equal(calls.length, 2);
    assert.equal(calls[1].cursor, "user-1");
    assert.equal(calls[1].confirmation, "TERMS");
    assert.equal(reopened.querySelectorAll("input")[0].value, "user-2");
    assert.match(reopened.textContent, /合計 enqueued: 12/);
  });
});
