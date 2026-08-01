import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("critical Server Actions rethrow Next.js control-flow exceptions", () => {
  const files = [
    "../actions/xid.ts",
    "../actions/xid-admin.ts",
    "../actions/xid-merge-admin.ts",
    "../actions/slot.ts",
    "../actions/video/interaction.ts",
    "../actions/video/createFreeVideo.ts",
    "../actions/event-staff-admin.ts",
  ];

  for (const file of files) {
    const source = read(file);
    assert.match(
      source,
      /import \{[^}]*unstable_rethrow[^}]*\} from "next\/navigation"/,
      `${file} must import unstable_rethrow`,
    );
    assert.match(
      source,
      /unstable_rethrow\(error\)/,
      `${file} must call unstable_rethrow in catch blocks`,
    );
  }
});

test("xid setActiveXId uses post-commit best-effort for revalidate", () => {
  const action = read("../actions/xid.ts");
  assert.match(action, /runPostCommitBestEffort/);
  assert.match(
    action,
    /export async function setActiveXId[\s\S]*runXIdPostCommit[\s\S]*revalidateXIdentityPaths/,
  );
});

test("video interaction uses post-commit best-effort for revalidate", () => {
  const action = read("../actions/video/interaction.ts");
  assert.match(action, /runPostCommitBestEffort/);
  assert.match(
    action,
    /runPostCommitBestEffort[\s\S]*revalidatePath/,
  );
});

test("video update keeps revalidation after the atomic commit boundary", () => {
  const savePlan = read("../video/videoSavePlan.ts");
  const applyStart = savePlan.indexOf("export async function applyVideoUpdatePlan");
  const applySource = savePlan.slice(applyStart);
  const commitIndex = applySource.indexOf("await executeVideoAtomicWritePlan");
  const postCommitIndex = applySource.indexOf("await runPostCommitBestEffort");
  const revalidateIndex = applySource.indexOf("revalidatePath(path)");

  assert.ok(applyStart >= 0);
  assert.ok(commitIndex >= 0);
  assert.ok(postCommitIndex > commitIndex);
  assert.ok(revalidateIndex > postCommitIndex);
  assert.equal((applySource.match(/revalidatePath\(/g) ?? []).length, 1);

  const updateAction = read("../actions/video/updateVideo.ts");
  assert.match(
    updateAction,
    /try \{\s*staticRebuildEnqueued = await applyVideoUpdatePlan\(db, plan\);\s*\} catch \(err\) \{\s*await rollbackUploadedVideoIcon\(uploadedIconKey\)/,
  );
});

test("free video creation treats wake, cleanup, and revalidation as post-commit work", () => {
  const action = read("../actions/video/createFreeVideo.ts");
  const actionStart = action.indexOf("export async function createFreeVideo");
  const actionSource = action.slice(actionStart);
  const commitIndex = actionSource.indexOf("await executeVideoAtomicWritePlan");
  const catchIndex = actionSource.indexOf("} catch (error) {", commitIndex);
  const postCommitIndex = actionSource.indexOf("await runPostCommitBestEffort", catchIndex);
  const wakeIndex = actionSource.indexOf("await sendYoutubeSyncPendingWakeBestEffort", catchIndex);
  const cleanupIndex = actionSource.indexOf("await cleanupReplacedVideoCreatorIcon", catchIndex);
  const revalidateIndex = actionSource.indexOf('revalidatePath("/")', catchIndex);

  assert.ok(actionStart >= 0);
  assert.ok(commitIndex >= 0);
  assert.ok(catchIndex > commitIndex);
  assert.ok(postCommitIndex > catchIndex);
  assert.ok(wakeIndex > postCommitIndex);
  assert.ok(cleanupIndex > postCommitIndex);
  assert.ok(revalidateIndex > postCommitIndex);
  assert.equal((actionSource.match(/revalidatePath\(/g) ?? []).length, 3);
});

test("xid-admin uses post-commit best-effort for revalidate", () => {
  const action = read("../actions/xid-admin.ts");
  assert.match(action, /runPostCommitBestEffort/);
  assert.match(action, /unstable_rethrow\(error\)/);
  assert.match(
    action,
    /export async function approveXIdLinkRequest[\s\S]*runXIdAdminPostCommit[\s\S]*revalidateIdentityAdminPaths/,
  );
  assert.match(
    action,
    /export async function rejectXIdLinkRequest[\s\S]*runXIdAdminPostCommit[\s\S]*revalidateIdentityAdminPaths/,
  );
});

test("xid-merge-admin uses post-commit best-effort for revalidate", () => {
  const action = read("../actions/xid-merge-admin.ts");
  assert.match(action, /runPostCommitBestEffort/);
  assert.match(action, /unstable_rethrow\(/);
  assert.match(
    action,
    /export async function createXIdMergeRequest[\s\S]*runXIdMergePostCommit[\s\S]*revalidateMergePaths/,
  );
  assert.match(
    action,
    /export async function executeXIdMergeRequest[\s\S]*runXIdMergePostCommit[\s\S]*revalidateMergePaths/,
  );
  assert.match(
    action,
    /export async function approveXIdMergeRevert[\s\S]*runXIdMergePostCommit[\s\S]*revalidateMergePaths/,
  );
});
