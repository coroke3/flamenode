import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("../../../app/api/youtube-thumbnail/[id]/[size]/route.ts", import.meta.url),
  "utf8",
);

test("YouTube thumbnail routeは共通proxyとサイズ別buffer上限を利用する", () => {
  assert.match(source, /proxyExternalImage/);
  assert.match(source, /namespace: "youtube-thumbnail"/);
  assert.match(source, /MAX_OBJECT_BYTES_BY_SIZE: Record<YoutubeThumbSize, number>/);
  assert.match(source, /mqdefault: 160 \* 1024/);
  assert.match(source, /maxresdefault: 1024 \* 1024/);
  assert.match(source, /maxObjectBytes: MAX_OBJECT_BYTES_BY_SIZE\[size\]/);
  assert.match(source, /i\.ytimg\.com\/vi/);
  assert.match(source, /decodeURIComponent/);
  assert.match(source, /cache\.match/);
  assert.match(source, /cache\.put/);
  assert.match(
    source,
    /\$\{new URL\(req\.url\)\.origin\}\/api\/youtube-thumbnail\/\$\{id\}\/\$\{size\}/,
  );
  assert.doesNotMatch(source, /new Request\(req\.url/);
  assert.doesNotMatch(source, /getDatabase/);
});
