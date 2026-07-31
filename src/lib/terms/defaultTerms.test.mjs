import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TERMS_MARKDOWN,
  DEFAULT_TERMS_VERSION_LABEL,
} from "./defaultTerms.ts";

test("default terms include liability, deletion, and secondary-use policy", () => {
  assert.match(DEFAULT_TERMS_VERSION_LABEL, /2026-07-31/);
  assert.match(DEFAULT_TERMS_MARKDOWN, /運営は.*責任を負いません/);
  assert.match(
    DEFAULT_TERMS_MARKDOWN,
    /二次創作の作者、企画参加者、サイト利用者本人からの削除依頼に対して、削除義務を負いません/,
  );
  assert.match(
    DEFAULT_TERMS_MARKDOWN,
    /二次創作の権利元.*申請による削除には、運営は可能な範囲で応じます/,
  );
  assert.match(
    DEFAULT_TERMS_MARKDOWN,
    /掲載責任は、当該作品または情報を投稿したサイト利用者が負います/,
  );
  assert.match(
    DEFAULT_TERMS_MARKDOWN,
    /同意以前に投稿された作品を含むすべての掲載作品、および関連するイベント情報は、当サイトの宣伝、広報活動、その他の運営目的に二次利用される場合があります/,
  );
});

test("default terms omit court and governing-law clauses", () => {
  assert.doesNotMatch(DEFAULT_TERMS_MARKDOWN, /準拠法/);
  assert.doesNotMatch(DEFAULT_TERMS_MARKDOWN, /裁判所/);
  assert.doesNotMatch(DEFAULT_TERMS_MARKDOWN, /日本法/);
  assert.doesNotMatch(DEFAULT_TERMS_MARKDOWN, /故意又は重大な過失/);
  assert.doesNotMatch(DEFAULT_TERMS_MARKDOWN, /弁護士費用/);
});
