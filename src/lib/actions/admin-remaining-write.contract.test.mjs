import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const names = ["admin.ts", "api-endpoints.ts", "permissions-admin.ts", "youtube-sync-admin.ts", "notification-admin.ts", "static-rebuild-admin.ts", "video-collab-perms.ts", "event-template-admin.ts"];
const sources = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(new URL(`./${name}`, import.meta.url), "utf8")])));

test("remaining admin mutations use canonical guards and atomic audit", () => {
  const features = {
    "admin.ts": "admin_video_status",
    "api-endpoints.ts": "admin_api_endpoints",
    "permissions-admin.ts": "admin_permissions",
    "youtube-sync-admin.ts": "admin_youtube_sync",
    "notification-admin.ts": "admin_notifications",
    "static-rebuild-admin.ts": "admin_static_rebuild",
    "event-template-admin.ts": "admin_event_templates",
  };
  for (const [name, feature] of Object.entries(features)) {
    assert.match(sources[name], new RegExp(`requireAdminWrite\\(\\"${feature}\\"\\)`));
    if (name === "admin.ts") {
      assert.match(sources[name], /executeVideoVisibilityStatusMutation/);
    } else {
      assert.match(sources[name], /mutateWithAudit\(/);
    }
    assert.doesNotMatch(sources[name], /auditAction\(/);
  }
  assert.match(sources["video-collab-perms.ts"], /writeGuard\(\{ feature: "edit_video" \}\)/);
  assert.match(sources["video-collab-perms.ts"], /mutateWithAudit\(/);
  assert.doesNotMatch(sources["video-collab-perms.ts"], /auditAction\(|enqueueNotification\(/);
});

test("CAS snapshots and same-batch side effects remain explicit", () => {
  for (const name of names) {
    if (name === "admin.ts") {
      assert.match(sources[name], /planVideoVisibilityTransition/);
      continue;
    }
    assert.match(
      sources[name],
      /expectedRowCondition|buildPermissionSetGuardSql|operation: "CREATE"/,
    );
  }
  assert.match(sources["admin.ts"], /planVideoVisibilityTransition/);
  assert.match(sources["admin.ts"], /buildVideoStatusChangeNotificationBatch|planVideoVisibilityTransition/);
  // Force-resend must use the route-aware builder so channel notifications can
  // retain a nullable recipient while DM rows still resolve a recipient.
  assert.match(sources["notification-admin.ts"], /buildNotificationOutboxStatement/);
  assert.match(sources["static-rebuild-admin.ts"], /buildStaticRebuildQueueBatch/);
});

test("bulk admin retries are bounded below D1 free limits", () => {
  assert.match(sources["notification-admin.ts"], /BULK_RETRY_MAX = 10/);
  assert.match(sources["static-rebuild-admin.ts"], /BULK_RETRY_MAX = 8/);
  assert.match(sources["notification-admin.ts"], /\.limit\(BULK_RETRY_MAX \+ 1\)/);
  assert.match(sources["static-rebuild-admin.ts"], /\.limit\(BULK_RETRY_MAX \+ 1\)/);
});

test("バックフィル成功redirectをcatchしない", () => {
  const source =
    sources["static-rebuild-admin.ts"];

  assert.match(
    source,
    /let redirectTarget: string/,
  );
  assert.match(
    source,
    /revalidatePath\("\/admin\/static-builds"\);\s*redirect\(redirectTarget\);/,
  );

  const tryBlock =
    source.match(
      /try \{[\s\S]*?\} catch \(error\)/,
    )?.[0] ?? "";

  assert.doesNotMatch(
    tryBlock,
    /\bredirect\(/,
  );
});
