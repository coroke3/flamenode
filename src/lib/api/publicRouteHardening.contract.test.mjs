import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const sources = Object.fromEntries(
  await Promise.all(
    [
      ["events", "../../../app/api/events/route.ts"],
      ["videos", "../../../app/api/videos/route.ts"],
      ["videoDetail", "../../../app/api/videos/[id]/route.ts"],
      ["software", "../../../app/api/software/suggestions/route.ts"],
      ["eventExport", "../../../app/api/event-endpoints/[id]/route.ts"],
      ["media", "../../../app/api/media/[...key]/route.ts"],
      [
        "slotIcon",
        "../../../app/api/media/slot-submission-icon/[slotId]/route.ts",
      ],
      ["xSearch", "../../../app/api/internal/x-users/search/route.ts"],
      [
        "spreadsheetExport",
        "../../../app/api/admin/spreadsheet/export/route.ts",
      ],
    ].map(async ([name, path]) => [
      name,
      await readFile(new URL(path, import.meta.url), "utf8"),
    ]),
  ),
);

test("公開一覧APIは静的専用モードでD1へfallbackせず503にする", () => {
  assert.match(
    sources.events,
    /staticIndex\.strategy === "static_json_only"[\s\S]*?public_data_unavailable/,
  );
  assert.match(sources.events, /staticIndex\.strategy === "maintenance"/);
  assert.match(
    sources.events,
    /publicServiceUnavailableResponse\("database_unavailable"\)/,
  );
  assert.match(
    sources.videos,
    /publicServiceUnavailableResponse\("database_unavailable"\)/,
  );
});

test("公開詳細/候補APIは不正pathとD1障害をfail-closedにする", () => {
  assert.match(sources.videoDetail, /function decodePathSegment\(/);
  assert.match(sources.videoDetail, /catch \{\s*return null;/);
  assert.match(
    sources.videoDetail,
    /publicJsonResponse\(_req, \{ error: "not_found" \}, "no-store", 404\)/,
  );
  assert.match(
    sources.videoDetail,
    /publicServiceUnavailableResponse\("database_unavailable"\)/,
  );
  assert.match(sources.software, /MAX_QUERY_LENGTH = 64/);
  assert.match(sources.software, /\.slice\([\s\S]*MAX_QUERY_LENGTH/);
  assert.match(
    sources.software,
    /if \(!results\)[\s\S]*?publicServiceUnavailableResponse\("database_unavailable"\)/,
  );
  assert.match(
    sources.software,
    /checkPublicApiRateLimit\(req, "\/api\/software\/suggestions"\)/,
  );
});

test("公開export/mediaと内部検索は認可後の障害・cacheを安全に処理する", () => {
  assert.match(sources.eventExport, /function decodePathSegment\(/);
  assert.match(sources.eventExport, /event lookup failed/);
  assert.match(sources.eventExport, /snapshot query failed/);
  assert.match(sources.eventExport, /assertNoForbiddenKeys\(payload\)/);
  assert.match(sources.media, /CloudflareBindingsUnavailableError/);
  assert.match(sources.media, /status: 503/);
  assert.match(sources.slotIcon, /CloudflareBindingsUnavailableError/);
  assert.match(sources.slotIcon, /media read failed/);
  assert.match(
    sources.xSearch,
    /Cache-Control": "private, no-store, no-cache, must-revalidate/,
  );
  assert.match(
    sources.spreadsheetExport,
    /PRIVATE_HEADERS[\s\S]*Content-Disposition/,
  );
});
