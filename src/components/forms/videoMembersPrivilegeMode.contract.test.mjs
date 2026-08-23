import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./VideoMembersField.tsx", import.meta.url),
  "utf8",
);

test("TSV権限batchはURLに明示されたadmin/event modeだけServer Actionへ渡す", () => {
  assert.match(source, /currentExplicitPermissionPrivilegeMode/);
  assert.match(source, /new URLSearchParams\(window\.location\.search\)\.get\("privileged"\)/);
  assert.match(source, /raw === "admin" \|\| raw === "event"/);
  assert.match(source, /edit_privilege_mode: explicitPrivilegeMode/);
  assert.match(source, /explicitPrivilegeMode[\s\S]*\? \{ edit_privilege_mode: explicitPrivilegeMode \}[\s\S]*: \{\}/);
});

test("queryにmodeが無い画面ではnormalを明示送信せずServer側fallbackを残す", () => {
  assert.match(source, /return raw === "admin" \|\| raw === "event" \? raw : undefined/);
  assert.doesNotMatch(source, /edit_privilege_mode:\s*"normal"/);
});

test("権限batch成功後はmembers_jsonを汚さずローカルcan_edit表示だけ同期する", () => {
  assert.match(source, /stripCsvEditFlags/);
  assert.match(source, /syncPermissionIntentsToLocalRows/);
  assert.match(source, /return \{ \.\.\.row, can_edit: byXid\.get\(xid\) \? 1 : 0 \}/);
  assert.match(
    source,
    /if \(result\.ok\) \{[\s\S]*runPendingApply\(\);[\s\S]*syncPermissionIntentsToLocalRows\(intents\)/,
  );
  const normalizeBody = source.match(/function normalizeMemberRows\([\s\S]*?\n}/)?.[0] ?? "";
  assert.doesNotMatch(normalizeBody, /can_edit/);
});
