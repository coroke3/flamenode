import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SQUARE_ICON_OUTPUT_SIZE,
  createIconPreviewError,
  drawSquareIconPreview,
  encodeSquareIconFile,
  getCoverBaseScale,
  isIconPreviewError,
  isValidBitmap,
  sanitizeTransform,
} from "./squareIconEncode.ts";

const readSource = () =>
  readFileSync(fileURLToPath(new URL("./squareIconEncode.ts", import.meta.url)), "utf8");

test("getCoverBaseScale は cover 用の最大スケールを返す", () => {
  assert.equal(getCoverBaseScale(100, 200, 280), 2.8);
  assert.equal(getCoverBaseScale(400, 100, 280), 2.8);
  assert.equal(getCoverBaseScale(280, 280, 280), 1);
  assert.equal(getCoverBaseScale(560, 280, 280), 1);
});

test("getCoverBaseScale は無効な寸法で ICON_PREVIEW_FAILED を投げる", () => {
  assert.throws(() => getCoverBaseScale(0, 200, 280), (err) => isIconPreviewError(err));
  assert.throws(() => getCoverBaseScale(100, NaN, 280), (err) => isIconPreviewError(err));
  assert.throws(() => getCoverBaseScale(100, 200, -1), (err) => isIconPreviewError(err));
});

test("SQUARE_ICON_OUTPUT_SIZE は 256", () => {
  assert.equal(SQUARE_ICON_OUTPUT_SIZE, 256);
});

test("sanitizeTransform は scale をクランプし有限 offset を返す", () => {
  assert.deepEqual(sanitizeTransform({ offsetX: 5, offsetY: -3, scale: 0.5 }), {
    offsetX: 5,
    offsetY: -3,
    scale: 1,
  });
  assert.deepEqual(sanitizeTransform({ offsetX: NaN, offsetY: Infinity, scale: 9 }), {
    offsetX: 0,
    offsetY: 0,
    scale: 3,
  });
});

test("isValidBitmap は有限かつ正の寸法だけ true", () => {
  assert.equal(isValidBitmap({ width: 100, height: 200 }), true);
  assert.equal(isValidBitmap({ width: 0, height: 200 }), false);
  assert.equal(isValidBitmap({ width: NaN, height: 200 }), false);
  assert.equal(isValidBitmap({ width: 100, height: Infinity }), false);
});

test("ソース契約: WebP 優先・PNG フォールバック・clearRect・256 出力", () => {
  const source = readSource();
  assert.match(source, /SQUARE_ICON_OUTPUT_SIZE|OUTPUT_SIZE\s*=\s*256/);
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

test("drawSquareIconPreview は無効 bitmap で drawImage を呼ばず ICON_PREVIEW_FAILED", () => {
  const ctx = {
    clearRect: () => {},
    drawImage: () => {
      throw new Error("drawImage should not be called");
    },
  };
  assert.throws(
    () => drawSquareIconPreview(ctx, { width: 0, height: 100 }, 280, { offsetX: 0, offsetY: 0, scale: 1 }),
    (err) => isIconPreviewError(err),
  );
});

test("drawSquareIconPreview は NaN scale をサニタイズして drawImage する", () => {
  const calls = [];
  const ctx = {
    clearRect: () => {},
    drawImage: (...args) => calls.push(args),
  };
  drawSquareIconPreview(ctx, { width: 200, height: 100 }, 280, {
    offsetX: 0,
    offsetY: 0,
    scale: NaN,
  });
  assert.equal(calls.length, 1);
  const drawArgs = calls[0];
  assert.ok(Number.isFinite(drawArgs[1]));
  assert.ok(Number.isFinite(drawArgs[2]));
  assert.ok(Number.isFinite(drawArgs[3]));
  assert.ok(Number.isFinite(drawArgs[4]));
  assert.ok(drawArgs[3] > 0);
  assert.ok(drawArgs[4] > 0);
});

test("drawSquareIconPreview は drawImage 失敗を ICON_PREVIEW_FAILED で包む", () => {
  const ctx = {
    clearRect: () => {},
    drawImage: () => {
      throw new Error("canvas failure");
    },
  };
  assert.throws(
    () =>
      drawSquareIconPreview(ctx, { width: 200, height: 100 }, 280, {
        offsetX: 0,
        offsetY: 0,
        scale: 1,
      }),
    (err) => isIconPreviewError(err) && err.message.includes("drawImage failed"),
  );
});

test("createIconPreviewError は code を付与する", () => {
  const err = createIconPreviewError("ICON_PREVIEW_FAILED: test");
  assert.equal(err.code, "ICON_PREVIEW_FAILED");
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

test("encodeSquareIconFile は WebP を優先し 256 キャンバスで変換する", async () => {
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

test("encodeSquareIconFile は canvas を 256x256 に設定する", async () => {
  let canvasWidth = 0;
  let canvasHeight = 0;
  globalThis.document = {
    createElement: () => {
      const canvas = {
        get width() {
          return canvasWidth;
        },
        set width(v) {
          canvasWidth = v;
        },
        get height() {
          return canvasHeight;
        },
        set height(v) {
          canvasHeight = v;
        },
        getContext: () => ({
          clearRect: () => {},
          drawImage: () => {},
        }),
        toBlob: (callback, type) => {
          callback(new Blob(["mock"], { type }));
        },
      };
      return canvas;
    },
  };

  const bitmap = { width: 100, height: 100, close: () => {} };
  await encodeSquareIconFile(bitmap, 280, { offsetX: 0, offsetY: 0, scale: 1 }, "photo.jpg");
  assert.equal(canvasWidth, 256);
  assert.equal(canvasHeight, 256);
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

test("encodeSquareIconFile は無効 bitmap で ICON_PREVIEW_FAILED", async () => {
  const bitmap = { width: 0, height: 100, close: () => {} };
  await assert.rejects(
    () =>
      encodeSquareIconFile(bitmap, 280, { offsetX: 0, offsetY: 0, scale: 1 }, "photo.jpg"),
    (err) => isIconPreviewError(err),
  );
});
