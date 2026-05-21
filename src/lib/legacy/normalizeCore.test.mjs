import { test } from "node:test";
import assert from "node:assert/strict";
import {
  looksLikeMojibake,
  cleanLegacyString,
  normalizeIconUrl,
  normalizeLegacyUrl,
  normalizeXIdLegacy,
  splitCsvStringPreserveEmpty,
  splitCsvString,
  splitLegacyEventIds,
  toUnixSec,
  normalizeEventType,
  normalizeSubmissionType,
  submissionTypeFromLegacyVideo,
  MOJIBAKE_TOKENS,
  COLLAB_TOKENS,
} from "./normalizeCore.ts";

// Token verification: codepoints must match normalize.ts exactly
test("MOJIBAKE_TOKENS preserve expected codepoints", () => {
  const expectedHex = [
    "fffd",
    "7e3a",
    "7e67",
    "8373",
    "8b41",
    "90b5",
    "965e",
    "9677",
    "95d5",
    "96b4",
  ];
  const actualHex = MOJIBAKE_TOKENS.map((t) => t.codePointAt(0).toString(16));
  assert.deepEqual(actualHex, expectedHex);
});

test("COLLAB_TOKENS preserve expected codepoints", () => {
  // collab, then 5 mojibake-aware tokens
  assert.equal(COLLAB_TOKENS[0], "collab");
  assert.equal(COLLAB_TOKENS[1].codePointAt(0).toString(16), "8907");
  assert.equal(COLLAB_TOKENS[1].codePointAt(1).toString(16), "6570");
  assert.equal(COLLAB_TOKENS[2].codePointAt(0).toString(16), "5408");
  assert.equal(COLLAB_TOKENS[2].codePointAt(1).toString(16), "4f5c");
  assert.equal(COLLAB_TOKENS[3].codePointAt(0).toString(16), "56e3");
  assert.equal(COLLAB_TOKENS[3].codePointAt(1).toString(16), "4f53");
  assert.equal(COLLAB_TOKENS[4].codePointAt(0).toString(16), "968d");
  assert.equal(COLLAB_TOKENS[5].codePointAt(0).toString(16), "8757");
});

test("looksLikeMojibake: empty/null", () => {
  assert.equal(looksLikeMojibake(""), false);
  assert.equal(looksLikeMojibake(null), false);
  assert.equal(looksLikeMojibake(undefined), false);
});

test("looksLikeMojibake: U+FFFD replacement char triggers true", () => {
  const s = `abc${String.fromCodePoint(0xfffd)}def`;
  assert.equal(looksLikeMojibake(s), true);
});

test("looksLikeMojibake: control chars trigger true", () => {
  for (const cp of [0x00, 0x05, 0x08, 0x0b, 0x10, 0x1f]) {
    assert.equal(
      looksLikeMojibake(`a${String.fromCodePoint(cp)}b`),
      true,
      `cp=${cp.toString(16)} should trigger`,
    );
  }
});

test("looksLikeMojibake: tab (U+0009) and LF (U+000A) do NOT trigger", () => {
  assert.equal(looksLikeMojibake("a\tb"), false);
  assert.equal(looksLikeMojibake("a\nb"), false);
});

test("normalizeIconUrl: drive open URL → lh3", () => {
  const out = normalizeIconUrl(
    "https://drive.google.com/open?id=ABC123-_456",
  );
  assert.equal(out, "https://lh3.googleusercontent.com/d/ABC123-_456");
});

test("normalizeIconUrl: drive file/d/ URL → lh3", () => {
  const out = normalizeIconUrl("https://drive.google.com/file/d/XYZ_789/view");
  assert.equal(out, "https://lh3.googleusercontent.com/d/XYZ_789");
});

test("normalizeIconUrl: 非 drive URL はそのまま", () => {
  assert.equal(normalizeIconUrl("https://example.com/a.png"), "https://example.com/a.png");
});

test("normalizeIconUrl: 空/null", () => {
  assert.equal(normalizeIconUrl(null), null);
  assert.equal(normalizeIconUrl(""), null);
  assert.equal(normalizeIconUrl("   "), null);
});

test("normalizeIconUrl: legacy relative paths are dropped", () => {
  assert.equal(normalizeIconUrl("hqdefault.jpg"), null);
  assert.equal(normalizeIconUrl("IMG_1409 - sample.jpeg"), null);
});

test("normalizeIconUrl: app media paths are preserved", () => {
  assert.equal(
    normalizeIconUrl("/api/media/xicons/sample.png"),
    "/api/media/xicons/sample.png",
  );
});

test("normalizeXIdLegacy: 通常", () => {
  assert.equal(normalizeXIdLegacy("@tanaka"), "tanaka");
  assert.equal(normalizeXIdLegacy("foo_bar"), "foo_bar");
  assert.equal(normalizeXIdLegacy("@@@FOO"), "foo");
  assert.equal(normalizeXIdLegacy("Foo_Bar"), "foo_bar");
});

test("normalizeXIdLegacy: スペースをアンダースコアに", () => {
  assert.equal(normalizeXIdLegacy("foo bar"), "foo_bar");
});

test("normalizeXIdLegacy: 不正文字は null", () => {
  assert.equal(normalizeXIdLegacy("foo-bar"), null);
  assert.equal(normalizeXIdLegacy("foo.bar"), null);
  assert.equal(normalizeXIdLegacy(null), null);
  assert.equal(normalizeXIdLegacy(""), null);
});

test("normalizeXIdLegacy: 64 文字でクリップ", () => {
  const long = "a".repeat(80);
  assert.equal(normalizeXIdLegacy(long).length, 64);
});

test("cleanLegacyString: trims, normalizes line endings, and drops controls", () => {
  assert.equal(cleanLegacyString(" \r\nA\u0000B\r\n "), "AB");
  assert.equal(cleanLegacyString("   "), null);
  assert.equal(cleanLegacyString("abcdef", { maxLength: 3 }), "abc");
});

test("normalizeLegacyUrl: accepts http(s), rejects relative or non-http", () => {
  assert.equal(normalizeLegacyUrl(" https://example.com/a "), "https://example.com/a");
  assert.equal(normalizeLegacyUrl("ftp://example.com/a"), null);
  assert.equal(normalizeLegacyUrl("relative/path"), null);
});

test("splitCsvString: ASCII comma + JP comma (U+3001) で分割", () => {
  assert.deepEqual(splitCsvString("a,b,c"), ["a", "b", "c"]);
  assert.deepEqual(
    splitCsvString(`a${String.fromCodePoint(0x3001)}b${String.fromCodePoint(0x3001)}c`),
    ["a", "b", "c"],
  );
  assert.deepEqual(splitCsvString(""), []);
  assert.deepEqual(splitCsvString(null), []);
  assert.deepEqual(splitCsvString(" a , b , "), ["a", "b"]);
});

test("splitCsvStringPreserveEmpty: member/memberid の 1:1 対応用に空要素を保持", () => {
  assert.deepEqual(splitCsvStringPreserveEmpty("a,,c"), ["a", "", "c"]);
  assert.deepEqual(splitCsvStringPreserveEmpty(" a , b , "), ["a", "b"]);
  assert.deepEqual(splitCsvStringPreserveEmpty(",b"), ["", "b"]);
});

test("splitLegacyEventIds: comma-separated eventid を順序維持で dedupe", () => {
  assert.deepEqual(
    splitLegacyEventIds("PVSF2026Sp, PVSF2025S, PVSF2026Sp"),
    ["PVSF2026Sp", "PVSF2025S"],
  );
  assert.deepEqual(splitLegacyEventIds("@PVSF2024GW"), ["PVSF2024GW"]);
});

test("toUnixSec: null/empty", () => {
  assert.equal(toUnixSec(null), null);
  assert.equal(toUnixSec(""), null);
  assert.equal(toUnixSec(undefined), null);
});

test("toUnixSec: 秒の整数", () => {
  assert.equal(toUnixSec(1700000000), 1700000000);
});

test("toUnixSec: ミリ秒 → 秒", () => {
  assert.equal(toUnixSec(1700000000000), 1700000000);
});

test("toUnixSec: Excel シリアル日付 (25569 基準)", () => {
  // 1970-01-01 = 25569
  const v = toUnixSec(25569);
  assert.equal(v, 0);
});

test("toUnixSec: ISO 文字列", () => {
  const v = toUnixSec("2023-11-14T22:13:20Z");
  assert.equal(v, 1700000000);
});

test("toUnixSec: 数値文字列", () => {
  assert.equal(toUnixSec("1700000000"), 1700000000);
});

test("toUnixSec: 完全に不正な文字列は null", () => {
  // Date.parse も MM/DD 正規表現も失敗する文字列。
  const v = toUnixSec("not-a-date-xyz", 2023, "07:13");
  assert.equal(v, null);
});

test("toUnixSec: 文字列「11/15」は Date.parse 経路 (環境依存値)", () => {
  // Node.js Date.parse("11/15") = 2001-11-15 (year 2001 にフォールバック)。
  // 値そのものは環境依存だが、null ではなく Math.floor された秒数が返ることだけ確認。
  const v = toUnixSec("11/15");
  assert.ok(typeof v === "number" && v > 0);
});

test("normalizeEventType: マッピング", () => {
  assert.equal(normalizeEventType("event"), "event");
  assert.equal(normalizeEventType("EVENT"), "event");
  assert.equal(normalizeEventType("collab"), "collabo");
  assert.equal(normalizeEventType("collabo"), "collabo");
  assert.equal(normalizeEventType("collaboration"), "collabo");
  assert.equal(normalizeEventType("type"), "type");
  assert.equal(normalizeEventType(""), "event");
  assert.equal(normalizeEventType(null), "event");
  assert.equal(normalizeEventType("unknown"), "other");
});

test("normalizeSubmissionType: collab トークン検出", () => {
  assert.equal(normalizeSubmissionType("collab work"), "collab");
  assert.equal(
    normalizeSubmissionType(String.fromCodePoint(0x8907, 0x6570)),
    "collab",
    "複数 → collab",
  );
  assert.equal(
    normalizeSubmissionType(String.fromCodePoint(0x5408, 0x4f5c)),
    "collab",
    "合作 → collab",
  );
  assert.equal(
    normalizeSubmissionType(String.fromCodePoint(0x56e3, 0x4f53)),
    "collab",
    "団体 → collab",
  );
  assert.equal(
    normalizeSubmissionType(String.fromCodePoint(0x968d)),
    "collab",
    "mojibake 隍 → collab",
  );
  assert.equal(
    normalizeSubmissionType(String.fromCodePoint(0x8757)),
    "collab",
    "mojibake 蝗 → collab",
  );
});

test("normalizeSubmissionType: individual がデフォルト", () => {
  assert.equal(normalizeSubmissionType(""), "individual");
  assert.equal(normalizeSubmissionType(null), "individual");
  assert.equal(normalizeSubmissionType("solo"), "individual");
  assert.equal(normalizeSubmissionType("personal"), "individual");
});

test("submissionTypeFromLegacyVideo: type2 優先", () => {
  assert.equal(
    submissionTypeFromLegacyVideo({ type2: "collab", type: "x", type1: "y" }),
    "collab",
  );
  assert.equal(
    submissionTypeFromLegacyVideo({ type: "collab", type1: "y" }),
    "collab",
  );
  assert.equal(
    submissionTypeFromLegacyVideo({ type1: "collab" }),
    "collab",
  );
  assert.equal(submissionTypeFromLegacyVideo({}), "individual");
});
