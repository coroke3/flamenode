import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { acquireBodyScrollLock } from "./bodyScrollLock.ts";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

test("bodyScrollLock exports acquireBodyScrollLock", () => {
  const source = readFileSync(
    path.join(root, "src/components/layout/bodyScrollLock.ts"),
    "utf8",
  );
  assert.match(source, /export function\s*\n?acquireBodyScrollLock/);
  assert.match(source, /state\.count/);
  assert.match(source, /window\.scrollTo/);
});

test("VideoUtilityDock uses acquireBodyScrollLock", () => {
  const source = readFileSync(
    path.join(root, "src/components/video/VideoUtilityDock.tsx"),
    "utf8",
  );
  assert.match(source, /acquireBodyScrollLock/);
  assert.doesNotMatch(source, /body\.style\.overflow = "hidden"/);
});

test("bodyScrollLockはsmooth設定に影響されず元の位置へ即時復元する", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const scrollCalls = [];
  const body = {
    style: {
      position: "relative",
      top: "3px",
      left: "4px",
      right: "5px",
      width: "80%",
      overflow: "visible",
      paddingRight: "7px",
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      scrollX: 12,
      scrollY: 697,
      innerWidth: 1024,
      getComputedStyle: () => ({ paddingRight: "7px" }),
      scrollTo: (options) => scrollCalls.push(options),
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { body, documentElement: { clientWidth: 1008 } },
  });

  try {
    const release = acquireBodyScrollLock();
    assert.equal(body.style.position, "fixed");
    assert.equal(body.style.top, "-697px");
    release();

    assert.deepEqual(scrollCalls, [
      { left: 12, top: 697, behavior: "instant" },
    ]);
    assert.deepEqual(body.style, {
      position: "relative",
      top: "3px",
      left: "4px",
      right: "5px",
      width: "80%",
      overflow: "visible",
      paddingRight: "7px",
    });
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      delete globalThis.window;
    }
    if (originalDocument) {
      Object.defineProperty(globalThis, "document", originalDocument);
    } else {
      delete globalThis.document;
    }
  }
});
