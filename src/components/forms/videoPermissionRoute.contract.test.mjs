import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const membersSource = await readFile(
  new URL("./VideoMembersField.tsx", import.meta.url),
  "utf8",
);
const summarySource = await readFile(
  new URL("../video/VideoEditPermissionSummary.tsx", import.meta.url),
  "utf8",
);
const permissionPageSource = await readFile(
  new URL("../../../app/(auth)/dashboard/edit/[id]/permissions/page.tsx", import.meta.url),
  "utf8",
).then((source) => source.replace(/\r\n/g, "\n"));

test("メンバー欄の#video-collab-perms導線には実在するtargetと専用管理ページリンクがある", () => {
  assert.match(membersSource, /collabPermsHref/);
  assert.match(summarySource, /id="video-collab-perms"/);
  assert.match(
    summarySource,
    /`\/dashboard\/edit\/\$\{encodeURIComponent\(videoId\)\}\/permissions\$\{privilegedQuery\}`/,
  );
  assert.match(summarySource, /編集できる人を管理/);
});

test("専用管理ページリンクは現在のprivileged queryを維持する", () => {
  assert.match(summarySource, /privilegedQuery = ""/);
  assert.match(summarySource, /\/permissions\$\{privilegedQuery\}/);
});

test("権限管理ページはquery無しの正当なadmin/event運営をServer側で補完する", () => {
  assert.match(permissionPageSource, /const hasExplicitPrivilegeMode = Boolean\(rawRequestedMode\)/);
  assert.match(permissionPageSource, /if \(!canEditPermissions && !hasExplicitPrivilegeMode\)/);
  assert.match(permissionPageSource, /user\.role === "admin"/);
  assert.match(permissionPageSource, /privilegeMode: "admin"/);
  assert.match(permissionPageSource, /canOfferEventMode/);
  assert.match(permissionPageSource, /privilegeMode: "event"/);
});

test("明示privilege mode時は別modeへ勝手にfallbackしない", () => {
  const fallbackBlock = permissionPageSource.match(
    /if \(!canEditPermissions && !hasExplicitPrivilegeMode\) \{[\s\S]*?\n  }\n\n  if \(!canEditPermissions\)/,
  )?.[0];
  assert.ok(fallbackBlock);
  assert.match(fallbackBlock, /privilegeMode: "admin"/);
  assert.match(fallbackBlock, /privilegeMode: "event"/);
});
