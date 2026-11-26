import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

// SEC-761: Next/Cloudflare action imports are unavailable in plain Node.
// Execute the actual source-defined diagnostic helper and separately lock the
// source-boundary call sites; do NOT claim mounted Hono/D1/Next fault injection.
const source = readFileSync(new URL("./submitSlotVideo.ts", import.meta.url), "utf8");
const declaration =
  "function warnSlotSubmissionFailure(result: SlotSubmitFailureDiagnostic): void {";
const begin = source.indexOf(declaration);
assert.ok(begin > 0, "actual diagnostic helper exists in the Server Action");
const bodyStart = begin + declaration.length;
const end = source.indexOf("\n}\n", bodyStart);
assert.ok(end > bodyStart, "function body must have a bounded closing brace");
const helperBody = source.slice(bodyStart, end);
const helperJs = "function warnSlotSubmissionFailure(result) {" + helperBody + "\n}";

const fixedCodes = [
  "event_plan_rejected",
  "stage_permission_fields_unavailable",
  "atomic_save_rejected",
  "preflight_rejected",
];

function poisonedProviderError() {
  const error = new Error("SEC761_PRIVATE_PROVIDER_SECRET");
  let nameReads = 0;
  Object.defineProperty(error, "name", {
    get() {
      nameReads += 1;
      throw new Error("SEC761_POISONED_NAME_ACCESSOR");
    },
  });
  return { error, reads: () => nameReads };
}

function runActualHelper(code, { throwingSink }) {
  const { error, reads } = poisonedProviderError();
  const emitted = [];
  const fakeConsole = {
    warn(line) {
      emitted.push(JSON.parse(String(line)));
      if (throwingSink) throw new Error("SEC761_BROKEN_LOGGER_SECRET");
    },
  };
  const action = helperJs + "\n" +
    "(() => { try { throw providerError; } catch (error) {" +
    "warnSlotSubmissionFailure(" + JSON.stringify(code) + ");" +
    "return { ok: false, message: 'safe_retry_message' };" +
    "} })()";
  const result = runInNewContext(action, {
    console: fakeConsole,
    providerError: error,
  });
  return { result: JSON.parse(JSON.stringify(result)), emitted, nameReads: reads() };
}

test("SEC-761: all four actual helper codes emit only fixed diagnostics", () => {
  assert.match(helperBody, /console\.warn\(JSON\.stringify\(\{ service: "submit_slot_video", result \}\)\)/);
  assert.doesNotMatch(helperBody, /\berror\s*\.|\buserId\b|\bauthUserId\b|\bformData\b/);
  for (const code of fixedCodes) {
    const output = runActualHelper(code, { throwingSink: false });
    assert.deepEqual(output.result, { ok: false, message: "safe_retry_message" });
    assert.deepEqual(output.emitted, [{ service: "submit_slot_video", result: code }]);
    assert.equal(output.nameReads, 0, code + " must never inspect malicious Error.name");
    assert.ok(!JSON.stringify(output).includes("SEC761_PRIVATE_PROVIDER_SECRET"));
    assert.ok(!JSON.stringify(output).includes("SEC761_POISONED_NAME_ACCESSOR"));
  }
});

test("SEC-761: a throwing logger cannot replace any safe failure result", () => {
  for (const code of fixedCodes) {
    const output = runActualHelper(code, { throwingSink: true });
    assert.deepEqual(output.result, { ok: false, message: "safe_retry_message" });
    assert.deepEqual(output.emitted, [{ service: "submit_slot_video", result: code }]);
    assert.equal(output.nameReads, 0);
  }
});

test("SEC-761: all four action failure catches use guarded fixed-code helper", () => {
  assert.equal((source.match(/warnSlotSubmissionFailure\("/g) ?? []).length, 4);
  assert.equal((source.match(/console\.warn\(/g) ?? []).length, 1,
    "no remaining direct warning sink may serialize an arbitrary provider error");
  assert.match(source,
    /\} catch \{\s*warnSlotSubmissionFailure\("event_plan_rejected"\);\s*return \{ ok: false, message: "選択イベント数が保存上限を超えています。" \};/);
  assert.match(source,
    /\} catch \{\s*warnSlotSubmissionFailure\("stage_permission_fields_unavailable"\);\s*return \{ ok: false, message: "ステージ許諾項目を読み込めませんでした。" \};/);
  assert.match(source,
    /unstable_rethrow\(error\);\s*await rollbackUploadedVideoIcon\(iconResolved\.value\.uploadedKey\);[\s\S]*?if \(isYoutubeIdUniqueConstraintError\(error\)\) \{[\s\S]*?warnSlotSubmissionFailure\("atomic_save_rejected"\);\s*return \{ ok: false,/,
    "atomic rollback and duplicate-YouTube mapping remain before the diagnostic");
  assert.match(source,
    /\} catch \(error\) \{\s*unstable_rethrow\(error\);\s*warnSlotSubmissionFailure\("preflight_rejected"\);\s*return \{\s*ok: false,/,
    "Next control-flow rethrow remains before top-level diagnostic");
  const atomicCatch = source.indexOf('warnSlotSubmissionFailure("atomic_save_rejected")');
  const postcommit = source.indexOf("await runPostCommitBestEffort(", atomicCatch);
  assert.ok(postcommit > atomicCatch,
    "merged SEC-736 YouTube postcommit wake remains outside the D1 rollback catch");
});
