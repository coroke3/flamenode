import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./activeXSwitchEvents.ts", import.meta.url),
  "utf8",
);

test("activeXSwitchEvents は before/changed イベント定数と dispatch を export する", () => {
  assert.match(source, /export const ACTIVE_X_BEFORE_SWITCH_EVENT/);
  assert.match(source, /export const ACTIVE_X_CHANGED_EVENT/);
  assert.match(source, /export function dispatchBeforeActiveXSwitch/);
  assert.match(source, /export function dispatchActiveXChanged/);
  assert.match(source, /return !event\.defaultPrevented/);
});

test("dispatchBeforeActiveXSwitch は preventDefault で false を返す", async () => {
  const { dispatchBeforeActiveXSwitch, ACTIVE_X_BEFORE_SWITCH_EVENT } =
    await import("./activeXSwitchEvents.ts");

  class MockEvent {
    type;
    detail;
    cancelable;
    defaultPrevented = false;

    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
      this.cancelable = options.cancelable ?? false;
    }

    preventDefault() {
      this.defaultPrevented = true;
    }
  }

  globalThis.CustomEvent = MockEvent;
  globalThis.window = {
    dispatchEvent(event) {
      if (event.type === ACTIVE_X_BEFORE_SWITCH_EVENT) {
        event.preventDefault();
      }
      return true;
    },
  };

  assert.equal(
    dispatchBeforeActiveXSwitch({ fromXId: null, toXId: "foo" }),
    false,
  );

  delete globalThis.window;
  delete globalThis.CustomEvent;
});
