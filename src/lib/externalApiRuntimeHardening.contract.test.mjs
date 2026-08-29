import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relative) => readFile(path.join(root, relative), "utf8");

const [externalApiSource, gaAuthSource, gaDataApiSource] = await Promise.all([
  read("workers/shared/externalApi.ts"),
  read("workers/ga-analytics/auth.ts"),
  read("workers/ga-analytics/dataApi.ts"),
]);

test("external API helperは事前caller abortを予算消費より先に伝播する", () => {
  const abortCheck = externalApiSource.indexOf("callerSignal?.throwIfAborted();");
  const budgetConsume = externalApiSource.indexOf("options.budget.consume()");
  assert.ok(abortCheck >= 0 && budgetConsume > abortCheck);
});

test("external API helperはcaller abortをnetwork errorへ変換しない", () => {
  assert.match(
    externalApiSource,
    /if \(abortSource === "caller"\) \{\s*callerSignal\?\.throwIfAborted\(\);/,
  );
  assert.match(
    externalApiSource,
    /if \(controller\.signal\.aborted\) \{\s*await cancelResponseBody\(response\);/,
  );
});

test("GA4 OAuth JSON parseはabortをinvalid_jsonへ誤変換しない", () => {
  assert.match(
    gaAuthSource,
    /catch \{\s*signal\?\.throwIfAborted\(\);\s*await cancelResponseBody\(response\);\s*throw new Error\("ga4_oauth_invalid_json"\);/,
  );
  const invalidJson = gaAuthSource.indexOf('throw new Error("ga4_oauth_invalid_json")');
  const postParseAbort = gaAuthSource.indexOf("signal?.throwIfAborted();", invalidJson);
  assert.ok(invalidJson >= 0 && postParseAbort > invalidJson);
  assert.match(
    gaAuthSource,
    /catch \{\s*signal\?\.throwIfAborted\(\);\s*\/\/ KV 障害/,
  );
});

test("GA4 report JSON parseはabortをinvalid_jsonへ誤変換しない", () => {
  assert.match(
    gaDataApiSource,
    /catch \{\s*signal\?\.throwIfAborted\(\);\s*await cancelResponseBody\(response\);\s*throw new Error\("ga4_report_invalid_json"\);/,
  );
  const invalidJson = gaDataApiSource.indexOf('throw new Error("ga4_report_invalid_json")');
  const postParseAbort = gaDataApiSource.indexOf("signal?.throwIfAborted();", invalidJson);
  assert.ok(invalidJson >= 0 && postParseAbort > invalidJson);
});

test("GA4 report paginationは5ページでfail-closedにする", () => {
  assert.match(gaDataApiSource, /GA4_REPORT_PAGE_SIZE = 10_000/);
  assert.match(gaDataApiSource, /GA4_REPORT_MAX_PAGES = 5/);
  assert.match(
    gaDataApiSource,
    /if \(pageCount >= GA4_REPORT_MAX_PAGES\) \{\s*throw new Error\("ga4_report_too_large"\);/,
  );
  assert.match(
    gaDataApiSource,
    /if \(rows\.length > GA4_REPORT_PAGE_SIZE\) \{\s*throw new Error\("ga4_report_page_too_large"\);/,
  );
});
