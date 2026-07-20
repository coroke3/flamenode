import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");
const read = (path) => readFileSync(join(root, path), "utf8");

function runtimeFiles(start) {
  const out = [];
  const visit = (path) => {
    for (const name of readdirSync(path)) {
      const full = join(path, name);
      const stat = statSync(full);
      if (stat.isDirectory()) visit(full);
      else if (/\.(?:ts|tsx|mjs)$/.test(name)) out.push(full);
    }
  };
  visit(join(root, start));
  return out;
}

const CANONICAL_FORBIDDEN = [
  "x_account_link_requests",
  "x_id_merge_requests",
  "x_id_merge_reverts",
  "linked_user_id",
  "approval_requested_at",
  "x_user_icons",
  "x_user_youtube_channels",
];

test("X名義ランタイムは旧申請表・単一リンク列・旧候補表を参照しない", () => {
  const files = ["src", "app", "workers"].flatMap(runtimeFiles).filter((path) => {
    const rel = relative(root, path).replaceAll("\\", "/");
    return (
      !rel.endsWith("src/lib/db/schema.base.ts") &&
      !rel.endsWith("src/lib/auth/xIdentityCanonical.contract.test.mjs") &&
      !rel.includes("historical")
    );
  });
  const violations = [];
  for (const path of files) {
    const source = readFileSync(path, "utf8");
    for (const token of CANONICAL_FORBIDDEN) {
      if (source.includes(token)) {
        violations.push(`${relative(root, path)}: ${token}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("X名義と認証ユーザーは複合主キーで多対多、承認時に由来とroleを保存する", () => {
  const schema = read("src/lib/db/schema.canonical.ts");
  assert.match(schema, /primaryKey\(\{ columns: \[t\.x_user_id, t\.auth_user_id\] \}\)/);
  assert.doesNotMatch(schema, /uniqueIndex\([^)]*x_user_account_links[^)]*\)\s*\.on\(t\.x_user_id\)/s);

  const admin = read("src/lib/actions/xid-admin.ts");
  assert.match(admin, /x_user_id: requestedXUserId/);
  assert.match(admin, /auth_user_id: requestedAuthUserId/);
  assert.match(admin, /link_role: "owner"/);
  assert.match(admin, /created_by_request_id: request\.id/);
  assert.match(admin, /created_at: now/);
  assert.match(admin, /updated_at: now/);
  assert.match(admin, /同一の X名義と認証ユーザーの組合せ/);
});

test("一般承認と統合・差し戻しは権限境界を分離する", () => {
  const admin = read("src/lib/actions/xid-admin.ts");
  const mergeAdmin = read("src/lib/actions/xid-merge-admin.ts");
  assert.match(admin, /canManageXIdLinkRequests/);
  assert.match(admin, /統合・差し戻し申請は X ID 統合管理/);
  assert.match(mergeAdmin, /user\.role !== "admin"/);
  assert.match(mergeAdmin, /isRevertDeadlineOpen/);
  assert.match(mergeAdmin, /restoreXIdMerge/);
});

test("公開DTOは認証ID・復元情報・内部申請情報を禁止する", () => {
  const dto = read("src/lib/api/publicDto.ts");
  for (const key of [
    "auth_user_id",
    "requested_by_auth_user_id",
    "created_by_request_id",
    "parent_request_id",
    "restore_snapshot_json",
    "revert_deadline_at",
  ]) {
    assert.match(dto, new RegExp(`"${key}"`));
  }
});
