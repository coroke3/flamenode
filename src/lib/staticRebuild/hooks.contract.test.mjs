import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [hooks, xid] = await Promise.all([
  readFile(new URL("./hooks.ts", import.meta.url), "utf8"),
  readFile(new URL("../actions/xid.ts", import.meta.url), "utf8"),
]);

test("X ID公開プロフィール更新は user と users_index をenqueueする", () => {
  assert.match(hooks, /export async function enqueueAfterXUserPublicUpdate/);
  assert.match(
    hooks,
    /enqueueAfterXUserPublicUpdate[\s\S]*targetType: "user"[\s\S]*usersIndexTarget\(opts\.reason\)/,
  );
  assert.match(hooks, /await enqueueStaticRebuildMany\(db, \[/);
});

test("本人X IDプロフィール・アイコン更新成功時に静的再生成フックを呼ぶ", () => {
  assert.match(xid, /enqueueAfterXUserPublicUpdate/);
  assert.match(
    xid,
    /updateXIdProfile[\s\S]*enqueueAfterXUserPublicUpdate\(db, \{[\s\S]*reason: "x_user_profile_update"/,
  );
  assert.match(
    xid,
    /setXIdIcon[\s\S]*enqueueAfterXUserPublicUpdate\(db, \{[\s\S]*reason: "x_user_icon_update"/,
  );
  assert.match(
    xid,
    /uploadXIdIcon[\s\S]*enqueueAfterXUserPublicUpdate\(db, \{[\s\S]*reason: "x_user_icon_update"/,
  );
  assert.equal(
    (xid.match(/await enqueueAfterXUserPublicUpdate\(/g) ?? []).length,
    3,
  );
});
