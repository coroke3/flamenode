import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = async (relative) =>
  readFile(new URL(relative, import.meta.url), "utf8");

test("approval action normalizes legacy slot snapshots before binding", async () => {
  const source = await read("../actions/xid-admin.ts");
  const section = source.slice(
    source.indexOf("async function bindReservedSlotsOnXApproval"),
  );
  assert.match(
    section,
    /lower\(trim\(ltrim\(\$\{slots\.reserved_x_id_snapshot\}, '@'\)\)\)/,
  );
  assert.doesNotMatch(
    section,
    /eq\(slots\.reserved_x_id_snapshot, args\.submittedXUserId\)/,
  );
});

test("recovery worker uses the same normalized snapshot predicate", async () => {
  const source = await read("../../../workers/content-jobs/xIdSlotBindRecovery.ts");
  assert.match(
    source,
    /lower\(trim\(ltrim\(reserved_x_id_snapshot, '@'\)\)\) = \?5/,
  );
  assert.match(
    source,
    /lower\(trim\(ltrim\(reserved_x_id_snapshot, '@'\)\)\) = \?2/,
  );
});
