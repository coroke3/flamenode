import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

function pngDimensions(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(buffer.subarray(0, signature.length), signature);
  assert.equal(buffer.toString("ascii", 12, 16), "IHDR");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

test("brand SEO PNG assets use their declared square and social-card dimensions", async () => {
  const assets = [
    ["../../public/brand/flamenode-icon-32.png", 32, 32],
    ["../../public/brand/flamenode-apple-touch-icon.png", 180, 180],
    ["../../public/brand/flamenode-icon-192.png", 192, 192],
    ["../../public/brand/flamenode-icon-512.png", 512, 512],
    ["../../public/brand/flamenode-icon-maskable-512.png", 512, 512],
    ["../../public/brand/flamenode-social-card.png", 1200, 630],
  ];

  for (const [relativePath, width, height] of assets) {
    const buffer = await readFile(new URL(relativePath, import.meta.url));
    assert.deepEqual(pngDimensions(buffer), { width, height }, relativePath);
  }
});

test("favicon contains dedicated 16, 32 and 48 pixel PNG frames", async () => {
  const favicon = await readFile(new URL("../../public/favicon.ico", import.meta.url));
  assert.equal(favicon.readUInt16LE(0), 0);
  assert.equal(favicon.readUInt16LE(2), 1);
  assert.equal(favicon.readUInt16LE(4), 3);

  const sizes = Array.from({ length: 3 }, (_, index) => {
    const offset = 6 + index * 16;
    return [favicon.readUInt8(offset) || 256, favicon.readUInt8(offset + 1) || 256];
  });
  assert.deepEqual(sizes, [
    [16, 16],
    [32, 32],
    [48, 48],
  ]);
});

test("manifest and root metadata reference the generated brand assets", async () => {
  const [manifest, layout, generator] = await Promise.all([
    readFile(new URL("../../app/manifest.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/generate-brand-seo-assets.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(manifest, /flamenode-icon-192\.png/);
  assert.match(manifest, /flamenode-icon-maskable-512\.png/);
  assert.match(layout, /BRAND_SOCIAL_IMAGE/);
  assert.match(layout, /flamenode-site-structured-data/);
  assert.match(generator, /flamenode-mark\.svg/);
  assert.match(generator, /flamenode-wordmark\.svg/);
});
