import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [healthPage, integrityPage, securityPage, healthChecks, integrityChecks, statusComponent] =
  await Promise.all([
    readFile(new URL("../../../app/(admin)/admin/health/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../../../app/(admin)/admin/health/integrity/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../../../app/(admin)/admin/security/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("./healthChecks.ts", import.meta.url), "utf8"),
    readFile(new URL("./integrityChecks.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../../components/admin/DiagnosticStatusResults.tsx", import.meta.url),
      "utf8",
    ),
  ]);

test("health は通常表示を operational に限定し、deep/run で全体診断する", () => {
  assert.match(healthChecks, /export async function runOperationalHealthChecks/);
  assert.match(healthPage, /sp\.deep === "1" \|\| sp\.run === "1"/);
  assert.match(healthPage, /runOperationalHealthChecks\(db\)/);
  assert.match(healthPage, /runHealthChecks\(db\)/);

  const operationalBody = healthChecks.match(
    /export async function runOperationalHealthChecks[\s\S]*?\n}\n/,
  )?.[0] ?? "";
  assert.doesNotMatch(operationalBody, /checkLikeCountDrift|checkSlotDuplicateStartTime/);
});

test("status filter はクライアント側で処理し、statusリンクによる再queryを行わない", () => {
  assert.match(statusComponent, /useState<DiagnosticFilter>/);
  assert.match(statusComponent, /useEffect\(\(\) => \{[\s\S]*setFilter\(normalizeFilter\(initialFilter\)\)/);
  assert.match(statusComponent, /onClick=\{\(\) => setFilter\(key\)\}/);
  assert.match(statusComponent, /router\.refresh\(\)/);
  assert.match(statusComponent, /kind === "health" && result\.note/);
  assert.match(statusComponent, /kind === "security" && result\.note/);
  assert.doesNotMatch(healthPage, /href=.*status=/);
  assert.doesNotMatch(securityPage, /href=.*status=/);
});

test("integrity/security は初期表示でD1診断を実行せず、run=1でのみ実行する", () => {
  assert.match(integrityPage, /const shouldRun = sp\.run === "1"/);
  assert.match(integrityPage, /if \(shouldRun\)/);
  assert.match(integrityPage, /health\/integrity\?run=1/);
  assert.match(securityPage, /const shouldRun = sp\.run === "1"/);
  assert.match(securityPage, /if \(shouldRun\)/);
  assert.match(securityPage, /security\?run=1/);
  assert.match(healthPage, /通常の運用チェックへ戻る/);
  assert.match(integrityPage, /最新状態で再チェック/);
});

test("integrity makeCheck は window count でサンプルと総数を一読する", () => {
  assert.match(integrityChecks, /COUNT\(\*\) OVER\(\)/);
  assert.match(integrityChecks, /total_count/);
  assert.doesNotMatch(integrityChecks, /countRows\(/);
  assert.match(integrityChecks, /limit\(DISPLAY_LIMIT\)/);
});

test("slot duplicate は self-joinでNULL意味とpair重複排除を維持する", () => {
  for (const source of [healthChecks, integrityChecks]) {
    assert.match(source, /slots AS s1, slots AS s2/);
    assert.match(source, /s1\.id < s2\.id/);
    assert.match(source, /s1\.reservation_group_id IS NULL/);
    assert.match(source, /s2\.reservation_group_id IS NULL/);
    assert.match(source, /limit\(5\)/);
  }
});
