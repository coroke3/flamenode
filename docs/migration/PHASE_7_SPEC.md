# FlameNode Phase 7 タスク仕様書（Private SPA Spec）

> 状態: Active / Phase 7 実行向け仕様書
> 最終検証: 2026-10-09（`CURRENT_ROUTES.md` の Personal 6, Entry 3, Manage 12, Admin 45 に基づき改定）
> 対象モデル: Claude / Codex / Antigravity / GPT-5.6-luna / Gemini Flash 等の全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`CURRENT_ROUTES.md`](CURRENT_ROUTES.md), [`UI_MIGRATION_GUIDE.md`](UI_MIGRATION_GUIDE.md), [`ROUTING_AND_DEPLOY_PLAN.md`](ROUTING_AND_DEPLOY_PLAN.md), [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) (D-05)
> **実行の正本:** 個別MIGの手順・停止条件・検証は本仕様書の `### MIG-XXXX:` Work Order。[`TASK_CARDS_6_7.md`](TASK_CARDS_6_7.md) は概要索引、CURRENT code/tests は実挙動の正本、[`STATUS.md`](STATUS.md) はmainへ統合済み進捗の正本。`npm run migration:next` はWork Orderと対応カードを併記し、矛盾時はLead確認までSTOP。

---

# 1. Private SPA の基本方針

1. **React + Vite による2つの独立SPA**:
   - Personal SPA: `apps/app`（`/dashboard`, `/entry`, `/onboarding`）、Ops SPA: `+apps/ops`（`/manage`, `/admin`）。どちらもCloudflare Workers Static Assetsから配信し、rootのHTML shell・error boundary・buildは独立。
   - ルーティングは `react-router-dom` を使用し、ブラウザ遷移で高速に動作。
2. **デザイン適用戦略（案A）の遵守**:
   - 管理・マイページ・登録画面はデザイン全面刷新を行わず、現行の UI/コンポーネント資産（`packages/ui`）を流用して移行効率を最大化。
   - `@flamenode/ui` のルーターアダプターを各SPA rootのContext/Providerで注入。module-global `setLinkComponent` / `setNavigatorAdapter` はPoC互換に限定。
3. **2 SPAルーティング・パス分離（D-05決定済み）**:
   - `apps/app`: `/dashboard`, `/dashboard/*`, `/entry`, `/entry/*`, `/onboarding`。既存作品編集 `/dashboard/edit/*` もPersonalに所属。
   - `+apps/ops`: `/manage`, `/manage/*`, `/admin`, `/admin/*`。Opsはroot SPA shell/entrypoint/Worker/static assetsを独立させる。
   - `base:'/'`を両方で使用するが、アセットprefixは `/_personal_assets/*` と `/_ops_assets/*` を分離。`assetsDir`だけでなくビルド出力とCloudflare Worker Routeの実URLを検査する。
   - 各SPAの内部ではReact Router、両SPA間は通常のHTTPフルナビゲーション。Cookie/sessionは同一origin、権限は必ずHonoで再検証。redirect/direct reload/404/asset/cacheをE2E確認。
   - Ops専用chunkがPersonal bundleに混在しないこと、権限がないユーザーがOpsのprivate DTOにアクセスできないことをテスト。

---

# 2. Phase 7 タスク別詳細仕様書（実ルート対応）

### Phase 7 共通契約（MIG-0701〜0706）

- 見た目は CURRENT の UI を移植する（案A。`UI_REFERENCE.md`）。private mock は参考で、Gate 条件にしない。
- データと mutation は Phase 6 の Hono API だけを使う。SPA から D1 や Server Action を呼ばない。権限は Hono 側で必ず再検証する。
- Adapter は各SPA root の Provider で注入する（MIG-0203）。
- 本番の Route 切替は各MIGの DONE 後に人間の明示承認を得て別操作として行う。
- 共通のコマンド: `npm run build --workspace=@flamenode/app`（Ops は `--workspace=@flamenode/ops`）, `npm run typecheck`, `npm run check:project-docs`。
- 共通の Rollback: PRをrevert。本番 Route を切り替えた後の戻しは `ROUTING_AND_DEPLOY_PLAN.md` の手順で、その実行も明示承認事項。

### MIG-0701: dashboard read-only（Personal 参照系画面）
- **Model:** small
- **Readiness:** READY_FOR_SMALL_MODEL — U01〜U03 は PR #332 / #374 で merge 済み。残りは CSS の移植（D-13-5）と root document（D-13-8）で、判断は全部この Work Order に書いた
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0102, MIG-0601, MIG-0608, MIG-0611 / **Decisions:** D-05 DECIDED, D-13-5 DECIDED, D-13-6 DECIDED, D-13-7 DECIDED, D-13-8 DECIDED
- **Verified against:** `7a19a42` (2026-10-25)
#### Source snapshot
- 済み（PR #332 merge `2c97162d`、PR #374 merge `e35a2d20`）: `apps/app/src/routes/router.tsx` の5ルート、`guard.tsx`、`dashboard/{Dashboard,Library,Settings,YoutubePlaylists}.tsx`、`onboarding.tsx`、`api/personal.ts`。query 契約（settings `?onboarding=1` / `?tab` / `?x` / `?next`、library `?tab` / `?page`）と 0X/1X/multiX/Active X は `apps/app/test/*.test.mjs` 54件で固定済み。`PendingData` は残っていない。
- CSS が無い: `apps/app` に `.css` が1つも無い（`apps/app/src/main.tsx` は `App` だけを import）。画面は CURRENT と同じ `fn-*` class と、CSS module の member を平らにした `dash-*` / `onb-*` / `settings-*` / `vcard-*` class を出している（`Dashboard.tsx:15` のコメント）。
- CURRENT の CSS の順: `app/layout.tsx:4` `@/styles/globals.css`（その先頭 `globals.css:7-10` が `redesign-public.css`, `mobile-public.css`, `admin-manage.css`, `admin-mobile.css` を `@import`）→ `app/layout.tsx:5` `@/styles/mobile-hardening.css` → page の CSS module。module の対応: `dash-` = `app/(auth)/dashboard/page.module.css`、`onb-` = `app/(auth)/onboarding/page.module.css`、`settings-` = `src/components/settings/settings-page.module.css`（`settings/page.tsx:25` と `SettingsXAccountPanel.tsx:7`）、`vcard-` = `src/components/video/VideoCard.module.css`。module 内の `:global(.fn-btn)` / `:global(.fn-btn-sm)` / `:global(h2)` は global class のまま。CURRENT の `src/styles/*.css` に `url(` は無い。
- root document: CURRENT `app/layout.tsx:17-22` FlameNode Sans（`app/fonts/FlameNodeSans.otf`、`--font-flamenode`）、`:24` `themeBootstrapCode`（`fn-theme`）、`:111-119` viewport と theme-color。`app/(auth)/layout.tsx:8-11` robots noindex/nofollow と `force-dynamic`、`:28` wrapper `<div data-fn-surface="personal" className="fn-personal-shell fn-app">`、`:31` `<main className="fn-main flex-1 w-full">`（`admin-manage.css:191,197` と `mobile-public.css:18-19` がこの wrapper に効く）。`apps/app/index.html` には noindex も theme script も無い。
- `fn-pc-status-banner--warn`（CURRENT `dashboard/page.tsx:361`）は CURRENT のどの CSS にも rule が無い。`settings-panel-{x,history,link,discord}` と `settings-{x,history,link,discord}-h` は `Settings.tsx:149-284` の id で class ではない。
#### Owned paths
- 新規: `+apps/app/src/styles/current/globals.css`, `+apps/app/src/styles/current/redesign-public.css`, `+apps/app/src/styles/current/mobile-public.css`, `+apps/app/src/styles/current/admin-manage.css`, `+apps/app/src/styles/current/admin-mobile.css`, `+apps/app/src/styles/current/mobile-hardening.css`
- 新規: `+apps/app/src/styles/dashboard.css`, `+apps/app/src/styles/onboarding.css`, `+apps/app/src/styles/settings.css`, `+apps/app/src/styles/video-card.css`, `+apps/app/src/styles/fonts.css`, `+apps/app/src/assets/FlameNodeSans.otf`
- 新規: `+apps/app/scripts/portCssModule.mjs`, `+apps/app/test/styles.test.mjs`, `+apps/app/test/document.test.mjs`
- 変更: `apps/app/src/main.tsx`, `apps/app/index.html`, `apps/app/src/routes/router.tsx`, `apps/app/public/_headers`, `docs/migration/FILE_MIGRATION_MATRIX.md`, `docs/migration/work-items/MIG-0701.md`
- 触らない: `app/(auth)/**`, `src/styles/**`, `src/components/**`（移植元。Phase 9 まで残す）, `apps/site/**`, `packages/ui/**`
#### Micro-units
- **U01〜U03**: DONE（PR #332 / #374）。
- **U04a CURRENT の global CSS をそのまま写す**（D-13-5）:
```bash
mkdir -p apps/app/src/styles/current apps/app/src/assets apps/app/scripts
for f in globals redesign-public mobile-public admin-manage admin-mobile mobile-hardening; do cp "src/styles/$f.css" "apps/app/src/styles/current/$f.css"; done
cp app/fonts/FlameNodeSans.otf apps/app/src/assets/FlameNodeSans.otf
for f in globals redesign-public mobile-public admin-manage admin-mobile mobile-hardening; do cmp "src/styles/$f.css" "apps/app/src/styles/current/$f.css"; done
```
  期待: `cmp` が何も出さない（6 file とも byte 一致）。中身は1文字も編集しない。
- **U04b CSS module を prefix 付き class に変換**: `apps/app/scripts/portCssModule.mjs` を下のとおり作る（この内容のまま）。
```js
// MIG-0701 U04b (D-13-5): CURRENT CSS module -> plain CSS. Local class `.x` in a selector becomes `.<prefix>-x`,
// `:global(...)` is unwrapped, declarations and at-rule preludes stay byte for byte.
import fs from "node:fs";

export const MODULES = [
  ["dash", "app/(auth)/dashboard/page.module.css", "apps/app/src/styles/dashboard.css"],
  ["onb", "app/(auth)/onboarding/page.module.css", "apps/app/src/styles/onboarding.css"],
  ["settings", "src/components/settings/settings-page.module.css", "apps/app/src/styles/settings.css"],
  ["vcard", "src/components/video/VideoCard.module.css", "apps/app/src/styles/video-card.css"],
];

export function portCssModule(css, prefix) {
  const parts = css.split(/([{}])/);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (parts[i + 1] === "{" && !part.trim().startsWith("@")) {
      out += part.replace(/:global\(([^)]*)\)|\.(-?[A-Za-z_][\w-]*)/g, (m, g, cls) => (g !== undefined ? g : "." + prefix + "-" + cls));
    } else out += part;
  }
  return out;
}

if (import.meta.url === new URL(process.argv[1], "file://").href) {
  const root = new URL("../../../", import.meta.url);
  for (const [prefix, from, to] of MODULES) {
    fs.writeFileSync(new URL(to, root), portCssModule(fs.readFileSync(new URL(from, root), "utf8"), prefix));
  }
}
```
```bash
node apps/app/scripts/portCssModule.mjs
grep -c "\.dash-" apps/app/src/styles/dashboard.css
grep -n ":global" apps/app/src/styles/*.css
```
  期待: 4 file ができる。`grep -c` は 1 以上、`:global` の grep は0件。生成物は手で直さない。
- **U04c import 順**: `apps/app/src/main.tsx` の `import { App } from "./App.js";` の直前に次の7行をこの順で入れる（CURRENT の layout → page の順）。
```ts
import "./styles/current/globals.css";
import "./styles/current/mobile-hardening.css";
import "./styles/fonts.css";
import "./styles/video-card.css";
import "./styles/dashboard.css";
import "./styles/settings.css";
import "./styles/onboarding.css";
```
  `apps/app/src/styles/fonts.css` の内容（CURRENT `app/layout.tsx:17-22` の localFont と同じ family / weight / display）:
```css
@font-face { font-family: "FlameNode Sans"; src: url("../assets/FlameNodeSans.otf") format("opentype"); font-weight: 400; font-display: swap; }
html { --font-flamenode: "FlameNode Sans"; }
```
- **U04d test**: `apps/app/test/styles.test.mjs` を作る。node:test で次の4件。path は `new URL("../../../<repo path>", import.meta.url)` で読む（`onboarding.test.mjs:126` と同じ書き方）。
  1. `src/styles/{globals,redesign-public,mobile-public,admin-manage,admin-mobile,mobile-hardening}.css` と `apps/app/src/styles/current/` の同名 file が `assert.equal` で一致し、`app/fonts/FlameNodeSans.otf` と `apps/app/src/assets/FlameNodeSans.otf` が `Buffer.equals` で一致する（drift guard。CURRENT を消す Phase 9 まで）。
  2. `MODULES` の各行で `portCssModule(CURRENT module, prefix)` と `to` の file が一致する（`import { MODULES, portCssModule } from "../scripts/portCssModule.mjs"`）。
  3. `apps/app/src/routes/**/*.tsx` から comment（`/\/\*[\s\S]*?\*\//g` と行頭 `//`）を除き、`/(?<![\w-])(?:fn|dash|onb|settings|vcard)-[A-Za-z0-9_-]*[A-Za-z0-9_]/g` で集めた token が、全 CSS（current の6 file + 生成した4 file）の `/\.(-?[A-Za-z_][\w-]*)/g` の集合に全部入る。例外は次の9件だけ: `fn-pc-status-banner--warn`（CURRENT にも rule が無い）, `settings-panel-x`, `settings-panel-history`, `settings-panel-link`, `settings-panel-discord`, `settings-x-h`, `settings-history-h`, `settings-link-h`, `settings-discord-h`（id）。
  4. `apps/app/src/main.tsx` の CSS import が U04c の7行と同じ順。
```bash
npm run test --workspace=@flamenode/app
```
  期待: 既存54件 + 新規4件が全部 PASS。3 で未定義 class が出たら CSS を足さずに STOP。
- **U05 root document**（D-13-8）:
  - `apps/app/index.html` を次の内容にする。`__THEME_BOOTSTRAP__` は次の bash の node が CURRENT から差し込む（手で写さない）。
```html
<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex, nofollow" />
    <meta name="theme-color" content="#fbfaf5" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#0b0d10" media="(prefers-color-scheme: dark)" />
    <link rel="icon" href="/brand/flamenode-favicon.svg" type="image/svg+xml" />
    <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
    <link rel="icon" href="/brand/flamenode-icon-32.png" sizes="32x32" type="image/png" />
    <link rel="icon" href="/brand/flamenode-icon-512.png" sizes="512x512" type="image/png" />
    <link rel="apple-touch-icon" href="/brand/flamenode-apple-touch-icon.png" sizes="180x180" type="image/png" />
    <script>__THEME_BOOTSTRAP__</script>
    <title>FlameNode</title>
  </head>
  <body class="min-h-screen flex flex-col">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```
```bash
node -e 'const fs=require("fs");const code=fs.readFileSync("app/layout.tsx","utf8").match(/const themeBootstrapCode = `([^`]*)`;/)[1];const p="apps/app/index.html";fs.writeFileSync(p,fs.readFileSync(p,"utf8").replace("__THEME_BOOTSTRAP__",()=>code));'
grep -c "fn-theme" apps/app/index.html
```
  期待: `1`。
  - `apps/app/src/routes/router.tsx` の `PersonalRoutes` の return を CURRENT `app/(auth)/layout.tsx:28,31` の wrapper で包む。`<RouteErrorBoundary>` は `<main>` の内側（CURRENT の `(auth)/error.tsx` は layout の内側に出る）。header / footer / `CostGuardBanner` は置かない（D-13-6、FIX-0701-1）。
```tsx
    <div data-fn-surface="personal" className="fn-personal-shell fn-app">
      <main className="fn-main flex-1 w-full">
        <RouteErrorBoundary>
          {/* 既存の <Routes>…</Routes> をそのまま */}
        </RouteErrorBoundary>
      </main>
    </div>
```
  - `apps/app/public/_headers` の末尾に次を足す（既存の `/_personal_assets/*` rule は変えない）。
```
# MIG-0701 (D-13-8): CURRENT (auth) は force-dynamic。SPA の HTML は Next と同じ no-store で返す。
/dashboard
  Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate

/dashboard/*
  Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate

/onboarding
  Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
```
  - `apps/app/test/document.test.mjs` を作る（4件）: (1) `index.html` に `<meta name="robots" content="noindex, nofollow" />` があり、`<script>` + CURRENT `app/layout.tsx` の `themeBootstrapCode` + `</script>` を含む。(2) `public/_headers` を `assetHeaders.test.mjs` と同じ規則で解決すると、`/dashboard`, `/dashboard/library`, `/dashboard/settings`, `/dashboard/youtube-playlists`, `/onboarding` が `private, no-cache, no-store, max-age=0, must-revalidate`、`/_personal_assets/index-AbC123.js` は `public, max-age=31536000, immutable` のまま。(3) `mount("/dashboard", …)`（`helpers.mjs`）で `[data-fn-surface="personal"].fn-personal-shell.fn-app > main.fn-main` がある。(4) error boundary の画面（`routes.test.mjs:137` と同じ throw）も同じ `main.fn-main` の中に出る。
```bash
npm run test --workspace=@flamenode/app
node --test --experimental-strip-types apps/site/src/gateway/assetHeaders.test.mjs
npm run build --workspace=@flamenode/app
ls apps/app/dist/_personal_assets | grep -c "\.css$"
grep -c "noindex" apps/app/dist/index.html
```
  期待: app test が全部 PASS（58 + 4）。assetHeaders 5/5（T03 の `/` と `/index.html` は null のまま）。build PASS。css は1以上、noindex は `1`。
- **U06 ledger / work item**: Ledger updates のとおり。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | X 0件 / 1件 / 複数 | CURRENT と同じ表示（済み: dashboard/settings/routes test） |
| T02 | 未ログインで直接URL | CURRENT と同じ遷移（済み） |
| T03 | 再読込・戻る・進む | 状態が壊れない（済み: library/settings の deep link test） |
| T04 | BAN された利用者 | CURRENT と同じ表示（済み） |
| T05 | 子 component が throw（G10） | error boundary の UI が `main.fn-main` の中に出る |
| T06 | route × role の guard（G12） | redirect 先と query が CURRENT と同じ（済み）。`index.html` に noindex がある |
| T07 | CSS の drift | current の6 file と font が CURRENT と byte 一致し、4 module の変換結果が file と一致する |
| T08 | 画面が使う class | 全部が CSS で定義されている（例外9件だけ） |
| T09 | SPA HTML の cache | 5ルートが no-store、`/_personal_assets/*` は immutable |
#### Commands
全部 exit 0。
```bash
npm run test --workspace=@flamenode/app
npm run build --workspace=@flamenode/app
node --test --experimental-strip-types apps/site/src/gateway/assetHeaders.test.mjs
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
- `FILE_MIGRATION_MATRIX.md` に新規 file の行を足す（列は既存行と同じ）。kind は `apps/app/src/styles/current/*.css` の6行と `dashboard.css` / `onboarding.css` / `settings.css` / `video-card.css` / `fonts.css` が CONFIG、`apps/app/src/assets/FlameNodeSans.otf` が CONFIG、`apps/app/scripts/portCssModule.mjs` が HELPER、`styles.test.mjs` / `document.test.mjs` が TEST。owner は MIG-0701、target は SAME、state は IN_PROGRESS、evidence は `PR#<n> SHA=<head> TEST=npm run test --workspace=@flamenode/app`。
- 5ページ行（`FILE_MIGRATION_MATRIX.md:74-77,81`）は IN_PROGRESS のまま evidence を新 PR に更新する。DONE にするのは merge 後の STATUS 統合のとき。
- `work-items/MIG-0701.md` に checkpoint を書き、Parity status の古い "Gaps" 行（PendingData、`unwiredPersonalApi`、CSS 未移植）を消す。
#### DONE checklist
- [ ] 5ルートの本文の状態が CURRENT と一致する（U01〜U03 の test 54件 + U04/U05 の test）
- [ ] CSS は CURRENT と byte 一致の copy と機械変換だけで、画面の class が全部定義されている
- [ ] `index.html` に noindex、SPA の HTML は no-store
- [ ] SPA から Server Action や D1 を呼んでいない
- [ ] header / footer / CostGuardBanner は FIX-0701-1（D-13-6）、browser 確認は MIG-0706 の smoke（D-13-7）に記録した
- [ ] 独立レビュー（builder より上位の model か他 agent）の APPROVE と最終 head の CI green
#### STOP
- `styles.test.mjs` の 3 で未定義 class が出たら止める（CSS を足したり、class を改名したりしない）。
- `src/styles/**` や CSS module を変更したくなったら止める（CURRENT は触らない）。
- header / account menu / CostGuardBanner を `apps/app` に置きたくなったら止める（FIX-0701-1）。
- `apps/app` の wrangler / Worker Route / 本番 deploy が必要に見えたら止める（owner の明示承認事項）。
#### Rollback
PR を revert。`apps/app` は本番に route されていないので、本番と DB への影響は無い。

### MIG-0702: dashboard mutations（Personal 更新系機能）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0602・MIG-0605・MIG-0701 の merge 後（Active X / profile の API は MIG-0605）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0602, MIG-0636, MIG-0701 / **Decisions:** D-03 DECIDED, D-04 DECIDED, D-13-9 DECIDED（2026-10-25: 要る API は SA-076・SA-098〜105・onboarding complete の POST だけで、すべて MIG-0636。MIG-0605 全体には依存しない）
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- SA-098〜105（`src/lib/actions/xid.ts`: `setActiveXId`, `requestXIdLink`, `cancelXIdLinkRequest`, `requestXIdMergeRevert`, `updateXIdProfile`, `deleteLinkedXId`, `setXIdIcon`, `uploadXIdIcon`）、SA-076 `acceptOnboardingTerms`（`src/lib/actions/terms.ts`）。
- 通知の「既読化」は CURRENT に無い。追加しない。
- 引き継ぎ（MIG-0611, lead 決定 2026-10-23）: CURRENT の `/onboarding` 表示は `maybeMarkOnboardingComplete`（`user.onboarding_completed_at` の条件付き UPDATE。X 申請済み/承認済みのときだけ。認可には使わない補助マーカー）を GET 中に実行する。`GET /api/personal/onboarding` は書かないので、この更新は MIG-0702 で明示的な `POST` として実装し、SPA が `/onboarding` 到達時に呼ぶ。
#### Owned paths
- 新規: `+apps/app/src/routes/dashboard/settings/*.tsx`（更新フォーム）, `+apps/app/src/components/ActiveXLinkModal.tsx`
- 触らない: `src/lib/actions/**`
#### Micro-units
- **U01 profile / X**: SA-102〜105。
- **U02 Active X / link**: SA-098〜101。未連携ユーザーの登録誘導モーダル。
- **U03 onboarding**: SA-076。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 二重送信 | 1回だけ反映 |
| T02 | 承認待ちの連携 | CURRENT と同じ表示 |
| T03 | manager 権限だけの X | CURRENT と同じ可否 |
| T04 | X 0件でいいね | 誘導モーダル |
#### Commands
```bash
npm run build --workspace=@flamenode/app
npm run typecheck
npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の SA-076, 098〜105 に SPA 側の呼び出し元。
#### DONE checklist
- [ ] U01〜U03 が DONE
- [ ] CURRENT に無い mutation を追加していない
#### STOP
- D-04（Active X 一斉切替）の実行が必要に見えたら止める（別承認）。
#### Rollback
Phase 7 共通契約のとおり。

### MIG-0703: entry（Entry 画面群）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0702 の後。作品投稿は MIG-0603、枠は MIG-0604 の API を使う
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0603, MIG-0604, MIG-0702, MIG-0623, MIG-0630 / **Decisions:** none
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- CURRENT: `app/(auth)/entry/page.tsx`, `app/(auth)/entry/slotted/page.tsx`, `app/(auth)/entry/unslotted/page.tsx`, `app/(auth)/dashboard/edit/[id]/page.tsx`, `app/(auth)/dashboard/edit/[id]/permissions/page.tsx`。
- フォーム: `src/components/forms/VideoForm.tsx`, `UnslottedPostForm.tsx`, `CustomQuestionFields.tsx`, `VideoMembersField.tsx`（契約テスト `src/components/forms/*.contract.test.mjs` 5件）。
- SA-086〜089（投稿・更新）。編集権限は PR #265 の一本化した判定。
#### Owned paths
- 新規: `+apps/app/src/routes/entry/*.tsx`, `+apps/app/src/routes/dashboard/edit/*.tsx`
- 触らない: `src/components/forms/**`（移植元。Phase 9 まで残す）
#### Micro-units
- **U01 entry**: `/entry` と slotted / unslotted。
- **U02 edit**: `/dashboard/edit/:id` と permissions（読み取り API は MIG-0630）。
- **SA-107 の扱い（coverage gap G22）**: entry の `discordSignInInline` と return-to の sanitize は MIG-0802 の認証と合わせて対応する。それまでは CURRENT の Server Action を呼ぶ。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 投稿済みの枠で再投稿 | CURRENT と同じ拒否 |
| T02 | 不正な YouTube URL・重複 | CURRENT と同じエラー |
| T03 | collaborator が権限ページ | CURRENT と同じ可否 |
| T04 | 編集中の再読込 | CURRENT と同じ |
| T05 | 読み取りは MIG-0623 の API を使う（G13） | 画面が直接 D1 / auth / publicData を import しない |
| T06 | SA-107 の return-to に危険な URL（G22） | 同じ移動先に sanitize される |
#### Commands
```bash
npm run build --workspace=@flamenode/app
npm run typecheck
npm run test:unit
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の5ページ行を IN_PROGRESS。
#### DONE checklist
- [ ] 5ルートのフォーム状態と副作用が SA ごとに CURRENT と一致
#### STOP
- 権限判定を SPA 側で決める必要が出たら止める（Hono が正）。
#### Rollback
Phase 7 共通契約のとおり。

### MIG-0704: manage（Manage イベント運営画面群）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0604 と MIG-0703 の後。micro-unit の正本は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0704
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0604, MIG-0703, MIG-0624 / **Decisions:** D-05 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- CURRENT（12ファイル）: `app/(manage)/manage/page.tsx`, `app/(manage)/manage/events/[id]/{page,edit/page,audience/page,slots/page,staff/page,videos/page,videos/[videoId]/page,youtube-playlist/page,review/page}.tsx`, `app/(manage)/manage/notifications/page.tsx`, `app/(manage)/manage/x-link-requests/page.tsx`。
- `apps/ops` はまだ無い（`FILE_MIGRATION_MATRIX.md` の Future files 表で NOT_CREATED）。
- 部品: `src/components/manage/**`, `src/components/layout/ManageSidebarNav.tsx`, `ManageActiveXNotice.tsx`。
#### Owned paths
- 新規: `+apps/ops/package.json`（`@flamenode/ops`）, `+apps/ops/index.html`, `+apps/ops/tsconfig.json`, `+apps/ops/vite.config.ts`（`assetsDir: "_ops_assets"`）, `+apps/ops/src/**`, `+apps/ops/public/_headers`（MIG-0620 から引き継ぎ、D-13-4）
- 変更（MIG-0620 から引き継ぎ）: `apps/site/src/gateway/assetHeaders.test.mjs`
- 変更: `package-lock.json`, `.github/workflows/migration-docs-check.yml`（Ops の build を追加）
- 触らない: `app/(manage)/**`, `apps/app/**`
#### Micro-units
- U01〜U05 と Final audit は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0704 のとおり。
- **U01 追加（coverage gap G10, G12）**: `(manage)/layout.tsx` の guard を写す。user 無しは `/entry`、enrichmentFailed は `/entry?error=auth_temporarily_unavailable`、manage / admin 権限無しは `/dashboard`。error boundary と `CostGuardBanner` を置く。`apps/ops/index.html` に noindex。読み取りは MIG-0624 の API を使う。
- **U01 追加（MIG-0620 から引き継ぎ、D-13-4）**: `apps/ops/public/_headers` を `apps/app/public/_headers` の `/_personal_assets/*` rule と同じ形で作る（`/_ops_assets/*` に `Cache-Control: public, max-age=31536000, immutable`。HTML には rule を置かない）。`apps/site/src/gateway/assetHeaders.test.mjs` に `const ops = parse(await read("apps/ops/public/_headers"));` を足し、T01 で `/_ops_assets/index-AbC123.js`, `/_ops_assets/index-AbC123.css`, `/_ops_assets/a-AbC.svg` が `IMMUTABLE`、T03 の HTML の loop と `for (const rules of [site, app])` に `ops` を足し、build 出力の test に `apps/ops/dist/_headers` がある時の一致検査を足す。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | Personal と Ops の build | CSS/JS が互いに混ざらない |
| T02 | 担当外イベントの URL | 拒否 |
| T03 | 最後の owner の解任 | 拒否 |
| T04 | `/manage/events/[id]/review` | `videos?status=pending` へ互換 redirect |
| T05 | route × role（guest, user, staff, owner, admin）（G12） | Location（`error` query を含む）が CURRENT の layout と同じ |
| T06 | Ops の HTML（G12） | `meta robots noindex` または `X-Robots-Tag` がある |
| T07 | `/_ops_assets/*`（MIG-0620 T01） | immutable 1年。HTML は null |
#### Commands
```bash
npm run build --workspace=@flamenode/app
npm run build --workspace=@flamenode/ops
npm run typecheck
npm run check:event-owners
node --test --experimental-strip-types apps/site/src/gateway/assetHeaders.test.mjs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の Manage 12行を IN_PROGRESS、`apps/ops/**` 行（`apps/ops/public/_headers` を含む）を追加し、`assetHeaders.test.mjs` 行の変更を MIG-0704 として記録。
#### DONE checklist
- [ ] U01〜U05 と Final audit が DONE
- [ ] Ops の build が CI で動く
- [ ] `apps/ops/public/_headers` の `/_ops_assets/*` が immutable 1年で、`assetHeaders.test.mjs` が `ops` を検査している（MIG-0620 から引き継ぎ、D-13-4）
#### STOP
- Ops の Worker / Route を本番に作る必要が出たら止める（明示承認事項）。
#### Rollback
Phase 7 共通契約のとおり。

### MIG-0705: admin（Admin 全体管理者画面群）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0605 と MIG-0704 の後。micro-unit の正本は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0705
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0605, MIG-0704, MIG-0625, MIG-0626, MIG-0635, MIG-0637, MIG-0638 / **Decisions:** D-05 DECIDED, D-13-56 DECIDED（2026-10-25: MIG-0605 の残りを MIG-0636〜0638 へ分割。admin 画面が呼ぶ 0635/0637/0638 を依存に追加）
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- CURRENT: `app/(admin)/**/page.tsx` 45件（`CURRENT_ROUTES.md` Admin 45）。部品は `src/components/admin/**`。
- 危険操作（spreadsheet 書き込み、X merge、audit restore、BAN）は strict audit と確認が必要（`server-actions/README.md`）。
#### Owned paths
- 新規: `+apps/ops/src/routes/admin/**`（lazy chunk）
- 触らない: `app/(admin)/**`, `apps/app/**`
#### Micro-units
- U01〜U08 と Final audit は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0705 のとおり。
- **U01 追加（coverage gap G10, G12）**: `(admin)/layout.tsx` の guard（manage と同じ redirect に加え、admin 以外は `/dashboard`）、error boundary、noindex、`CostGuardBanner`。読み取りは MIG-0625 / MIG-0626 の API を使う。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | guest / user / moderator / owner / admin × 45ルート | CURRENT と同じ可否 |
| T02 | spreadsheet の import 途中失敗 | 全件ロールバック |
| T03 | 発行 token | ブラウザに渡らない |
| T04 | Personal bundle | admin のコードが入っていない |
| T05 | admin guard の Location（`error` query を含む）（G12） | CURRENT の layout と同じ |
| T06 | Admin 45 の読み取り（G13） | MIG-0625 / MIG-0626 の endpoint を使い、直接 D1 を import しない |
#### Commands
```bash
npm run build --workspace=@flamenode/ops
npm run build --workspace=@flamenode/app
npm run typecheck
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の Admin 45行を IN_PROGRESS。
#### DONE checklist
- [ ] U01〜U08 と Final audit が DONE
- [ ] 危険操作が独立レビューを通っている
#### STOP
- 任意SQLを実行できる画面が必要に見えたら止める。
#### Rollback
Phase 7 共通契約のとおり。

### MIG-0706: Phase 7 Gate
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — Phase Gate はエージェントが自動承認しない
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0705 / **Decisions:** D-05 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- Personal 6 + `/onboarding`、Entry 3、Manage 12、Admin 45（`CURRENT_ROUTES.md`）と MIG-0701〜0705 の merge 済みPR。
#### Owned paths
- 新規: `+docs/migration/design/PHASE_7_GATE.md`
- 変更: `docs/migration/ROUTE_MATRIX.md`, `docs/migration/STATUS.md`（承認後だけ）
#### Micro-units
- **U01 matrix**: 全ルートの対応・権限・404・再読込・SPA間遷移の証跡をまとめる。
- **U02 review**: 独立レビューと人間の Phase Gate 承認を依頼。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 2つの SPA の build | 両方成功、asset prefix が分離 |
| T02 | 権限の無い利用者が Ops の DTO | 拒否 |
| T03 | 未移行の Server Action | 0件 |
#### Commands
```bash
npm run build --workspace=@flamenode/app
npm run build --workspace=@flamenode/ops
npm run check:project-docs
```
#### Ledger updates
承認後に `STATUS.md` の MIG-0706 を DONE。
#### DONE checklist
- [ ] 全ルートの証跡
- [ ] 独立レビューの APPROVE と人間の Phase Gate 承認
- [ ] Ops の bundle が存在する
#### STOP
- 人間の承認なしに STATUS を DONE にしない。
#### Rollback
Gate のPRをrevert。
