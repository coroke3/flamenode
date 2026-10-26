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

### MIG-0702: dashboard mutations（Personal 更新系機能、Final audit）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — D-16-10 で U01〜U03 を MIG-0708 / 0709 / 0710 に分割した。本 task は3つの DONE 後の Final audit だけ
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0708..MIG-0710 / **Decisions:** D-03 DECIDED, D-04 DECIDED, D-13-9 DECIDED, D-14-9, D-15-8, D-16-1, D-16-6, D-16-10
- **Verified against:** `c2a6ecb` (2026-10-26)
#### Source snapshot
- 対象: SA-098〜105（`src/lib/actions/xid.ts`）、SA-076 `acceptOnboardingTerms`（`src/lib/actions/terms.ts:293`）、onboarding complete（`maybeMarkOnboardingComplete`、`src/lib/auth/onboarding.ts:122`、CURRENT `app/(auth)/onboarding/page.tsx:67` が GET 中に実行）。
- 通知の「既読化」は CURRENT に無い。追加しない。「X 0件でいいね → 誘導モーダル」も CURRENT に無い（D-16-6。旧 T04 と `ActiveXLinkModal.tsx` は削った）。
#### Owned paths
- 変更: `docs/migration/work-items/MIG-0702.md`（新規）, `docs/migration/API_MATRIX.md`（SA-076, 098〜105 の SPA 側の呼び出し元が揃っているかの確認だけ）
- 触らない: `apps/app/src/**`（MIG-0708〜0710 の範囲）, `src/lib/actions/**`
#### Micro-units
- **U01 audit**: MIG-0708 / 0709 / 0710 の merge 済み PR で、SA-076・098〜105・onboarding complete の全てに SPA の呼び出し元があり、各 PR の client が `packages/contracts` の schema を使っていること（D-16-1 の 5）を表にする。
- **U02 横断の確認**: 二重送信・承認待ち・manager リンクの X の3つ（T01〜T03）を merge 済み main の `npm run test --workspace=@flamenode/app` の test 名で示す。無ければ不足として担当 task に返す（本 task で画面を書かない）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 二重送信 | 1回だけ反映（MIG-0708 / 0709 / 0710 の test） |
| T02 | 承認待ちの連携 | CURRENT と同じ表示（MIG-0709） |
| T03 | manager 権限だけの X | CURRENT と同じ可否（MIG-0708） |
#### Commands
```bash
npm run build --workspace=@flamenode/app
npm run test --workspace=@flamenode/app
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`work-items/MIG-0702.md` に U01 の表。`API_MATRIX.md` の SA-076, 098〜105 の SPA 側の呼び出し元を確認済みにする。
#### DONE checklist
- [ ] MIG-0708〜0710 が DONE
- [ ] CURRENT に無い mutation を追加していない
#### STOP
- D-04（Active X 一斉切替）の実行が必要に見えたら止める（別承認）。
- 不足を本 task で実装しない（担当の 0708〜0710 に返す）。
#### Rollback
Phase 7 共通契約のとおり。

### MIG-0703: entry（Entry 画面群、Final audit）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — D-16-11 で MIG-0711〜0717 に分割した。本 task は分割先の DONE 後の Final audit だけ
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0711, MIG-0715..MIG-0717 / **Decisions:** D-15-1, D-15-4, D-16-1, D-16-11, D-16-12
- **Verified against:** `c2a6ecb` (2026-10-26)
#### Source snapshot
- CURRENT: `app/(auth)/entry/page.tsx`（381 行）, `app/(auth)/entry/slotted/page.tsx`（312）, `app/(auth)/entry/unslotted/page.tsx`（237）, `app/(auth)/dashboard/edit/[id]/page.tsx`（813）, `app/(auth)/dashboard/edit/[id]/permissions/page.tsx`（239）。フォームの契約テスト `src/components/forms/*.contract.test.mjs`。
- 分割先: `/entry` = MIG-0711、form の移植 = MIG-0712 / 0713 / 0714、permissions = MIG-0715、slotted / unslotted = MIG-0716、edit = MIG-0717。
#### Owned paths
- 変更: `docs/migration/work-items/MIG-0703.md`（新規）, `docs/migration/FILE_MIGRATION_MATRIX.md`（5ページ行の状態の確認だけ）
- 触らない: `apps/app/src/**`（分割先の範囲）, `src/components/forms/**`
#### Micro-units
- **U01 audit**: 5ルートについて、CURRENT の form 状態と副作用（SA-082..084 / 086 / 088 / 089）が分割先の test で固定されていることを表にする。
- **U02 G13 / G22**: 画面が D1 / auth / publicData を import しない（T05）、`/entry` の return-to が sanitize される（T06、MIG-0711）を merge 済み main で確認する。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 投稿済みの枠で再投稿 | CURRENT と同じ拒否（MIG-0716） |
| T02 | 不正な YouTube URL・重複 | CURRENT と同じエラー（MIG-0714 / 0716） |
| T03 | collaborator が権限ページ | CURRENT と同じ可否（MIG-0715） |
| T04 | 編集中の再読込 | CURRENT と同じ（MIG-0717） |
| T05 | 読み取りは MIG-0623 / 0630 の API（G13） | `rg "@/lib/(db|auth|publicData)" apps/app/src` が 0 件 |
| T06 | `/entry?next=https://evil.example`（G22） | `callbackUrl` が CURRENT `entryLoginRedirectTo` と同じ値（外部 URL は `/entry` に落ちる、MIG-0711） |
#### Commands
```bash
npm run build --workspace=@flamenode/app
npm run test --workspace=@flamenode/app
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`work-items/MIG-0703.md` に U01 の表。
#### DONE checklist
- [ ] MIG-0711〜0717 が DONE
- [ ] 5ルートのフォーム状態と副作用が SA ごとに CURRENT と一致
#### STOP
- 権限判定を SPA 側で決める必要が出たら止める（Hono が正）。
- 不足を本 task で実装しない（担当の分割先に返す）。
#### Rollback
Phase 7 共通契約のとおり。

### MIG-0704: manage（Manage イベント運営画面群）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0604・MIG-0703・MIG-0707 の後（D-15-13 で U01 の scaffold を MIG-0707 へ分割）。micro-unit の正本は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0704
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0604, MIG-0703, MIG-0624, MIG-0707, MIG-0661 / **Decisions:** D-05 DECIDED, D-14-3, D-15-13, D-16-5（manage の video 詳細の状態 form `ManageVideoStatusForm` は本 task）, D-16-13（`CostGuardBanner` は MIG-0661 の `GET /api/operation-mode/banner`）
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- CURRENT（12ファイル）: `app/(manage)/manage/page.tsx`, `app/(manage)/manage/events/[id]/{page,edit/page,audience/page,slots/page,staff/page,videos/page,videos/[videoId]/page,youtube-playlist/page,review/page}.tsx`, `app/(manage)/manage/notifications/page.tsx`, `app/(manage)/manage/x-link-requests/page.tsx`。
- `apps/ops` の package・build・guard・`_headers` は MIG-0707 が作る（D-15-13）。本 task は画面と `CostGuardBanner`、`apps/ops/wrangler.toml`。
- 部品: `src/components/manage/**`, `src/components/layout/ManageSidebarNav.tsx`, `ManageActiveXNotice.tsx`。
#### Owned paths
- 新規: `+apps/ops/src/routes/manage/**`, `+apps/ops/wrangler.toml`（MIG-0628 から引き継ぎ、D-14-3。MIG-0628 の `apps/app/wrangler.toml` と同じ形、id は placeholder、`wrangler deploy --dry-run` を CI に足す）
- 変更: `apps/ops/src/routes/router.tsx`（MIG-0707 の route 枠を埋める）
- 触らない: `app/(manage)/**`, `apps/app/**`
#### Micro-units
- U01〜U05 と Final audit は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0704 のとおり。
- **U01**: scaffold・guard・noindex・`_headers` は MIG-0707（D-15-13）。本 task の U01 は `CostGuardBanner`（読む API は MIG-0661、D-16-13）と Manage の layout（`ConsoleShell` / sidebar、`GET /api/manage/navigation`）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | Personal と Ops の build | CSS/JS が互いに混ざらない |
| T02 | 担当外イベントの URL | 拒否 |
| T03 | 最後の owner の解任 | 拒否 |
| T04 | `/manage/events/[id]/review` | `videos?status=pending` へ互換 redirect |
| T05 | route × role（guest, user, staff, owner, admin）（G12） | Location（`error` query を含む）が CURRENT の layout と同じ |
| T06 | Ops の HTML（G12） | `meta robots noindex` または `X-Robots-Tag` がある |
| T07 | `/_ops_assets/*`（MIG-0620 T01） | MIG-0707 で満たす |
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
- [ ] MIG-0707 が DONE（`_headers` と `assetHeaders.test.mjs` の `ops`、D-13-4）
#### STOP
- Ops の Worker / Route を本番に作る必要が出たら止める（明示承認事項）。
#### Rollback
Phase 7 共通契約のとおり。

### MIG-0705: admin（Admin 全体管理者画面群）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0605 と MIG-0704 の後。micro-unit の正本は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0705
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0605, MIG-0704, MIG-0625, MIG-0626, MIG-0635, MIG-0637, MIG-0638, MIG-0642..MIG-0648, MIG-0650..MIG-0657, MIG-0660, MIG-0661 / **Decisions:** D-05 DECIDED, D-15-15（admin 画面が呼ぶ MIG-0650〜0657 / 0660 を依存に追加）, D-13-56 DECIDED（2026-10-25: MIG-0605 の残りを MIG-0636〜0638 へ分割。admin 画面が呼ぶ 0635/0637/0638 を依存に追加）, D-14-14（0637 / 0638 の分割先 0642〜0648 を依存に追加）, D-16-5（admin の video 詳細の状態 form `AdminVideoStatusForm` は本 task）, D-16-13（`CostGuardBanner source="admin"` は MIG-0661 の `GET /api/admin-read/cost-guard-banner`）
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

### MIG-0707: Ops SPA の土台（`apps/ops` の package・build・guard、MIG-0704 U01）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-15-13: MIG-0704 U01 の scaffold を分割。読み API（MIG-0624 / MIG-0625 / RH-001）は DONE。画面は MIG-0704 / MIG-0705。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0102, MIG-0608, MIG-0624, MIG-0625 / **Decisions:** D-05 DECIDED, D-13-4, D-15-13
- **Verified against:** `0a0f62a` (2026-10-26)
#### Source snapshot
- 手本（Personal SPA、MIG-0701）: `apps/app/package.json`（scripts `build: "tsc && vite build"`、`test: "tsc -p tsconfig.test.json && node --test test/*.test.mjs"`、deps `@flamenode/contracts` / `@flamenode/ui` / react 19 / react-router-dom 7）、`apps/app/vite.config.ts`（`base: "/"`, `build.assetsDir: "_personal_assets"`）、`apps/app/tsconfig.json`、`apps/app/index.html`、`apps/app/src/{main,App}.tsx`、`apps/app/src/routes/guard.tsx`（`LoginRequired` / `BannedNotice` / `AuthErrorView`）、`apps/app/public/_headers`。
- CURRENT の guard: `app/(manage)/layout.tsx`（user 無し → `/entry`、`enrichmentFailed` → `/entry?error=auth_temporarily_unavailable`、`canAccessAdmin` も `canAccessManage` も無い → `/dashboard`、robots noindex/nofollow）、`app/(admin)/layout.tsx`（同じ順で、`role !== "admin"` → `/dashboard`）。
- guard の入力: RH-001 `GET /api/account/summary`（`apps/api/src/routes/account/summary.ts`、`canAccessAdmin` / `canAccessManage` :282-302）。sidebar の event 一覧は `GET /api/manage/navigation`（`apps/api/src/routes/manage/navigation.ts`）。
- `CostGuardBanner`（`src/components/layout/CostGuardBanner.tsx`、server で `resolveCostGuardBannerSnapshot` を読む）を返す HTTP endpoint は main に無い（`apps/api/src/routes/live/operationMode.ts` は live API 内部用）。D-15-13 で banner は MIG-0704 に残す。
- CI: `.github/workflows/migration-docs-check.yml:103`（`npm run build --workspace=@flamenode/app`）。
#### Owned paths
- 新規: `+apps/ops/package.json`（`@flamenode/ops`）, `+apps/ops/index.html`（`<meta name="robots" content="noindex, nofollow">`）, `+apps/ops/tsconfig.json`, `+apps/ops/tsconfig.test.json`, `+apps/ops/vite.config.ts`（`base: "/"`, `build.assetsDir: "_ops_assets"`）, `+apps/ops/src/{main,App}.tsx`, `+apps/ops/src/routes/{router,guard}.tsx`, `+apps/ops/src/api/account.ts`, `+apps/ops/public/_headers`, `+apps/ops/test/{guard,build}.test.mjs`
- 変更: `package-lock.json`, `.github/workflows/migration-docs-check.yml`（Ops の build と test を 2 行）, `apps/site/src/gateway/assetHeaders.test.mjs`（D-13-4 の `ops` 追加）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `apps/app/**`, `app/(manage)/**`, `app/(admin)/**`, `packages/ui/**`
#### Micro-units
- **U01 package + build**: `apps/app` と同じ形で package / tsconfig / vite.config / index.html を作る（`assetsDir` と noindex だけが違う）。`npm ci` で lock を更新。
- **U02 router + guard**: `/manage`、`/manage/*`、`/admin`、`/admin/*` の route 枠（中身は「未移行」の空ページ。MIG-0704 / 0705 が埋める）。guard は RH-001 の応答で CURRENT の layout と同じ Location に `window.location.assign`（SPA 間は通常の navigation、D-05）。error boundary は `apps/app` の `AuthErrorView` と同じ文言。
- **U03 `_headers`**（D-13-4、MIG-0704 から移す）: `apps/ops/public/_headers` に `/_ops_assets/*` `Cache-Control: public, max-age=31536000, immutable`（HTML には rule を置かない）。`assetHeaders.test.mjs` に `const ops = parse(await read("apps/ops/public/_headers"));` を足し、T01 の `/_ops_assets/index-AbC123.js` / `.css` / `a-AbC.svg` が `IMMUTABLE`、T03 の HTML の loop と `for (const rules of [site, app])` に `ops` を足す。
- **U04 CI**: workflow に `npm run build --workspace=@flamenode/ops` と `npm run test --workspace=@flamenode/ops`。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | Personal と Ops の build | 両方成功、`dist/_personal_assets` と `dist/_ops_assets` に分かれ、互いの chunk 名が出ない |
| T02 | guard: 未ログイン / enrichment 失敗 / manage 権限なし / admin 以外が `/admin` | Location が CURRENT の layout と同じ（`error` query を含む） |
| T03 | Ops の HTML | `meta robots noindex` がある |
| T04 | `/_ops_assets/*`（MIG-0620 T01） | immutable 1 年、HTML は null |
#### Commands
```bash
npm ci --no-audit --no-fund
npm run build --workspace=@flamenode/app
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
node --test --experimental-strip-types apps/site/src/gateway/assetHeaders.test.mjs
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の Future files 表の `apps/ops/**` を作成済みに、`assetHeaders.test.mjs` 行に MIG-0707。
#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T04 が PASS
- [ ] Ops の build が CI で動く
#### STOP
- Ops の Worker / Route / Custom Domain を作る必要が出たら止める（明示承認事項。`apps/ops/wrangler.toml` は MIG-0704）。
- guard の判定に RH-001 に無い値が要ると分かったら止める（API を変えない）。
#### Rollback
PR を revert（`apps/ops` は本番に配信されていない）。

### MIG-0708: Personal settings の Active X・X profile・icon・削除 form（SA-098, SA-102..105、MIG-0702 U01）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-16-10: MIG-0702 から分割。契約先行で、merge は MIG-0636 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0611 / **Decisions:** D-04 DECIDED, D-05 DECIDED, D-16-1, D-16-2, D-16-3, D-16-4, D-16-10
- **Merge gate:** MIG-0636 が DONE（D-16-1）
- **Verified against:** `c2a6ecb` (2026-10-26)
#### Source snapshot
- CURRENT: `src/components/settings/XIdSettingsClient.tsx`（726 行）の `SetActiveXButton`（:243-290、FormData `x_user_id` :261、成功で `router.push(next)` か `router.refresh()`）、`XIdCompactProfileForm`（:294-437、form の FormData + `x_user_id` :320-331）、`XIdIconPicker`（:439-648、SA-104 `icon_url` :471-481、SA-105 `icon_file` :493-510、`SquareIconEditor`）、`DeleteXIdForm`（:650-、`x_user_id` / `confirm` :666-676、`ConfirmDialog`）。CSS は `XIdSettingsClient.module.css`（496 行）。呼び出し元は `src/components/settings/SettingsXAccountPanel.tsx`。
- SPA: `apps/app/src/routes/dashboard/Settings.tsx` の `XAccountPanel`（:400-489）が読み取り表示だけを出している。読みは `GET /api/personal/settings`（MIG-0611）。
- API（MIG-0636、D-16-1）: `POST /api/xid/active` body `{ x_user_id }`、`PATCH /api/xid/:xUserId/profile` body = `XIdCompactProfileForm` の form field の key、`DELETE /api/xid/:xUserId` body `{ confirm }`、`PUT /api/xid/:xUserId/icon` body `{ icon_url }`、`POST /api/xid/:xUserId/icon/upload` multipart `icon_file`（8 MiB）。応答は CURRENT の結果 object。
#### Owned paths
- 新規: `+apps/app/src/routes/dashboard/settings/XIdPanelActions.tsx`（4 component の移植）, `+apps/app/src/api/xidProfile.ts`（1 行目は D-16-1 の provisional comment）, `+apps/app/src/styles/xid-settings.css`（`portCssModule.mjs` の `MODULES` に `["xids", "src/components/settings/XIdSettingsClient.module.css", "apps/app/src/styles/xid-settings.css"]`）, `+apps/app/test/xidProfile.test.mjs`
- 新規（MIG-0709 / 0710 / 0715 と先に merge した方が作る、D-16-2）: `+apps/app/src/api/write.ts`
- 新規（MIG-0712 と先に merge した方が作る、D-16-4）: `+apps/app/src/components/shared/{SocialLinksEditor,YoutubeChannelPicker,SquareIconEditor,SquareIconEditorBoundary,ConfirmDialog}.tsx` と各 CSS
- 変更: `apps/app/src/routes/dashboard/Settings.tsx`（`XAccountPanel` に 4 component を置く）, `apps/app/src/api/personal.ts`（`xidProfile` 1 行ずつ）, `apps/app/src/routes/guard.tsx`（D-16-3 の `refreshKey`。先に merge した task が足す）, `apps/app/scripts/portCssModule.mjs`（`MODULES` に行）, `apps/app/src/main.tsx`（css import 1 行）
- 触らない: `src/components/**`, `src/lib/actions/**`, `apps/api/**`
#### Micro-units
- **U01 共通**: `write.ts`（D-16-2）と `useApiResult` の `refreshKey`（D-16-3）。`guard.tsx` の `useApiResult` を次の形にする（main に既にあれば何もしない）:
```ts
export function useApiResult<T>(
  api: PersonalApi,
  key: string,
  load: (api: PersonalApi, signal: AbortSignal) => Promise<ApiResult<T>>,
  refreshKey = 0,
): DataState<T> {
  const [state, setState] = React.useState<DataState<T>>(LOADING);
  const loadRef = React.useRef(load);
  loadRef.current = load;
  const shownKey = React.useRef<string | null>(null);
  React.useEffect(() => {
    const ctrl = new AbortController();
    const silent = shownKey.current === key; // only refreshKey changed: keep the page (CURRENT router.refresh)
    shownKey.current = key;
    if (!silent) setState(LOADING);
    loadRef.current(api, ctrl.signal).then(
      (r) => {
        if (!ctrl.signal.aborted && (!silent || r.status === "ok")) setState(r);
      },
      () => {
        if (!ctrl.signal.aborted && !silent) setState({ status: "unavailable" });
      },
    );
    return () => ctrl.abort();
  }, [api, key, refreshKey]);
  return state;
}
```
- **U02 client**: `xidProfile.ts` に `setActive` / `updateProfile` / `deleteXId` / `setIcon` / `uploadIcon`（`write.ts` の `send`）。
- **U03 画面**: 4 component を React のまま移植（文言・class・確認 dialog・二重送信防止を変えない）。`router.refresh()` は `Settings` の `refreshKey` を 1 増やす、`router.push(next)` は `useNavigate()(next)`。`SetActiveXButton` は D-04 の一斉切替を呼ばない。
- **U04 merge 直前**（D-16-1 の 5）: MIG-0636 の `packages/contracts/src/xid.ts` に置き換え、fixture を `parse` に通す。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | Active X 切替を連打 | fetch は1回（CURRENT の pending と同じ） |
| T02 | 承認待ち / manager リンクの X に Active ボタン | CURRENT `SettingsXAccountPanel` と同じ表示可否 |
| T03 | profile 保存の `{ok:false, message}` / reject | `message` /「更新に失敗しました。」、入力が残る |
| T04 | icon upload 8 MiB 超（API の 413 `{ok:false, message}`） | CURRENT と同じ文言 |
| T05 | 削除の確認文字列が違う | API を呼ばない（CURRENT と同じ） |
| T06 | 成功後の再取得 | `getSettings` が1回呼ばれ、画面は LOADING にならない（D-16-3） |
#### Commands
```bash
node apps/app/scripts/portCssModule.mjs
npm run build --workspace=@flamenode/app
npm run test --workspace=@flamenode/app
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と `XIdSettingsClient.tsx` 行の移植先。`API_MATRIX.md` の SA-098, 102〜105 に SPA の呼び出し元。
#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T06 が PASS
- [ ] MIG-0636 が DONE で、client が `packages/contracts` の schema を使っている（D-16-1）
- [ ] browser 確認（390px / 1440px）が PR にある
#### STOP
- D-04（Active X 一斉切替）の実行が必要に見えたら止める（別承認）。
- API の契約が CURRENT と違うときは止めて MIG-0636 に返す。
#### Rollback
Phase 7 共通契約のとおり。

### MIG-0709: Personal settings と onboarding の X 連携申請・取り下げ・統合差し戻し form（SA-099..101、MIG-0702 U02）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-16-10: MIG-0702 から分割。契約先行で、merge は MIG-0659 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0611 / **Decisions:** D-05 DECIDED, D-15-8, D-16-1, D-16-2, D-16-3, D-16-10
- **Merge gate:** MIG-0659 が DONE（D-16-1）
- **Verified against:** `c2a6ecb` (2026-10-26)
#### Source snapshot
- CURRENT: `src/components/settings/XIdSettingsClient.tsx` の `XIdLinkForm`（:16-110、FormData `request_type: "link"` / `x_id` :38-40、成功で `onSuccessRedirect` か `router.refresh()`）と `XIdMergeForm`（:111-237、form の FormData + `request_type: "merge"` :142-151）。`src/components/settings/XIdLinkedList.tsx`（267 行。取り下げ SA-100 `request_id` :125-131、統合の差し戻し SA-101 `parent_request_id` :150-159）。`app/(auth)/onboarding/OnboardingXIdForm.tsx`（119 行、`request_type: "link"` / `x_id` :33-44）。
- SPA: `apps/app/src/routes/dashboard/Settings.tsx` の `settings-panel-link`（:259-281）と `RequestHistoryList`（:519-）、`apps/app/src/routes/onboarding.tsx` の `{/* MIG-0702: OnboardingXIdForm ... */}` の2箇所（:196, :259）。
- API（MIG-0659、D-16-1）: `POST /api/xid/requests` body `{ request_type, x_id, ... }`（merge のときは `XIdMergeForm` の form field の key）、`POST /api/xid/requests/:id/cancel`、`POST /api/xid/merge-revert-requests` body `{ parent_request_id }`。
#### Owned paths
- 新規: `+apps/app/src/routes/dashboard/settings/XIdRequestForms.tsx`（`XIdLinkForm` / `XIdMergeForm`）, `+apps/app/src/routes/dashboard/settings/XIdRequestActions.tsx`（取り下げ・差し戻しの button）, `+apps/app/src/routes/onboardingXIdForm.tsx`, `+apps/app/src/api/xidRequests.ts`（1 行目は D-16-1 の provisional comment）, `+apps/app/test/xidRequests.test.mjs`
- 新規（MIG-0708 / 0710 / 0715 と先に merge した方が作る、D-16-2）: `+apps/app/src/api/write.ts`
- 変更: `apps/app/src/routes/dashboard/Settings.tsx`（link panel と history の行に置く）, `apps/app/package.json` と `package-lock.json`（`@flamenode/domain` が無ければ、D-16-4）, `apps/app/src/routes/onboarding.tsx`（コメント 2 箇所を component に）, `apps/app/src/api/personal.ts`（`xidRequests` 1 行ずつ）, `apps/app/src/routes/guard.tsx`（D-16-3。main に既にあれば何もしない）
- 触らない: `src/components/**`, `app/(auth)/**`, `apps/api/**`, MIG-0708 の `XIdPanelActions.tsx`
#### Micro-units
- **U01 共通**: `write.ts` と `refreshKey`（MIG-0708 U01 の code。main に既にあれば何もしない）。
- **U02 client**: `xidRequests.ts` に `requestLink` / `requestMerge` / `cancelRequest` / `requestMergeRevert`。
- **U03 画面**: 3 component と onboarding の form を移植。`parseXIdentityInput` は CURRENT と同じ `@flamenode/domain/xid`（`packages/domain/src/xid/format.ts:27`、`src/lib/utils/xid.ts:1-6` が re-export している）から import する（D-16-4。`apps/app/package.json` に `@flamenode/domain` が無ければ足して `npm install`）。`router.refresh()` は `refreshKey`、`onSuccessRedirect` は `useNavigate()`。
- **U04 merge 直前**（D-16-1 の 5）: MIG-0659 の `packages/contracts/src/xidRequest.ts` に置き換える。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | link 申請を連打 | fetch は1回 |
| T02 | 承認待ちの申請の取り下げ | CURRENT と同じ文言（「申請を取り下げました。」）と再取得 |
| T03 | 不正な X ID 入力 | API を呼ばず CURRENT と同じ文言 |
| T04 | onboarding で申請成功 | onboarding の再取得（`getOnboarding`）、画面は LOADING にならない |
| T05 | `{ok:false, message}` / reject | `message` /「申請に失敗しました。」 |
#### Commands
```bash
npm run build --workspace=@flamenode/app
npm run test --workspace=@flamenode/app
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と `XIdLinkedList.tsx` / `OnboardingXIdForm.tsx` 行の移植先。`API_MATRIX.md` の SA-099〜101 に SPA の呼び出し元。
#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T05 が PASS
- [ ] MIG-0659 が DONE で、client が `packages/contracts` の schema を使っている（D-16-1）
- [ ] browser 確認（390px / 1440px）が PR にある
#### STOP
- API の契約が CURRENT と違うときは止めて MIG-0659 に返す。
#### Rollback
Phase 7 共通契約のとおり。

### MIG-0710: `/onboarding` の規約同意 form と onboarding complete の POST（SA-076、MIG-0702 U03）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-16-10: MIG-0702 から分割。契約先行で、merge は MIG-0641 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0611 / **Decisions:** D-05 DECIDED, D-13-60, D-14-9, D-16-1, D-16-2, D-16-3, D-16-10
- **Merge gate:** MIG-0641 が DONE（D-16-1）
- **Verified against:** `c2a6ecb` (2026-10-26)
#### Source snapshot
- CURRENT: `app/(auth)/onboarding/OnboardingTermsForm.tsx`（105 行。checkbox 未チェックで「利用規約に同意するにはチェックボックスをオンにしてください。」:24-26、`acceptOnboardingTerms()` は引数なし :31、成功で「利用規約への同意が完了しました。」と `router.refresh()` :32-35、例外で「同意の保存に失敗しました。時間をおいて再試行してください。」:43）。`app/(auth)/onboarding/page.tsx:67` が GET 中に `maybeMarkOnboardingComplete(db, user.id, state)`（`src/lib/auth/onboarding.ts:122`、X 申請済み / 承認済みのときだけの条件付き UPDATE、認可に使わない補助マーカー）。
- SPA: `apps/app/src/routes/onboarding.tsx`（`TermsReader` :272-、`{/* MIG-0702: agree checkbox + "同意して続ける" (acceptOnboardingTerms) */}` :301）。
- API（MIG-0641、D-16-1）: `POST /api/personal/onboarding/terms`（body なし `{}`）、`POST /api/personal/onboarding/complete`（body なし、条件は server が `maybeMarkOnboardingComplete` と同じに判定）。
#### Owned paths
- 新規: `+apps/app/src/routes/onboardingTermsForm.tsx`, `+apps/app/src/api/terms.ts`（1 行目は D-16-1 の provisional comment）, `+apps/app/test/onboardingWrites.test.mjs`
- 新規（MIG-0708 / 0709 / 0715 と先に merge した方が作る、D-16-2）: `+apps/app/src/api/write.ts`
- 変更: `apps/app/src/routes/onboarding.tsx`（:301 のコメントを form に、到達時の complete POST）, `apps/app/src/api/personal.ts`（`terms` 1 行ずつ）, `apps/app/src/routes/guard.tsx`（D-16-3。main に既にあれば何もしない）
- 触らない: `app/(auth)/**`, `apps/api/**`, MIG-0709 の `onboardingXIdForm.tsx`
#### Micro-units
- **U01 共通**: `write.ts` と `refreshKey`（MIG-0708 U01 の code。main に既にあれば何もしない）。
- **U02 terms form**: `OnboardingTermsForm` の同意部分を移植（文言・checkbox・pending を変えない）。成功で `refreshKey` を 1 増やす。
- **U03 complete**: `/onboarding` の読み（`getOnboarding`）が `ok` になった後に1回だけ `POST /api/personal/onboarding/complete` を送る（`useEffect`、同じ mount で2回送らない）。結果は表示に使わない（CURRENT も表示に使わない）。失敗は無視する（CURRENT の補助マーカーと同じ扱い）。
- **U04 merge 直前**（D-16-1 の 5）: MIG-0641 の `packages/contracts/src/terms.ts` に置き換える。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | checkbox 未チェックで送信 | API を呼ばず CURRENT の文言 |
| T02 | 同意を連打 | fetch は1回 |
| T03 | `{ok:false, message}` / reject | `message` /「同意の保存に失敗しました。時間をおいて再試行してください。」 |
| T04 | `/onboarding` 到達 | complete の POST が1回、読みの失敗時は送らない |
#### Commands
```bash
npm run build --workspace=@flamenode/app
npm run test --workspace=@flamenode/app
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と `OnboardingTermsForm.tsx` 行の移植先。`API_MATRIX.md` の SA-076 と onboarding complete に SPA の呼び出し元。
#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T04 が PASS
- [ ] MIG-0641 が DONE で、client が `packages/contracts` の schema を使っている（D-16-1）
#### STOP
- complete の結果で表示や認可を変える必要が見えたら止める（CURRENT は補助マーカー）。
- API の契約が CURRENT と違うときは止めて MIG-0641 に返す。
#### Rollback
Phase 7 共通契約のとおり。

### MIG-0711: `/entry` の画面（読み取りと Discord ログイン、MIG-0703 U01 の前半）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-16-11: MIG-0703 から分割。読みの API は MIG-0623 で DONE、書き込みは無い。ログインは D-16-12。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0611, MIG-0623 / **Decisions:** D-05 DECIDED, D-16-11, D-16-12
- **Verified against:** `c2a6ecb` (2026-10-26)
#### Source snapshot
- CURRENT: `app/(auth)/entry/page.tsx`（381 行。`AUTH_ERROR_MESSAGES` :28-、未ログインは「まず Discord でログインしてください」の section と server action の form :191-224、初期設定未完了 :225-、投稿資格なし、確保済み枠と受付中イベントの一覧。CSS は `page.module.css`）。`entryLoginRedirectTo`（`src/lib/auth/onboardingUrls.ts:26` → `src/lib/auth/authComplete.ts:105-108`）。
- 読み: `GET /api/personal/entry`（`apps/api/src/routes/personal/entry/entryIndex.ts:33`、schema `EntryIndexResponseSchema` `packages/contracts/src/personal/entry.ts:35`）。未ログインは `personal` router の `requireAuth` で 401（`apps/api/src/routes/personal/index.ts:23`）。
- SPA: `apps/app/src/routes/router.tsx`（`PERSONAL_READ_PATHS` と `PersonalRoutes`）、guard の `LoginRequired` は `/entry?next=` へ link する（`apps/app/src/routes/guard.tsx:7-20`、`next.ts:32`）。
- Auth.js: CURRENT の endpoint は `app/api/auth/[...nextauth]/route.ts`（Phase 8 まで Next が配信）。
#### Owned paths
- 新規: `+apps/app/src/routes/entry/EntryIndex.tsx`, `+apps/app/src/routes/entry/discordSignIn.ts`, `+apps/app/src/styles/entry.css`（`portCssModule.mjs` の `MODULES` に `["entry", "app/(auth)/entry/page.module.css", "apps/app/src/styles/entry.css"]`）, `+apps/app/test/entryIndex.test.mjs`
- 変更: `apps/app/src/routes/router.tsx`（`/entry` の Route 1 行と `PERSONAL_READ_PATHS`）, `apps/app/src/api/personal.ts`（`getEntryIndex` 1 行ずつ）, `apps/app/scripts/portCssModule.mjs`（`MODULES` に行）, `apps/app/src/main.tsx`（css import 1 行）, `apps/app/src/routes/next.ts`（`entryLoginRedirectTo` の移植）
- 触らない: `app/(auth)/**`, `apps/api/**`, `src/lib/auth/**`
#### Micro-units
- **U01 読み**: `getEntryIndex()` = `GET /api/personal/entry`。401 は未ログインの表示（`LoginRequired` ではなく CURRENT `/entry` の未ログイン section。`/entry` は login の入口だから）。
- **U02 ログイン**（D-16-12）: `discordSignIn.ts` に `startDiscordSignIn(next)`: `fetch("/api/auth/csrf", { credentials: "same-origin" })` の `csrfToken` を取り、`form` を作って `method="POST" action="/api/auth/signin/discord"` に hidden `csrfToken` と `callbackUrl = entryLoginRedirectTo(next)` を入れて `submit()`。csrf の取得が失敗したら `location.assign("/entry?error=auth_temporarily_unavailable")`。`entryLoginRedirectTo` は CURRENT `authComplete.ts:105-108` と同じ中身を `next.ts` に移す（`sanitizeAuthCompleteNext` などの依存も同じ中身で）。
- **U03 画面**: CURRENT の section の順と文言、`?error=` の `AUTH_ERROR_MESSAGES`、確保済み枠の表示、`/entry/slotted`・`/entry/unslotted` への link（行き先の画面は MIG-0716。それまでは通常 navigation で CURRENT の Next 画面に行く、D-05）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 未ログイン（401） | CURRENT の未ログイン section と「Discord でログイン」button |
| T02 | button 押下（fake fetch の csrf） | POST form の `action` / `csrfToken` / `callbackUrl` が期待値 |
| T03 | `?next=https://evil.example`（G22） | `callbackUrl` が CURRENT `entryLoginRedirectTo` と同じ値（外部 URL は `/entry` に落ちる） |
| T04 | csrf の fetch が reject | `/entry?error=auth_temporarily_unavailable` |
| T05 | `?error=OAuthCallback` | 「Discord認証を完了できませんでした」 |
| T06 | 初期設定未完了 / 投稿資格なし / 通常 | CURRENT と同じ section（fixture は `EntryIndexResponseSchema.parse`） |
#### Commands
```bash
node apps/app/scripts/portCssModule.mjs
npm run build --workspace=@flamenode/app
npm run test --workspace=@flamenode/app
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `app/(auth)/entry/page.tsx` 行を IN_PROGRESS（移植先）。`API_MATRIX.md` の SA-107 に「`/entry` の SPA は Auth.js の HTTP の流れ（D-16-12）」。
#### DONE checklist
- [ ] U01〜U03 が DONE、T01〜T06 が PASS
- [ ] Server Action を呼ばない
- [ ] browser 確認（390px / 1440px）が PR にある
#### STOP
- `/api/auth/signin/discord` が SPA の origin から使えない（別 host・CSRF の拒否）と分かったら止める（MIG-0802 と合わせて決め直す）。
- Auth.js の設定（`src/lib/auth/**`）を変える必要が出たら止める。
#### Rollback
Phase 7 共通契約のとおり。

### MIG-0712: Personal SPA の投稿 form その A: 小さい field 部品の移植（MIG-0703）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-16-11: 投稿 form の移植を3つに分けた1つ目。network を呼ばない部品だけで、API を待たない。実装は Sonnet、review は Opus）
- **Recipe:** R-UI
- **Runtime:** N
- **Depends on:** MIG-0623, MIG-0630 / **Decisions:** D-16-4, D-16-11
- **Verified against:** `c2a6ecb` (2026-10-26)
#### Source snapshot
- CURRENT（`VideoForm.tsx:24-79` が import する部品）: `src/components/forms/CustomQuestionFields.tsx`（196 行 + css 47）、`SocialLinksEditor.tsx`（127 + 117）、`VideoIconPicker.tsx`（441、`SquareIconEditor` / `SquareIconEditorBoundary` を使う）、`YoutubeDescriptionPreview.tsx`（234 + 131）、`src/components/settings/YoutubeChannelPicker.tsx`（259）、`src/components/video/permission/{PermissionBadge,FieldLockNote,PermissionFieldLabel}.tsx`（124 / 43 / 46、各 css）、`src/components/media/SquareIconEditor.tsx`（388 + css 116）、`SquareIconEditorBoundary.tsx`（52）。
- 部品が import する `src/lib` の module: `video/customQuestions.ts`（223）、`socialLinks.ts`（210）、`utils/youtubeChannel.ts`（70）、`event/youtubeDescriptionTemplate.ts`（468）、`video/videoFormSchema`（`VideoIconMode` 型）。
- 入力の形: `EntryCustomQuestionSchema`（`packages/contracts/src/personal/entry.ts:43`）、edit の form options（`EditFormOptionsResponseSchema`、`packages/contracts/src/personal/edit.ts:220`）。
#### Owned paths
- 新規: `+apps/app/src/components/forms/{CustomQuestionFields,VideoIconPicker,YoutubeDescriptionPreview}.tsx`, `+apps/app/src/components/permission/{PermissionBadge,FieldLockNote,PermissionFieldLabel}.tsx`, `+apps/app/src/lib/` の下に部品が使う pure module（1 file ずつ、1 行目 `// Port of CURRENT <path> (MIG-0712). Same output.`）, `+apps/app/src/styles/forms-a.css`（`portCssModule.mjs` の `MODULES` に各 css module の行。prefix は `cq` / `ydesc` / `perm-badge` / `perm-lock` / `perm-label`）, `+apps/app/test/formFieldsA.test.mjs`
- 新規（MIG-0708 と先に merge した方が作る、D-16-4）: `+apps/app/src/components/shared/{SocialLinksEditor,YoutubeChannelPicker,SquareIconEditor,SquareIconEditorBoundary,ConfirmDialog}.tsx` と各 css
- 変更: `apps/app/scripts/portCssModule.mjs`（`MODULES` に行）, `apps/app/src/main.tsx`（css import）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `src/components/**`, `src/lib/**`（移植元）, `VideoForm.tsx` / `VideoMembersField.tsx` の移植（MIG-0713 / 0714）
#### Micro-units
- **U01 lib**: 部品が import する pure module を移す。`packages/domain` に同名の関数があればそれを import し、無ければ中身を変えずに `apps/app/src/lib/` へ写す。`next/*`・`@/lib/db`・`@/lib/auth` を import する module は写さない（あれば STOP）。
- **U02 部品**: 上の部品を React のまま移植。文言・class（CSS module は `portCssModule.mjs` の prefix 付き class）・`aria-*` を変えない。network を呼ばない。
- **U03 test**: jsdom で各部品を描き、CURRENT の契約 test（`src/components/forms/*.contract.test.mjs` のうち部品に当たるもの）と同じ入力で同じ DOM / callback を確かめる。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | custom question の各 type（options あり / なし） | CURRENT と同じ field と name |
| T02 | social links の追加・削除・上限 | CURRENT と同じ |
| T03 | YouTube 概要欄の preview（template あり / なし） | CURRENT `youtubeDescriptionTemplate` と同じ文字列 |
| T04 | icon picker の mode 切替（`SquareIconEditorBoundary` の失敗を含む） | CURRENT と同じ表示 |
| T05 | `rg "@/|next/" apps/app/src/components` | 0 件 |
#### Commands
```bash
node apps/app/scripts/portCssModule.mjs
npm run build --workspace=@flamenode/app
npm run test --workspace=@flamenode/app
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と移植元の行の移植先。
#### DONE checklist
- [ ] U01〜U03 が DONE、T01〜T05 が PASS
- [ ] 部品が network を呼ばない
#### STOP
- 部品が server 専用の module（db・auth・publicData）を要ると分かったら止める。
#### Rollback
PR を revert（まだどの route からも使われない）。

### MIG-0713: Personal SPA の投稿 form その B: `VideoMembersField` の移植（MIG-0703）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-16-11: 投稿 form の移植の2つ目。X user 検索（RH-019）と権限一括（SA-084）は props の adapter にして API を待たない。実装は Sonnet、review は Opus）
- **Recipe:** R-UI
- **Runtime:** N
- **Depends on:** MIG-0623, MIG-0630 / **Decisions:** D-16-4, D-16-11
- **Verified against:** `c2a6ecb` (2026-10-26)
#### Source snapshot
- CURRENT: `src/components/forms/VideoMembersField.tsx`（1503 行 + css 128）。props は `VideoMembersFieldProps`（:32）。network は2つ: X user 検索 `fetch("/api/internal/x-users/search?q=...&limit=20&offset=...")`（:142-170、debounce）と SA-084 `applyVideoCollaboratorPermissionsBatch({ video_id, edit_privilege_mode?, notify: true, intents })`（:745-760）。
- import する `src/lib`: `video/memberInput.ts`（333）、`video/memberSuggestionRank.ts`（277）、`utils/clipboard.ts`（38）、`video/atomicLimits.ts`（`MAX_VIDEO_MEMBERS`、`MAX_COLLABORATOR_PERMISSION_BATCH`）、`utils/xid`（`@flamenode/domain/xid` の re-export）。
#### Owned paths
- 新規: `+apps/app/src/components/forms/VideoMembersField.tsx`, `+apps/app/src/lib/` の下に部品が使う pure module（1 行目 `// Port of CURRENT <path> (MIG-0713). Same output.`）, `+apps/app/src/styles/video-members.css`（`MODULES` に `["vmembers", "src/components/forms/VideoMembersField.module.css", "apps/app/src/styles/video-members.css"]`）, `+apps/app/test/videoMembersField.test.mjs`
- 変更: `apps/app/scripts/portCssModule.mjs`, `apps/app/src/main.tsx`（css import）, `apps/app/package.json` と `package-lock.json`（`@flamenode/domain` が無ければ、D-16-4）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `src/components/**`, `src/lib/**`, MIG-0712 の部品
#### Micro-units
- **U01 lib**: MIG-0712 U01 と同じ規則で pure module を移す（MIG-0712 が先に移した file はそれを使う）。
- **U02 adapter**: props に `searchXUsers(q: string, offset: number, signal: AbortSignal): Promise<unknown>`（CURRENT :161-170 の fetch と同じ query、応答は CURRENT の route の JSON）と `applyPermissionBatch(input): Promise<{ ok: boolean; message?: string }>`（CURRENT :745 の引数から `video_id` を除いたもの + `videoId`）を足す。部品の中で `fetch` も Server Action も呼ばない。
- **U03 移植**: 残りは React のまま（debounce の時間・上限・文言・clipboard を変えない）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 入力の debounce 中に連続入力 | `searchXUsers` は最後の1回だけ |
| T02 | 上限（`MAX_VIDEO_MEMBERS`）ちょうど / 超え | CURRENT と同じ表示 |
| T03 | 権限一括（`MAX_COLLABORATOR_PERMISSION_BATCH` を超える intents） | adapter に渡るのは上限まで（CURRENT :740 と同じ） |
| T04 | adapter が `{ok:false}` / reject | CURRENT と同じ文言 |
| T05 | `rg "fetch\\(|@/lib/actions" apps/app/src/components/forms/VideoMembersField.tsx` | 0 件 |
#### Commands
```bash
node apps/app/scripts/portCssModule.mjs
npm run build --workspace=@flamenode/app
npm run test --workspace=@flamenode/app
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と `VideoMembersField.tsx` 行の移植先。
#### DONE checklist
- [ ] U01〜U03 が DONE、T01〜T05 が PASS
#### STOP
- 検索や権限の判定を部品の中で決める必要が出たら止める（Hono が正）。
#### Rollback
PR を revert（まだどの route からも使われない）。

### MIG-0714: Personal SPA の投稿 form その C: `VideoForm` と `UnslottedPostForm` の移植（MIG-0703）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — BLOCKED（D-16-11: MIG-0712 と MIG-0713 の部品を使う）。submit は props の adapter にして API を待たない
- **Recipe:** R-UI
- **Runtime:** N
- **Depends on:** MIG-0712, MIG-0713 / **Decisions:** D-16-4, D-16-11
- **Verified against:** `c2a6ecb` (2026-10-26)
#### Source snapshot
- CURRENT: `src/components/forms/VideoForm.tsx`（3756 行 + css 1224。`export function VideoForm` :469、型 `VideoFormInitialValues` :112 / `EventOption` :142 / `XIdOption` :193。submit は `createFreeVideo` / `submitSlotVideo` / `updateVideo`（:13-17）を `submitFormCompat` で呼ぶ、guard は `redirectForGuardReason`、下書きは `useFormDraft` / `videoFormDraft` / `draftFileStore`）、`UnslottedPostForm.tsx`（261 行、`VideoForm` を包む）。
- import する `src/lib`: `youtube/id`、`video/{types,formSettings,requiredVideoFields,atomicLimits,videoEditPermissionView,permissionUnlockHint,customQuestions,videoFormDraft}`、`client/{guardRedirect,activeXSwitchEvents}`、`forms/submitFormCompat`、`interactions/{useFormDraft,draftFileStore}`、`event/youtubeDescriptionTemplate`。
#### Owned paths
- 新規: `+apps/app/src/components/forms/{VideoForm,UnslottedPostForm}.tsx`, `+apps/app/src/lib/` の下に pure module（1 行目 `// Port of CURRENT <path> (MIG-0714). Same output.`）, `+apps/app/src/lib/guardRedirect.ts`（D-16-4）, `+apps/app/src/styles/video-form.css`（`MODULES` に `["vform", "src/components/forms/VideoForm.module.css", "apps/app/src/styles/video-form.css"]`）, `+apps/app/test/videoForm.test.mjs`
- 変更: `apps/app/scripts/portCssModule.mjs`, `apps/app/src/main.tsx`, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `src/components/**`, `src/lib/**`, MIG-0712 / 0713 の部品（import だけ）
#### Micro-units
- **U01 lib**: MIG-0712 U01 と同じ規則。`useFormDraft` / `draftFileStore`（localStorage / IndexedDB）は browser の API だけを使うので中身を変えずに写す。
- **U02 adapter**: `VideoForm` の props に `submit(mode: "free" | "slot" | "update", fd: FormData): Promise<VideoActionResult>` を足し、`createFreeVideo` / `submitSlotVideo` / `updateVideo` の直呼びを置き換える。`VideoMembersField` の 2 adapter（MIG-0713）は `VideoForm` の props から渡す。
- **U03 移植**: 残りは React のまま（wizard の手順・必須 field の検査・下書き・文言を変えない）。`next/link` は `<a>`、`useRouter` は `useNavigate`。
- **U04 test**: CURRENT の `src/components/forms/*.contract.test.mjs` と同じ入力で、adapter に渡る FormData の key と値が同じことを確かめる。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 不正な YouTube URL・重複 | submit を呼ばず CURRENT と同じエラー |
| T02 | 正しい入力で submit | adapter の FormData が CURRENT の契約 test と同じ key / 値 |
| T03 | 下書きの保存・復元 | CURRENT と同じ storage key（`buildFormDraftStorageKey`） |
| T04 | `{ok:false, reason:"tos_required"}` | `/onboarding?next=` へ（`guardRedirect.ts`） |
#### Commands
```bash
node apps/app/scripts/portCssModule.mjs
npm run build --workspace=@flamenode/app
npm run test --workspace=@flamenode/app
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と `VideoForm.tsx` / `UnslottedPostForm.tsx` 行の移植先。
#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T04 が PASS
- [ ] 部品が network を呼ばない
#### STOP
- 1 PR の差分が 3000 行を超えそうなら U01 だけで先に PR を出す（R-CORE と同じ扱い）。
- 投稿の検査を SPA 側だけで決める必要が出たら止める（Hono が正）。
#### Rollback
PR を revert（まだどの route からも使われない）。

### MIG-0715: `/dashboard/edit/:id/permissions` の画面（SA-082..084、MIG-0703 U02 の後半）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-16-11: MIG-0703 から分割。読みは MIG-0630 で DONE。書き込みは契約先行で、merge は MIG-0650 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0630 / **Decisions:** D-05 DECIDED, D-16-1, D-16-2, D-16-3, D-16-11
- **Merge gate:** MIG-0650 が DONE（D-16-1）
- **Verified against:** `c2a6ecb` (2026-10-26)
#### Source snapshot
- CURRENT: `app/(auth)/dashboard/edit/[id]/permissions/page.tsx`（239 行。`?privileged=` の mode :44-、`AdminVideoTabs`、`VideoCollabPermsManager` に `videoId` / `videoTitle` / `subjects` / `publicMembers` / `editPrivilegeMode` を渡す :220-226）。`src/components/admin/VideoCollabPermsManager.tsx`（658 行 + css 250。SA-082 `upsertVideoCollaborator(fd)`、FormData `video_id` / `x_user_id` / `display_name` / `can_edit: "1"` / `notify` / `edit_privilege_mode` :294-306。解除は SA-084 `applyVideoCollaboratorPermissionsBatch({ video_id, edit_privilege_mode?, notify: false, intents })` :308-330。成功で `router.refresh()` :274。通知の preview に `buildVideoEditPermissionGrantedNotification`（`src/lib/notifications/templates/video.ts`、252 行）:346）。
- 読み: `GET /api/personal/edit/:id/permissions`（`apps/api/src/routes/personal/edit/permissions.ts:14`、`EditPermissionsResponseSchema` `packages/contracts/src/personal/edit.ts:185`）。
- API（MIG-0650、D-16-1）: `PUT /api/videos/:videoId/collaborators/:xUserId` body `{ display_name, can_edit, notify, edit_privilege_mode? }`、`POST /api/videos/:videoId/collaborators/batch` body `{ edit_privilege_mode?, notify, intents }`。応答は CURRENT の `VideoCollabResult`。
#### Owned paths
- 新規: `+apps/app/src/routes/dashboard/edit/Permissions.tsx`, `+apps/app/src/components/VideoCollabPermsManager.tsx`, `+apps/app/src/api/videoCollaborators.ts`（1 行目は D-16-1 の provisional comment）, `+apps/app/src/styles/video-collab.css`（`MODULES` に `["vcollab", "src/components/admin/VideoCollabPermsManager.module.css", "apps/app/src/styles/video-collab.css"]`）, `+apps/app/test/editPermissions.test.mjs`
- 新規（MIG-0708 / 0709 / 0710 と先に merge した方が作る、D-16-2）: `+apps/app/src/api/write.ts`
- 変更: `apps/app/src/routes/router.tsx`（Route 1 行と `PERSONAL_READ_PATHS`）, `apps/app/src/api/personal.ts`（`getEditPermissions` と `videoCollaborators` の行）, `apps/app/src/routes/guard.tsx`（D-16-3。main に既にあれば何もしない）, `apps/app/scripts/portCssModule.mjs`, `apps/app/src/main.tsx`
- 触らない: `app/(auth)/**`, `src/components/**`, `apps/api/**`
#### Micro-units
- **U01 読み**: `getEditPermissions(id, privileged)` = `GET /api/personal/edit/:id/permissions?privileged=`。`kind` ごとの表示（not found / 権限なし / 通常）を CURRENT と同じに。
- **U02 client**: `videoCollaborators.ts` に `upsert` / `applyBatch`（`write.ts` の `send`）。
- **U03 画面**: `VideoCollabPermsManager` を React のまま移植（文言・確認・上限を変えない）。`buildVideoEditPermissionGrantedNotification` は pure なので中身を変えずに `apps/app/src/lib/` へ写す（import 先の `../actor` / `../format` も同じ規則）。`AdminVideoTabs` は CURRENT と同じ link の列を移植。
- **U04 merge 直前**（D-16-1 の 5）: MIG-0650 の `packages/contracts/src/videoCollaborators.ts` に置き換える。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | collaborator（権限なし）が URL を開く | 読みの `kind` で CURRENT と同じ拒否表示 |
| T02 | 追加・解除 | CURRENT と同じ body を送り、成功で読み直す（LOADING にならない） |
| T03 | 不正な X ID | API を呼ばず「X ID は英数字とアンダースコア20文字以内で入力してください。」 |
| T04 | `{ok:false, message}` / reject | `message` /「更新に失敗しました。」「解除に失敗しました。」 |
#### Commands
```bash
node apps/app/scripts/portCssModule.mjs
npm run build --workspace=@flamenode/app
npm run test --workspace=@flamenode/app
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の permissions ページ行を IN_PROGRESS（移植先）。`API_MATRIX.md` の SA-082 / 084 に SPA の呼び出し元。
#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T04 が PASS
- [ ] MIG-0650 が DONE で、client が `packages/contracts` の schema を使っている（D-16-1）
- [ ] browser 確認（390px / 1440px）が PR にある
#### STOP
- 権限の可否を SPA 側で決める必要が出たら止める（Hono が正）。
- API の契約が CURRENT と違うときは止めて MIG-0650 に返す。
#### Rollback
Phase 7 共通契約のとおり。

### MIG-0716: `/entry/slotted` と `/entry/unslotted` の画面（SA-086, SA-088、MIG-0703 U01 の後半）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — BLOCKED（D-16-11: MIG-0714 の `VideoForm` を使う）。読みは MIG-0623 で DONE。書き込みは契約先行で、merge は MIG-0651・0648・0650 の DONE 後
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0714 / **Decisions:** D-05 DECIDED, D-16-1, D-16-11
- **Merge gate:** MIG-0651, MIG-0648, MIG-0650 が DONE（D-16-1。submit、X user 検索、権限一括）
- **Verified against:** `c2a6ecb` (2026-10-26)
#### Source snapshot
- CURRENT: `app/(auth)/entry/slotted/page.tsx`（312 行、`VideoForm` mode slot）、`app/(auth)/entry/unslotted/page.tsx`（237 行、`UnslottedPostForm`）。
- 読み: `GET /api/personal/entry/slotted`（`SlottedEntryResponseSchema`、`packages/contracts/src/personal/entry.ts:109`）、`GET /api/personal/entry/unslotted`（`UnslottedEntryResponseSchema` :135）。
- API（D-16-1）: SA-086 `POST /api/videos/free`、SA-088 `POST /api/slots/:slotId/video`（MIG-0651。body は `VideoForm` の FormData をそのまま multipart）、RH-019 `GET /api/internal/x-users/search`（MIG-0648）、SA-084 `POST /api/videos/:videoId/collaborators/batch`（MIG-0650）。
#### Owned paths
- 新規: `+apps/app/src/routes/entry/{Slotted,Unslotted}.tsx`, `+apps/app/src/api/videoSubmit.ts`（1 行目は D-16-1 の provisional comment）, `+apps/app/src/api/xUserSearch.ts`（同）, `+apps/app/test/entryForms.test.mjs`
- 変更: `apps/app/src/routes/router.tsx`（Route 2 行と `PERSONAL_READ_PATHS`）, `apps/app/src/api/personal.ts`, `apps/app/src/api/videoCollaborators.ts`（MIG-0715 の client を import。無ければ MIG-0715 U02 の内容で作る）
- 触らない: `app/(auth)/**`, `src/components/**`, `apps/api/**`, MIG-0714 の form（props で渡すだけ）
#### Micro-units
- **U01 読み**: 2 ページの読みと `kind` ごとの表示。
- **U02 adapter**: `VideoForm` の `submit` に `videoSubmit.ts`（multipart）、`VideoMembersField` の 2 adapter に `xUserSearch.ts` と `videoCollaborators.applyBatch`。
- **U03 merge 直前**（D-16-1 の 5）: MIG-0651 の `packages/contracts/src/videoSubmit.ts`、MIG-0650 の `packages/contracts/src/videoCollaborators.ts` の schema に置き換える。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 投稿済みの枠で再投稿 | API の `{ok:false, message}` を CURRENT と同じ表示 |
| T02 | 成功 | CURRENT と同じ移動先 |
| T03 | 受付外のイベント（読みの `kind`） | CURRENT と同じ表示 |
#### Commands
```bash
npm run build --workspace=@flamenode/app
npm run test --workspace=@flamenode/app
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の 2 ページ行を IN_PROGRESS（移植先）。`API_MATRIX.md` の SA-086 / 088 に SPA の呼び出し元。
#### DONE checklist
- [ ] U01〜U03 が DONE、T01〜T03 が PASS
- [ ] MIG-0651 / 0648 / 0650 が DONE で、client が `packages/contracts` の schema を使っている（D-16-1）
#### STOP
- API の契約が CURRENT と違うときは止めて担当の API task に返す。
#### Rollback
Phase 7 共通契約のとおり。

### MIG-0717: `/dashboard/edit/:id` の画面（SA-089、MIG-0703 U02 の前半）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — BLOCKED（D-16-11: MIG-0714 の `VideoForm` を使う）。読みは MIG-0630 で DONE。書き込みは契約先行で、merge は MIG-0651・0648・0650 の DONE 後
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0714 / **Decisions:** D-05 DECIDED, D-16-1, D-16-11
- **Merge gate:** MIG-0651, MIG-0648, MIG-0650 が DONE（D-16-1）
- **Verified against:** `c2a6ecb` (2026-10-26)
#### Source snapshot
- CURRENT: `app/(auth)/dashboard/edit/[id]/page.tsx`（813 行。`VideoForm` mode edit、`VideoEditPermissionSummary` / `VideoEditPermissionOverview`、`AdminVideoTabs`、編集可能 section の判定 `hasAnyEditableVideoFormSection`）。
- 読み: `GET /api/personal/edit/:id`（`EditPageResponseSchema` `packages/contracts/src/personal/edit.ts:125`）、`GET /api/personal/edit/:id/form-options`（`EditFormOptionsResponseSchema` :220）。
- API（D-16-1）: SA-089 `PATCH /api/videos/:videoId`（MIG-0651、multipart）、RH-019（MIG-0648）、SA-084（MIG-0650）。
#### Owned paths
- 新規: `+apps/app/src/routes/dashboard/edit/Edit.tsx`, `+apps/app/src/components/permission/{VideoEditPermissionSummary,VideoEditPermissionOverview}.tsx`, `+apps/app/test/editPage.test.mjs`
- 変更: `apps/app/src/routes/router.tsx`, `apps/app/src/api/personal.ts`, `apps/app/src/api/videoSubmit.ts`（MIG-0716 の client。無ければ MIG-0716 U02 の内容で作る）
- 触らない: `app/(auth)/**`, `src/components/**`, `apps/api/**`
#### Micro-units
- **U01 読み**: 2 つの読みと `kind` ごとの表示（not found / 権限なし / 編集可能 section なし / 通常）。
- **U02 画面**: 権限 summary / overview の移植と `VideoForm`（mode edit）。
- **U03 merge 直前**（D-16-1 の 5）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 編集中の再読込 | 下書きが CURRENT と同じに戻る |
| T02 | 編集できない section | CURRENT と同じ lock 表示、送らない |
| T03 | `{ok:false, message}` | CURRENT と同じ表示 |
#### Commands
```bash
npm run build --workspace=@flamenode/app
npm run test --workspace=@flamenode/app
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の edit ページ行を IN_PROGRESS（移植先）。`API_MATRIX.md` の SA-089 に SPA の呼び出し元。
#### DONE checklist
- [ ] U01〜U03 が DONE、T01〜T03 が PASS
- [ ] MIG-0651 / 0648 / 0650 が DONE で、client が `packages/contracts` の schema を使っている（D-16-1）
#### STOP
- 編集可能 section を SPA 側で決める必要が出たら止める（読みの API が正）。
#### Rollback
Phase 7 共通契約のとおり。

### MIG-0718: Personal SPA の CostGuardBanner（D-16-13）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-16-13: D-13-6 の FIX-0701-1 のうち banner の部分。endpoint は MIG-0661。契約先行で、merge は MIG-0661 と MIG-0701 の DONE 後。header / footer は FIX-0701-1 に残る。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0611 / **Decisions:** D-05 DECIDED, D-13-6, D-13-8, D-16-1, D-16-13
- **Merge gate:** MIG-0661, MIG-0701 が DONE（D-16-1。API と、banner を置く root document / wrapper）
- **Verified against:** `c2a6ecb` (2026-10-26)
#### Source snapshot
- CURRENT: `app/(auth)/layout.tsx:27`（`<CostGuardBanner />`、公開 source）、`src/components/layout/CostGuardBanner.tsx`（98 行。`TONE` の4 mode の label / description :9-41、`role="status"` `aria-live="polite"`、`fn-public-container` の中に label・description・reason :77-95、css `CostGuardBanner.module.css`）。
- API（MIG-0661）: `GET /api/operation-mode/banner` → `{ mode, reason }`。
- SPA: `apps/app/src/routes/router.tsx` の `PersonalRoutes`。MIG-0701 U05 が `(auth)` layout の wrapper（`fn-personal-shell`）を作る。
#### Owned paths
- 新規: `+apps/app/src/routes/CostGuardBanner.tsx`, `+apps/app/src/api/operationMode.ts`（1 行目は D-16-1 の provisional comment）, `+apps/app/src/styles/cost-guard-banner.css`（`MODULES` に `["cgb", "src/components/layout/CostGuardBanner.module.css", "apps/app/src/styles/cost-guard-banner.css"]`）, `+apps/app/test/costGuardBanner.test.mjs`
- 変更: `apps/app/src/routes/router.tsx`（CURRENT `app/(auth)/layout.tsx:27` と同じ位置 = MIG-0701 の wrapper の中・`<main>` の前に mount 1 行。MIG-0701 が wrapper を別 file に作ったらその file）, `apps/app/scripts/portCssModule.mjs`, `apps/app/src/main.tsx`
- 触らない: `src/components/**`, `apps/api/**`, `apps/ops/**`
#### Micro-units
- **U01 client**: `GET /api/operation-mode/banner`。失敗・`normal` は何も出さない（CURRENT は snapshot が無ければ null）。
- **U02 表示**: `TONE` と markup を CURRENT と同じに（inline style の色も同じ）。
- **U03 merge 直前**: MIG-0661 の `packages/contracts/src/costGuardBanner.ts` に置き換え、MIG-0701 の wrapper の中に置く。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `economy` / `read_only` / `static_only` / `maintenance` + reason | CURRENT と同じ label・description・`(理由: x)` |
| T02 | `normal` / fetch 失敗 | 何も出さない |
#### Commands
```bash
node apps/app/scripts/portCssModule.mjs
npm run build --workspace=@flamenode/app
npm run test --workspace=@flamenode/app
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `CostGuardBanner.tsx` 行に Personal SPA の移植先。
#### DONE checklist
- [ ] U01〜U03 が DONE、T01〜T02 が PASS
- [ ] MIG-0661 と MIG-0701 が DONE（D-16-1）
#### STOP
- banner のために D1 を読む必要が出たら止める（公開 source は D1 を読まない）。
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
