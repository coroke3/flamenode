import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [eventPage, videoPage, videoQueries, videoOverlay] = await Promise.all([
  readFile(
    new URL("../../../app/(public)/event/[id]/page.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../app/(public)/[id]/page.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("./videoDetailQueries.ts", import.meta.url), "utf8"),
  readFile(new URL("../video/videoViewerOverlay.ts", import.meta.url), "utf8"),
]);

test("event cards preserve the public event playlist", () => {
  assert.match(
    eventPage,
    /const target = video\.youtube_video_id\?\.trim\(\) \|\| video\.id/,
  );
  assert.match(
    eventPage,
    /href=\{`\/\$\{target\}\?playlist=\$\{encodeURIComponent\(eventId\)\}`\}/,
  );
});

test("anonymous video overlays may load only public event playlists", () => {
  const playlistQuery = videoQueries.slice(
    videoQueries.indexOf("export async function fetchEventPlaylistVideos("),
  );

  assert.match(videoPage, /VideoViewerUtilityDock/);
  assert.match(videoOverlay, /const publicPlaylist = await loadStaticEventPlaylistOverlay/);
  assert.match(videoOverlay, /loadPublicEventPlaylistR2Only\(playlist\)/);
  assert.doesNotMatch(videoOverlay, /fetchEventPlaylistVideos\(db, playlist\)/);
  assert.match(videoOverlay, /resolvePublicOperationMode\(\{ allowD1: false \}\)/);
  assert.match(videoOverlay, /if \(!isLiveApiEnabled\(operationMode\)\)/);
  assert.match(
    videoOverlay,
    /const operationMode = await resolvePublicOperationMode[\s\S]*?if \(!isLiveApiEnabled\(operationMode\)\)[\s\S]*?let context/,
  );
  assert.match(videoOverlay, /error instanceof CurrentUserUnavailableError/);
  assert.match(
    videoOverlay,
    /return emptyOverlay\(publicPlaylist\);/,
  );
  assert.doesNotMatch(
    videoOverlay,
    /fetchEventPlaylistVideos/,
  );

  assert.match(playlistQuery, /\.innerJoin\(\s*events,/);
  assert.match(playlistQuery, /eq\(events\.visibility_status, "public"\)/);
  assert.match(playlistQuery, /eventPublicVideoLinkCondition\(eventId\)/);
  assert.match(playlistQuery, /countablePublicVideoCondition/);
  assert.match(
    playlistQuery,
    /\.orderBy\(\s*sql`\$\{videos\.scheduled_time\} IS NULL ASC, \$\{videos\.scheduled_time\} ASC, \$\{videos\.id\} ASC`,/,
  );
});

test("playlist R2 fallback は理由を分類して event visibility guard を維持する", () => {
  assert.match(videoQueries, /r2_missing/);
  assert.match(videoQueries, /r2_invalid/);
  assert.match(videoQueries, /r2_incomplete/);
  assert.match(videoQueries, /r2_error/);
  assert.match(videoQueries, /event_playlist_d1_fallback/);
  assert.match(videoQueries, /from\(events\)/);
  assert.match(videoQueries, /visibility_status !== "public"/);
  assert.match(videoQueries, /readPublicVisibilityBlockedEntitiesManifest/);
  assert.match(
    videoQueries,
    /isEntityBlockedInManifest\(visibilityManifest, "event", eventId\)/,
  );
  assert.match(videoQueries, /isEntityBlockedInManifest\(visibilityManifest!, "video"/);
  assert.match(videoQueries, /containsBlockedVideo/);
  assert.match(videoQueries, /afterVisibility/);
  assert.match(videoQueries, /visibilityManifestEtag/);
  assert.match(videoQueries, /visibilityManifestUnavailable/);
  assert.match(
    videoQueries,
    /visibilityGuardMode === "enforce" && visibilityManifestUnavailable/,
  );
  assert.match(
    videoQueries,
    /afterVisibility\.etag !== visibilityManifestEtag/,
  );
  assert.match(
    videoQueries,
    /resolvePublicVisibilityGuardModeFromEnv\(\)/,
  );
});
