import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { captureVideoEvidence } from "./videoScreenshotCapture.mjs";

test("MIG-0507 U12 captures member-present 390/1440 evidence without claiming mock parity",
  { skip: process.platform === "win32" ? "POSIX CLI executable stub" : false }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fn-u12-video-"));
    const output = path.join(root, "shots");
    fs.mkdirSync(output);
    const cli = path.join(root, "playwright-stub");
    const makeStub = (mode = "good") => [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const zlib = require('node:zlib');",
      "const a = process.argv;",
      "const i = a.indexOf('--viewport-size');",
      "if (i === -1 || a[a.length-2].includes('flamenode.net')) process.exit(3);",
      "const dimensions = a[i+1].split(',').map(Number);",
      "const width = " + (mode === "wrongsize" ? "1" : "dimensions[0]") + ";",
      "const height = dimensions[1];",
      "function crc32(bytes) {",
      "  let c = 0xffffffff;",
      "  for (const b of bytes) {",
      "    c ^= b;",
      "    for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);",
      "  }",
      "  return (c ^ 0xffffffff) >>> 0;",
      "}",
      "function chunk(type, payload) {",
      "  const tag = Buffer.from(type);",
      "  const len = Buffer.alloc(4); len.writeUInt32BE(payload.length);",
      "  const data = Buffer.concat([tag, payload]);",
      "  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(data));",
      "  return Buffer.concat([len, data, crc]);",
      "}",
      "const ihdr = Buffer.alloc(13);",
      "ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);",
      "ihdr[8] = 8; ihdr[9] = 0;",
      "let png = Buffer.concat([",
      "  Buffer.from([137,80,78,71,13,10,26,10]),",
      "  chunk('IHDR', ihdr),",
      "  chunk('IDAT', zlib.deflateSync(Buffer.alloc(height * (width + 1)))),",
      "  chunk('IEND', Buffer.alloc(0)),",
      "]);",
      ...(mode === "badcrc" ? ["png[png.length - 1] ^= 1;"] : []),
      ...(mode === "truncated" ? ["png = png.subarray(0, png.length - 8);"] : []),
      "fs.writeFileSync(a[a.length-1],png);",
    ].join("\n") + "\n";
    fs.writeFileSync(cli, makeStub());
    fs.chmodSync(cli, 0o755);

    let missingMembers = false;
    let redirect = false;
    const server = createServer((req, res) => {
      if (req.url !== "/member-video/") { res.writeHead(404); res.end(); return; }
      if (redirect) {
        res.writeHead(302, { Location: "https://example.com/" }); res.end(); return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(missingMembers ? "<html><body>No members</body></html>" :
        '<!doctype html><html><main><div class="vd-mrow">Member</div></main></html>');
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = "http://127.0.0.1:" + server.address().port;
    try {
      await assert.rejects(captureVideoEvidence("https://flamenode.net", "member-video", output, cli),
        /loopback/);
      await assert.rejects(captureVideoEvidence(origin, "../admin", output, cli),
        /safe route segment/);
      await assert.rejects(captureVideoEvidence(origin, "member-video", root, cli),
        /empty/);
      missingMembers = true;
      await assert.rejects(captureVideoEvidence(origin, "member-video", output, cli),
        /no rendered member rows/);
      missingMembers = false;
      redirect = true;
      await assert.rejects(captureVideoEvidence(origin, "member-video", output, cli),
        /without redirect/);
      redirect = false;

      const evidence = await captureVideoEvidence(origin, "member-video", output, cli);
      assert.equal(evidence.memberRows, 1);
      assert.equal(evidence.screenshotCount, 2);
      assert.equal(evidence.visualComparison, "NOT_REVIEWED");
      assert.equal(evidence.permissionParity, "NOT_REVIEWED");
      assert.equal(evidence.productionSample, false);
      assert.deepEqual(evidence.files.map(x => x.viewport), ["390x844", "1440x900"]);
      assert.deepEqual(evidence.files.map(x => x.imageSize), ["390x844", "1440x900"]);
      assert.deepEqual(evidence.files.map(x => x.mockReference), [
        "docs/migration/mock/screenshots/VideoDetail.mobile.jpg",
        "docs/migration/mock/screenshots/VideoDetail.desktop.jpg",
      ]);
      assert.ok(evidence.files.every(x => x.bytes > 57 && /^[a-f0-9]{64}$/.test(x.sha256)));
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, "evidence.json"), "utf8")), evidence);
      await assert.rejects(captureVideoEvidence(origin, "member-video", output, cli),
        /empty/);
      for (const name of fs.readdirSync(output)) fs.unlinkSync(path.join(output, name));

      fs.writeFileSync(cli, makeStub("wrongsize"));
      await assert.rejects(captureVideoEvidence(origin, "member-video", output, cli),
        /PNG dimensions mismatch/);
      assert.deepEqual(fs.readdirSync(output), [], "partial evidence must be removed");
      fs.writeFileSync(cli, makeStub("badcrc"));
      await assert.rejects(captureVideoEvidence(origin, "member-video", output, cli),
        /invalid PNG: chunk CRC mismatch/);
      assert.deepEqual(fs.readdirSync(output), [], "bad CRC cannot leave partial evidence");

      fs.writeFileSync(cli, makeStub("truncated"));
      await assert.rejects(captureVideoEvidence(origin, "member-video", output, cli),
        /invalid PNG: missing IDAT or IEND/);
      assert.deepEqual(fs.readdirSync(output), [], "missing IEND cannot leave partial evidence");

    } finally {
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
