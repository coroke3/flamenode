import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSupportedImageUpload } from "./imageUpload.ts";

test("detectSupportedImageUpload detects PNG magic number", () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.deepEqual(detectSupportedImageUpload(bytes.buffer), {
    contentType: "image/png",
    ext: "png",
  });
});

test("detectSupportedImageUpload detects JPEG magic number", () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  assert.deepEqual(detectSupportedImageUpload(bytes.buffer), {
    contentType: "image/jpeg",
    ext: "jpg",
  });
});

test("detectSupportedImageUpload rejects text pretending to be an image", () => {
  const bytes = new TextEncoder().encode("<script>alert(1)</script>");
  assert.equal(detectSupportedImageUpload(bytes.buffer), null);
});
