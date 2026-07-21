import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("buildSubmissionXUserPlan は非 approved 行を上書きしない", () => {
  const source = read("./ensureSubmissionXUser.ts");
  assert.match(
    source,
    /existing\.approval_status !== "approved"/,
  );
  assert.match(source, /return emptyVideoAtomicWritePlan\(\)/);
});

test("設定画面は imported を却下扱いにしない", () => {
  const panel = read("../../components/settings/SettingsXAccountPanel.tsx");
  assert.match(panel, /approval_status === "imported"/);
  assert.match(panel, /旧データから移行された X ID です/);
  assert.match(
    panel,
    /pending" \?[\s\S]*imported \?[\s\S]*approval_status === "rejected"/,
  );
});
