import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SQUARE_ICON_OUTPUT_SIZE,
  drawSquareIconPreview,
  encodeSquareIconFile,
  getCoverBaseScale,
} from "./squareIconEncode.ts";

const readSource = () =>
  readFileSync(fileURLToPath(new URL("./squareIconEncode.ts", import.meta.url)), "utf8");

test("getCoverBaseScale は cover 用の最大スケールを返す", () => {
  assert.equal(getCoverBaseScale(100, 200, 280), 2.8);
  assert.equal(getCoverBaseScale(400, 100, 280), 2.8);
  assert.equal(getCoverBaseScale(280, 280, 280), 1);
  assert.equal(getCoverBaseScale(560, 280, 280), 1);
});

test("SQUARE_ICON_OUTPUT_SIZE は 512", () => {
  assert.equal(SQUARE_ICON_OUTPUT_SIZE, 512);
});

test("ソース契約: WebP 優先・PNG フォールバック・clearRect・512 出力", () => {
  const source = readSource();
  assert.match(source, /SQUARE_ICON_OUTPUT_SIZE|OUTPUT_SIZE\s*=\s*512/);
  assert.match(source, /image\/webp/);
  assert.match(source, /0\.88/);
  assert.match(source, /image\/png/);
  assert.match(source, /clearRect/);
  assert.doesNotMatch(source, /fillRect/);
});

test("drawSquareIconPreview は clearRect 後に drawImage する", () => {
  const calls = [];
  const ctx = {
    clearRect: (...args) => calls.push(["clearRect", ...args]),
    drawImage: (...args) => calls.push(["drawImage", ...args]),
  };
  const bitmap = { width: 200, height: 100 };
  drawSquareIconPreview(ctx, bitmap, 280, { offsetX: 10, offsetY: -5, scale: 1.2 });

  assert.equal(calls[0][0], "clearRect");
  assert.deepEqual(calls[0].slice(1), [0, 0, 280, 280]);
  assert.equal(calls[1][0], "drawImage");
  assert.equal(calls[1][1], bitmap);
});

const originalDocument = globalThis.document;

beforeEach(() => {
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        clearRect: () => {},
        drawImage: () => {},
      }),
      toBlob: (callback, type, quality) => {
        callback(new Blob(["mock"], { type }));
        void quality;
      },
    }),
  };
});

afterEach(() => {
  globalThis.document = originalDocument;
});

test("encodeSquareIconFile は WebP を優先し 512 キャンバスで変換する", async () => {
  const toBlobCalls = [];
  globalThis.document = {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          clearRect: () => {},
          drawImage: () => {},
        }),
        toBlob: (callback, type, quality) => {
          toBlobCalls.push({ type, quality });
          callback(new Blob(["mock"], { type }));
        },
      };
      return canvas;
    },
  };

  const bitmap = { width: 400, height: 300, close: () => {} };
  const file = await encodeSquareIconFile(
    bitmap,
    280,
    { offsetX: 0, offsetY: 0, scale: 1 },
    "avatar.png",
  );

  assert.equal(toBlobCalls[0]?.type, "image/webp");
  assert.equal(toBlobCalls[0]?.quality, 0.88);
  assert.equal(file.type, "image/webp");
  assert.equal(file.name, "avatar.webp");
});

test("encodeSquareIconFile は WebP 失敗時 PNG にフォールバックする", async () => {
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        clearRect: () => {},
        drawImage: () => {},
      }),
      toBlob: (callback, type) => {
        if (type === "image/webp") {
          callback(null);
          return;
        }
        callback(new Blob(["mock"], { type }));
      },
    }),
  };

  const bitmap = { width: 100, height: 100, close: () => {} };
  const file = await encodeSquareIconFile(
    bitmap,
    280,
    { offsetX: 0, offsetY: 0, scale: 1 },
    "photo.jpg",
  );

  assert.equal(file.type, "image/png");
  assert.equal(file.name, "photo.png");
});

test("encodeSquareIconFile は blob.type 不一致時 PNG にフォールバックする", async () => {
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        clearRect: () => {},
        drawImage: () => {},
      }),
      toBlob: (callback, type) => {
        if (type === "image/webp") {
          callback(new Blob(["mock"], { type: "image/png" }));
          return;
        }
        callback(new Blob(["mock"], { type }));
      },
    }),
  };

  const bitmap = { width: 100, height: 100, close: () => {} };
  const file = await encodeSquareIconFile(
    bitmap,
    280,
    { offsetX: 0, offsetY: 0, scale: 1 },
    "photo.jpg",
  );

  assert.equal(file.type, "image/png");
  assert.equal(file.name, "photo.png");
});

test("encodeSquareIconFile は 0 バイト blob を拒否する", async () => {
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        clearRect: () => {},
        drawImage: () => {},
      }),
      toBlob: (callback) => {
        callback(new Blob([], { type: "image/webp" }));
      },
    }),
  };

  const bitmap = { width: 100, height: 100, close: () => {} };
  await assert.rejects(
    () =>
      encodeSquareIconFile(bitmap, 280, { offsetX: 0, offsetY: 0, scale: 1 }, "photo.jpg"),
    /画像の変換に失敗しました/,
  );
});
