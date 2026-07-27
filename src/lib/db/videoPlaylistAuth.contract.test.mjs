import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [eventPage, videoPage, videoQueries] = await Promise.all([
  readFile(
    new URL("../../../app/(public)/event/[id]/page.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../app/(public)/[id]/page.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("./videoDetailQueries.ts", import.meta.url), "utf8"),
]);

test("event cards preserve the public event playlist", () => {
  assert.match(eventPage, /const target = video\.youtube_video_id \?\? video\.id/);
  assert.match(
    eventPage,
    /href=\{`\/\$\{target\}\?playlist=\$\{encodeURIComponent\(eventId\)\}`\}/,
  );
});

test("anonymous video overlays may load only public event playlists", () => {
  assert.doesNotMatch(videoPage, /if \(!viewerUser\) return emptyOverlay/);
  assert.match(videoPage, /const eventPlaylistRequested =/);
  assert.match(videoPage, /fetchEventPlaylistVideos\(db, playlist\)/);
  assert.match(videoPage, /error instanceof CurrentUserUnavailableError/);
  assert.match(
    videoPage,
    /return \{ \.\.\.emptyOverlay, viewerUser, authUnavailable \}/,
  );
  assert.doesNotMatch(
    videoPage,
    /return \{ \.\.\.emptyOverlay, viewerUser, authUnavailable: true \}/,
  );
  assert.match(videoPage, /if \(viewerActiveX\)/);

  assert.match(
    videoQueries,
    /\.innerJoin\(events, eq\(videoEvents\.event_id, events\.id\)\)/,
  );
  assert.match(
    videoQueries,
    /eq\(events\.visibility_status, "public"\)/,
  );
});
