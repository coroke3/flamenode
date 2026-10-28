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
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnUqQAAAABJRU5ErkJggg==";
  fs.writeFileSync(goodCli, `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.argv.at(-1), Buffer.from("${png}", "base64"));\n`);
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
    await assert.rejects(captureListingEvidence(origin, output, goodCli), /be empty/);

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
