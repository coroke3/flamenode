import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { mergeVideoChapterOverlay } = await import(
    "./privateVideoChapterOverlay.ts"
  );
  const { normalizeStaticVideoDetail } = await import(
    "./staticVideoDetailCore.ts"
  );

  const chapter = (id, time, visibility, label = id) => ({
    id,
    chapter_time: time,
    chapter_label: label,
    visibility,
    note: null,
    author_name: null,
    author_icon: null,
  });

  test("Scenario 7: authorized overlay is private-only and deduplicated", () => {
    const merged = mergeVideoChapterOverlay(
      [chapter("public-2", 20, "public"), chapter("same", 30, "public")],
      [
        chapter("private-1", 10, "private"),
        // D1 private data wins if a stale artifact reused an id.
        { ...chapter("same", 30, "private"), note: "private note" },
        chapter("ignored-public", 5, "public"),
      ],
    );

    assert.deepEqual(
      merged.map(({ id, visibility, note }) => ({ id, visibility, note })),
      [
        { id: "private-1", visibility: "private", note: null },
        { id: "public-2", visibility: "public", note: null },
        { id: "same", visibility: "private", note: "private note" },
      ],
    );
  });

  test("Scenario 7: equal timestamps use stable id ordering", () => {
    const merged = mergeVideoChapterOverlay(
      [chapter("z", 1, "public"), chapter("a", 1, "public")],
      [],
    );
    assert.deepEqual(
      merged.map((entry) => entry.id),
      ["a", "z"],
    );
  });

  test("Scenario 7: malformed visibility and timestamps are fail-closed", () => {
    const merged = mergeVideoChapterOverlay(
      [
        chapter("good", 1, "public"),
        chapter("private-public", 2, "private"),
        { ...chapter("nan", 3, "public"), chapter_time: Number.NaN },
      ],
      [
        chapter("private-good", 4, "private"),
        chapter("public-private", 5, "public"),
        { ...chapter("blank", 6, "private"), id: "" },
      ],
    );
    assert.deepEqual(
      merged.map((entry) => entry.id),
      ["good", "private-good"],
    );
  });

  test("Scenario 7: a stale private row in an R2 artifact is not public", () => {
    const detail = normalizeStaticVideoDetail({
      video: { id: "video-1", title: "Video", visibility_status: "public" },
      public_chapters: [
        { id: "public", chapter_time: 1, chapter_label: "Public", visibility: "public" },
        { id: "private", chapter_time: 2, chapter_label: "Private", visibility: "private" },
        { id: "malformed", chapter_time: 3, chapter_label: "Malformed", visibility: null },
      ],
    });
    assert.ok(detail);
    assert.deepEqual(detail.publicChapters.map((entry) => entry.id), ["public"]);
  });

  test("Scenario 7: public page keeps static body on overlay/D1 failure", async () => {
    const [page, dbQueries, ownership, generator, degraded, overlay, utilityDock] = await Promise.all([
      readFile(new URL("../../../app/(public)/[id]/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../db/videoDetailQueries.ts", import.meta.url), "utf8"),
      readFile(new URL("../auth/ownership.ts", import.meta.url), "utf8"),
      readFile(new URL("../../../workers/json-generator/rebuild.ts", import.meta.url), "utf8"),
      readFile(new URL("./degradedQueries.ts", import.meta.url), "utf8"),
      readFile(new URL("../video/videoViewerOverlay.ts", import.meta.url), "utf8"),
      readFile(new URL("../../components/video/VideoViewerUtilityDock.tsx", import.meta.url), "utf8"),
    ]);

    assert.doesNotMatch(page, /fetchAuthorizedPrivateVideoChapters/);
    assert.doesNotMatch(page, /mergeVideoChapterOverlay/);
    assert.match(page, /VideoViewerUtilityDock/);
    assert.match(overlay, /fetchBoundedPrivateChapters/);
    assert.match(overlay, /authUnavailable: true/);
    assert.match(utilityDock, /mergeVideoChapterOverlay/);
    assert.match(dbQueries, /if \(!viewer\?\.id\) return \[\];/);
    assert.match(dbQueries, /eq\(videoChapters\.visibility, "private"\)/);
    assert.match(dbQueries, /viewer\.role === "admin" \|\| viewer\.canEditChapters === true/);
    assert.match(dbQueries, /json_each\(\$\{JSON\.stringify\(approvedXIds\)\}\)/);
    assert.match(dbQueries, /eq\(xUsers\.approval_status, "approved"\)/);
    assert.match(dbQueries, /notLike\(videoChapters\.id, "%:member:%"\)/);
    assert.match(dbQueries, /notLike\(videoChapters\.id, "%:legacy:%"\)/);
    assert.match(dbQueries, /orderBy\(asc\(videoChapters\.chapter_time\), asc\(videoChapters\.id\)\)/);
    assert.match(ownership, /approvedXUserIds\?: readonly string\[\]/);
    assert.match(ownership, /args\.approvedXUserIds \?\? \(await getApprovedXIds\(db, user\.id\)\)/);
    assert.match(generator, /vc\.visibility = 'public'/);
    assert.match(degraded, /eq\(videoChapters\.visibility, "public"\)/);
  });
}
