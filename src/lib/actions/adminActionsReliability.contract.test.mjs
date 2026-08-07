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
    assert.match(
      source,
      new RegExp(
        `export async function ${target.exportName}[\\s\\S]*${target.revalidateHelper}`,
      ),
    );
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
