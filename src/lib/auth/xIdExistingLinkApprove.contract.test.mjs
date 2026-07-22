import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("既存X名義へのnew_link承認は再申請を要求せず既存連携として処理する", () => {
  const admin = read("../actions/xid-admin.ts");
  const action = read("../actions/xid.ts");

  assert.doesNotMatch(
    admin,
    /既存連携として再申請してください/,
  );
  assert.match(
    admin,
    /再申請を要求せず既存連携として承認する/,
  );
  assert.match(
    admin,
    /同一X IDの重複pending申請を取り消す/,
  );
  assert.match(action, /resolveCanonicalXUserId/);
  assert.match(
    action,
    /canonicalXUserId \|\| existingXUser \? "existing_link" : "new_link"/,
  );
  assert.match(
    action,
    /同一X IDの重複pending申請を取り消す/,
  );
});

test("X ID申請の承認・却下はmutation失敗をerror boundaryへ投げず返す", () => {
  const admin = read("../actions/xid-admin.ts");
  const table = read("../../components/admin/XLinkRequestTable.tsx");

  assert.match(admin, /function mutationError\(error: unknown\): XIdAdminResult/);
  assert.match(
    admin,
    /export async function approveXIdLinkRequest[\s\S]*try \{[\s\S]*\} catch \(error\) \{[\s\S]*return mutationError\(error\);/,
  );
  assert.match(
    admin,
    /export async function rejectXIdLinkRequest[\s\S]*try \{[\s\S]*\} catch \(error\) \{[\s\S]*return mutationError\(error\);/,
  );
  assert.match(
    table,
    /try \{[\s\S]*const r = await fn\(fd\);[\s\S]*\} catch \{[\s\S]*通信または処理中に問題が発生しました/,
  );
});
