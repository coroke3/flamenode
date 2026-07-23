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
const broadcastButton = read("../../components/admin/TermsReacceptBroadcastButton.tsx");
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

test("rules publish keeps D1 commit separate from post-commit cache work", () => {
  const publish = rules.slice(
    rules.indexOf("export async function publishTermsVersion"),
    rules.indexOf("export async function broadcastTermsReaccept"),
  );
  assert.match(publish, /await mutateWithAudit\(db, \{ mutationStatements: statements/);
  const commitBlock = publish.match(
    /try \{[\s\S]*?await mutateWithAudit\(db, \{ mutationStatements: statements[\s\S]*?\} catch/,
  )?.[0];
  assert.ok(commitBlock, "publish commit block must exist");
  assert.doesNotMatch(commitBlock, /enqueueStaticRebuild/);
  assert.match(
    publish,
    /runRulesPostCommit\("rules\.publish"[\s\S]*enqueueStaticRebuild/,
    "static rebuild must run in post-commit",
  );
  assert.match(publish, /runRulesPostCommit\("rules\.publish"/);
  assert.match(publish, /name: "static_rebuild"/);
  assert.match(publish, /name: "revalidate"/);
});

test("rules broadcast separates fan-out commit from terms touch", () => {
  const broadcast = rules.slice(
    rules.indexOf("export async function broadcastTermsReaccept"),
    rules.indexOf("export async function archiveTermsVersion"),
  );
  assert.match(
    broadcast,
    /mutationStatements: notifications\.statements/,
    "notification fan-out must commit on its own",
  );
  assert.match(broadcast, /runRulesPostCommit\("rules\.broadcast"/);
  assert.doesNotMatch(
    broadcast,
    /mutationStatements:\s*\[[\s\S]*notifications\.statements[\s\S]*termsVersions/,
    "fan-out and terms touch must not share one mutationStatements array",
  );
  assert.match(broadcast, /touchWarning/);
  assert.match(broadcast, /warning: touchWarning/);
  assert.match(broadcastButton, /result\.warning/);
  assert.match(broadcastButton, /role="alert"/);
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
