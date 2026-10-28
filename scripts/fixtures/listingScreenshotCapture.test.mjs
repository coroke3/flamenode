import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { captureListingEvidence } from "./listingScreenshotCapture.mjs";

test("MIG-0505 U02 capture records six complete images but never claims visual parity",
  { skip: process.platform === "win32" ? "POSIX executable test stub; use WSL/Linux CI" : false }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fn-listing-visual-test-"));
  const output = path.join(dir, "shots");
  fs.mkdirSync(output);
  const goodCli = path.join(dir, "playwright-stub");
  fs.writeFileSync(goodCli, "#!/usr/bin/env node\nconst fs = require(\"node:fs\");\nconst zlib = require(\"node:zlib\");\nconst args = process.argv;\nconst pos = args.indexOf(\"--viewport-size\");\nif (pos < 0) process.exit(3);\nconst [width, height] = args[pos + 1].split(\",\").map(Number);\nconst crc32 = (buf) => { let crc = 0xffffffff; for (const byte of buf) { crc ^= byte; for (let i=0; i<8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };\nfunction chunk(tag, data) { const name = Buffer.from(tag); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([len, name, data, checksum]); }\nconst ihdr = Buffer.alloc(13);\nihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; // 8-bit grayscale\nconst pixels = Buffer.alloc(height * (width + 1)); // zero filter, black scanlines\nconst bytes = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk(\"IHDR\", ihdr), chunk(\"IDAT\", zlib.deflateSync(pixels)), chunk(\"IEND\", Buffer.alloc(0))]);\nfs.writeFileSync(args.at(-1), bytes);\n");
  fs.chmodSync(goodCli, 0o755);
  const server = createServer((req, res) => {
    if (["/list/", "/recommend/", "/trending/"].includes(req.url)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html><body><main>Fixture</main></body></html>");
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(captureListingEvidence("https://flamenode.net", output, goodCli), /loopback origin/);
    const evidence = await captureListingEvidence(origin, output, goodCli);
    assert.equal(evidence.screenshotCount, 6);
    assert.equal(evidence.visualComparison, "NOT_REVIEWED");
    assert.deepEqual(evidence.files.map((x) => x.file), [
      "list.mobile.png", "list.desktop.png", "recommend.mobile.png", "recommend.desktop.png",
      "trending.mobile.png", "trending.desktop.png",
    ]);
    assert.deepEqual(evidence.files.map((x) => x.viewport), [
      "390x844", "1440x900", "390x844", "1440x900", "390x844", "1440x900",
    ]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, "evidence.json"), "utf8")), evidence);
    assert.ok(evidence.files.every((x) => /^[a-f0-9]{64}$/.test(x.sha256) && x.bytes > 8));
    assert.deepEqual(evidence.files.map((x) => x.imageSize), [
      "390x844", "1440x900", "390x844", "1440x900", "390x844", "1440x900",
    ]);
    await assert.rejects(captureListingEvidence(origin, output, goodCli), /be empty/);

    const wrongSizeCli = path.join(dir, "wrong-size-playwright-stub");
    const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnUqQAAAABJRU5ErkJggg==";
    fs.writeFileSync(wrongSizeCli, "#!/usr/bin/env node\\nrequire('node:fs').writeFileSync(process.argv.at(-1), Buffer.from('" + onePixelPng + "', 'base64'));\\n".replaceAll("\\\\n", "\\n"));
    fs.chmodSync(wrongSizeCli, 0o755);
    const wrongSizeOutput = path.join(dir, "wrong-size-shots");
    fs.mkdirSync(wrongSizeOutput);
    await assert.rejects(captureListingEvidence(origin, wrongSizeOutput, wrongSizeCli), /PNG dimensions mismatch/);
    assert.deepEqual(fs.readdirSync(wrongSizeOutput), [], "wrong-size evidence must not remain");

    const corruptCli = path.join(dir, "corrupt-playwright-stub");
    fs.writeFileSync(corruptCli, "#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.argv.at(-1), 'not-a-png');\n");
    fs.chmodSync(corruptCli, 0o755);
    const failedOutput = path.join(dir, "failed-shots");
    fs.mkdirSync(failedOutput);
    await assert.rejects(captureListingEvidence(origin, failedOutput, corruptCli), /valid PNG/);
    assert.deepEqual(fs.readdirSync(failedOutput), [], "partial evidence must not remain after failure");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
