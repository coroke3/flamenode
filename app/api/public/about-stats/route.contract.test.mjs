import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

test("about-stats Cache APIはqueryによるcache-bypassを許さずwaitUntilで保存する", () => {
  assert.match(source, /\/api\/public\/about-stats/);
  assert.doesNotMatch(source, /new Request\(req\.url/);
  assert.match(source, /context\.ctx\.waitUntil\(write\)/);
  assert.match(source, /await cachePublicResponse\(cache, cacheKey, response\.clone\(\)\)/);
});

test("SEC-754: CURRENT R2 catch executes fixed diagnostic and survives poisoned logger", () => {
  const marker = 'console.warn("[about-stats] compact R2 stats read failed")';
  const markerIndex = source.lastIndexOf(marker);
  assert.ok(markerIndex > 0, "source must emit only the fixed diagnostic");
  const blockStart = source.lastIndexOf("  } catch {", markerIndex);
  const blockEnd = source.indexOf("\n  }\n", markerIndex);
  assert.ok(blockStart >= 0 && blockEnd > markerIndex, "extract the real GET catch block");
  const catchBlock = source.slice(blockStart, blockEnd + "\n  }".length);
  const probe = `(function () {
    try {
      const provider = new Error("SEC754_PROVIDER_SECRET");
      Object.defineProperty(provider, "name", {
        get() { throw new Error("SEC754_THROWING_NAME_GETTER"); },
      });
      throw provider;
    ${catchBlock}
  })()`;
  const invoke = (warn) => runInNewContext(probe, {
    console: { warn },
    unavailable: () => 503,
  });
  const warnings = [];
  assert.equal(invoke((...args) => warnings.push(args.join(" "))), 503);
  assert.deepEqual(warnings, ["[about-stats] compact R2 stats read failed"]);
  assert.equal(invoke(() => { throw new Error("SEC754_LOG_SINK_SECRET"); }), 503);
});
