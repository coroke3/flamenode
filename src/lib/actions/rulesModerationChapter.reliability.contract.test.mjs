import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const rules = read("./rules.ts");
const moderation = read("./moderation-admin.ts");
const chapter = read("./chapter.ts");
const videoDetailPage = read("../../../app/(admin)/admin/videos/[id]/page.tsx");
const moderationForm = read("../../components/admin/CreateModerationCaseForm.tsx");

test("rules, moderation, chapter import unstable_rethrow", () => {
  for (const [name, source] of [
    ["rules.ts", rules],
    ["moderation-admin.ts", moderation],
    ["chapter.ts", chapter],
  ]) {
    assert.match(
      source,
      /import \{[^}]*unstable_rethrow[^}]*\} from "next\/navigation"/,
      `${name} must import unstable_rethrow`,
    );
    assert.match(
      source,
      /unstable_rethrow\(error\)/,
      `${name} must call unstable_rethrow in catch blocks`,
    );
  }
});

test("rules publish stores the rebuild queue in the same audited D1 batch", () => {
  const publish = rules.slice(
    rules.indexOf("export async function publishTermsVersion"),
    rules.indexOf("export async function broadcastTermsReaccept"),
  );
  assert.match(publish, /await mutateWithAudit\(db, \{[\s\S]*mutationStatements: \[\.\.\.statements, \.\.\.queue\.statements\]/);
  const commitBlock = publish.match(
    /try \{[\s\S]*?await mutateWithAudit\(db, \{[\s\S]*?\} catch/,
  )?.[0];
  assert.ok(commitBlock, "publish commit block must exist");
  assert.match(publish, /buildStaticRebuildQueueBatch/);
  assert.match(commitBlock, /\.\.\.queue\.statements/);
  assert.match(commitBlock, /expectedMutationChanges:\s*\[\.\.\.expected, \.\.\.queue\.expectedChanges\]/);
  assert.match(commitBlock, /staticRebuildWakeSource/);
  assert.doesNotMatch(publish, /enqueueStaticRebuild/);
  assert.match(publish, /runRulesPostCommit\("rules\.publish"/);
  assert.match(publish, /name: "revalidate"/);
});

test("rules broadcast keeps the no-DM terms touch atomic", () => {
  const broadcast = rules.slice(
    rules.indexOf("export async function broadcastTermsReaccept"),
    rules.indexOf("export async function archiveTermsVersion"),
  );
  assert.doesNotMatch(broadcast, /buildKnownRecipientNotificationBatch/);
  assert.doesNotMatch(broadcast, /type:\s*"terms_reaccept_required"/);
  assert.match(broadcast, /Discord DM は送信しません/);
  assert.match(broadcast, /await mutateWithAudit\(db,/);
  assert.match(broadcast, /db\.update\(termsVersions\)/);
  assert.match(broadcast, /expectedRowCondition\(\{ expectedCurrent: snapshot\(target\) \}\)/);
  assert.match(broadcast, /expectedMutationChanges:\s*\[1\]/);
  assert.match(broadcast, /context:\s*"admin_terms_broadcast"/);
  assert.match(broadcast, /catch \(error\) \{ return mutationError\(error\); \}/);
  assert.match(broadcast, /runRulesPostCommit\("rules\.broadcast"/);
  assert.match(broadcast, /revalidatePath\("\/rules"\)/);
  assert.match(broadcast, /revalidatePath\("\/onboarding"\)/);
  assert.doesNotMatch(broadcast, /touchWarning/);
});

test("published rules archive keeps the rebuild queue atomic", () => {
  const archive = rules.slice(rules.indexOf("export async function archiveTermsVersion"));
  assert.match(archive, /before\.status === "published"[\s\S]*buildStaticRebuildQueueBatch/);
  assert.match(archive, /\.\.\.\(queue\?\.statements \?\? \[\]\)/);
  assert.match(archive, /staticRebuildWakeSource/);
  assert.doesNotMatch(archive, /enqueueStaticRebuild/);
});

test("admin video detail surfaces moderation create failures in client form", () => {
  assert.match(videoDetailPage, /CreateModerationCaseForm/);
  assert.doesNotMatch(videoDetailPage, /createModerationCaseAction/);
  assert.match(moderationForm, /createModerationCase\(/);
  assert.match(moderationForm, /useTransition/);
  assert.match(moderationForm, /!result\.ok/);
  assert.match(moderationForm, /role="alert"/);
});

test("moderation uses post-commit revalidate and noop for resolved re-apply", () => {
  assert.match(moderation, /runPostCommitBestEffort/);
  assert.match(moderation, /runModerationPostCommit/);
  assert.match(
    moderation,
    /current\.status !== "open"[\s\S]*current\.status === status[\s\S]*ok: true/,
  );
  assert.doesNotMatch(
    moderation,
    /catch \(error\) \{ return mutationError\(error\); \}[\s\S]*revalidateModeration\(/,
    "revalidate must not run synchronously after commit",
  );
});

test("chapter delete treats missing row as noop success", () => {
  assert.match(
    chapter,
    /export async function deleteChapter[\s\S]*既に削除されています/,
  );
});

test("chapter write paths use post-commit revalidate", () => {
  assert.match(chapter, /runPostCommitBestEffort/);
  assert.match(chapter, /revalidateChapterPath/);
  assert.match(
    chapter,
    /await mutateWithAudit\(db,[\s\S]*staticRebuildWakeSource/,
    "static rebuild queue stays in commit batch",
  );
});
