import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import { test } from "node:test";

const routes = [
  { path: "../../../app/api/events/route.ts", labels: [
    "[public-events] static index load failed",
    "[public-events] runtime bindings unavailable",
    "[public-events] list query failed",
  ] },
  { path: "../../../app/api/videos/route.ts", labels: [
    "[public-videos] static list load failed",
  ] },
  { path: "../../../app/api/videos/[id]/route.ts", labels: [
    "[public-videos] runtime bindings unavailable",
    "[public-videos] detail query failed",
  ] },
  { path: "../../../apps/api/src/routes/videos/list.ts", labels: [
    "[public-videos] static list load failed",
  ] },
  { path: "../../../apps/api/src/routes/videos/detail.ts", labels: [
    "[public-videos] detail query failed",
  ] },
];

// Execute the source's real catch-body statements without importing Next/Hono
// route adapters. The full projects' build/parity checks still cover imports.
const guardedCatch = /catch \{\s*try \{\s*console\.error\("([^"\n]+)"\);\s*\} catch \{\s*\/\/ Diagnostics must not replace the fixed availability response\.\s*\}\s*return (?:publicServiceUnavailableResponse\("database_unavailable"\)|unavailable\(\));\s*\}/g;

for (const { path, labels } of routes) {
  test(`public route ${path} redacts provider errors and preserves 503 after broken logger`, async () => {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    const catches = [...source.matchAll(guardedCatch)];
    assert.deepEqual(catches.map((m) => m[1]), labels);
    // Provider Error objects, SQL, session tokens, or Proxy getters are never
    // inspected by any of these diagnostic paths.
    assert.doesNotMatch(source, /console\.error\([^;]*,\s*error\)/);

    for (const match of catches) {
      const script = new Script(`(async () => {
        try { throw new Error("SQL token=provider-secret"); }
        ${match[0]}
      })()`);
      for (const loggerThrows of [false, true]) {
        const lines = [];
        const result = await script.runInNewContext({
          Error,
          console: {
            error(...values) {
              lines.push(values);
              if (loggerThrows) throw new Error("logger unavailable");
            },
          },
          publicServiceUnavailableResponse: (reason) => ({ status: 503, reason, cache: "no-store" }),
          unavailable: () => ({ status: 503, reason: "database_unavailable", cache: "no-store" }),
        });
        assert.equal(result.status, 503);
        assert.equal(result.reason, "database_unavailable");
        assert.equal(result.cache, "no-store");
        assert.equal(lines.length, 1);
        assert.equal(lines[0].length, 1);
        assert.equal(lines[0][0], match[1]);
        assert.doesNotMatch(lines[0].join(" "), /provider-secret|SQL|token=/);
      }
    }
  });
}
