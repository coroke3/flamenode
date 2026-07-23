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
