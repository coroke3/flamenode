# FlameNode Phase 2 タスク仕様書（Design System & UI Primitives Spec）

> 状態: Active / Phase 2 実行向け仕様書
> 最終検証: 2026-10-13（HTMLモック登録 D-08 DECIDED, MIG-0200 DONE 後に策定）
> 対象モデル: Claude / Codex / Antigravity / 全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`AGENT_PROTOCOL.md`](AGENT_PROTOCOL.md), [`UI_REFERENCE.md`](UI_REFERENCE.md), [`CURRENT_ROUTES.md`](CURRENT_ROUTES.md), [`TASK_CARDS_2_3.md`](TASK_CARDS_2_3.md)

この仕様書は、Phase 2（デザインシステム・UI Primitives・IA抽出）のアーキテクチャ方針と各タスクの実行境界を定める。

> **実行の正本:** 個別MIGの手順・停止条件・検証は本仕様書の `### MIG-XXXX:` Work Order。[`TASK_CARDS_2_3.md`](TASK_CARDS_2_3.md) は概要索引、CURRENT code/tests は実挙動の正本、[`STATUS.md`](STATUS.md) はmainへ統合済み進捗の正本。`npm run migration:next` はWork Orderと対応カードを併記し、矛盾時はLead確認までSTOP。

---

# 1. Phase 2 の目的と基本原則

### 目的

ユーザー承認済みの HTML モック（`docs/migration/mock/`、`UI_REFERENCE.md` 登録済み）から、デザイントークン（色・余白・タイポグラフィ・ブレークポイント等）および汎用 UI プリミティブ（Button, Link, Badge, Modal, Input 等）を抽出し、フレームワーク非依存の `packages/ui` に実装する。

### 基本原則

1. **公開画面と非公開画面の分離**:
   - **公開画面**: 登録済み HTML モック（D-08 DECIDED）を正本としてデザインを適用。
   - **非公開画面**: CURRENT UI / 機能を維持・再利用。モックの未掲載を理由に独自デザインを創作しない。
2. **既存機能・UX の完全保持**:
   - 見た目の変更（デザイン刷新）によって既存の認可、CSRF、キーボード操作、フォーカス管理、アクセシビリティ（a11y）、エラー表示、ローディング表示を欠落させない。
3. **薄い UI コンポーネント境界**:
   - `packages/ui` のコンポーネントは Next.js, Astro, Vite, Hono 等の特定フレームワークに密結合せず、純粋な React コンポーネントおよび CSS トークンとして提供する。
4. **段階的リリースと Gate 厳守**:
   - Phase 2 の完了は `MIG-0206`（Phase 2 Acceptance Gate）の明示的検証・承認をもって認定し、後続の個別画面移行（Phase 4/5）の前提条件とする。

---

# 2. Phase 2 タスク構成

| タスク ID | 名称 | 対象境界 | 主な成果物 |
| --- | --- | --- | --- |
| `MIG-0200` | 承認済み HTML モック登録（DONE） | `docs/migration/` | `UI_REFERENCE.md`, `OPEN_DECISIONS.md` |
| `MIG-0201` | デザイントークン抽出 | `packages/ui/src/styles/` | `tokens.css`（`tokens.json` から生成） |
| `MIG-0202` | 汎用 UI プリミティブ実装 | `packages/ui/src/components/` | Button, Link, Badge, Dialog, `bodyScrollLock.ts` |
| `MIG-0203` | 公開ナビゲーション・レイアウト | `packages/ui/src/layout/` | Header, Footer, SideNav, Layout Context |
| `MIG-0204` | フォーム・フィードバック・データ表示 | `packages/ui/src/` | Form controls, Toast, Alert, Table, Skeleton |
| `MIG-0205` | 代表的レスポンシブ公開画面プロトタイプ | `packages/ui/` | Video, Event, User 代表画面プロトタイプ |
| `MIG-0206` | Phase 2 受入 Gate | 全体検証 | UI Primitive テストスイート, Gate 判定記録 |

---

# 3. Work Orders

### MIG-0201: visual hierarchy / IA / tokens extraction
- **Model:** small
- **Readiness:** READY_FOR_SMALL_MODEL — 下の生成 script と test は 2026-10-15 に実行し、出力の sha256 と test 3件 PASS を確認した
- **Recipe:** R-BUILD
- **Runtime:** N
- **Depends on:** MIG-0108, MIG-0200 / **Decisions:** D-08 DECIDED
- **Verified against:** `7e1deb5` (2026-10-15)
#### Source snapshot
- `docs/migration/mock/source/design-system/tokens.json`（version 1）: `color.tokens` 27件（パレット12件は文字列、テーマ別15件は `{"dark","light"}`、値の `{black}` はパレット参照）、`spacing.tokens` 7件、`radius.tokens` 1件、`shadow.tokens` 1件（テーマ別）、`type.families` 3件、`type.groups` 3群・9スタイル。
- mock の CSS `docs/migration/mock/source/fn.css:9-19` も同じ値を `:root,[data-theme="dark"]` と `[data-theme="light"]` に持つ。違いは1点だけ: light の `--shadow-overlay` を2回書いており、後の `0 8px 24px rgba(16,18,15,.18)` が効く（tokens.json は `rgba(0,0,0,0.16)`）。**この task では tokens.json を正とする**。
- route と mock の対応表は `docs/migration/UI_REFERENCE.md` の「CURRENT route と mock の対応」に既にある。別の対応表（旧計画の `IA_MAPPING.md`）は重複なので作らない。
- `packages/ui/src/styles/` は存在しない。`test:unit`（`package.json` の scripts）は `scripts/**/*.test.mjs` を含む。
#### Owned paths
- 新規: `+scripts/generate-ui-tokens.mjs`, `+scripts/generate-ui-tokens.test.mjs`, `+packages/ui/src/styles/tokens.css`（script の出力。手で編集しない）
- 触らない: `docs/migration/mock/**`（登録済み mock）、`packages/ui/src/components/**`（MIG-0202）
- 対象外: `@font-face`（font file の置き場所が未決定。lead が MIG-0202 の refinement で決める）、breakpoint（tokens.json に無い）
#### Micro-units
- **U01 生成 script を作る**: `scripts/generate-ui-tokens.mjs` を次の内容で作る（1文字も変えない）。
  ```js
#!/usr/bin/env node
// tokens.json（登録済み mock のデザイントークン）から packages/ui の CSS 変数を作る。
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const TOKENS_JSON = "docs/migration/mock/source/design-system/tokens.json";
export const TOKENS_CSS = "packages/ui/src/styles/tokens.css";

const cssValue = (value) => value.replace(/^\{(.+)\}$/, "var(--$1)");
const declaration = (name, value) => `  --${name}: ${cssValue(String(value))};`;

export function renderTokensCss(tokens) {
  const shared = [];
  const themed = { dark: [], light: [] };
  for (const token of [...tokens.color.tokens, ...tokens.shadow.tokens]) {
    if (typeof token.value === "string") shared.push(declaration(token.name, token.value));
    else for (const theme of ["dark", "light"]) themed[theme].push(declaration(token.name, token.value[theme]));
  }
  for (const token of [...tokens.spacing.tokens, ...tokens.radius.tokens]) shared.push(declaration(token.name, token.value));
  for (const [name, stack] of Object.entries(tokens.type.families)) shared.push(`  --font-${name}: ${stack};`);
  for (const group of tokens.type.groups) {
    for (const style of group.styles) {
      shared.push(`  --text-${style.name}-family: var(--font-${style.family ?? group.family});`);
      shared.push(declaration(`text-${style.name}-size`, style.fontSize));
      shared.push(declaration(`text-${style.name}-line-height`, style.lineHeight));
      shared.push(declaration(`text-${style.name}-weight`, style.fontWeight));
      if (style.letterSpacing) shared.push(declaration(`text-${style.name}-letter-spacing`, style.letterSpacing));
    }
  }
  return [
    `/* 生成元: ${TOKENS_JSON}（version ${tokens.version}）。手で編集しない。再生成: node scripts/generate-ui-tokens.mjs */`,
    ":root {", ...shared, "}", "",
    ":root,", '[data-theme="dark"] {', ...themed.dark, "}", "",
    '[data-theme="light"] {', ...themed.light, "}", "",
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tokens = JSON.parse(fs.readFileSync(TOKENS_JSON, "utf8"));
  fs.mkdirSync("packages/ui/src/styles", { recursive: true });
  fs.writeFileSync(TOKENS_CSS, renderTokensCss(tokens));
}
  ```
  ```bash
  node scripts/generate-ui-tokens.mjs
  sha256sum packages/ui/src/styles/tokens.css
  wc -l packages/ui/src/styles/tokens.css
  ```
  期待: sha256 が `affa3789bb7c49a25d9d8abcd9d8a10af5537b83aaba6a2d5533bde496e42f25`、行数 103。違えば script を見直し、2回直しても合わなければ STOP。
- **U02 test を作る**: `scripts/generate-ui-tokens.test.mjs` を次の内容で作る。
  ```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { renderTokensCss, TOKENS_CSS, TOKENS_JSON } from "./generate-ui-tokens.mjs";

const tokens = JSON.parse(fs.readFileSync(TOKENS_JSON, "utf8"));

test("committed tokens.css matches tokens.json", () => {
  assert.equal(fs.readFileSync(TOKENS_CSS, "utf8"), renderTokensCss(tokens));
});

test("theme tokens reference palette variables in both themes", () => {
  const css = renderTokensCss(tokens);
  assert.match(css, /\[data-theme="dark"\] \{\n  --bg: var\(--black\);/);
  assert.match(css, /\[data-theme="light"\] \{\n  --bg: var\(--white\);/);
});

test("rendering is deterministic", () => {
  assert.equal(renderTokensCss(tokens), renderTokensCss(structuredClone(tokens)));
});
  ```
  ```bash
  node --test scripts/generate-ui-tokens.test.mjs
  npm run test:unit
  ```
  期待: 出力の末尾近くに `# pass 3` と `# fail 0`（1行目は `TAP version 13`）。`test:unit` は `# fail 0` で、`# pass` が変更前より3件多い（作業前に `npm run test:unit` を実行して数を控える）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `node scripts/generate-ui-tokens.mjs` を2回実行 | 2回とも sha256 `affa3789…2f25` |
| T02 | 生成された file の `[data-theme="light"]` 節 | `--bg: var(--white);` で始まり `--shadow-overlay: 0 8px 24px rgba(0,0,0,0.16);` で終わる |
| T03 | tokens.json を書き換えずに test 実行 | 3件 PASS |
| T04 | tokens.css を手で1文字変えて test 実行 | 1件目が FAIL（戻してから commit） |
#### Commands
```bash
node scripts/generate-ui-tokens.mjs
node --test scripts/generate-ui-tokens.test.mjs
npm run test:unit
node scripts/check-migration-file-progress.mjs
npm run check:project-docs
```
期待: すべて終了コード0。`git diff --name-only origin/main...HEAD` の出力が Owned paths の3 file と `docs/migration/work-items/MIG-0201.md` の4行だけ。
#### Ledger updates
なし。`FILE_MIGRATION_MATRIX.md` は CURRENT の file の移行先を追う台帳で、tokens.css に対応する CURRENT の file は無い。UX / FN の state も変えない（部品はまだ使われていない）。
#### DONE checklist
- [ ] `packages/ui/src/styles/tokens.css` の sha256 が `affa3789bb7c49a25d9d8abcd9d8a10af5537b83aaba6a2d5533bde496e42f25`
- [ ] `scripts/generate-ui-tokens.test.mjs` が `test:unit` で走る（件数 +3）
- [ ] PR 本文に fn.css と tokens.json の light shadow の違いを1行で書いた
#### STOP
- `tokens.json` の version が 1 でない、または token の件数が Source snapshot と違う（mock が更新された）。
- sha256 が合わない（2回直しても）。
- 手順に無い token（breakpoint、font file、density）を足したくなった。
#### Rollback
PR を revert（新規 file の追加と台帳1行だけ）。

### MIG-0202: shared UI primitives
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0201 の `tokens.css` 変数名と、`packages/ui` のコンポーネントテスト実行経路（U01）が確定するまで小型モデルへ渡さない
- **Recipe:** R-UI
- **Runtime:** N
- **Depends on:** MIG-0201 / **Decisions:** D-08 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- `packages/ui/src/components/Button.tsx:3-13`: `variant` は `primary | secondary` のみ。disabled/loading/aria の扱いは未実装。
- `packages/ui/src/index.ts:1-2`: export は `Button` と `adapters` のみ。
- `packages/ui/package.json`: `build` = `tsc`（`dist/` 出力）。test script は無い。root `test:unit`（`package.json:85`）は `src/** scripts/** app/**` だけを対象にし、`packages/**` のテストは CI で実行されない。
- `src/components/layout/bodyScrollLock.ts:20-22` `acquireBodyScrollLock(): () => void`、`:138-140` `getBodyScrollLockCountForTest()`。契約テストは `src/components/layout/bodyScrollLock.contract.test.mjs`。
- 既存の汎用部品: `src/components/ui/ConfirmDialog.tsx`, `src/components/ui/Icon.tsx`, `src/components/ui/Logo.tsx`。
- モック側の部品定義: `docs/migration/mock/source/design-system/components.js`, `components.css`（版は `UI_REFERENCE.md` の `Version/hash` を正本とする。mock差し替えPRがmerge済みならその版で読み直す）。
#### Owned paths
- 変更: `packages/ui/src/components/Button.tsx`, `packages/ui/src/index.ts`, `packages/ui/package.json`（test script 追加のみ）, `.github/workflows/migration-docs-check.yml`（ui の test を1行追加のみ）
- 新規: `+packages/ui/src/components/Badge.tsx`, `+packages/ui/src/components/Dialog.tsx`, `+packages/ui/src/layout/bodyScrollLock.ts`, `+packages/ui/test/*.test.mjs`
- 変更（bridge化のみ）: `src/components/layout/bodyScrollLock.ts` を `@flamenode/ui` の再exportにする
- 触らない: `packages/ui/src/adapters/index.tsx`（Context化は MIG-0203 の所有）、`src/components/ui/**`（CURRENT UI は Phase 7 まで維持）
#### Micro-units
- **U01 test path**: `packages/ui` に `"test": "npm run build && node --test test/*.test.mjs"` を追加し、`react-dom/server` の `renderToStaticMarkup` で `dist/` を検証する経路を作る。`.github/workflows/migration-docs-check.yml` の workspace job に `npm run test --workspace=@flamenode/ui` を1行追加。検証: `npm run test --workspace=@flamenode/ui` が0件以上PASSで終了コード0。
- **U02 Button**: `disabled` / `aria-busy`（loading）/ `type="button"` 既定値を mock の button 状態に合わせて追加。CSS は `tokens.css` の変数だけを参照。検証: U01 のテストで disabled 時に `disabled` 属性、loading 時に `aria-busy="true"` が出る。
- **U03 bodyScrollLock**: `src/components/layout/bodyScrollLock.ts` の実装を意味を変えず `packages/ui/src/layout/bodyScrollLock.ts` へ移し、旧pathを同名export bridgeにする。検証: `node --test --experimental-strip-types src/components/layout/bodyScrollLock.contract.test.mjs` が移動前と同数PASS。
- **U04 Badge / Dialog**: mock に存在する場合だけ作る。Dialog は `role="dialog"`、`aria-modal`、開閉時のフォーカス移動と復帰、Esc で閉じる、`acquireBodyScrollLock` を使う。検証: U01 テストでマークアップ、手動でキーボード操作を確認しPRに記録。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `<Button disabled>` を描画 | `disabled` 属性が付き、onClick が発火しない |
| T02 | `<Button loading>` を描画 | `aria-busy="true"`、二重押下が無効 |
| T03 | Dialog を開いて Esc | 閉じて、開いた要素へフォーカスが戻る |
| T04 | Dialog を2つ重ねて閉じる | `getBodyScrollLockCountForTest()` が0へ戻る |
| T05 | 旧path `src/components/layout/bodyScrollLock.ts` から import | 既存の契約テストが無変更でPASS |
#### Commands
```bash
npm run build --workspace=@flamenode/ui
npm run test --workspace=@flamenode/ui
node --test --experimental-strip-types src/components/layout/bodyScrollLock.contract.test.mjs
npm run typecheck
npm run check:project-docs
```
期待: すべて終了コード0。
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に `src/components/layout/bodyScrollLock.ts`（state `BRIDGED`, target `packages/ui/src/layout/bodyScrollLock.ts`）と新規 `packages/ui/src/components/*.tsx` 行を追加。UX ID は `UI_REFERENCE.md` の「CURRENT route と mock の対応」と `screen-mapping/README.md` で対応付けたものだけを記録する。
#### DONE checklist
- [ ] `npm run test --workspace=@flamenode/ui` が CI の workspace job で実行される
- [ ] 作った primitive がすべて mock の部品定義に存在する（存在しない部品は作っていない）
- [ ] bodyScrollLock の旧path契約テストが移動前と同数PASS
- [ ] `packages/ui/src/**` に `next/*` の import が無い
#### STOP
- mock に無い部品やバリアントが必要になったら作らずに lead へ返す。
- `adapters/index.tsx` の変更が必要になったら MIG-0203 へ回す。
- `src/components/ui/**` の既存部品を置換する必要が出たら止める（Phase 7 の所有）。
#### Rollback
PRをrevert。bridge化した `src/components/layout/bodyScrollLock.ts` は revert で元実装に戻る。

### MIG-0203: public navigation / layout
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0202 の primitive と、mock の header/footer/スマホメニューの階層（mock差し替え後の版）を確定してから
- **Recipe:** R-UI
- **Runtime:** N
- **Depends on:** MIG-0202 / **Decisions:** D-08 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- `packages/ui/src/adapters/index.tsx:8-12, 31-35, 66-68`: `setLinkComponent` / `setImageComponent` / `setNavigatorAdapter` はモジュール単位の可変グローバル。Astro の build 時描画や複数 Island で状態が共有されるため、`TASK_CARDS_4_5.md` MIG-0402 の「module global mutable setterをSSR共有stateにしない」に反する。
- CURRENT 公開シェル: `app/(public)/layout.tsx:3-4,17,24` が `PublicHeader` と `PublicFooter` を描画。
- `src/components/layout/publicNavigation.ts:7` `PUBLIC_NAV_ITEMS`、`:17` `isPublicNavItemActive`。契約テスト `src/components/layout/publicNavigation.contract.test.mjs`。
- その他: `src/components/layout/ThemeToggle.tsx`, `src/components/layout/useDismissablePanel.ts`, `src/components/layout/PublicAccountIsland.tsx`。
#### Owned paths
- 変更: `packages/ui/src/adapters/index.tsx`（Context/Provider 化。旧 setter は互換のため残すが非推奨コメントを付ける）
- 新規: `+packages/ui/src/navigation/publicNavigation.ts`, `+packages/ui/src/layout/PublicHeader.tsx`, `+packages/ui/src/layout/PublicFooter.tsx`, `+packages/ui/src/layout/AdapterProvider.tsx`
- 変更（bridge化のみ）: `src/components/layout/publicNavigation.ts`
- 触らない: `app/(public)/layout.tsx`（Next の公開シェルは Phase 5 cutover まで現行のまま）、`PublicAccountIsland.tsx`（認証状態は Phase 5 の Island で扱う）
#### Micro-units
- **U01 adapter context**: `LinkContext` / `ImageContext` / `NavigatorContext` と `AdapterProvider` を追加し、`Link` / `Image` / `useNavigateAdapter` は Context を優先、無ければ素の `<a>` / `<img>` / `window.location`。検証: U01 テストで Provider 無し・有りの2通りの出力が期待通り。
- **U02 navigation data**: `PUBLIC_NAV_ITEMS` と `isPublicNavItemActive` を意味を変えず移し、旧pathを bridge にする。検証: `publicNavigation.contract.test.mjs` が同数PASS。
- **U03 header/footer**: mock の header/footer/スマホメニューを `tokens.css` で実装。リンク先は CURRENT のナビ項目と一致させ、mock にしか無いリンクは追加しない。検証: 描画結果のリンク集合が `PUBLIC_NAV_ITEMS` と一致するテスト。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | Provider 無しで `<Link href="/event">` | `<a href="/event">` |
| T02 | 2つの Provider を別ツリーで描画 | 互いの Link 実装が混ざらない |
| T03 | `/event/abc` で active 判定 | `isPublicNavItemActive` が移動前と同じ結果 |
| T04 | スマホ幅でメニューを開閉し Esc | 閉じてトグルへフォーカスが戻る |
| T05 | ヘッダーのリンク集合 | CURRENT の公開ナビ入口が欠けていない |
#### Commands
```bash
npm run build --workspace=@flamenode/ui
npm run test --workspace=@flamenode/ui
node --test --experimental-strip-types src/components/layout/publicNavigation.contract.test.mjs
npm run build --workspace=@flamenode/site
npm run typecheck
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md`: `src/components/layout/publicNavigation.ts` を `BRIDGED`、新規 `packages/ui/src/layout/*` 行を追加。公開ナビの UX ID を `frontend/PUBLIC.md` から引いて記録。
#### DONE checklist
- [ ] `packages/ui` の Link/Image/Navigator が Context 経由で注入できる
- [ ] 旧 setter を使う既存コードがあれば動作が変わっていない（`rg -n "setLinkComponent|setImageComponent|setNavigatorAdapter"` の結果をPRに記録）
- [ ] 公開ナビの入口が CURRENT から欠けていない
#### STOP
- 認証状態を header に持ち込む必要が出たら止める（Phase 5 の Island）。
- mock と CURRENT でナビ項目が食い違う場合は推測で決めず lead へ返す。
#### Rollback
PRをrevert。bridge化した `publicNavigation.ts` は revert で元実装に戻る。

### MIG-0204: forms / feedback / data display
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0202 の test 経路と、mock に存在する form/feedback 部品の一覧を確定してから
- **Recipe:** R-UI
- **Runtime:** N
- **Depends on:** MIG-0202 / **Decisions:** D-08 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- CURRENT のフィードバック部品: `src/components/ui/EmptyState.tsx`, `src/components/ui/ErrorCallout.tsx`, `src/components/ui/StatusPanel.tsx`, `src/components/ui/PartialFailureNotice.tsx`, `src/components/ui/ReflectionPendingNotice.tsx`, `src/components/ui/PublicReflectionDelayNotice.tsx`, `src/components/ui/SaveSuccessNotice.tsx`, `src/components/ui/RetryCurrentPageButton.tsx`, `src/components/ui/DataUnavailableNotice.tsx`。
- データ表示: `src/components/ui/Pagination.tsx`, `src/components/ui/TableScroll.tsx`, `src/components/ui/FnTable.tsx`。
- フォーム: `src/components/forms/ImeSafeGetForm.tsx`（IME 変換中の送信抑止）、`src/components/forms/AutoSubmitSelect.tsx`。
- 状態の契約は `frontend/CROSS_CUTTING.md` を正本にする。
#### Owned paths
- 新規: `+packages/ui/src/feedback/*.tsx`, `+packages/ui/src/data/*.tsx`, `+packages/ui/src/forms/*.tsx`, `+packages/ui/test/*.test.mjs`
- 変更: `packages/ui/src/index.ts`（export 追加のみ）
- 触らない: `src/components/ui/**`, `src/components/forms/**`（CURRENT は Phase 7 まで維持。今回は移植でなく公開画面用の部品を作る）
#### Micro-units
- **U01 feedback**: empty / error / degraded / pending / success の表示部品。エラーと完了通知は `role="status"` または `aria-live` を CURRENT と同じ強さで付ける。検証: テストで各状態の role/aria 属性。
- **U02 data display**: Pagination と横スクロール表。Pagination は CURRENT と同じ URL query 形式を受け取る（自前の state を持たない）。検証: 前後ページのリンクが query を保持するテスト。
- **U03 forms**: 公開画面で使う検索フォームと select。IME 変換中の Enter で送信しない挙動を `ImeSafeGetForm.tsx` と一致させる。検証: compositionstart〜end 間の submit 抑止テスト。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | error 状態を描画 | `aria-live` 付きで、再試行ボタンがある |
| T02 | empty 状態 | CURRENT と同じ文言キーで表示 |
| T03 | `?q=a&page=2` で Pagination | 前後リンクが `q=a` を保持 |
| T04 | IME 変換中に Enter | submit されない |
#### Commands
```bash
npm run build --workspace=@flamenode/ui
npm run test --workspace=@flamenode/ui
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
新規 `packages/ui/src/{feedback,data,forms}/*` 行を `FILE_MIGRATION_MATRIX.md` に追加。使った状態ごとに `frontend/CROSS_CUTTING.md` の UX ID を記録。
#### DONE checklist
- [ ] 各部品の状態（empty/error/degraded/pending/success）が `frontend/CROSS_CUTTING.md` の UX ID と対応付いている
- [ ] mutation を UI 部品の中で実行していない
- [ ] `src/components/**` を変更していない
#### STOP
- 部品が Server Action や fetch を直接呼ぶ必要が出たら止める（API は Phase 6）。
- mock と CURRENT で状態の種類が食い違う場合は lead へ返す。
#### Rollback
PRをrevert。新規ファイルだけなので既存画面への影響は無い。

### MIG-0205: representative responsive public screens
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0203/0204 の部品と、MIG-0401 の snapshot 型（PR #283）が main に入ってから
- **Recipe:** R-UI
- **Runtime:** N
- **Depends on:** MIG-0203, MIG-0204 / **Decisions:** D-08 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- 代表3画面の CURRENT: `app/(public)/[id]/page.tsx`（作品）、`app/(public)/event/[id]/page.tsx`（イベント）、`app/(public)/user/[id]/page.tsx`（クリエイター）。
- mock 側: `docs/migration/mock/site/EventDetail.html`, `docs/migration/mock/site/Creator.html`、`docs/migration/mock/site/VideoDetail.html`（`pages.json` の `VideoDetail /[id]`）。スクリーンショットは `docs/migration/mock/screenshots/`。
- `apps/site/src/pages/index.astro` は疎通用 Button だけ（`CODE_AUDIT_2026-10-09.md:15`）。
#### Owned paths
- 新規: `+packages/ui/src/screens/VideoDetailView.tsx`, `+packages/ui/src/screens/EventDetailView.tsx`, `+packages/ui/src/screens/CreatorView.tsx`（props は fixture を受け取る表示専用）
- 新規: `+docs/migration/design/REPRESENTATIVE_SCREENS.md`（UX ID ごとの 保持 / 未対応 / 次MIG の表）
- 触らない: `apps/site/src/pages/**`（実ルートは MIG-0403 の所有）、`app/(public)/**`
#### Micro-units
- **U01 video**: 作品詳細の表示部品。プレイヤー・いいね等の操作は placeholder の Island 境界だけを置き、実装しない。検証: fixture で描画し、desktop 1440px / mobile 390px のスクリーンショットを mock と並べてPRに添付。
- **U02 event**: イベント詳細。募集状況・枠の表示は fixture。検証: U01 と同じ。
- **U03 creator**: クリエイタープロフィール。検証: U01 と同じ。
- **U04 record**: `REPRESENTATIVE_SCREENS.md` に3画面の UX ID を 保持 / 未対応 / 次MIG で全件記録。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 空の作品リスト fixture | empty 状態が表示される |
| T02 | 非公開・削除済み fixture | 表示部品は描画しない（呼び出し側で除外される前提をテストで固定） |
| T03 | 390px 幅 | 横はみ出しなし |
| T04 | キーボードのみで操作 | フォーカス順が視覚順と一致 |
#### Commands
```bash
npm run build --workspace=@flamenode/ui
npm run test --workspace=@flamenode/ui
npm run build --workspace=@flamenode/site
npm run check:project-docs
```
#### Ledger updates
`REPRESENTATIVE_SCREENS.md` を新規作成し、`FILE_MIGRATION_MATRIX.md` に `packages/ui/src/screens/*` 行を追加。CURRENT page 行の state は変えない（実ルート移行は Phase 4/5）。
#### DONE checklist
- [ ] 3画面の desktop/mobile スクリーンショットが mock と並べてPRにある
- [ ] 3画面の UX ID が全件 保持 / 未対応 / 次MIG のどれかに分類されている
- [ ] 表示部品がデータ取得や可視性判定をしていない
#### STOP
- 可視性判定や認証状態が表示部品に必要になったら止める（MIG-0405 / Phase 5）。
- 配信処理（snapshot 読み込み、route map）を書き始めたら止める（Phase 4）。
#### Rollback
PRをrevert。新規ファイルだけ。

### MIG-0206: Phase 2 Gate
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — Phase Gate はエージェントが自動承認しない。MIG-0201..0205 の merge 後に lead が証跡をまとめる
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0205 / **Decisions:** D-08 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- `UI_REFERENCE.md` の `Version/hash` と `docs/migration/mock/` の実体（Gate 時点の版）。
- MIG-0201..0205 の merge 済みPRと、`docs/migration/UI_REFERENCE.md` の「CURRENT route と mock の対応」、`docs/migration/design/REPRESENTATIVE_SCREENS.md`。
#### Owned paths
- 新規: `+docs/migration/design/PHASE_2_GATE.md`（チェックリストと証跡リンク）
- 変更: `docs/migration/STATUS.md`（Gate 承認後の merge 統合時だけ）
#### Micro-units
- **U01 evidence**: Gate 文書に、mock 版の一致、`UI_REFERENCE.md` の対応表の公開画面網羅、primitive の状態テスト、代表3画面のスクリーンショット、未対応 UX ID の一覧と次MIGを記録する。
- **U02 review**: 独立レビュー（他agentまたは人間）を依頼し、結果をPRに記録。人間の Phase Gate 承認を待つ。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `UI_REFERENCE.md` の版と mock 実体 | 一致 |
| T02 | `UI_REFERENCE.md` の対応表の公開ルート | `CURRENT_ROUTES.md` の公開 VISUAL_SCREEN 全件を含む |
| T03 | UX ID の削除 | 0件（未対応は次MIG付きで残る） |
#### Commands
```bash
npm run test --workspace=@flamenode/ui
npm run build --workspace=@flamenode/site
npm run check:project-docs
npm run check:ui-acceptance
```
#### Ledger updates
Gate 承認後に `STATUS.md` の MIG-0206 を DONE、MIG-0402 の依存解消を反映（MIG-0401 も DONE の場合のみ READY）。
#### DONE checklist
- [ ] 独立レビューの APPROVE がPRにある
- [ ] 人間の Phase Gate 承認がPRにある
- [ ] CI が green
#### STOP
- 人間の承認が無い状態で STATUS を DONE にしない。
- 証跡の欠けがあれば該当MIGへ差し戻す。
#### Rollback
Gate 文書のPRをrevert。STATUS は承認前に変更しないので戻す必要は無い。
