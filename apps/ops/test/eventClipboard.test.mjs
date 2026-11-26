// MIG-0721: CURRENT clipboard behavior and exact source parity; Ops editor remains unmounted.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { writeTextToClipboard } from "../.test-dist/apps/ops/src/lib/event/clipboard.js";

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function restoreGlobal(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}

test.afterEach(() => {
  restoreGlobal("navigator", navigatorDescriptor);
  restoreGlobal("document", documentDescriptor);
});

test("Clipboard APIの成功時はtrueを返しフォールバックを実行しない", async () => {
  let fallbackCalled = false;
  setGlobal("navigator", {
    clipboard: { writeText: async (text) => assert.equal(text, "hello") },
  });
  setGlobal("document", {
    body: { appendChild: () => { fallbackCalled = true; } },
  });

  assert.equal(await writeTextToClipboard("hello"), true);
  assert.equal(fallbackCalled, false);
});

test("Clipboard APIが拒否された場合はDOMフォールバックでコピーする", async () => {
  let removed = false;
  const textarea = {
    value: "",
    style: {},
    setAttribute: () => {},
    focus: () => {},
    select: () => {},
    remove: () => { removed = true; },
  };
  setGlobal("navigator", {
    clipboard: { writeText: async () => { throw new Error("denied"); } },
  });
  setGlobal("document", {
    body: { appendChild: (node) => assert.equal(node, textarea) },
    createElement: (tag) => {
      assert.equal(tag, "textarea");
      return textarea;
    },
    execCommand: (command) => {
      assert.equal(command, "copy");
      assert.equal(textarea.value, "fallback");
      return true;
    },
  });

  assert.equal(await writeTextToClipboard("fallback"), true);
  assert.equal(removed, true);
});

test("Element.removeがないDOMでもフォールバック後に親から削除する", async () => {
  let removed = false;
  const parent = {
    removeChild: (node) => {
      assert.equal(node, textarea);
      removed = true;
    },
  };
  const textarea = {
    value: "",
    style: {},
    parentNode: parent,
    setAttribute: () => {},
    focus: () => {},
    select: () => {},
  };
  setGlobal("navigator", {
    clipboard: { writeText: async () => { throw new Error("denied"); } },
  });
  setGlobal("document", {
    body: { appendChild: (node) => assert.equal(node, textarea) },
    createElement: () => textarea,
    execCommand: () => true,
  });

  assert.equal(await writeTextToClipboard("legacy"), true);
  assert.equal(removed, true);
});

test("ブラウザAPIとDOMがない場合はfalseを返す", async () => {
  setGlobal("navigator", {});
  setGlobal("document", undefined);

  assert.equal(await writeTextToClipboard("no-browser"), false);
});

test("DOM fallback restores the previously focused element on success and failure", async () => {
  for (const copyFails of [false, true]) {
    let focus = "copy-button";
    let removed = false;
    const copyButton = {
      focus: () => {
        assert.equal(removed, true, "temporary textarea must be removed before focus returns");
        focus = "copy-button";
      },
    };
    const textarea = {
      value: "",
      style: {},
      setAttribute: () => {},
      focus: () => { focus = "textarea"; },
      select: () => {},
      remove: () => { removed = true; },
    };
    setGlobal("navigator", {});
    setGlobal("document", {
      activeElement: copyButton,
      body: { appendChild: (node) => assert.equal(node, textarea) },
      createElement: (tag) => {
        assert.equal(tag, "textarea");
        return textarea;
      },
      execCommand: (command) => {
        assert.equal(command, "copy");
        assert.equal(focus, "textarea");
        if (copyFails) throw new Error("copy is blocked");
        return true;
      },
    });

    assert.equal(await writeTextToClipboard("focus"), !copyFails);
    assert.equal(removed, true);
    assert.equal(focus, "copy-button");
  }
});

test("failed focus restoration does not change a successful clipboard result", async () => {
  let removed = false;
  const textarea = {
    value: "",
    style: {},
    setAttribute: () => {},
    focus: () => {},
    select: () => {},
    remove: () => { removed = true; },
  };
  setGlobal("navigator", {});
  setGlobal("document", {
    activeElement: { focus: () => { throw new Error("detached copy button"); } },
    body: { appendChild: () => {} },
    createElement: () => textarea,
    execCommand: () => true,
  });

  assert.equal(await writeTextToClipboard("focus"), true);
  assert.equal(removed, true);
});


test("MIG-0721 keeps the exact CURRENT clipboard implementation", () => {
  const current = readFileSync(new URL("../../../src/lib/utils/clipboard.ts", import.meta.url), "utf8");
  const port = readFileSync(new URL("../src/lib/event/clipboard.ts", import.meta.url), "utf8");
  assert.equal(port, "// Port of CURRENT src/lib/utils/clipboard.ts (MIG-0721). Same output.\n" + current);
});
