import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [route, island, publicLayout] = await Promise.all([
  readFile(
    new URL("../../../app/api/account/summary/route.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../components/layout/PublicAccountIsland.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../app/(public)/layout.tsx", import.meta.url),
    "utf8",
  ),
]);

test("account summary APIはprivate no-storeで最小DTOだけを返す", () => {
  assert.match(route, /"Cache-Control": "private, no-store"/);
  assert.match(route, /loggedIn: true/);
  assert.match(route, /loggedIn: false/);
  assert.match(route, /unavailable: true/);
  assert.match(route, /degraded: true/);
  assert.match(route, /displayName: headerUser\.name/);
  assert.match(route, /canAccessAdmin: headerUser\.management\.canAccessAdmin/);
  assert.doesNotMatch(route, /id: headerUser\.id/);
});

test("公開layoutとAccount Islandはserver authを呼ばない", () => {
  assert.doesNotMatch(publicLayout, /getCurrentUser/);
  assert.doesNotMatch(publicLayout, /buildHeaderUser/);
  assert.match(publicLayout, /CostGuardBanner/);
  assert.doesNotMatch(publicLayout, /source=["']admin["']/);
  assert.match(island, /\/api\/account\/summary/);
  assert.match(island, /cache: "no-store"/);
  assert.match(island, /preserveLoggedInOnFailure/);
});
