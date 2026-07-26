import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  dockSource,
  dockCss,
  geometrySource,
  memberCss,
  memberItemSource,
] = await Promise.all([
  readFile(
    new URL(
      "./VideoUtilityDock.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "./VideoUtilityDock.module.css",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "./useMobileVideoGeometry.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "./MemberSection.module.css",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "./MemberChapterItem.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
]);

test("Utility Dockは共通geometry変数だけを使う", () => {
  assert.doesNotMatch(
    dockSource,
    /getBoundingClientRect|visualViewport|ResizeObserver/,
  );
  assert.match(
    dockCss,
    /--fn-mobile-player-bottom/,
  );
  assert.match(
    dockCss,
    /--fn-keyboard-inset/,
  );
});

test("モバイルgeometryはviewport scrollも追従する", () => {
  assert.match(
    geometrySource,
    /viewport\?\.addEventListener\(\s*"scroll"/,
  );
  assert.match(
    geometrySource,
    /window\.addEventListener\(\s*"scroll"/,
  );
  assert.doesNotMatch(
    geometrySource,
    /LANDSCAPE_MIN_PLAYER_WIDTH_PX/,
  );
});

test("モバイルメンバーテーブルはtrをgrid化しない", () => {
  const mobileBlock =
    memberCss.match(
      /@media \(max-width: 640px\) \{[\s\S]*$/,
    )?.[0] ?? "";

  assert.match(
    mobileBlock,
    /\.table\s*\{\s*min-width:\s*680px/,
  );
  assert.doesNotMatch(
    mobileBlock,
    /\.tableHeader,\s*\.tableRow\s*\{[\s\S]*display:\s*grid/,
  );
  assert.doesNotMatch(
    memberCss,
    /\.tableRow\s*>\s*span/,
  );
});

test("メンバーチャプターに補助ラベルを追加しない", () => {
  assert.doesNotMatch(
    memberItemSource,
    /範囲外/,
  );
  assert.doesNotMatch(
    memberItemSource,
    /name="chapter"/,
  );
});
