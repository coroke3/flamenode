import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  dockSource,
  dockCss,
  geometrySource,
  memberSource,
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
      "./MemberSection.tsx",
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

test("モバイルgeometryは未変化時にCSS変数を書き換えない", () => {
  assert.match(
    geometrySource,
    /applyMobileVideoGeometryCssVars/,
  );
  assert.match(
    geometrySource,
    /lastCssVars/,
  );
});

test("モバイルgeometryはキーボード表示中にプレイヤー寸法を凍結する", () => {
  assert.match(
    geometrySource,
    /lastNonKeyboardPlayerSize/,
  );
  assert.match(
    geometrySource,
    /scheduleFromScroll/,
  );
  assert.doesNotMatch(
    geometrySource,
    /keyboardInset\s*>\s*0[\s\S]*constrainByHeight/,
  );
});

test("メンバーテーブルは必要以上の固定幅を持たずtrをgrid化しない", () => {
  const mobileBlock =
    memberCss.match(
      /@media \(max-width: 640px\) \{[\s\S]*$/,
    )?.[0] ?? "";

  assert.doesNotMatch(memberCss, /min-width:\s*(?:680|720)px/);
  assert.match(
    memberCss,
    /\.tableWrap\s*\{[\s\S]*?width:\s*fit-content;[\s\S]*?max-width:\s*100%/,
  );
  assert.match(
    memberCss,
    /\.tColNo\s*\{[\s\S]*?width:\s*52px;[\s\S]*?max-width:\s*52px/,
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

test("メンバーのアイコンと活動名は公開プロフィールへ直接リンクする", () => {
  assert.match(memberSource, /function memberProfileHref/);
  assert.match(
    memberSource,
    /<Link href=\{internalHref\} className=\{styles\.tNameLink\}>[\s\S]*?<UserAvatar[\s\S]*?label=\{displayName\}/,
  );
  assert.match(memberSource, /useIconFallback/);
  assert.match(memberSource, /className=\{styles\.chapterGroupIdentity\}/);
  assert.doesNotMatch(memberSource, /label="FlameNode"/);
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
