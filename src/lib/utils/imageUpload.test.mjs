import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectSupportedImageUpload,
  inspectSupportedImageUpload,
  validateIconImageUpload,
} from "./imageUpload.ts";

function pushChunk(parts, type, data) {
  const length = data.length;
  parts.push((length >> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff);
  for (let i = 0; i < 4; i += 1) parts.push(type.charCodeAt(i));
  for (const byte of data) parts.push(byte);
  parts.push(0, 0, 0, 0);
}

function buildPng({ width = 64, height = 64, animated = false } = {}) {
  const parts = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  pushChunk(parts, "IHDR", ihdr);
  if (animated) {
    const actl = new Uint8Array(8);
    new DataView(actl.buffer).setUint32(0, 1);
    new DataView(actl.buffer).setUint32(4, 0);
    pushChunk(parts, "acTL", actl);
  }
  pushChunk(parts, "IDAT", new Uint8Array([0x78, 0x01, 0x01, 0x00, 0x00, 0xff, 0xff]));
  pushChunk(parts, "IEND", new Uint8Array(0));
  return new Uint8Array(parts);
}

function buildJpeg({ width = 64, height = 64 } = {}) {
  const bytes = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
  bytes.push(...new TextEncoder().encode("JFIF\0"), 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00);
  bytes.push(0xff, 0xc0, 0x00, 0x0b, 0x08);
  bytes.push((height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff);
  bytes.push(0x01, 0x01, 0x11, 0x00, 0xff, 0xd9);
  return new Uint8Array(bytes);
}

function pushWebpChunk(parts, type, data) {
  for (let i = 0; i < 4; i += 1) parts.push(type.charCodeAt(i));
  const size = data.length;
  parts.push(size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff);
  for (const byte of data) parts.push(byte);
  if (size % 2 === 1) parts.push(0);
}

function buildWebp({ width = 64, height = 64, animated = false } = {}) {
  const body = [];
  if (animated) {
    const vp8x = new Uint8Array(10);
    vp8x[0] = 0x02;
    const w = width - 1;
    const h = height - 1;
    vp8x[4] = w & 0xff;
    vp8x[5] = (w >> 8) & 0xff;
    vp8x[6] = (w >> 16) & 0xff;
    vp8x[7] = h & 0xff;
    vp8x[8] = (h >> 8) & 0xff;
    vp8x[9] = (h >> 16) & 0xff;
    pushWebpChunk(body, "VP8X", vp8x);
    pushWebpChunk(body, "ANIM", new Uint8Array(6));
  }
  const vp8l = new Uint8Array(10);
  vp8l[0] = 0x2f;
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  vp8l[1] = bits & 0xff;
  vp8l[2] = (bits >> 8) & 0xff;
  vp8l[3] = (bits >> 16) & 0xff;
  vp8l[4] = (bits >> 24) & 0xff;
  pushWebpChunk(body, "VP8L", vp8l);

  const riff = [0x52, 0x49, 0x46, 0x46];
  const riffSize = 4 + body.length;
  riff.push(
    riffSize & 0xff,
    (riffSize >> 8) & 0xff,
    (riffSize >> 16) & 0xff,
    (riffSize >> 24) & 0xff,
    0x57,
    0x45,
    0x42,
    0x50,
    ...body,
  );
  return new Uint8Array(riff);
}

test("detectSupportedImageUpload detects PNG magic number", () => {
  const bytes = buildPng({ width: 1, height: 1 });
  assert.deepEqual(detectSupportedImageUpload(bytes.buffer), {
    contentType: "image/png",
    ext: "png",
  });
});

test("detectSupportedImageUpload detects JPEG magic number", () => {
  const bytes = buildJpeg({ width: 1, height: 1 });
  assert.deepEqual(detectSupportedImageUpload(bytes.buffer), {
    contentType: "image/jpeg",
    ext: "jpg",
  });
});

test("detectSupportedImageUpload rejects text pretending to be an image", () => {
  const bytes = new TextEncoder().encode("<script>alert(1)</script>");
  assert.equal(detectSupportedImageUpload(bytes.buffer), null);
});

test("inspectSupportedImageUpload returns dimensions for PNG/JPEG/WebP", () => {
  const png = buildPng({ width: 128, height: 96 });
  assert.deepEqual(inspectSupportedImageUpload(png.buffer), {
    contentType: "image/png",
    ext: "png",
    width: 128,
    height: 96,
    animated: false,
  });

  const jpeg = buildJpeg({ width: 200, height: 150 });
  assert.deepEqual(inspectSupportedImageUpload(jpeg.buffer), {
    contentType: "image/jpeg",
    ext: "jpg",
    width: 200,
    height: 150,
    animated: false,
  });

  const webp = buildWebp({ width: 80, height: 80 });
  assert.deepEqual(inspectSupportedImageUpload(webp.buffer), {
    contentType: "image/webp",
    ext: "webp",
    width: 80,
    height: 80,
    animated: false,
  });
});

test("inspectSupportedImageUpload detects animated PNG and WebP", () => {
  const apng = buildPng({ width: 64, height: 64, animated: true });
  assert.equal(inspectSupportedImageUpload(apng.buffer)?.animated, true);

  const animatedWebp = buildWebp({ width: 64, height: 64, animated: true });
  assert.equal(inspectSupportedImageUpload(animatedWebp.buffer)?.animated, true);
});

test("inspectSupportedImageUpload rejects GIF and SVG signatures", () => {
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  assert.equal(inspectSupportedImageUpload(gif.buffer), null);

  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert.equal(inspectSupportedImageUpload(svg.buffer), null);
});

test("inspectSupportedImageUpload rejects broken PNG without IHDR dimensions", () => {
  const broken = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
  assert.equal(inspectSupportedImageUpload(broken.buffer), null);
});

test("validateIconImageUpload enforces size, type, dimensions, and animation rules", () => {
  const valid = buildPng({ width: 128, height: 128 });
  assert.deepEqual(
    validateIconImageUpload({
      buffer: valid.buffer,
      declaredType: "image/png",
    }),
    {
      ok: true,
      image: {
        contentType: "image/png",
        ext: "png",
        width: 128,
        height: 128,
        animated: false,
      },
    },
  );

  assert.equal(validateIconImageUpload({ buffer: new ArrayBuffer(0) }).ok, false);
  assert.equal(
    validateIconImageUpload({ buffer: new Uint8Array(2 * 1024 * 1024 + 1).buffer }).ok,
    false,
  );
  assert.equal(
    validateIconImageUpload({
      buffer: valid.buffer,
      declaredType: "image/jpeg",
    }).ok,
    false,
  );
  assert.equal(
    validateIconImageUpload({ buffer: buildPng({ width: 32, height: 32 }).buffer }).ok,
    false,
  );
  assert.equal(
    validateIconImageUpload({ buffer: buildPng({ width: 3000, height: 3000 }).buffer }).ok,
    false,
  );
  assert.equal(
    validateIconImageUpload({ buffer: buildPng({ width: 64, height: 64, animated: true }).buffer })
      .ok,
    false,
  );
});
