import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const route = await readFile(
  new URL("../../../app/api/event-endpoints/[id]/route.ts", import.meta.url),
  "utf8",
);

test("event export logs summarize errors without raw Error/stack payloads", () => {
  assert.match(route, /import \{ safeErrorSummary \} from ".*workers\/shared\/safeLog\.ts"/);
  assert.match(route, /function safeEventExportErrorSummary\(error: unknown\)/);
  assert.equal(
    (route.match(/safeEventExportErrorSummary\(error\)/g) ?? []).length,
    6,
    "all storage/query error logs should use the redacting helper",
  );
  assert.doesNotMatch(
    route,
    /console\.(?:error|warn)\([\s\S]{0,260}\berror,\s*[}\)]/,
  );
});
