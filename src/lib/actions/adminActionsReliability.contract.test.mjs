import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = async (relative) =>
  readFile(new URL(relative, import.meta.url), "utf8");

const reliabilityTargets = [
  {
    file: "./slot-admin.ts",
    exportName: "generateSlotsBatch",
    revalidateHelper: "revalidateEventSlotPathsBestEffort",
  },
  {
    file: "./user-admin.ts",
    exportName: "setUserRole",
    revalidateHelper: "revalidateUserDetailPathsBestEffort",
  },
  {
    file: "./event-youtube-playlist.ts",
    exportName: "saveEventYoutubePlaylistSettings",
    revalidateHelper: "revalidateEventYoutubePlaylistPathBestEffort",
  },
  {
    file: "./youtube-sync-admin.ts",
    exportName: "queueYoutubeMetadataResync",
    revalidateHelper: "revalidateYoutubeSyncPathsBestEffort",
  },
  {
    file: "./permissions-admin.ts",
    exportName: "updateGlobalEditableFields",
    revalidateHelper: "revalidatePermissionsAdminPathsBestEffort",
  },
  {
    file: "./video-collab-perms.ts",
    exportName: "upsertVideoCollaborator",
    revalidateHelper: "revalidateVideoCollabPathsBestEffort",
  },
  {
    file: "./video/adminMembers.ts",
    exportName: "updateVideoMembersAdmin",
    revalidateHelper: "revalidateVideoMembersAdminPathsBestEffort",
  },
];

test("./admin.ts uses post-commit revalidate and shared visibility failure helper", async () => {
  const [adminSource, transitionSource] = await Promise.all([
    read("./admin.ts"),
    read("../video/videoVisibilityTransition.ts"),
  ]);
  assert.match(adminSource, /handleVideoVisibilityMutationFailure/);
  assert.match(
    adminSource,
    /catch \(error\) \{[\s\S]*return handleVideoVisibilityMutationFailure/,
  );
  assert.match(adminSource, /runPostCommitBestEffort/);
  assert.match(adminSource, /revalidateVideoStatusPathsBestEffort/);
  assert.match(
    adminSource,
    /export async function setVideoStatus[\s\S]*revalidateVideoStatusPathsBestEffort/,
  );
  assert.doesNotMatch(
    adminSource,
    /catch \(error\) \{\s*return \{\s*ok: false/m,
  );
  assert.match(
    transitionSource,
    /export async function handleVideoVisibilityMutationFailure[\s\S]*unstable_rethrow\(error\)/,
    "videoVisibilityTransition must rethrow NEXT navigation errors",
  );
});

for (const target of reliabilityTargets) {
  test(`${target.file} uses post-commit revalidate and unstable_rethrow`, async () => {
    const source = await read(target.file);
    assert.match(
      source,
      /import \{[^}]*unstable_rethrow[^}]*\} from "next\/navigation"/,
      `${target.file} must import unstable_rethrow`,
    );
    assert.match(source, /runPostCommitBestEffort/);
    assert.match(source, new RegExp(target.revalidateHelper));
    assert.match(source, /unstable_rethrow\(/);
    const exportIndex = source.indexOf(`export async function ${target.exportName}`);
    assert.ok(exportIndex >= 0, `${target.file} must export ${target.exportName}`);
    if (target.exportName === "upsertVideoCollaborator") {
      // The single-row action delegates to the shared intent applier, which
      // owns post-commit revalidation for both single and batch writes.
      assert.match(source, /applyPermissionIntentsToVideo\(/);
      assert.match(source, /applyPermissionIntentsToVideo[\s\S]*revalidateVideoCollabPathsBestEffort/);
    } else {
      assert.match(
        source,
        new RegExp(
          `export async function ${target.exportName}[\\s\\S]*${target.revalidateHelper}`,
        ),
      );
    }
    assert.doesNotMatch(
      source,
      /catch \(error\) \{\s*return \{\s*ok: false/m,
    );
  });
}

test("youtube-sync-admin skips re-queue when metadata is already pending", async () => {
  const source = await read("./youtube-sync-admin.ts");
  assert.match(source, /before\?\.sync_status === "pending"/);
  assert.match(
    source,
    /if \(before\?\.sync_status === "pending"\) \{\s*return;\s*\}/,
  );
});

test("event-youtube-playlist queue sync uses post-commit revalidate", async () => {
  const source = await read("./event-youtube-playlist.ts");
  assert.match(
    source,
    /export async function queueEventYoutubePlaylistSync[\s\S]*revalidateEventYoutubePlaylistPathBestEffort/,
  );
  assert.match(source, /queue sync failed/);
});

test("playlist settings atomically enqueue event_base and wake only after commit", async () => {
  const source = await read("./event-youtube-playlist.ts");
  assert.match(source, /buildStaticRebuildQueueBatch\(guard\.db/);
  assert.match(
    source,
    /mutationStatements:\s*\[\.\.\.mutationStatements, \.\.\.projectionQueue\.statements\]/,
  );
  assert.match(
    source,
    /expectedMutationChanges:\s*\[[\s\S]*\.\.\.projectionQueue\.expectedChanges/,
  );
  assert.match(source, /staticRebuildWakeSource:/);
  assert.doesNotMatch(source, /enqueueEventBaseProjectionBestEffort/);
});

test("playlist settings and manual wake keep the lease CAS at commit time", async () => {
  const source = await read("./event-youtube-playlist.ts");
  assert.match(source, /onConflictDoUpdate\(\{[\s\S]*?where:\s*sql`[\s\S]*?run_lease_token IS NULL/);
  assert.match(source, /pending_trigger: "manual" as const/);
  assert.match(
    source,
    /\.where\(\s*and\(\s*eq\(eventYoutubePlaylistSync\.event_id, eventId\),[\s\S]*?run_lease_expires_at <= \$\{now\}/,
  );
});
