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

test("X IDの一般・運営ActionはCloudflare binding障害を結果化しnavigation例外だけ再送出する", () => {
  const action = read("../actions/xid.ts");
  const admin = read("../actions/xid-admin.ts");

  assert.match(action, /import \{ unstable_rethrow \} from "next\/navigation"/);
  assert.match(
    action,
    /async function getXIdWriteContext[\s\S]*try \{[\s\S]*await writeGuard[\s\S]*catch \(error\) \{[\s\S]*unstable_rethrow\(error\)[\s\S]*認証またはDBに接続できません/,
  );
  assert.match(admin, /import \{ unstable_rethrow \} from "next\/navigation"/);
  assert.match(
    admin,
    /async function getXIdLinkOperator[\s\S]*try \{[\s\S]*await writeGuard[\s\S]*await canManageXIdLinkRequests[\s\S]*catch \(error\) \{[\s\S]*unstable_rethrow\(error\)[\s\S]*認証またはDBに接続できません/,
  );
  assert.match(
    admin,
    /export async function approveXIdLinkRequest[\s\S]*if \(!operator\.ok\) return \{ ok: false, message: operator\.message \}/,
  );
  assert.match(
    admin,
    /export async function rejectXIdLinkRequest[\s\S]*if \(!operator\.ok\) return \{ ok: false, message: operator\.message \}/,
  );
});

test("X ID申請はsibling cancelを冪等化しmutation失敗を返す", () => {
  const action = read("../actions/xid.ts");
  const admin = read("../actions/xid-admin.ts");
  const settings = read("../../components/settings/XIdSettingsClient.tsx");

  assert.match(
    action,
    /eq\(xIdentityRequests\.id, sibling\.id\)[\s\S]*eq\(xIdentityRequests\.status, "pending"\)[\s\S]*expectedMutationChanges\.push\(null\)/,
  );
  assert.match(
    admin,
    /eq\(xIdentityRequests\.id, sibling\.id\)[\s\S]*eq\(xIdentityRequests\.status, "pending"\)[\s\S]*expected\.push\(null\)/,
  );
  assert.match(
    admin,
    /eq\(xIdentityRequests\.id, request\.id\)[\s\S]*eq\(xIdentityRequests\.status, "pending"\)[\s\S]*expected\.push\(1\)/,
  );
  assert.match(action, /function revalidateXIdRequestPaths\(\)/);
  assert.match(action, /revalidateXIdRequestPaths\(\)/);
  assert.doesNotMatch(
    action,
    /export async function requestXIdLink[\s\S]*revalidateXIdentityPaths\(requestedXUserId\)/,
  );
  assert.match(
    action,
    /export async function requestXIdLink[\s\S]*申請の保存に失敗しました。時間をおいて再試行してください。/,
  );
  assert.doesNotMatch(
    action,
    /export async function requestXIdLink[\s\S]*if \(!isConditionalInsertAssertionError\(error\)\) throw error/,
  );
  assert.match(
    settings,
    /export function XIdLinkForm[\s\S]*try \{[\s\S]*await requestXIdLink\(fd\)[\s\S]*\} catch/,
  );
  assert.match(
    settings,
    /export function XIdMergeForm[\s\S]*try \{[\s\S]*await requestXIdLink\(fd\)[\s\S]*\} catch/,
  );
});
