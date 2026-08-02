import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("approved X helper は x_user_account_links と approved だけを参照する", () => {
  const source = read("src/lib/auth/approvedX.ts");
  assert.match(source, /xUserAccountLinks/);
  assert.match(source, /approval_status,\s*"approved"/);
  assert.doesNotMatch(source, /approval_status,\s*"imported"/);
});

test("event ownership は approved helper を使う", () => {
  const source = read("src/lib/event/eventOwnership.ts");
  assert.match(source, /getApprovedLinkedXUserIds/);
  assert.doesNotMatch(source, /from\(xUserAccountLinks\)/);
});

test("ownership.getApprovedXIds は approved helper へ委譲する", () => {
  const source = read("src/lib/auth/ownership.ts");
  assert.match(source, /getApprovedLinkedXUserIds/);
});

test("xid-admin は decision metadata と static rebuild を同一 batch に含める", () => {
  const source = read("src/lib/actions/xid-admin.ts");
  assert.match(source, /buildXIdentityDecisionFields/);
  assert.match(source, /buildStaticRebuildQueueBatch/);
  assert.match(source, /users_index/);
  assert.match(source, /staticRebuildWakeSource/);
});

test("deleteLinkedXId は依存関係 guard と SQL blocker を使う", () => {
  const source = read("src/lib/actions/xid.ts");
  assert.match(source, /assessXLinkDeletion/);
  assert.match(source, /xLinkDeletionAllowedSql/);
});
