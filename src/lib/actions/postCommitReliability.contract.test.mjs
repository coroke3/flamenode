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

test("SEC-736: slotted video YouTube wake runs only after the atomic-save catch", () => {
  const source = read("../actions/video/submitSlotVideo.ts");
  const start = source.indexOf("async function submitSlotVideoCore(");
  const end = source.indexOf("const SLOT_SUBMIT_UNEXPECTED_ERROR_MESSAGE", start);
  assert.ok(start >= 0 && end > start, "inspect the actual slotted submission action");
  const action = source.slice(start, end);
  const wakeSet = action.indexOf("const wakeSentKinds = new Set<QueueWakeKind>();");
  const atomicCommit = action.indexOf("await executeVideoAtomicWritePlan(db, plan, {");
  const catchIndex = action.indexOf("} catch (error) {", atomicCommit);
  const rollbackIndex = action.indexOf("await rollbackUploadedVideoIcon(iconResolved.value.uploadedKey)", catchIndex);
  const postCommitIndex = action.indexOf("await runPostCommitBestEffort(", catchIndex);
  const conditionalWakeIndex = action.indexOf("...(youtubeFieldPresent && submittedYoutubeId", postCommitIndex);
  const wakeIndex = action.indexOf('await sendYoutubeSyncPendingWakeBestEffort("web", wakeSentKinds)', postCommitIndex);
  const cleanupIndex = action.indexOf('name: "icon_orphan_cleanup"', postCommitIndex);

  assert.ok(wakeSet >= 0 && wakeSet < atomicCommit, "one sentKinds set must span the batch and post-commit wake");
  assert.ok(atomicCommit < catchIndex && catchIndex < rollbackIndex && rollbackIndex < postCommitIndex,
    "only an uncommitted atomic write may reach the icon rollback catch");
  assert.ok(postCommitIndex < conditionalWakeIndex && conditionalWakeIndex < wakeIndex,
    "only a submitted YouTube ID queues the best-effort wake");
  assert.ok(wakeIndex < cleanupIndex, "a failed wake cannot skip later cleanup tasks");
  assert.equal(action.slice(atomicCommit, catchIndex).includes("sendYoutubeSyncPendingWakeBestEffort"), false,
    "a post-commit YouTube Queue exception must never enter the D1 failure catch");
  assert.equal((action.match(/sendYoutubeSyncPendingWakeBestEffort\(/g) ?? []).length, 1,
    "the YouTube wake must not execute twice");
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
