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
- **Readiness:** NEEDS_REFINEMENT — Final audit だけ（D-17-1: U01（layout の残り）〜U05 を MIG-0719..MIG-0723 へ分割した。画面の実装は子 task）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0719..MIG-0723 / **Decisions:** D-05 DECIDED, D-14-3, D-15-13, D-16-5（manage の video 詳細の状態 form `ManageVideoStatusForm` は本 task）, D-16-13（`CostGuardBanner` は MIG-0661 の `GET /api/operation-mode/banner`）, D-17-1
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- CURRENT（12ファイル）: `app/(manage)/manage/page.tsx`, `app/(manage)/manage/events/[id]/{page,edit/page,audience/page,slots/page,staff/page,videos/page,videos/[videoId]/page,youtube-playlist/page,review/page}.tsx`, `app/(manage)/manage/notifications/page.tsx`, `app/(manage)/manage/x-link-requests/page.tsx`。
- `apps/ops` の package・build・guard・`_headers` は MIG-0707 が作る（D-15-13）。本 task は画面と `CostGuardBanner`、`apps/ops/wrangler.toml`。
- 部品: `src/components/manage/**`, `src/components/layout/ManageSidebarNav.tsx`, `ManageActiveXNotice.tsx`。
#### Owned paths
- 新規・変更: なし（画面と部品は子 task が持つ）。Final audit の表は本 task の PR に置く
#### Micro-units
- U01（layout の残り）〜U05: MIG-0719..MIG-0723（D-17-1）。
- **Final audit**: [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) の Final audit（CURRENT_ROUTES の全 route、担当外の拒否、Ops の独立 build と deep URL）を、子 task の merge 後の main で確かめる。
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
- **Readiness:** NEEDS_REFINEMENT — Final audit だけ（D-17-1: U01〜U08（U08 の 45 route の sweep は本 task の Final audit に残す） を MIG-0724..MIG-0731 へ分割した。画面の実装は子 task）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0724..MIG-0731 / **Decisions:** D-05 DECIDED, D-15-15（admin 画面が呼ぶ MIG-0650〜0657 / 0660 を依存に追加）, D-13-56 DECIDED（2026-10-25: MIG-0605 の残りを MIG-0636〜0638 へ分割。admin 画面が呼ぶ 0635/0637/0638 を依存に追加）, D-14-14（0637 / 0638 の分割先 0642〜0648 を依存に追加）, D-16-5（admin の video 詳細の状態 form `AdminVideoStatusForm` は本 task）, D-16-13（`CostGuardBanner source="admin"` は MIG-0661 の `GET /api/admin-read/cost-guard-banner`）, D-17-1
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- CURRENT: `app/(admin)/**/page.tsx` 45件（`CURRENT_ROUTES.md` Admin 45）。部品は `src/components/admin/**`。
- 危険操作（spreadsheet 書き込み、X merge、audit restore、BAN）は strict audit と確認が必要（`server-actions/README.md`）。
#### Owned paths
- 新規・変更: なし（画面と部品は子 task が持つ）。Final audit の表は本 task の PR に置く
#### Micro-units
- U01〜U08（U08 の 45 route の sweep は本 task の Final audit に残す）: MIG-0724..MIG-0731（D-17-1）。
- **Final audit**: [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) の Final audit（CURRENT_ROUTES の全 route、担当外の拒否、Ops の独立 build と deep URL）を、子 task の merge 後の main で確かめる。
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
- **U02 router + guard**: `/manage`、`/manage/*`、`/admin`、`/admin/*` の route 枠（中身は「未移行」の空ページ。MIG-0704 / 0705 が埋める）。guard は RH-001 の応答で CURRENT の layout と同じ Location に `window.location.assign`（SPA 間は通常の navigation、D-05）。error boundary は `apps/app` の `AuthErrorView` と同じ文言。 RH-001 は CURRENT の `enrichmentFailed`（`src/lib/auth/requestAuthContext.ts:215-225`）を返さないので、D-17-3 の写像に従う: 503 `unavailable` と非 admin の `degraded: true` は両 SPA とも `/entry?error=auth_temporarily_unavailable`、admin の `degraded: true` は通す（degraded では `canAccessManage` が計算されない、`apps/api/src/routes/account/summary.ts:167-190`）。`summary.ts:221-232` の degraded（pending 申請の読みの失敗）は CURRENT では `enrichmentFailed` ではないので、その差を `DOCUMENTED DIFFERENCE D-17-3` として PR に書く。
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

### MIG-0719: Manage layout（ConsoleShell・sidebar・ManageActiveXNotice・CostGuardBanner・`apps/ops/wrangler.toml`、MIG-0704 U01 の残り）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — BLOCKED（D-17-1: MIG-0704 を 0719〜0723 へ分割。MIG-0707 の merge 後、かつ banner は MIG-0661 の merge 後に READY。sidebar の active X 警告は MIG-0663（navigation に 2 field を足す API、READY）を Merge gate にする。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0707, MIG-0624（DONE、manage read） / **Decisions:** D-05, D-14-3, D-15-13, D-16-1, D-16-2, D-16-4, D-16-13, D-17-1
- **Merge gate:** MIG-0661（D-16-13、`GET /api/operation-mode/banner` の実装。現在 apps/api に route 無し）、MIG-0663（D-17-2、navigation の `activeXUserId` / `manageStaffXUserIds`）
- **Verified against:** `08e7e8cc` (2026-10-27)

#### Source snapshot
- CURRENT layout: `app/(manage)/layout.tsx`（52 行）。guard は :29-34（未ログイン→`/entry`、enrichment 失敗→`/entry?error=auth_temporarily_unavailable`、admin でも manage でも無い→`/dashboard`）。DOM は `<div data-manage-shell data-fn-surface="manage">` :38、`<CostGuardBanner />` :39（公開 source。`(manage)` は admin ではないので引数なし）、`<PublicHeader user hydrateAccount />` :40、`<ConsoleShell consoleMode="manage" navigation={<ConsoleSidebar>}>` :41-、`<PublicFooter />`。robots noindex は `layout.tsx` の metadata。
- ConsoleShell: `src/components/layout/ConsoleShell.tsx:7-34`（class `manage-shell` / `fn-console-frame`、label「運営メニュー」、`ConsoleDrawer` に包む）。
- ConsoleSidebar（server component、DB 直読み）: `src/components/layout/ConsoleSidebar.tsx:72-120`。非表示条件 `!isAdmin && navigation.events.length === 0 && !authorization.canManageXIdLinkRequests` が `:98-104`。`warnActiveX` は `:106-108`（`shouldWarnManageActiveXMismatch(activeX, manageStaffXIds)`）。モード説明 banner `SidebarModeBanner` は `:34-66`（manage 文言 `:54-64`）。
- ManageSidebarNav（client）: `src/components/layout/ManageSidebarNav.tsx:107`（props `events` / `showXLinkRequests` / `warnActiveX` / `activeX`）。localStorage `flamenode:recent-manage-events` は `:119-122`（per-viewer の便利機能、SPA でも可）。`EventGroup` 「最近」「開催中・公開中」 `:265-266`。`/manage` link `:227`、`/manage/x-link-requests` link `:235-237`、`warnActiveX` の警告 `:218`。CSS は `@/components/admin/AdminSidebarNav.module.css` を import（`:13`、admin と共有）。
- ManageActiveXNotice: `src/components/layout/ManageActiveXNotice.tsx:11-31`。`role="status"`、文言 `:23-27`、判定 `:15`（`shouldWarnManageActiveXMismatch`）。
- CostGuardBanner: `src/components/layout/CostGuardBanner.tsx:9-41`（TONE の 4 mode の label / description / bg / border / color）、`:52` 本体、公開 source `:70-75`（`resolveCostGuardBannerSnapshot`、`src/lib/operationMode/publicMode.ts:108-117`、D1 を読まない）、`normal` は null `:77`、markup `:80-97`（`role="status"` `aria-live="polite"`、`fn-public-container` の中に label・description・`(理由: x)`）。CSS は `CostGuardBanner.module.css`（`:7`）。同 CSS は `src/components/layout/PublicDegradedBanner.tsx:3` からも使われる（Personal 側と共有）。
- Read API（ナビ）: `GET /api/manage/navigation` = `apps/api/src/routes/manage/navigation.ts:9`（401 `:11`、`manageGate` 403 `:14`、`access` / `events` / `truncated` を返す `:17-24`）。mount は `apps/api/src/routes/manage/index.ts:33`、認証は `index.ts:30-31`。DTO は `packages/contracts/src/manage/shared.ts:28-37`。`manageGate` は `apps/api/src/routes/manage/access.ts:215-218`（403 `{reason:"manage_access_required"}`）。
- Read API（banner）: `GET /api/operation-mode/banner`（MIG-0661、未実装。`apps/api/src` に route 無し。`PHASE_6_SPEC.md:2967-2971` の設計）。
- Write: この task に SA は無い。
- wrangler: `apps/ops/wrangler.toml` は main に無い。template は root の `wrangler.toml`（`name = "flamenode-web"` :1、`[assets]` :29-31、placeholder `database_id` :70、KV id :85）。`apps/app/wrangler.toml` は main に無い（D-14-3 の「同じ形」は当てにならない、D-17）。

#### Owned paths
- 新規: `+apps/ops/src/routes/manage/ManageShell.tsx`（layout 相当: `data-manage-shell`、CostGuardBanner、header/footer、ConsoleShell）, `+apps/ops/src/components/shared/{ConsoleShell,ConsoleDrawer,ConsolePageHeader,ManageSidebarNav,ManageActiveXNotice,CostGuardBanner,NotificationOutboxSummary}.tsx`（`NotificationOutboxSummary` は read のみ。`lib/notifications/display` の drizzle 部分は port せず、表示に要る pure 部分だけ）（`ConsoleSidebar` の server 部分は API 読みに置換し、ファイルは作らない）, `+apps/ops/src/lib/manage/sidebarEvents.ts`（1 行目 `// Port of CURRENT src/lib/manage/sidebarEvents.ts (MIG-0719). Same output.`。import `#utils/event-status-core` は `packages/domain` 側に同名があればそれを import）, `+apps/ops/src/api/manage.ts`（`getManageNavigation()`、`GET /api/manage/navigation`、`ManageNavigationResponseSchema` を `@flamenode/contracts` から import）, `+apps/ops/src/api/operationMode.ts`（1 行目 `// D-16-1 provisional: replace with @flamenode/contracts at merge`、`GET /api/operation-mode/banner`）, `+apps/ops/src/api/write.ts`（D-16-2 の `send()` と同じ中身。Manage の書き込みは全部これを使うので本 task が作る。D-17）, `+apps/ops/src/styles/`（下記 U03 の CSS port 3 件）, `+apps/ops/wrangler.toml`（D-14-3）, `+apps/ops/test/manageLayout.test.mjs`
- 変更: `apps/ops/src/routes/router.tsx`（`/manage` 系の layout wrapper を `ManageShell` に 1 行。MIG-0707 の枠を埋める）, `apps/ops/src/main.tsx`（CSS import 行）, `.github/workflows/migration-docs-check.yml`（`wrangler deploy --dry-run` の step 1 つ。MIG-0707 が同 file に足す Ops build の行の後）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(manage)/**`（移植元）, `src/components/**`（移植元）, `apps/api/**`（navigation / banner の API は MIG-0663 / MIG-0661 が作る）, `apps/app/**`, `apps/ops/src/routes/manage/**` の画面（0720〜0723）

#### Micro-units
- **U01 ナビとシェル**: `GET /api/manage/navigation`（navigation.ts:9）を読む。ConsoleShell / ConsoleDrawer / ConsolePageHeader / ManageSidebarNav を移植。非表示条件を `ConsoleSidebar.tsx:98-104` と同じにする（`access.isAdmin` が false、events 0 件、`access.canManageXIdLinkRequests` が false で非表示）。`/manage` と `/manage/x-link-requests` の link 条件は `ManageSidebarNav.tsx:227,235` と同じ。`warnActiveX` は navigation の `activeXUserId` / `manageStaffXUserIds`（MIG-0663、D-17-2）を `@flamenode/domain/video` の `shouldWarnManageActiveXMismatch`（`packages/domain/src/video/ownership.ts:206-214`）に渡す（再実装しない）。
- **U02 banner と通知**: CostGuardBanner を公開 source で移植（`GET /api/operation-mode/banner`、`{mode, reason}`。`normal` / fetch 失敗は null）。`ManageActiveXNotice` を shared に置く（0720 / 0721 / 0723 が import する。CURRENT `ManageActiveXNotice.tsx:11-31` と文言同じ）。merge は MIG-0661 の後（U02 の import 先を `packages/contracts/src/costGuardBanner.ts` に置き換える、D-16-1 の 5）。
- **U03 CSS**: 次の 3 つを port する。(a) `src/styles/admin-manage.css`（3928 行。`[data-manage-shell]` の selector が `:842`、`:1378`、`:1382` などにある。`globals.css:9` で import されている）の manage/console 部分、(b) `src/styles/admin-mobile.css`（647 行、`globals.css:10`）の console 部分、(c) `CostGuardBanner.module.css` と `AdminSidebarNav.module.css`（module）。(a)(b)(c) は admin（MIG-0705）と共有するので、先に merge した方が作り、後の方は import だけ（D-17）。
- **U04 wrangler**: `apps/ops/wrangler.toml` を root `wrangler.toml` の形（`[assets]`、`[observability]`、`[placement]`、binding の placeholder ID）で作る。OpenNext の `main`、`WORKER_SELF_REFERENCE`、queue producer は入れない。ID は `00000000-…` の placeholder（root `wrangler.toml:70,85` と同じ）。CI には `wrangler deploy --dry-run` だけを足す。本番の Worker・route・custom domain は作らない（D-14-3）。

#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | navigation の events 2 件（`start_time` 降順の API 順）で `/manage/events/:id` を開く | サイドバーに CURRENT と同じ順で 2 件。該当 event の link に `aria-current="page"`（ManageSidebarNav.tsx:50-54 と同じ判定） |
| T02 | 非 admin、events 0 件、`canManageXIdLinkRequests=false` | サイドバー全体が非表示（ConsoleSidebar.tsx:98-104） |
| T03 | 非 admin、events 0 件、`canManageXIdLinkRequests=true` | サイドバーは表示し、「X ID 連携申請」link のみ（ManageSidebarNav.tsx:235-237） |
| T04 | navigation の 401 / 403（`manage_access_required`） | サイドバーを出さず、画面は MIG-0707 の guard の Location（CURRENT layout.tsx:29-34）。例外を投げない |
| T05 | banner: `economy` / `read_only` / `static_only` / `maintenance` + reason | CURRENT と同じ label・description・`(理由: x)`（CostGuardBanner.tsx:9-41, :92-94） |
| T06 | banner: `normal` / fetch 失敗 / JSON 不正 | 何も出さない（CostGuardBanner.tsx:77 と同じ） |
| T07 | ManageActiveXNotice と sidebar の警告: active X と運営 X が不一致 / 一致 / active X 未選択 / 運営 X 0 件 | 不一致だけ `role="status"` と文言（ManageActiveXNotice.tsx:23-27）と sidebar の警告。他は null（`packages/domain/src/video/ownership.ts:206-214`） |
| T08 | `wrangler deploy --dry-run --config apps/ops/wrangler.toml`（CI） | placeholder ID のまま通る。実 ID・route を含まない |
| T09 | `rg "@/|next/" apps/ops/src` | 0 件 |

#### Commands
```bash
npm ci --no-audit --no-fund
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npx wrangler deploy --dry-run --config apps/ops/wrangler.toml
npm run check:project-docs
```

#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `app/(manage)/layout.tsx`、`src/components/layout/{ConsoleShell,ConsoleSidebar,ConsoleDrawer,ConsolePageHeader,ManageSidebarNav,ManageActiveXNotice,CostGuardBanner}.tsx` を IN_PROGRESS（移植先 `apps/ops/...`）。`src/styles/admin-manage.css` 行に Ops の移植先を追記（admin と共有、D-17）。`API_MATRIX.md` に `GET /api/manage/navigation` の SPA 呼び出し元。

#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T09 が PASS
- [ ] MIG-0661 が DONE、banner の client が `packages/contracts` の schema を使っている（D-16-1）
- [ ] wrangler の dry-run が CI で動く。本番の Worker / route / custom domain が無い
- [ ] browser 確認（390px / 1440px）が PR にある（サイドバーとシェルの折りたたみ）

#### STOP
- 警告の判定に navigation（MIG-0663 後）に無い値が要ると分かったら止める。
- banner のために D1 を読む必要が出たら止める（公開 source は D1 を読まない、publicMode.ts:108-117）。
- Ops の Worker / route / custom domain / 本番 ID を作る必要が出たら止める（明示承認事項、`PHASE_7_SPEC.md:447`（MIG-0707 の STOP）と同じ）。

#### Rollback
PR を revert（`apps/ops` は本番に配信されていない。MIG-0707 と同じ）。

### MIG-0720: Manage 入口・イベント概要・設定（edit）・登録者プレビュー（`/manage`、`/manage/events/[id]`、`.../edit`、`.../audience`、MIG-0704 U02）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — BLOCKED（D-17-1: MIG-0704 の U02 を分割。読みは MIG-0624 で DONE。書き込み（SA-021..024、SA-035）は契約先行で、merge は MIG-0652・MIG-0655 の DONE 後。MIG-0719 の shell を使う。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0707, MIG-0624（DONE）, MIG-0719 / **Decisions:** D-05, D-16-1, D-16-2, D-16-3, D-16-4, D-17-1
- **Merge gate:** MIG-0652（SA-021..024）、MIG-0655（SA-035）
- **Verified against:** `08e7e8cc` (2026-10-27)

#### Source snapshot
- CURRENT（4 ページ、計 1,336 行 + 共有部品）: `app/(manage)/manage/page.tsx`（439）、`app/(manage)/manage/events/[id]/page.tsx`（657）、`.../edit/page.tsx`（179）、`.../audience/page.tsx`（257）。
- 入口 `/manage`: `requireSession({next:"/manage"})` `page.tsx:46`。`ManageActiveXNotice`（非 admin）`:172-177`。ヘッダー link（通知センター `:183`、`canManageXLinks` のとき X ID 連携申請 `:186-190`）。空のとき（担当 0 件）の `EmptyState` は admin / 非 admin の分岐 `:142-165`。通知 `NotificationOutboxSummary` `:349`。
- 概要 `/manage/events/[id]`: `requireSession` `:81`、`notFound` `:88`、`:96`、`:100`。`ManageEventPageShell` `:252`（`showActiveXNotice` `:261`、`activeXUserId` `:262`、`manageStaffXUserIds` `:263`）。テンプレ化 section は admin 限定 `:436-440`（`SaveEventTemplateForm` `:440`）。`NotificationOutboxSummary` `:582`。
- 設定 `/manage/events/[id]/edit`: `requireSession` `:35`、`notFound` `:42`、`:47`、`:69`。`canManageBasic/Publish/Questions/Slots`（`canEditEventFromSnapshot`）`:55-62`。`ManageEventPageShell` `:77`（`showActiveXNotice={!isAdmin}` `:86`）。`EventForm` `:102`（update のみ、create は manage では使わない）。危険操作は admin 限定 `:154-172`（`RenameEventIdForm` `:165`、`DeleteEventForm` `:172`、文言は「非公開化」）。
- 登録者プレビュー `/manage/events/[id]/audience`: `requireSession` `:47`、`notFound` `:54`、`:63`、`:68`（`permissions.size === 0` かつ非 admin）。`ManageEventPageShell` `:187`。`ManageXIcon` `:226`。
- 共有 shell: `src/components/manage/ManageEventPageShell.tsx:28-70`（`ManageActiveXNotice` `:46-51`、`ConsolePageHeader` `:52-61`、`ManageEventTabs` `:62-66`）、`src/components/manage/ManageEventTabs.tsx:57-181`（`resolveManageEventNav` `src/lib/manage/eventNavigation.ts` が pure、`:67-72`。tab 4 つ `:22-55`、content 副 tab `:123-147`、settings 副 tab `:149-173`）、`src/components/manage/ManageEventMoreMenu.tsx`（`/manage/notifications?event=` `:26-30`、`/event/:id` `:31`。admin 向け `/admin/videos`・`/admin/audit`・`/admin/notifications` `:37-68`、D-17）、`src/components/manage/ManageXIcon.tsx`（42 行）。
- 部品（admin と共有、D-17）: `src/components/admin/EventForm.tsx`（`createEvent` / `updateEvent` を `:8`、呼び出し `:602`。子: `PermissionKeysField`、`YoutubeDescriptionTemplateEditor`、`EventSettingsPreview`、`EventCustomQuestionsEditor`、`lib/video/formSettings`、`lib/event/eventLimits`、`lib/event/generalCustomQuestionDraft`、`lib/video/customQuestions`、`lib/utils/eventStatus`（drizzle を import、`eventStatusCore` を使う）、`lib/interactions/useFormDraft`、`useUnsavedChangesGuard`、`lib/slots/limits`、`lib/video/requiredVideoFields`、`lib/event/youtubeDescriptionTemplate`）、`src/components/admin/DeleteEventForm.tsx`（`deleteEvent` `:42`、button 文言 `:99`）、`src/components/admin/RenameEventIdForm.tsx`（`renameEventId` `:24`）、`src/components/admin/SaveEventTemplateForm.tsx`（`saveEventAsTemplate` `:29`）、`src/components/notifications/NotificationOutboxSummary.tsx`（read のみ）。
- Read API: 入口 `GET /api/manage` = `apps/api/src/routes/manage/dashboard.ts:13`（gate `:18-20`、`activeXUserId` / `manageStaffXUserIds` `:38-39`）。概要 `GET /api/manage/events/:id` = `overview.ts:51`（404 `:61`、`:147`、`:163`、`activeXUserId` / `manageStaffXUserIds` `:168-169`）。設定 `GET /api/manage/events/:id/edit` = `eventEdit.ts:82`（404 `:99`、`:140`、`:170-171`）。登録者 `GET /api/manage/events/:id/audience` = `audience.ts:27`（404 `:36`、`:76`）。mount は `index.ts:37-44`。
- Write: SA-021 `renameEventId`（`src/lib/actions/event-admin-danger.ts:99`、MIG-0652 / admin のみ）、SA-023 `updateEvent`（`event-admin.ts:553`、MIG-0652、guard `manage_event_update`）、SA-024 `deleteEvent`（`event-admin.ts:1096`、MIG-0652、admin のみ、`manage_event_archive` `:1099`）、SA-035 `saveEventAsTemplate`（`event-template-admin.ts:51`、MIG-0655、admin のみ）。SA-022 `createEvent` は manage の画面からは呼ばれない（`EventForm.tsx:602` は create 分岐を持つが manage の edit は update のみ）。

#### Owned paths
- 新規: `+apps/ops/src/routes/manage/{ManageIndex,EventOverview,EventEdit,EventAudience}.tsx`, `+apps/ops/src/components/manage/{ManageEventPageShell,ManageEventTabs,ManageEventMoreMenu,ManageXIcon}.tsx`, `+apps/ops/src/lib/manage/eventNavigation.ts`（pure、1 行目 `// Port of CURRENT src/lib/manage/eventNavigation.ts (MIG-0720). Same output.`）, `+apps/ops/src/api/manageEvents.ts`（読み 4 本）, `+apps/ops/src/api/eventAdmin.ts`（SA-021..024 と SA-035 の client。1 行目は `// D-16-1 provisional: replace with @flamenode/contracts at merge`）, `+apps/ops/src/components/shared/{EventForm,PermissionKeysField,YoutubeDescriptionTemplateEditor,EventSettingsPreview,EventCustomQuestionsEditor,DeleteEventForm,RenameEventIdForm,SaveEventTemplateForm}.tsx`（admin（MIG-0705）と共有、先に merge した方が作る。D-17）, `+apps/ops/test/manageEvents.test.mjs`
- 変更: `apps/ops/src/routes/router.tsx`（`/manage`、`/manage/events/:id`、`.../edit`、`.../audience` の 4 行）, `docs/migration/FILE_MIGRATION_MATRIX.md`（CSS は MIG-0719 U03 の共有 file で足りる。main.tsx は触らない）
- 触らない: `app/(manage)/**`, `src/components/**`（移植元）, `apps/api/**`, MIG-0719 の shell（import だけ）

#### Micro-units
- **U01 入口と共有 shell**: `GET /api/manage` を読む（dashboard.ts:13）。`ManageEventPageShell`、`ManageEventTabs`、`ManageEventMoreMenu`、`ManageXIcon`、`lib/manage/eventNavigation.ts` を移植（ManageEventTabs.tsx の tab 4 つと副 tab の link は CURRENT と同じ href）。入口の KPI・空状態（`ManagePageHeader` の link、担当 0 件の文言）を CURRENT と同じに。
- **U02 概要の読みとテンプレ化**: `GET /api/manage/events/:id` を読む（overview.ts:51）。`ManageEventPageShell` の `showActiveXNotice`（非 admin）。テンプレ化 section は admin 限定（page.tsx:436）で `SaveEventTemplateForm`（SA-035、MIG-0655 の client）。通知 `NotificationOutboxSummary`。
- **U03 設定の読みと書き込み**: `GET /api/manage/events/:id/edit` を読む（eventEdit.ts:82）。`EventForm` は update のみ（SA-023）。危険操作は admin 限定（edit/page.tsx:154）で `RenameEventIdForm`（SA-021）と `DeleteEventForm`（SA-024）。`write.ts` は MIG-0719 U04 で作られているので import だけ（D-17）。
- **U04 登録者プレビュー（読みのみ）**: `GET /api/manage/events/:id/audience` を読む（audience.ts:27）。`FnTable` は `components/ui` を使うが、Ops では `packages/ui` の既存 UI を使うか MIG-0719 の shared と揃える（D-17）。表の行、`ManageXIcon`、空状態（`EmptyState`）を CURRENT と同じに。

#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 担当 0 件の `/manage`（非 admin） | CURRENT の非 admin 文言（manage/page.tsx:144-148） |
| T02 | 非 admin で active X と運営 X が不一致の `/manage` | `role="status"` の notice（manage/page.tsx:172-177、ManageActiveXNotice.tsx:23-27） |
| T03 | 担当外の `/manage/events/:id`（`manageableEventIds` に無い） | 404（overview.ts:61、page.tsx:96） |
| T04 | tab の active 判定（`/videos?status=pending` / `videos?status=all` / `edit`）と副 tab の表示 | CURRENT と同じ `aria-current` と href（ManageEventTabs.tsx:84-173） |
| T05 | 非 admin で `/manage/events/:id/edit` | 危険操作 section が無い（edit/page.tsx:154）。admin は 2 つ表示（:165, :172） |
| T06 | `EventForm` の保存成功 / `{ok:false, message}` / reject | 成功で読み直し（D-16-3 の `refreshKey`）、失敗は CURRENT の文言。前の data を消さない |
| T07 | `DeleteEventForm` の確認 | 確認文字列（event id）が一致しないと送らない（`deleteEvent` は `confirm !== eventId` で拒否、event-admin.ts:1106）。文言は CURRENT（「非公開化」） |
| T08 | 担当外（permissions 0）の `/manage/events/:id/audience` | 404（audience/page.tsx:68、audience.ts:36） |
| T09 | `rg "@/|next/" apps/ops/src/routes/manage apps/ops/src/components/manage` | 0 件 |

#### Commands
```bash
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```

#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `app/(manage)/manage/page.tsx`、`.../events/[id]/page.tsx`、`.../edit/page.tsx`、`.../audience/page.tsx` と、admin と共有する部品の各行を IN_PROGRESS（移植先）。`API_MATRIX.md` の SA-021 / 022（呼ばない）/ 023 / 024 / 035 に SPA の呼び出し元（D-17）。

#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T09 が PASS
- [ ] MIG-0652（SA-021..024）と MIG-0655（SA-035）が DONE で、client が `packages/contracts` の schema を使っている（D-16-1）
- [ ] 書き込みは `write.ts` の `send()` を通る（D-16-2）
- [ ] browser 確認（390px / 1440px）が PR にある

#### STOP
- 権限の可否（`canEditEventFromSnapshot` の section 判定）を SPA 側で決める必要が出たら止める（API の読みが正）。
- SA-024 の挙動（非公開化。行を消さない）が API 側の契約と違うと分かったら止める（D-17-9）。
- 担当外の判定や owner の保護を SPA で決める必要が出たら止める（Hono が正、MIG-0633 の core）。

#### Rollback
PR を revert（Ops は本番に配信されない）。admin と共有する shared 部品は別 PR に分けてもよい（R-UI と同じ扱い）。

### MIG-0721: イベントの枠（`.../slots`）と運営メンバー（`.../staff`、owner 0 件 guard・CAS、MIG-0704 U03）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — BLOCKED（D-17-1: MIG-0704 の U03 を分割。読みは MIG-0624 で DONE。書き込み（SA-031..034、SA-056..064）は契約先行で、merge は MIG-0654・MIG-0656 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0707, MIG-0624（DONE）, MIG-0720（`ManageEventPageShell` / `ManageEventTabs`）/ **Decisions:** D-05, D-15-4, D-16-1, D-16-2, D-16-3, D-16-4, D-17-1
- **Merge gate:** MIG-0654（SA-031..034）、MIG-0656（SA-056..064）
- **Verified against:** `08e7e8cc` (2026-10-27)

#### Source snapshot
- CURRENT: `app/(manage)/manage/events/[id]/slots/page.tsx`（198 行）、`.../staff/page.tsx`（187 行）。
- 枠: `requireSession` `slots/page.tsx:59`、`notFound` `:64`、`:67`。`canEditSlots = canEditEventFromSnapshot(…, "event.slots")` `:74-78`、無ければ `notFound` `:79-80`。`ManageEventPageShell` `:131`。`SlotBatchForm` `:163`、`SlotList` `:186`（`canManageSubmittedSlots={canEditSlots}` `:192`）。
- 運営メンバー: `requireSession` `staff/page.tsx:41`、`notFound` `:47`、`:56`、`:61`（非 admin で権限 0 件）。`canManageMembers = isAdmin || has("event.members")` `:62-63`。`ManageEventPageShell` `:120`。`SummaryCard`（代表者 / 登録メンバー / 公開メンバー / 承認済み X 名義）`:137-140`。`EventStaffManager` `:145`（`canManageMembers` のとき）、`EventStaffReadOnlyList` `:162`（閲覧のみ文言は `:160`、section 全体 `:156-170`）。
- 枠の部品（admin と共有）: `src/components/admin/SlotBatchForm.tsx`（`generateSlotsBatch` `:47`、`deleteAvailableSlots` `:66`、上限 `MAX_SLOT_BATCH_GENERATE_COUNT`（`lib/slots/atomicLimits`）を `:12` で import、文言 `:148`）、`src/components/admin/SlotList.tsx`（`releaseSubmittedVideoKeepReservation` / `forceReleaseSubmittedSlot` `:455-457`、`releaseSlot` / `deleteSlot` `:459`、`batchUpdateSlotLabels` `:466`、`batchReleaseReservedSlots` `:468`、`batchDeleteAvailableSlots` `:470`、`ConfirmDialog` 使用、`TableScroll`）。
- 運営メンバーの部品（admin と共有）: `src/components/admin/EventStaffManager.tsx`（`upsertEventStaffMember` `:364`、`:551`、`removeEventStaffMember` `:503`、`transferEventOwnershipAction` `:638`、`bulkUpsertEventStaffFromCsv` `:729`、`ownerCount` `:139`、`isLastOwner` `:349`、preset select の disabled `:392`、「最後の代表者は削除・降格できません」`:436`、削除時の文言 `:474`、代表者 section `:627-628`）、`src/components/admin/EventStaffReadOnlyList.tsx`（`ManageXIcon`、`PRESET_DEFINITIONS`）。
- Read API: 枠 `GET /api/manage/events/:id/slots` = `apps/api/src/routes/manage/slots.ts:55`（404 `:66`（`canEditEvent(...,"event.slots")`）、`:101`、`:122`）。運営メンバー `GET /api/manage/events/:id/staff` = `staff.ts:40`（404 `:51`、`:74`、`:107`）。
- Write（SA）: SA-056 `forceReleaseSubmittedSlot`（`slot-admin-danger.ts:236`）、SA-057 `releaseSubmittedVideoKeepReservation`（`:484`）、SA-058 `generateSlotsBatch`（`slot-admin.ts:262`）、SA-059 `deleteAvailableSlots`（`:398`）、SA-060 `releaseSlot`、SA-061 `deleteSlot`、SA-062 `batchDeleteAvailableSlots`、SA-063 `batchReleaseReservedSlots`、SA-064 `batchUpdateSlotLabels`（すべて `slot-admin.ts`、MIG-0656）。SA-031 `upsertEventStaffMember`（`event-staff-admin.ts:303`）、SA-032 `bulkUpsertEventStaffFromCsv`（`:467`）、SA-033 `removeEventStaffMember`（`:669`）、SA-034 `transferEventOwnershipAction`（`:723`、MIG-0654）。
- owner 0 件 guard / CAS の正本: `packages/server-core/src/event/eventOwnership.ts:58-73`（`remainingOperableEventOwnerSql`）、`:383-411`（既存 owner の降格・削除の `ownerCondition` を UPDATE の WHERE に入れ、`expectedMutationChanges` で 1 件を確かめる）、`:454-466`（削除側）。`src/lib/actions/event-staff-admin.ts:357-371`（owner 付与時の検査）、`:496`、`:568`。

#### Owned paths
- 新規: `+apps/ops/src/routes/manage/{EventSlots,EventStaff}.tsx`, `+apps/ops/src/api/slotAdmin.ts`（SA-056..064 の client、provisional comment）, `+apps/ops/src/api/eventStaff.ts`（SA-031..034 の client、provisional comment）, `+apps/ops/src/components/shared/{SlotBatchForm,SlotList,EventStaffManager,EventStaffReadOnlyList}.tsx`（admin と共有、先に merge した方が作る。D-17）, `+apps/ops/src/lib/slots/`（CURRENT `src/lib/utils/slotGrouping.ts` が import する pure だけ、`slotGroupingCore` を含む。1 行目 `// Port of CURRENT <path> (MIG-0721). Same output.`）, `+apps/ops/test/eventSlotsStaff.test.mjs`
- 変更: `apps/ops/src/routes/router.tsx`（2 行）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(manage)/**`, `src/components/**`, `apps/api/**`, `packages/server-core/**`（owner の正本、変えない）

#### Micro-units
- **U01 枠の読み**: `GET /api/manage/events/:id/slots`（slots.ts:55）。`canEditSlots`（`event.slots`）が無ければ 404 の表示（slots/page.tsx:79-80）。`SlotList` の表示部分（`buildSlotParts` / `resolveSlotPartDisplayLabel` は `lib/utils/slotGrouping` の pure port）。
- **U02 枠の書き込み**: `SlotBatchForm` の生成と削除（SA-058 / SA-059）、`SlotList` の個別・一括操作（SA-056..057、SA-060..064）。確認は `ConfirmDialog`（CURRENT の文言）。結果の `{ok,message}` を表示し、成功で読み直す（D-16-3）。
- **U03 運営メンバーの読み**: `GET /api/manage/events/:id/staff`（staff.ts:40）。`SummaryCard` 4 つ、`canManageMembers` で `EventStaffManager` か `EventStaffReadOnlyList`（閲覧のみ文言 page:160）。
- **U04 運営メンバーの書き込み**: SA-031..034 を `eventStaff.ts` 経由で送る。owner の表示・disabled・文言（EventStaffManager.tsx:139, :349, :392, :436, :474）を CURRENT と同じに。CSV の一括登録（SA-032、:729）。サーバーの判定（owner 0 件、CAS）は core の結果だけを表示する。

#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `event.slots` 権限が無い `/manage/events/:id/slots` | 404（slots/page.tsx:79-80、slots.ts:66） |
| T02 | 枠の一括生成で上限（`MAX_SLOT_BATCH_GENERATE_COUNT`）ちょうど / 超え | CURRENT と同じ表示。超えは送らない（SlotBatchForm.tsx の上限検査） |
| T03 | 予約済み枠の強制解放（SA-056）と予約を残す解放（SA-057） | 確認ダイアログを経てから送る。CURRENT の文言と同じ（SlotList.tsx:455-457） |
| T04 | `event.members` が無い（閲覧のみ）`/manage/events/:id/staff` | `EventStaffReadOnlyList` と「閲覧のみ」文言（staff/page.tsx:150-170）。送信 UI は出ない |
| T05 | 最後の代表者の削除・降格・preset 変更（SA-033 / SA-031） | UI は disabled と文言（EventStaffManager.tsx:349, :392, :436, :474）。直接送っても core が拒否（eventOwnership.ts:383-411）。owner 1 件のとき 1 件だけ残る（同時 2 件送信でも 0 件にならない、CAS） |
| T06 | 担当外（staff の権限 0 件）の `/manage/events/:id/staff` | 404（staff/page.tsx:61、staff.ts:51） |
| T07 | `{ok:false, message}` / reject | CURRENT の文言。前の data を消さない（D-16-3） |
| T08 | `rg "@/|next/" apps/ops/src/routes/manage apps/ops/src/components/shared` | 0 件 |

#### Commands
```bash
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:event-owners
npm run check:slot-domain-limits
```

#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `.../slots/page.tsx`、`.../staff/page.tsx`、`SlotBatchForm.tsx`、`SlotList.tsx`、`EventStaffManager.tsx`、`EventStaffReadOnlyList.tsx` 行を IN_PROGRESS（移植先）。`API_MATRIX.md` の SA-031..034、SA-056..064 に SPA の呼び出し元。

#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T08 が PASS
- [ ] MIG-0654 と MIG-0656 が DONE で、client が `packages/contracts` の schema を使っている（D-16-1）
- [ ] 最後の owner の拒否は、UI の disabled だけでなく API の拒否で確かめている（T05）

#### STOP
- owner 0 件の判定や CAS を SPA 側で決める必要が出たら止める（core が正、MIG-0633）。
- 枠の予約の transaction 境界に触る必要が出たら止める（MIG-0604 の STOP と同じ）。

#### Rollback
PR を revert（Ops は本番に配信されない）。

### MIG-0722: 作品・審査（`.../videos`、`.../videos/[videoId]`、`.../youtube-playlist`、`.../review` の互換 redirect、MIG-0704 U04）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — BLOCKED（D-17-1: MIG-0704 の U04 を分割。読みは MIG-0624 で DONE。審査の書き込み（SA-040..042）は MIG-0603 U02c、playlist の書き込み（SA-038/039）は MIG-0655 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0707, MIG-0624（DONE）, MIG-0719（`write.ts`）, MIG-0720（`ManageEventPageShell` / `ManageEventTabs`）/ **Decisions:** D-05, D-16-1, D-16-3, D-16-4, D-16-5, D-17-1
- **Merge gate:** MIG-0603（SA-040..042、`POST /api/manage/events/:eventId/videos/:videoId/status` は MIG-0603 U02c、PHASE_6_SPEC.md:213）、MIG-0655（SA-038 / SA-039）
- **Verified against:** `08e7e8cc` (2026-10-27)

#### Source snapshot
- CURRENT: `app/(manage)/manage/events/[id]/videos/page.tsx`（218）、`.../videos/[videoId]/page.tsx`（138）、`.../youtube-playlist/page.tsx`（361）、`.../review/page.tsx`（13）。
- 一覧: `requireSession` `videos/page.tsx:75`、`notFound` `:82`、`:90`（`canAccessManageEventFromSnapshot`）、`:92`。既定の status は `review`（`:68`）、`normalizeVideoVisibilityFilter(statusRaw,"review")` `:69`。`canApproveVideoStatus = canEditEventFromSnapshot(…,"video.status")` `:87-89`。`ManageEventPageShell` `:150`、フィルタ nav `:160-175`（`status=<value>` link）、`VideoReviewQueueTable` `:204`（`quickApproveAction={approveManageVideoPublic}` `:212`）。
- 詳細: `requireSession` `[videoId]/page.tsx:42`、`notFound` `:49`、`:56`（担当外）、`:58`（event なし）、`:61`（video なし）。`canReview = canEditEventFromSnapshot(…)` `:65`。`VideoReviewDetailPanel` `:83`、審査操作 `:86-94`（`VideoApproveActions`、`approveAction={approveManageVideoPublic}` `:93`、`approveAndNextAction={approveManageVideoPublicAndNext}` `:94`）、`ManageVideoStatusForm` `:97`。
- playlist: `requireSession` `youtube-playlist/page.tsx:106`、`notFound` `:112`、`:121`（`canAccessManageEventFromSnapshot`）、`:123`。`canEdit` `:125`。`ManageEventPageShell` `:191`（`showActiveXNotice` `:200`、`activeXUserId` `:201`、`manageStaffXUserIds` `:202`）。保存 `<form action={saveEventYoutubePlaylistSettings}>` `:228`（input の disabled `:237, :248, :261`、`canEdit` `:280`）。同期 `<form action={queueEventYoutubePlaylistSync}>` `:336`（`canEdit && config.enabled === 1` `:334`）。
- review: `review/page.tsx:12` が `redirect("/manage/events/${id}/videos?status=pending")`（Next の既定の redirect。SPA は replace の Navigate）。
- 部品: `src/components/admin/VideoReviewQueueTable.tsx`（`VideoReviewQuickApproveButton` `:11`、`VideoVisibilityBadge` の label は `lib/admin/videoVisibilityLabels`）、`src/components/admin/VideoReviewQuickApproveButton.tsx`（`useRouter`、`action(fd)` `:52`）、`src/components/admin/VideoReviewDetailPanel.tsx`（`VideoReviewDetail` 型 `lib/admin/videoReviewDetail`、`youtubeWatchUrl`、css module `:8`）、`src/components/video/VideoApproveActions.tsx`（`approveAction` / `approveAndNextAction` props `:23-24`）、`src/components/video/VideoStatusForm.tsx`（`ManageVideoStatusForm` `:91-127`、`setManageVideoStatus` `:8`、`MANAGE_STATUS_VALUES = ["pending","public","private"]` `:51`、`router.refresh()` `:223, :229, :241`）。
- Read API: 一覧 `GET /api/manage/events/:id/videos?status=`= `apps/api/src/routes/manage/videos.ts:48`（`normalizeFilter` `:26-31`、既定 review `:27`、404 `:59`、`:82`）。詳細 `GET /api/manage/events/:id/videos/:videoId` = `videoDetail.ts:64`（404 `:73`、`:119`、`:121`）。playlist `GET /api/manage/events/:id/youtube-playlist` = `playlist.ts:64`（404 `:72`、`:107`、`activeXUserId` / `manageStaffXUserIds` `:125-126`）。
- Write: SA-040 `approveManageVideoPublic`（`src/lib/actions/manage-video.ts:58`、一覧の quick approve と詳細）、SA-041 `approveManageVideoPublicAndNext`（`:65`、詳細）、SA-042 `setManageVideoStatus`（`:73`、詳細の状態 form、D-16-5）。`canEditEvent(…,"video.status")` が判定（PHASE_6_SPEC.md:196）。SA-038 `saveEventYoutubePlaylistSettings`、SA-039 `queueEventYoutubePlaylistSync`（`src/lib/actions/event-youtube-playlist.ts`、MIG-0655）。

#### Owned paths
- 新規: `+apps/ops/src/routes/manage/{EventVideos,EventVideoDetail,EventYoutubePlaylist,EventReviewRedirect}.tsx`, `+apps/ops/src/api/manageVideos.ts`（SA-040..042 の client、provisional comment）, `+apps/ops/src/api/youtubePlaylist.ts`（SA-038/039、provisional comment）, `+apps/ops/src/components/shared/{VideoReviewQueueTable,VideoReviewQuickApproveButton,VideoReviewDetailPanel,VideoApproveActions,VideoStatusForm}.tsx`（admin と共有、先に merge した方が作る。D-17）, `+apps/ops/src/components/manage/YoutubePlaylistSettings.tsx`（playlist の表示と form。CSS は ManageEventPageShell の既存 class）, `+apps/ops/src/lib/admin/videoVisibilityLabels.ts`（pure port、1 行目 `// Port of CURRENT src/lib/admin/videoVisibilityLabels.ts (MIG-0722). Same output.`）, `+apps/ops/test/manageVideos.test.mjs`
- 変更: `apps/ops/src/routes/router.tsx`（4 行: `videos`、`videos/:videoId`、`youtube-playlist`、`review`）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(manage)/**`, `src/components/**`, `apps/api/**`, `src/lib/actions/manage-video.ts`（移植元）
- 注意: `src/lib/admin/videoReviewQueueOrder.ts` は `@/lib/db/client` を import している（DB 依存）。一覧の並べ順は API の結果を使い、この module は port しない（STOP 参照）。

#### Micro-units
- **U01 作品一覧（読みと quick approve）**: `GET /api/manage/events/:id/videos?status=`（videos.ts:48）。既定 `review`、`all` は全件（videos.ts:27-29、ManageEventTabs.tsx:46）。フィルタ nav の link と `aria-current` は CURRENT と同じ（videos/page.tsx:160-175）。quick approve は SA-040 を `write.ts` で送り、成功で読み直す（D-16-3）。
- **U02 作品詳細と審査**: `GET /api/manage/events/:id/videos/:videoId`（videoDetail.ts:64）。`VideoReviewDetailPanel` の表示、`canReview` のときだけ `VideoApproveActions`（SA-040/041）と `ManageVideoStatusForm`（SA-042、D-16-5）。`router.refresh` は `refreshKey` に置き換える（VideoStatusForm.tsx:223-241）。
- **U03 YouTube 再生リスト**: `GET /api/manage/events/:id/youtube-playlist`（playlist.ts:64）。保存（SA-038、page:228）と同期（SA-039、page:336）。`canEdit` で disabled（page:237, :248, :261）、同期 form は `canEdit && enabled === 1` のときだけ（page:334）。
- **U04 互換 redirect と深い URL の確認**: `/manage/events/:id/review` を `/manage/events/:id/videos?status=pending` へ replace で移す（review/page.tsx:12）。`ManageEventTabs` の「対応待ち」は `videos?status=pending`（ManageEventTabs.tsx:38-39）。deep-link（`videos?status=pending` / `all` / 未指定 / 不正な値）を試験する。

#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `/manage/events/:id/review` を開く | `/manage/events/:id/videos?status=pending` へ置き換わる（review/page.tsx:12、MIG-0704 T04） |
| T02 | `/videos`（status 無し）/ `status=all` / `status=pending` / `status=abc`（不正） | 既定と不正値は審査待ち（videos.ts:26-31、page:69）。`all` は全件。`pending` は審査待ち |
| T03 | 担当外の event の `/videos`、`/videos/:videoId` | 404（videos/page.tsx:90、[videoId]/page.tsx:56、videoDetail.ts:73） |
| T04 | event に紐付かない video の詳細 | 404（videoDetail.ts:119-121、videoDetail.ts:12 の注釈） |
| T05 | `video.status` 権限が無い（canReview=false）の詳細 | 審査 UI が出ない（page:65-88）。一覧の quick approve も出ない（videos/page.tsx:87-89） |
| T06 | SA-040 / 041 / 042 の成功・`{ok:false,message}` | CURRENT の文言、成功で読み直し（D-16-3）。`pending/public/private` の 3 値だけを選べる（VideoStatusForm.tsx:51） |
| T07 | playlist の保存（SA-038）と同期（SA-039） | `canEdit=false` は入力 disabled と同期 form 非表示（page:237-261、:334）。保存 body は CURRENT の FormData の key と同じ |
| T08 | `rg "@/|next/" apps/ops/src/routes/manage apps/ops/src/components/shared` | 0 件 |

#### Commands
```bash
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```

#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `.../videos/page.tsx`、`.../videos/[videoId]/page.tsx`、`.../youtube-playlist/page.tsx`、`.../review/page.tsx`、`VideoStatusForm.tsx`（`ManageVideoStatusForm` の行）、`VideoReviewQueueTable.tsx`、`VideoApproveActions.tsx` を IN_PROGRESS（移植先）。`API_MATRIX.md` の SA-038..042 に SPA の呼び出し元。

#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T08 が PASS
- [ ] MIG-0603（U02c）と MIG-0655 が DONE で、client が `packages/contracts` の schema を使っている（D-16-1）
- [ ] review の redirect と deep-link（T01、T02）が browser で確認されている

#### STOP
- 審査の可否（`video.status` / `canEditEvent`）を SPA 側で決める必要が出たら止める（API が正、MIG-0633）。
- 一覧の並べ順を client で決める必要が出たら止める（`videoReviewQueueOrder` は DB 依存。API の順を使う）。
- SA-040..042 の API 契約（`POST …/status`）が CURRENT の FormData key と違うと分かったら止めて MIG-0603 に返す。

#### Rollback
PR を revert（Ops は本番に配信されない）。

### MIG-0723: 通知センター（`/manage/notifications`）と X ID 連携申請（`/manage/x-link-requests`、MIG-0704 U05）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — BLOCKED（D-17-1: MIG-0704 の U05 を分割。読みは MIG-0624 で DONE。X ID 連携申請の承認・却下（SA-090/091）は MIG-0605 U05x の DONE 後に merge。通知の読みは gate なしで進められるが、task 単位の gate に従う（D-17）。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0707, MIG-0624（DONE）, MIG-0719（`ManageActiveXNotice`、`write.ts`）/ **Decisions:** D-05, D-16-1, D-16-2, D-16-3, D-16-4, D-17-1
- **Merge gate:** MIG-0605（U05x、`POST /api/xid/link-requests/:requestId/approve` と `/reject`、MIG-0605 の Owned、PHASE_6_SPEC.md:326-334）
- **Verified against:** `08e7e8cc` (2026-10-27)

#### Source snapshot
- CURRENT 通知: `app/(manage)/manage/notifications/page.tsx`（304 行）。`requireSession({next:"/manage/notifications"})` `:62-63`、`notFound` `:79`、admin 判定 `:81`、閲覧可能 event `:93-98`、`?event=` が担当外なら `notFound` `:108-113`。フィルタは `<form method="get">` `:216`、`AutoSubmitSelect` 3 つ `:217, :229, :240`（GET のみ自動 submit、`src/components/forms/AutoSubmitSelect.tsx:22-24`）。`ManageActiveXNotice` `:185-187`。`NotificationOutboxSummary` `:274`（read のみ）。admin 向けの文言 `:207`。
- CURRENT X 連携申請: `app/(manage)/manage/x-link-requests/page.tsx`（97 行）。`requireSession` `:20-21`、`notFound` `:23`、`canManageXIdLinkRequests` 無しで `notFound` `:28`。`ManagePageHeader` `:85`（title「X ID 申請」`:86`）。`XLinkRequestTable` を使う。
- 部品: `src/components/admin/XLinkRequestTable.tsx`（`approveXIdLinkRequest` / `rejectXIdLinkRequest` `:5`、承認 `run(approveXIdLinkRequest, r.id)` `:249`、却下 `run(rejectXIdLinkRequest, r.id, reason)` `:288`、`ManageXIcon` `:8`、`formatUnix` `:6`）。`enrichXLinkPendingRows`（`src/lib/admin/enrichXLinkPendingRows.ts`、server 側で行を作る。SPA は API の行を使う）。`ConsolePageHeader`（layout）。
- Read API: 通知 `GET /api/manage/notifications` = `apps/api/src/routes/manage/notificationCenter.ts:25`（404 `:37`、`manageManageableEventIds` 判定 `:17`、`manageStaffXUserIds` / `activeXUserId` `:76-77`、`:87`）。X 連携申請 `GET /api/manage/x-link-requests` = `xlink.ts:51`（404 `:58`、`:117`）。
- Write（SA）: SA-090 `approveXIdLinkRequest`（`src/lib/actions/xid-admin.ts`、CURRENT `:78` は `writeGuard({ feature: "xid_links" })`。Hono 側は PHASE_6_SPEC.md:334 の `writeGuardMiddleware`、MIG-0605 U05x）、SA-091 `rejectXIdLinkRequest`（同）。通知に write は無い（`notification-admin.ts` の SA-045..048 は admin 側 `NotificationActionButton` と `NotificationCancelButton` でだけ使われ、manage 画面からは呼ばれない）。

#### Owned paths
- 新規: `+apps/ops/src/routes/manage/{EventNotifications,XLinkRequests}.tsx`（通知は `ManageNotifications.tsx` でもよい。名前は lead が決める）, `+apps/ops/src/api/manageNotifications.ts`（読みのみ）, `+apps/ops/src/api/xidAdmin.ts`（SA-090/091 の client、1 行目 `// D-16-1 provisional: replace with @flamenode/contracts at merge`）, `+apps/ops/src/components/shared/XLinkRequestTable.tsx`（admin と共有。先に merge した方が作る。D-17）。`NotificationOutboxSummary` は MIG-0719 の shared を import（重複させない）, `+apps/ops/test/manageNotifications.test.mjs`, `+apps/ops/test/xLinkRequests.test.mjs`
- 変更: `apps/ops/src/routes/router.tsx`（2 行）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(manage)/**`, `src/components/**`, `apps/api/**`, `packages/server-core/**`

#### Micro-units
- **U01 通知の読み**: `GET /api/manage/notifications`（notificationCenter.ts:25）。フィルタ（GET、`AutoSubmitSelect` の形）と `NotificationOutboxSummary` の表示。`ManageActiveXNotice`（MIG-0719 の shared）を page の上に置く（page.tsx:185-187）。
- **U02 通知の担当スコープと X 連携申請の読み**: `?event=` が担当外なら 404（notifications/page.tsx:108-113、notificationCenter.ts:37）。admin は全 event（page.tsx:93-98）。`/manage/x-link-requests` の読み（xlink.ts:51）と `ConsolePageHeader`、`XLinkRequestTable` の表示部分（approve / reject の UI は U03 まで出さない）。
- **U03 承認と却下（SA-090 / 091）**: `xidAdmin.ts` 経由で送る。却下の理由入力（XLinkRequestTable.tsx:288 の `rejectReason`）。`{ok,message}` の表示と成功後の読み直し（D-16-3）。
- **U04 最終確認（Manage 12 の棚卸し）**: `app/(manage)/manage/**/page.tsx` が 12 件（`find app/(manage) -name page.tsx`）あることを確かめ、12 件すべてに `apps/ops/src/routes` の route が対応することを表にする（review の互換 redirect を含む）。MIG-0704 の Final audit の一部（D-17）。

#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 非 admin で担当外 event の `/manage/notifications?event=…` | 404（notifications/page.tsx:113、notificationCenter.ts:37） |
| T02 | admin で `/manage/notifications` | 全 event が対象（page.tsx:93-98） |
| T03 | フィルタ `<select>` を変える | GET の遷移のみ。ページの読み直しで反映（AutoSubmitSelect.tsx:22-24） |
| T04 | `canManageXIdLinkRequests=false` の `/manage/x-link-requests` | 404（x-link-requests/page.tsx:28、xlink.ts:58） |
| T05 | 承認（SA-090）/ 却下（SA-091、理由あり / 空） | CURRENT の文言、成功で読み直し（D-16-3）。送信 body は CURRENT の引数（`r.id`、reason）と同じ |
| T06 | 承認の二重押し | 2 回目は送らない（pending 表示。CURRENT の `run()` と同じ） |
| T07 | U04: `find app/(manage) -name page.tsx` の 12 件と route の対応表 | 12 件すべて対応（review は redirect）。欠けが無い |
| T08 | `rg "@/|next/" apps/ops/src/routes/manage apps/ops/src/components/shared` | 0 件 |

#### Commands
```bash
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```

#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `app/(manage)/manage/notifications/page.tsx`、`app/(manage)/manage/x-link-requests/page.tsx`、`XLinkRequestTable.tsx`、`NotificationOutboxSummary.tsx` を IN_PROGRESS（移植先）。`API_MATRIX.md` の SA-090 / 091 に SPA の呼び出し元。

#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T08 が PASS
- [ ] MIG-0605（U05x）が DONE で、client が `packages/contracts` の schema を使っている（D-16-1）
- [ ] Manage 12 の表（U04）が PR にある

#### STOP
- 承認の可否（`canManageXIdLinkRequests`、activeX 判定）を SPA 側で決める必要が出たら止める（API が正）。
- 通知の対象を SPA 側で絞り込む必要が出たら止める（API の読みが正）。

#### Rollback
PR を revert（Ops は本番に配信されない）。

### MIG-0724: admin shell、top dashboard、permission simulator（CURRENT `app/(admin)/layout.tsx`、`admin/page.tsx`、`admin/permissions/simulator`）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — BLOCKED（D-17-1: MIG-0705 を 0724〜0731 に分割。MIG-0707 の merge 後に READY。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0707, MIG-0608, MIG-0625 / **Decisions:** D-05 DECIDED, D-15-13, D-16-1, D-16-3, D-16-13, D-17-1
- **Merge gate:** MIG-0626（top の `GET /api/admin-read/ops/top` と simulator の `GET /api/admin-read/permissions/simulator` は part B、READY）、MIG-0661（`GET /api/admin-read/cost-guard-banner` は未実装、READY）
- **Verified against:** `08e7e8cc` (2026-10-27)

#### Source snapshot
- CURRENT layout: `app/(admin)/layout.tsx:16-41`。guard の順は `getLayoutAuthSurface()`（`src/lib/auth/requestAuthContext.ts:308`）→ `!headerUser` で `/entry`（:23）→ `enrichmentFailed` で `/entry?error=auth_temporarily_unavailable`（:24-26）→ `headerUser.role !== "admin"` で `/dashboard`（:27）。`metadata.robots = { index: false, follow: false }`（:11-13）、`dynamic = "force-dynamic"`（:14）。chrome は `<div data-admin-shell data-fn-surface="admin">`（:30）、`CostGuardBanner source="admin"`（:31）、`PublicHeader hydrateAccount`（:32）、`ConsoleShell consoleMode="admin"` + `ConsoleSidebar consoleMode="admin"`（:33-36）、`<main className="admin-main">`（:37）、`PublicFooter`（:39）。
- admin の nav: `src/lib/admin/adminNavGroups.tsx:12-125`（href 一覧）、`src/components/admin/AdminSidebarNav.tsx:32`、`src/components/layout/ConsoleSidebar.tsx:72`、`src/components/layout/ConsoleShell.tsx:7`。
- error boundary: `(admin)` 直下に `error.tsx` は無い。CURRENT は `app/error.tsx:1-33`（`"use client"`、「問題が発生しました」、「再試行」、ghost link「トップへ戻る」→ `/`）を使う。
- top dashboard: `app/(admin)/admin/page.tsx:20-21`（`getDatabase()` を直接呼ぶ）、`adminPendingCounts` import（:5-9）、`Icon` / `EmptyState` / `OperationMode`（:10-13）。読みは `GET /api/admin-read/ops/top`（`apps/api/src/routes/adminRead/ops.ts:817`、MIG-0626 part B）。
- permission simulator: `app/(admin)/admin/permissions/simulator/page.tsx:11-14`（`searchParams` の `event_id` / `x_user_id`）、`PermissionSimulatorPanel`（`src/components/admin/PermissionSimulatorPanel.tsx:13`）、判定 `simulateEventPermissions`（`src/lib/admin/permissionSimulator`）。読みは `GET /api/admin-read/permissions/simulator`（`apps/api/src/routes/adminRead/settings.ts:182-189`。入力が欠けると `result: null`、`x_user_id` の先頭 `@` は除く）。
- CostGuardBanner admin source: `src/components/layout/CostGuardBanner.tsx:52-70`（admin は `getDatabase()` → `readAdminSystemSettings`（:58-67）、失敗時は `null`（:67-68））。HTTP endpoint は main に無く、`GET /api/admin-read/cost-guard-banner`（D-16-13、MIG-0661）を使う。
- read API の共通 guard: `apps/api/src/routes/adminRead/index.ts:27-41`（session 無し 401 → `requireAuth`、`role !== "admin"` は 403 `{ error: "Forbidden", redirect: "/dashboard" }`（:35-39）。moderator も admin ではない（:34））。D1 失敗は 503 `{ error: "unavailable" }`（:61-65）。
- layout の入力: RH-001 `GET /api/account/summary`（`apps/api/src/routes/account/summary.ts:187` `role`、:282 `canAccessAdmin`）。

#### Owned paths
- 新規: `+apps/ops/src/routes/admin/AdminShell.tsx`（CURRENT `layout.tsx` の chrome と `CostGuardBanner` を組む。guard 本体は MIG-0707 U02 の `apps/ops/src/routes/guard.tsx` を呼ぶ）, `+apps/ops/src/routes/admin/AdminTop.tsx`, `+apps/ops/src/routes/admin/PermissionSimulator.tsx`, `+apps/ops/src/api/adminShell.ts`（`getAdminTop` / `getPermissionSimulation` / `getCostGuardBanner`。1 行目 `// D-16-1 provisional: replace with @flamenode/contracts at merge` は contract 未 merge の間だけ）, `+apps/ops/src/components/shared/{ConsoleShell,ConsoleSidebar,AdminSidebarNav,ConsolePageHeader,ConsolePanel,CostGuardBanner}.tsx` と css（D-16-4 と同じ規則: 0725〜0727 より先に merge した方が作り、後の方は import だけ）, `+apps/ops/src/components/admin/PermissionSimulatorPanel.tsx`, `+apps/ops/src/lib/adminNavGroups.ts`（`src/lib/admin/adminNavGroups.tsx` の pure な部分のみ、1 行目 `// Port of CURRENT src/lib/admin/adminNavGroups.tsx (MIG-0724). Same output.`）, `+apps/ops/test/adminShell.test.mjs`, `+apps/ops/test/permissionSimulator.test.mjs`
- 変更: `apps/ops/src/routes/router.tsx`（`/admin` と `/admin/permissions/simulator` の Route 行。MIG-0707 の空枠を置き換え）, `apps/ops/scripts/portCssModule.mjs`（`MODULES` に行）, `apps/ops/src/main.tsx`（css import 1 行）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(admin)/**`, `src/components/**`（移植元）, `apps/api/**`, `apps/app/**`, `apps/ops/src/routes/guard.tsx` の判定（テストの追加だけ可）

#### Micro-units
- **U01 shell と guard の接続**: `AdminShell` で MIG-0707 の guard を呼び、CURRENT の chrome（`data-admin-shell` / `data-fn-surface="admin"` / `main.admin-main`）を組む。Location は MIG-0707 の出力をそのまま使い、admin 固有の表（`/entry`、`/entry?error=auth_temporarily_unavailable`、`/dashboard`）を test で固定する。error 表示は `app/error.tsx` の文言。
- **U02 chrome 部品と CostGuardBanner**: `ConsoleShell` / `ConsoleSidebar` / `AdminSidebarNav` / `ConsolePageHeader` / `ConsolePanel` を React のまま移植（nav の href と順を変えない）。`CostGuardBanner` は `getCostGuardBanner()` で読む（MIG-0661 の merge 後）。
- **U03 `/admin` top**: `AdminTop` は `GET /api/admin-read/ops/top`（`ops.ts:817`）の応答で件数と mode を描く。文言・件数・`EmptyState`（`app/(admin)/admin/page.tsx` の表示）を変えない。
- **U04 `/admin/permissions/simulator`**: `PermissionSimulator` は URL の `event_id` / `x_user_id` を CURRENT と同じ名前で読み、`GET /api/admin-read/permissions/simulator` を呼ぶ。`PermissionSimulatorPanel` を移植（判定は Hono が正。SPA で判定しない）。

#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | guest / user / moderator / owner / admin × `/admin` | guest は `/entry`、user / moderator / owner は `/dashboard`（moderator は admin ではない、`adminRead/index.ts:34`）、admin は表示（`layout.tsx:23,27` と同じ） |
| T02 | enrichment が失敗した状態（`enrichmentFailed` 相当） | `/entry?error=auth_temporarily_unavailable`（`layout.tsx:24-26`）。RH-001 の 503 `unavailable`、または非 admin の `degraded: true`（D-17-3、MIG-0707 U02 と同じ写像。admin の degraded は通る） |
| T03 | 任意の `/admin/*` の HTML | `<meta name="robots" content="noindex, nofollow">`（`layout.tsx:11-13`） |
| T04 | adminRead が 401 / 403 / 503 | 401 は `/entry`、403 は `/dashboard`（`adminRead/index.ts:37-38`）、503 は `app/error.tsx` の表示（`index.ts:61-65`） |
| T05 | CostGuardBanner admin source: mode normal / maintenance / cost_guard の 3 状態、endpoint 失敗 | CURRENT と同じ表示。失敗時は非表示（`CostGuardBanner.tsx:67-68`） |
| T06 | `/admin` の件数（fixture は `AdminTopResponse` を `parse`） | `adminPendingCounts` の CURRENT 件数と同じ（`page.tsx:5-9`） |
| T07 | simulator: `event_id` も `x_user_id` も無い | `result: null` の初期表示（`settings.ts:185-188`） |
| T08 | simulator: `x_user_id` が `@` 付き | `@` を除いた値で判定（`settings.ts:189`） |
| T09 | `rg "fetch\\(|@/lib|next/|getDatabase" apps/ops/src/routes/admin apps/ops/src/components/shared` | 直接 D1 / Next の import は 0 件 |

#### Commands
```bash
npm ci --no-audit --no-fund
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```

#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `app/(admin)/layout.tsx`、`app/(admin)/admin/page.tsx`、`app/(admin)/admin/permissions/simulator/page.tsx`、`src/components/layout/CostGuardBanner.tsx`（admin source 部分）を IN_PROGRESS（移植先）。`STATUS.md` は merge 直前の統合でだけ更新。

#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T09 が PASS
- [ ] MIG-0626 と MIG-0661 が DONE になってから、top / simulator / banner の実 API で確認
- [ ] この task の画面は write を呼ばない（Server Action も `POST` も無い）
- [ ] browser 確認（390px / 1440px）が PR にある

#### STOP
- guard の判定（role / enrichment 失敗）を SPA 側で決める必要が出たら止める（Hono が正）。CURRENT の `enrichmentFailed`（`requestAuthContext.ts:215-225`）は RH-001 に無いので、MIG-0707 の guard が D-17-3 の写像（503 と非 admin の degraded を `/entry?error=auth_temporarily_unavailable`）を持つ。本 task は MIG-0707 の guard を使い、写像を変えない。
- `GET /api/admin-read/cost-guard-banner` が D1 を使わずに mode を出せない、または admin と public の出し分けが変わるなら MIG-0661 に返す。

#### Rollback
Phase 7 共通契約のとおり。route 行を MIG-0707 の空枠に戻す。

### MIG-0725: admin 内容ルール（CURRENT `admin/announcements`、`api-endpoints`、`rules`、`event-groups`、list navigation）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — BLOCKED（D-17-1: MIG-0705 を 0724〜0731 に分割。MIG-0707 の merge 後に READY。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0707, MIG-0602, MIG-0625 / **Decisions:** D-05 DECIDED, D-15-13, D-16-1, D-16-2, D-16-3, D-16-4, D-17-1
- **Merge gate:** MIG-0626（reads: `settings.ts:38,66,80,169,239`）、MIG-0642（SA-051〜055 の書き込み）、MIG-0653（SA-025〜030 の event group 書き込み）
- **Verified against:** `08e7e8cc` (2026-10-27)

#### Source snapshot
- announcements: 一覧 `app/(admin)/admin/announcements/page.tsx`（drizzle の `announcements` を直接 select、:50-51）→ 読み `GET /api/admin-read/announcements`（`apps/api/src/routes/adminRead/settings.ts:38`）、詳細 `GET /api/admin-read/announcements/:id`（:66）。`new` は `AnnouncementForm`（`src/components/admin/AnnouncementForm.tsx:30`、server action import は :9）。`[id]/edit` は `AnnouncementForm` + `DeleteAnnouncementForm`（`src/components/admin/DeleteAnnouncementForm.tsx:9`、action import :6）。
- API endpoints: `app/(admin)/admin/api-endpoints/page.tsx:30-48`（inline server action `createApiEndpointAction` / `setApiEndpointActiveAction` が redirect する。SA-108 / SA-109）、`lib/actions/api-endpoints`（:13）、一覧の D1 直接読み（:50-78）→ 読み `GET /api/admin-read/api-endpoints`（`settings.ts:239`）。`EventExportLinkBuilder`（`src/components/admin/EventExportLinkBuilder.tsx:15`）を使う。
- rules: 一覧 `app/(admin)/admin/rules/page.tsx:26-`（drizzle の `termsVersions` を直接 select、:41-42）→ 読み `GET /api/admin-read/rules`（`settings.ts:80`）。`TermsReacceptBroadcastButton`（`src/components/admin/TermsReacceptBroadcastButton.tsx:13`、action import :5）。`rules/new` は `TermsForm`（`src/components/admin/TermsForm.tsx:29`）。`rules/[id]/edit` は `TermsForm` と読み `GET /api/admin-read/rules/:id`（`settings.ts:169`）。`TermsForm` の publish / archive は :86 / :94 で呼ぶ。
- event groups: 一覧 `app/(admin)/admin/event-groups/page.tsx:38-`（drizzle の `eventGroups` を直接 select、:63）→ 読み `GET /api/admin-read/event-groups`（`apps/api/src/routes/adminRead/eventGroups.ts:22`）。`new` は `EventGroupForm`（`src/components/admin/EventGroupForm.tsx:39`、action は :6-8、呼び分け :60-61）。`[id]/edit` は `EventGroupForm` + `EventGroupMembersEditor`（`src/components/admin/EventGroupMembersEditor.tsx:32`）+ `DeleteEventGroupForm`（`:13`）。読み `GET /api/admin-read/event-groups/:id`（`eventGroups.ts:51`、候補の一覧は :69-83 の cursor 付き）。候補の検索（`queryEventGroupEventOptions`、`src/lib/admin/eventGroupEventOptions.ts:51`）に対応する GET は未確認（D-17）。
- list navigation: `AdminSectionTabs`（`src/components/admin/AdminSectionTabs.tsx:41`）と `AutoSubmitSelect`（`src/components/forms/AutoSubmitSelect.tsx:95`、`navigateGetForm` :20）。

#### Owned paths
- 新規: `+apps/ops/src/routes/admin/content/{AnnouncementList,AnnouncementNew,AnnouncementEdit,ApiEndpoints,RuleList,RuleNew,RuleEdit,EventGroupList,EventGroupNew,EventGroupEdit}.tsx`, `+apps/ops/src/api/adminContent.ts`（読みの関数。provisional の型は 1 行目に D-16-1 の注記）, `+apps/ops/src/api/write.ts`（D-16-2 と同じ。先に merge した方が作る。最初に write を持つのはこの task）, `+apps/ops/src/components/admin/{AnnouncementForm,DeleteAnnouncementForm,TermsForm,TermsReacceptBroadcastButton,EventGroupForm,EventGroupMembersEditor,DeleteEventGroupForm,EventExportLinkBuilder}.tsx`, `+apps/ops/src/components/shared/{AdminSectionTabs,AutoSubmitSelect,FnTable,Pagination,EmptyState}.tsx` と css（D-16-4 と同じ規則。0726〜0731 も import する）, `+apps/ops/src/styles/admin-content.css`, `+apps/ops/test/adminContent.test.mjs`
- 変更: `apps/ops/src/routes/router.tsx`（route 行のみ）, `apps/ops/scripts/portCssModule.mjs`, `apps/ops/src/main.tsx`（css import）, `apps/ops/src/routes/guard.tsx`（D-16-3 の `refreshKey` 引数。main に既にあれば何もしない）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(admin)/**`, `src/components/**`（移植元）, `apps/api/**`, `packages/**`

#### Micro-units
- **U01 announcements**: 一覧 / new / edit / 削除。読みは `settings.ts:38,66`（MIG-0626 の merge 後）。書きは SA-004〜006（`POST /api/admin/announcements`、`PUT .../:id`、`DELETE .../:id`。MIG-0602 DONE、`API_MATRIX.md:94-96`）。
- **U02 api-endpoints と list navigation**: `ApiEndpoints` を移植。SA-007 / SA-008（`API_MATRIX.md:97-98`、MIG-0602 DONE）と、page 内 inline action（SA-108 / SA-109）の代わりの typed API 呼び出し。`AdminSectionTabs` / `AutoSubmitSelect` を shared に置く（一覧の絞り込み URL は CURRENT と同じ）。
- **U03 rules / terms**: 一覧 / new / edit、publish（SA-053）、archive（SA-055）、reaccept broadcast（SA-054）。書きは MIG-0642（READY）が merge されてから。読みは `settings.ts:80,169`（MIG-0626）。
- **U04 event groups**: 一覧 / new / edit / 削除、member の追加（SA-029）・削除（SA-030）・候補検索（SA-025）。書きは MIG-0653（READY）、読みは `eventGroups.ts:22,51`（MIG-0625 DONE）。

#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | moderator / user が `/admin/announcements` と `/admin/event-groups` を開く | 読みは 403 `redirect: "/dashboard"`（`adminRead/index.ts:35-39`）、`/dashboard` へ移動 |
| T02 | announcements 一覧・詳細の表示（fixture は `settings.ts:38,66` の応答） | CURRENT の列・文言・並びと同じ |
| T03 | announcement 作成 / 更新 / 削除 | `API_MATRIX.md:94-96` の status（200 / 400 / 404 / 409 / 413 / 500）どおりの表示。成功後に読み直す |
| T04 | api-endpoint の作成と有効・無効の切替 | `API_MATRIX.md:97-98` どおり。SA-108 / SA-109 の inline redirect と同じ遷移 |
| T05 | rules: 公開・アーカイブ・再同意 broadcast | CURRENT の確認文言と成功文言（`TermsForm.tsx:86,94`）。確認なしの実行はしない |
| T06 | event group: member の追加・削除、上限、削除 | CURRENT と同じ表示。上限超えは API を呼ばない |
| T07 | `rg "@/|next/|getDatabase" apps/ops/src/routes/admin/content apps/ops/src/components/admin` | 0 件 |
| T08 | 書きの 401 / 403 / 通信失敗 | CURRENT と同じ文言（各 component の「〜に失敗しました。」）。`write.ts` の `unavailable` で分岐 |

#### Commands
```bash
node apps/ops/scripts/portCssModule.mjs
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```

#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の 10 route 行と各 component 行を IN_PROGRESS（移植先）。`API_MATRIX.md` の SA-004〜008 と SA-051〜055、SA-025〜030 に Ops の呼び出し元を追記。

#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T08 が PASS
- [ ] MIG-0626 / MIG-0642 / MIG-0653 が DONE、または該当 unit が Merge gate 未解消のまま merge されていない
- [ ] 書きは `apps/ops/src/api/write.ts` だけを通る（画面から `fetch` を直接呼ばない）
- [ ] browser 確認（390px / 1440px）が PR にある

#### STOP
- 権利の判定（moderator の書き込み可否など）を SPA で決める必要が出たら止める（Hono が正）。
- terms の publish / archive で版の状態遷移が CURRENT（`src/lib/actions/rules.ts`）と違う場合は MIG-0642 に返す。

#### Rollback
Phase 7 共通契約のとおり。route と component を revert する（write client の追加は他の task が使い始めた後は revert しない）。

### MIG-0726: admin イベントとワークフロー（CURRENT `admin/events`、`events/new`、`events/templates`、`events/[id]` 系の互換 redirect）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — BLOCKED（D-17-1: MIG-0705 を 0724〜0731 に分割。MIG-0707 の merge 後に READY。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0707, MIG-0625 / **Decisions:** D-05 DECIDED, D-15-13, D-16-1, D-16-2, D-16-4, D-16-4（EventForm の shared 化）, D-17-1
- **Merge gate:** MIG-0652（SA-022 `createEvent`、READY）、MIG-0655（`snapshotToFormInitial` / `parseEventTemplateSnapshot` の `@flamenode/domain/eventTemplates` への移動、D-13-48）
- **Verified against:** `08e7e8cc` (2026-10-27)

#### Source snapshot
- 一覧: `app/(admin)/admin/events/page.tsx:37-`（`searchParams` :30-38、drizzle の `eventsTable` 直接 select）→ 読み `GET /api/admin-read/events`（`apps/api/src/routes/adminRead/events.ts:20`、MIG-0625 DONE）。`AdminSectionTabs`（:19）、`AutoSubmitSelect`（:21）。
- new: `app/(admin)/admin/events/new/page.tsx:25-`。`EventForm`（`src/components/admin/EventForm.tsx:376`、`createEvent` / `updateEvent` の呼び分けは :602）。テンプレート一覧は `listEventTemplatesForAdmin`（page :15、SA-037 の読み）→ `GET /api/admin-read/events/new`（`eventTemplates.ts:105`、MIG-0625 DONE）。`EventForm` は `EventCustomQuestionsEditor`（`src/components/admin/EventCustomQuestionsEditor.tsx`、390 行）、`YoutubeDescriptionTemplateEditor`（465 行）、`EventSettingsPreview`（350 行）を使う。
- templates: `app/(admin)/admin/events/templates/page.tsx:16-`、`DeleteEventTemplateButton`（`src/components/admin/DeleteEventTemplateButton.tsx:13`、SA-036）。読み `GET /api/admin-read/events/templates`（`eventTemplates.ts:96`、MIG-0625 DONE）。
- 互換 redirect（replacement なしに消さない。`CURRENT_ROUTES.md` の COMPAT_REDIRECT）:
  - `app/(admin)/admin/events/[id]/page.tsx` → `/manage/events/${id}`
  - `app/(admin)/admin/events/[id]/edit/page.tsx` → `/manage/events/${id}/edit`
  - `app/(admin)/admin/events/[id]/slots/page.tsx` → `/manage/events/${id}/slots`
  - `app/(admin)/admin/events/[id]/staff/page.tsx` → `/manage/events/${id}/staff`
  - いずれも next/navigation の `redirect()`（既定の一時 redirect）。redirect 先は MIG-0704（manage）の画面。
- SA-036 の状態: `docs/migration/PHASE_6_SPEC.md:268` と `:2695` は「SA-036 DONE / merge 済み（`apps/api/src/routes/events/templates.ts`）」と書く。一方 `FILE_MIGRATION_MATRIX.md:874-876` と `API_MATRIX.md` の MIG-0604 節は IN_PROGRESS（D-17）。

- `events/new` の読みは `formInitial: "deferred"` と `templateSettingsJson` を返す（`apps/api/src/routes/adminRead/eventTemplates.ts:105-121`）。CURRENT の変換は `src/lib/admin/eventTemplateSettings.ts:251,347`（`events/new/page.tsx:53-55`）で、MIG-0655 が `@flamenode/domain/eventTemplates` へ移す（D-13-48）。SPA は移した関数を import し、複製しない。test にテンプレートを選んだときの初期値の case を足す。
- SA-036 の endpoint（`apps/api/src/routes/events/templates.ts`）は main にある。MIG-0604 は Final audit だけなので gate にしない（D-15-4）。

#### Owned paths
- 新規: `+apps/ops/src/routes/admin/events/{EventList,EventNew,EventTemplates,EventCompatRedirect}.tsx`, `+apps/ops/src/api/adminEvents.ts`（`getAdminEvents` / `getEventTemplates` / `getEventNewOptions` / `deleteEventTemplate`。provisional 注記）, `+apps/ops/src/components/admin/{DeleteEventTemplateButton}.tsx`, `+apps/ops/src/components/shared/{EventForm,EventCustomQuestionsEditor,YoutubeDescriptionTemplateEditor,EventSettingsPreview}.tsx`（D-16-5 と同じ。`app/(manage)/manage/events/[id]/edit/page.tsx` も使うため、MIG-0704 は import だけ）, `+apps/ops/src/lib/eventRoutes.ts`（compat redirect の Location を組む pure 関数。新規の判定ロジックは書かない）, `+apps/ops/test/adminEvents.test.mjs`
- 変更: `apps/ops/src/routes/router.tsx`（route 行のみ）, `apps/ops/scripts/portCssModule.mjs`, `apps/ops/src/main.tsx`, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(admin)/**`, `app/(manage)/**`（MIG-0704 の移植対象）, `src/components/**`（移植元）, `apps/api/**`

#### Micro-units
- **U01 events 一覧と templates**: 一覧（`events.ts:20`）と templates（`eventTemplates.ts:96`）を移植。`DeleteEventTemplateButton` は SA-036（DONE、`templates.ts`）を呼ぶ。`AdminSectionTabs` の表示は 0725 の shared を使う。
- **U02 events/new（EventForm）**: `EventForm` と 3 つの editor を移植。書きは SA-022（`createEvent`、MIG-0652 READY）。テンプレート候補は `eventTemplates.ts:105`。`updateEvent`（SA-023）は manage 側のため本 task では呼ばない。
- **U03 互換 redirect 4 件**: `[id]`、`[id]/edit`、`[id]/slots`、`[id]/staff` を `eventRoutes.ts` の Location で redirect。`encodeURIComponent(id)` を CURRENT と同じく使う。
- **U04 Final audit（admin events）**: 一覧 / new / templates / 4 redirect の URL と遷移を 1 枚の表で確かめ、MIG-0704 の manage 画面に入る先が無くても 404 にならない（redirect 先は 0704 の枠）ことを確認。

#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | moderator / user が `/admin/events` と `/admin/events/new` を開く | 403 → `/dashboard`（`adminRead/index.ts:35-39`） |
| T02 | 一覧の絞り込み（`searchParams`）と並び | CURRENT の query 名と結果が同じ（`events/page.tsx:30-38`） |
| T03 | EventForm の作成（テンプレート有 / 無） | CURRENT と同じ項目と送る値。SA-022 の status と文言（MIG-0652 の契約） |
| T04 | テンプレートの削除 | 確認を経てから SA-036 を呼ぶ。成功後に一覧を読み直す |
| T05 | `/admin/events/abc/edit` など 4 redirect | Location が `/manage/events/abc/edit` 等（`encodeURIComponent` 済み）。`id` に `/` を含む入力でも 1 セグメント |
| T06 | `rg "@/|next/|getDatabase" apps/ops/src/routes/admin/events apps/ops/src/components/shared/EventForm.tsx` | 0 件 |

#### Commands
```bash
node apps/ops/scripts/portCssModule.mjs
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```

#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の events 系 7 route 行と `src/components/admin/EventForm.tsx` 行を IN_PROGRESS（移植先）。`API_MATRIX.md` の SA-022 と SA-036 に Ops の呼び出し元。

#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T06 が PASS
- [ ] MIG-0652 が DONE、または SA-022 の呼び出しを Merge gate 未解消のまま merge していない
- [ ] `EventForm` の shared 化を MIG-0704（manage edit）と合わせて確認した
- [ ] browser 確認（390px / 1440px）が PR にある

#### STOP
- `EventForm`（1120 行）＋ editor 3 件で 1 wake に収まらないと分かったら止め、MIG-0726a（一覧・templates・redirect）と MIG-0726b（EventForm）に分けるよう lead に返す。
- playlist の画面は本 task の対象外（D-17）。

#### Rollback
Phase 7 共通契約のとおり。

### MIG-0727: admin 動画（CURRENT `admin/videos`、`videos/[id]`、`videos/[id]/members`）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — BLOCKED（D-17-1: MIG-0705 を 0724〜0731 に分割。MIG-0707 の merge 後に READY。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0707, MIG-0625, MIG-0635 / **Decisions:** D-05 DECIDED, D-15-13, D-16-1, D-16-2, D-16-4, D-16-5（`AdminVideoStatusForm` は本 task。`app/(admin)/admin/videos/[id]/page.tsx:10,103` の呼び出し元）, D-17-1
- **Merge gate:** MIG-0603（SA-001〜003 と SA-043。U02a / U02b、READY）、MIG-0648（RH-019 `GET /api/internal/x-users/search`。`VideoMembersField.tsx:161` の候補検索）、MIG-0650（SA-085 `updateVideoMembersAdmin`、READY）
- **Verified against:** `08e7e8cc` (2026-10-27)

#### Source snapshot
- 一覧: `app/(admin)/admin/videos/page.tsx:54-`（drizzle の `videosTable` を直接 select :122・:147）→ 読み `GET /api/admin-read/videos`（`apps/api/src/routes/adminRead/videos.ts:34`、MIG-0625 DONE）。`VideoReviewQueueTable`（`src/components/admin/VideoReviewQueueTable.tsx:57`）、`VideoReviewQuickApproveButton`（`src/components/admin/VideoReviewQuickApproveButton.tsx:26`、SA-001 は page:22 の import 元）、`AdminVideoManagementTabs`（`:39`）、`AutoSubmitSelect`（:32）。
- 詳細: `app/(admin)/admin/videos/[id]/page.tsx:34-`（drizzle の `videoModerationCases` 直接 select、:7 / :50-62）→ 読み `GET /api/admin-read/videos/:id`（`apps/api/src/routes/adminRead/videoDetail.ts:67`、MIG-0635 DONE）。`AdminVideoStatusForm`（`src/components/video/VideoStatusForm.tsx:56`、`action={setVideoStatus}` は :78、import は :7。**src/components/admin の外**）、`VideoApproveActions`（`src/components/video/VideoApproveActions.tsx:31`。SA-001 / SA-002 は page:12-15 が props で渡す）、`VideoReviewDetailPanel`（`src/components/admin/VideoReviewDetailPanel.tsx:33`）、`CreateModerationCaseForm`（`src/components/admin/CreateModerationCaseForm.tsx:13`、page:20 / :195。SA-043）。
- members: `app/(admin)/admin/videos/[id]/members/page.tsx:26-`（`notFound` は :31）→ 読み `GET /api/admin-read/videos/:id/members`（`apps/api/src/routes/adminRead/videoMembers.ts:30`、MIG-0635 DONE）。`AdminVideoMembersForm`（`src/components/admin/AdminVideoMembersForm.tsx:29`、`updateVideoMembersAdmin` import は :8）、`VideoMembersField`（`src/components/forms/VideoMembersField.tsx`、1503 行、apps/app 専用の場所）の型 import は page:14。`formatMemberChapterTime`（`src/lib/video/memberInput.ts`）、`extractVideoMemberIdFromChapterId`、`MAX_VIDEO_MEMBERS`（page:15-17）。`AdminVideoTabs`（`src/components/admin/AdminVideoTabs.tsx:11`）。
- 書き（SA）: SA-001 `approveAdminVideoPublic`、SA-002 `approveAdminVideoPublicAndNext`（`src/lib/actions/admin.ts`、MIG-0603 U02a、READY）、SA-003 `setVideoStatus`（同 U02a / U02b、READY）、SA-043 `createModerationCase`（同 U02b、READY、`moderation-admin.ts:109`）、SA-085 `updateVideoMembersAdmin`（`src/lib/actions/video/adminMembers.ts:67`、MIG-0650 READY）。

#### Owned paths
- 新規: `+apps/ops/src/routes/admin/videos/{VideoList,VideoDetail,VideoMembers}.tsx`, `+apps/ops/src/api/adminVideos.ts`（`getAdminVideos` / `getAdminVideo` / `getAdminVideoMembers` / `approveVideo` / `setVideoStatus` / `createModerationCase` / `updateVideoMembers`。provisional 注記）, `+apps/ops/src/components/admin/{AdminVideoMembersForm,AdminVideoTabs,AdminVideoManagementTabs,CreateModerationCaseForm,VideoReviewDetailPanel,VideoReviewQuickApproveButton,VideoReviewQueueTable}.tsx`, `+apps/ops/src/components/shared/{AdminVideoStatusForm,VideoApproveActions,VideoMembersField}.tsx` と css（`AdminVideoStatusForm` は manage（MIG-0704 U04）の `ManageVideoStatusForm`（`src/components/video/VideoStatusForm.tsx:91`）と同じファイルの port。先に merge した方が作る、D-16-4 と同じ規則）, `+apps/ops/src/lib/video/{memberInput,atomicLimits}.ts`（`src/lib/video/` の pure 部分のみ。1 行目 `// Port of CURRENT <path> (MIG-0727). Same output.`。`packages/domain` に同名があればそれを import）, `+apps/ops/test/adminVideos.test.mjs`
- 変更: `apps/ops/src/routes/router.tsx`（route 行のみ）, `apps/ops/scripts/portCssModule.mjs`, `apps/ops/src/main.tsx`, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(admin)/**`, `src/components/**`（移植元）, `apps/app/**`（MIG-0713 の `VideoMembersField` 移植は apps/app 側。Ops は別に port する）, `apps/api/**`

#### Micro-units
- **U01 一覧**: `VideoList` を移植。`GET /api/admin-read/videos`（`videos.ts:34`）。承認ボタンは SA-001（MIG-0603 merge 後）。絞り込み URL（`status=pending` など）を CURRENT と同じに。
- **U02 詳細と状態 form**: `VideoDetail` を移植。`AdminVideoStatusForm`（SA-003）、`VideoApproveActions`（SA-001 / SA-002）、`VideoReviewDetailPanel`、`CreateModerationCaseForm`（SA-043）。読みは `videoDetail.ts:67`。書きは MIG-0603 merge 後。
- **U03 members**: `VideoMembers` を移植。`VideoMembersField` は port の adapter 形（MIG-0713 と同じ規則: `searchXUsers` と `applyPermissionBatch` は props）。書きは SA-085（MIG-0650 READY）。読みは `videoMembers.ts:30`。
- **U04 shared の確認と Final audit**: `AdminVideoStatusForm` / `VideoApproveActions` の props を manage（MIG-0704 U04）と合わせて確認。admin の 3 route の表（URL・Location・書きの SA）を PR に載せる。

#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | guest / user / moderator / owner が `/admin/videos`、`/admin/videos/:id`、`/admin/videos/:id/members` を開く | 401 は `/entry`、403 は `/dashboard`（`adminRead/index.ts:35-39`）。moderator は admin ではないので `/dashboard` |
| T02 | 一覧の承認（SA-001）・失敗 | CURRENT と同じ文言。成功で一覧を読み直す（LOADING にしない、D-16-3） |
| T03 | 詳細の状態変更（SA-003）: 同じ状態への変更 | CURRENT の `SAME_VIDEO_STATUS_MESSAGE` と同じ表示（`validateAdminVideoStatusInput`、`API_MATRIX.md:79`） |
| T04 | 詳細の moderation case 作成（SA-043） | CURRENT と同じ項目と送る値。未入力の検証は API を呼ばない |
| T05 | members の追加・削除・上限 `MAX_VIDEO_MEMBERS` ちょうど / 超え | CURRENT と同じ表示。超えは API を呼ばない |
| T06 | members の SA-085 失敗 / reject | CURRENT の文言（`AdminVideoMembersForm.tsx` の catch 文言）と同じ |
| T07 | `/admin/videos/:id` で存在しない id | CURRENT の `notFound`（`videos/[id]/page.tsx:45`）と同じ 404 表示 |
| T08 | `rg "fetch\\(|@/lib/actions|@/lib/db|next/" apps/ops/src/routes/admin/videos apps/ops/src/components/shared/AdminVideoStatusForm.tsx` | 0 件 |

#### Commands
```bash
node apps/ops/scripts/portCssModule.mjs
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```

#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `app/(admin)/admin/videos/**` 3 行と `src/components/video/VideoStatusForm.tsx`（admin 部分）、`src/components/admin/AdminVideoMembersForm.tsx` を IN_PROGRESS。`API_MATRIX.md` の SA-001〜003 / SA-043 / SA-085 に Ops の呼び出し元。

#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T08 が PASS
- [ ] MIG-0603 と MIG-0650 が DONE、または該当 unit を Merge gate 未解消のまま merge していない
- [ ] 書きは `apps/ops/src/api/write.ts` を通る（MIG-0725 が先に作る。無ければ D-16-2 の規則で作る）
- [ ] 危険操作（SA-001〜003、SA-043、SA-085）は独立レビュー（Opus）を通っている
- [ ] browser 確認（390px / 1440px）が PR にある

#### STOP
- `VideoMembersField` の移植（1503 行）と他の form で 1 PR に収まらないと分かったら止め、一覧・詳細と members に分けるよう lead に返す。`VideoMembersField` は MIG-0713（Personal、`apps/app`）も移植するので、同じ中身を写す（D-17-5）。
- 動画の状態遷移（公開・非公開の fence）を SPA 側で判定する必要が出たら止める（Hono が正、`planVideoVisibilityFence`）。
- `VideoMembersField` の port で `packages/domain` に無い pure 関数が要る場合は、apps/app の複製を増やす前に止めて lead に返す（D-17）。

#### Rollback
Phase 7 共通契約のとおり。route と component を revert する。

### MIG-0728: admin identity と moderation（users・ロール・BAN・X 連携申請・X ID 統合・moderation）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — BLOCKED（D-17-1: MIG-0705 を Admin 4 task（0728〜0731）と Final audit に分割。MIG-0707 の merge 後に READY。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0707, MIG-0625, MIG-0635 / **Decisions:** D-05 DECIDED, D-13-40（SA-043/044 は MIG-0603 U02b）, D-14-10（SA-077..081 / SA-092..097 / SA-110 の分割先）, D-16-1, D-16-2, D-16-3, D-16-4, D-17-1
- **Merge gate:** MIG-0603（SA-044）, MIG-0605（SA-090/091）, MIG-0637（SA-077..081）, MIG-0642（SA-049）, MIG-0644（SA-092..097, SA-110）
- **Verified against:** `08e7e8cc` (2026-10-27)
#### Source snapshot
- CURRENT 画面（6 route）:
  - `app/(admin)/admin/users/page.tsx`（625 行）。`view=links` は `/admin/x-link-requests` へ redirect（:89）。`AdminUserManagementTabs`（:335）、`GlobalEditableFieldsPanel`（:374）。
  - `app/(admin)/admin/users/[id]/page.tsx`（437 行、読み取りのみ。書き込み部品なし。`AdminUserTabs` :122）。
  - `app/(admin)/admin/users/[id]/edit/page.tsx`（65 行、`UserAdminForm` :51）。
  - `app/(admin)/admin/moderation/page.tsx`（216 行。`AutoSubmitSelect` の filter、`ModerationCaseStatusForm` :191、`ModerationFlashNotice`）。
  - `app/(admin)/admin/x-id-merges/page.tsx`（384 行。ページ内の server action `run`（:32-34）が 6 つの SA を呼ぶ。tabs :150、create form :160、approve / reject / execute / revert の form :323, :324, :328, :366, :372）。
  - `app/(admin)/admin/x-link-requests/page.tsx`（190 行、`XLinkRequestTable` :138、tabs :133）。
- CURRENT components（`src/components/admin/**`）: `AdminUserManagementTabs.tsx`（47 行）, `AdminUserTabs.tsx`（29）, `GlobalEditableFieldsPanel.tsx`（462）, `UserAdminForm.tsx`（242）, `ModerationCaseStatusForm.tsx`（88）, `ModerationFlashNotice.tsx`（44）, `XLinkRequestTable.tsx`（312）。共通部品: `src/components/ui/ConfirmDialog`（`UserAdminForm.tsx:13`）, `src/components/manage/ManageXIcon`（`users/page.tsx:25`）, `src/components/ui/FnTable`。CSS module は使わず、global の `fn-*` class。
- 読み（既存 Hono、`apps/api/src/routes/adminRead/**`）。全て `index.ts:33-38` の `sessionMiddleware` → `requireAuth` → `role === "admin"`（403 `{error, redirect:"/dashboard"}`）を通る。
  - `GET /api/admin-read/users?view&q&status&page` … `users.ts:117`（`view=links` は `{redirect}`、API_MATRIX.md:413）
  - `GET /api/admin-read/users/:id` … `users.ts:216`
  - `GET /api/admin-read/users/:id/edit` … `userEdit.ts:19`
  - `GET /api/admin-read/moderation` … `moderation.ts:11`
  - `GET /api/admin-read/x-link-requests` … `xLinkRequests.ts:86`
  - `GET /api/admin-read/x-id-merges?view&impact` … `xIdMerges.ts:86`
  - 読み MIG-0625（DONE、users / moderation / x-link-requests / x-id-merges）、MIG-0635（DONE、users/[id]/edit）。
- 書き（SA id → CURRENT の呼び出し元 → 所有 MIG → state）:

| SA | CURRENT 関数 | 呼び出し元 | 所有 MIG | state |
| --- | --- | --- | --- | --- |
| SA-049 | `updateGlobalEditableFields` | `GlobalEditableFieldsPanel.tsx:84`（page :374） | MIG-0642 | READY |
| SA-077 | `setUserRole` | `UserAdminForm.tsx:98`（`fd.set("role")` :97） | MIG-0637 | READY |
| SA-078 | `setUserBanned` | BAN `UserAdminForm.tsx:236`（`ConfirmDialog` :223-238 の中）、解除 `:123` | MIG-0637 | READY |
| SA-079 | `setUserNotifications` | `UserAdminForm.tsx:185` | MIG-0637 | READY |
| SA-080 | `setUserCanCreateEvents` | `UserAdminForm.tsx:167` | MIG-0637 | READY |
| SA-081 | `refreshXUserIcon` | `UserAdminForm.tsx:214` | MIG-0637 | READY |
| SA-044 | `updateModerationCaseStatus` | `ModerationCaseStatusForm.tsx:24`（page :191） | MIG-0603 U02b | READY |
| SA-090 | `approveXIdLinkRequest` | `XLinkRequestTable.tsx:249` | MIG-0605 U05x | READY |
| SA-091 | `rejectXIdLinkRequest` | `XLinkRequestTable.tsx:288`（理由入力あり） | MIG-0605 U05x | READY |
| SA-092 | `createXIdMergeRequest` | `x-id-merges/page.tsx:160` | MIG-0644 | READY |
| SA-093 | `approveXIdMergeRequest` | `x-id-merges/page.tsx:323` | MIG-0644 | READY |
| SA-094 | `rejectXIdMergeRequest` | `x-id-merges/page.tsx:324` | MIG-0644 | READY |
| SA-096 | `executeXIdMergeRequest` | `x-id-merges/page.tsx:328`（確認 `MERGE` :330） | MIG-0644 | READY |
| SA-097 | `approveXIdMergeRevert` | `x-id-merges/page.tsx:366`（確認 `REVERT` :368） | MIG-0644 | READY |
| SA-095 | `rejectXIdMergeRevert` | `x-id-merges/page.tsx:372` | MIG-0644 | READY |
| SA-110 | page 内 `run`（`x-id-merges/page.tsx:32-34`） | 上の 6 form を包む | MIG-0644 | READY |

- 対象外: SA-043 `createModerationCase` は `app/(admin)/admin/videos/[id]/page.tsx:195` の `CreateModerationCaseForm` で使う（0727 の担当）。
#### Owned paths
- 新規: `+apps/ops/src/routes/admin/identity/**`（6 route の画面と form component）, `+apps/ops/src/api/identity.ts`（読みは `/api/admin-read/*`、書きは各 MIG の endpoint。1 行目は D-16-1 の provisional comment）, `+apps/ops/test/adminIdentity.test.mjs`
- 新規（先に merge した方が作る、D-16-2）: `+apps/ops/src/api/write.ts`
- 新規（先に merge した方が作る、D-16-4）: `+apps/ops/src/components/shared/ConfirmDialog.tsx`（CURRENT `src/components/ui/ConfirmDialog`。0730 / 0731 も使う）
- 変更: `apps/ops/src/routes/router.tsx`（`/admin/users*`, `/admin/moderation`, `/admin/x-link-requests`, `/admin/x-id-merges` の Route 行。MIG-0707 の route 枠を埋める）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(admin)/**`, `src/components/admin/**`（移植元は読むだけ）, `apps/api/**`, `apps/ops/src/routes/admin/{shell,events,videos,spreadsheet,ops,audit}/**`（他 task の担当）
#### Micro-units
- **U01 読み**: `identity.ts` の 6 本の読みと、一覧の query（`view` / `q` / `status` / `page`）、詳細、edit、moderation、X 連携、X ID 統合。`view=links` は `/admin/x-link-requests` へ移す（`users/page.tsx:89`）。エラーと 0 件の表示を CURRENT と同じにする。
- **U02 users の書き込み**: `GlobalEditableFieldsPanel`（SA-049）と `UserAdminForm`（SA-077〜081）を React のまま移植。BAN は `ConfirmDialog`（`UserAdminForm.tsx:223-238`）を残す。成功後は `refreshKey` で読み直し、LOADING にしない（D-16-3）。
- **U03 moderation と X 連携**: `ModerationCaseStatusForm`（SA-044、`:26` の失敗文言）と `XLinkRequestTable`（SA-090/091、`:121` の結果表示、`:288` の理由入力）。
- **U04 X ID 統合**: merge の create / approve / reject / execute（`MERGE`）、revert の approve / reject（`REVERT`）（SA-092〜097、SA-110）。確認文字列と `required` / disabled の条件を CURRENT と同じにする。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | guest / user / moderator / owner / admin × 6 route | guest は `/entry`（`app/(admin)/layout.tsx:23`）、user / moderator / owner は `/dashboard`（:27）、admin 以外の API は 401 / 403 `{redirect:"/dashboard"}`（`adminRead/index.ts:36-38`）。moderator は admin ではない |
| T02 | `/admin/users?view=links` | `/admin/x-link-requests` へ移る（`users/page.tsx:89`） |
| T03 | BAN を押して確認を閉じる | API を呼ばない（`UserAdminForm.tsx:143`, `:223-238`） |
| T04 | ロール変更の成功 | 「ロールを … に変更しました。」（`:98`）、再取得で LOADING にならない |
| T05 | `{ok:false, message}` / reject | `message`、無ければ「操作に失敗しました。」（`UserAdminForm.tsx:55`） |
| T06 | X 連携 approve / reject の失敗 | `message`、無ければ「処理に失敗しました。」（`XLinkRequestTable.tsx:121`） |
| T07 | merge の実行で確認欄が `MERGE` 以外 | 送信できない（`x-id-merges/page.tsx:330` の `required` と同じ）。revert は `REVERT`（:368） |
| T08 | moderation 状態更新の失敗 | 「更新に失敗しました。」（`ModerationCaseStatusForm.tsx:26`） |
| T09 | 読みの D1 失敗 | CURRENT と同じ表示（users は 200 `degraded`、API_MATRIX.md:413） |
| T10 | 権限なしの書き込み（`requireAdminWrite(<feature>)` の拒否） | 返された `message` を CURRENT と同じ場所に出す |
#### Commands
```bash
npm ci --no-audit --no-fund
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `app/(admin)/admin/{users/**, moderation, x-id-merges, x-link-requests}` 行を IN_PROGRESS（移植先 `apps/ops/src/routes/admin/identity/**`）。`API_MATRIX.md` の SA-044, SA-049, SA-077〜081, SA-090〜097, SA-110 に SPA の呼び出し元。`work-items/MIG-0728.md` に U01〜U04 の表。
#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T10 が PASS
- [ ] MIG-0603 / 0605 / 0637 / 0642 / 0644 が DONE で、client が `packages/contracts` の schema を使っている（D-16-1）
- [ ] BAN、merge、revert の確認が CURRENT と同じ
- [ ] 独立レビュー（Opus）が APPROVE
- [ ] browser 確認（390px / 1440px）が PR にある
#### STOP
- role / BAN の可否を SPA 側で決める必要が出たら止める（Hono が正）。
- `users?view=xid` の `icon_url` は D-13-49 の記録済みの差（`apps/api/src/routes/adminRead/users.ts:171-172` は常に null）。本 task は null のまま `ManageXIcon` の fallback を出す。CURRENT と同じ icon に戻すのは MIG-0511（public X icon map projection）の DONE 後の follow-up（D-17-7）。
- SA-043（moderation case 作成）をこの task で実装しない（0727）。
#### Rollback
PR を revert（`apps/ops` は本番に配信されていない）。

### MIG-0729: admin spreadsheet と legacy import（table explorer、safe write / export / import）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — BLOCKED（D-17-1: MIG-0705 の分割。spreadsheet の読みは MIG-0605 U02 で main にあるが task は READY。書きと import は MIG-0638、legacy import は MIG-0645。MIG-0707 の merge 後に READY。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0707 / **Decisions:** D-05 DECIDED, D-14-11（RH-002 → MIG-0645、RH-004..008 → MIG-0638）, D-16-1, D-16-2, D-16-4, D-17-1
- **Merge gate:** MIG-0605（RH-003 / RH-007 / RH-009 の読み。U02 は main 済み）, MIG-0638（RH-004 / RH-005 / RH-006 / RH-008 の書きと import）, MIG-0645（RH-002 の legacy import）
- **Verified against:** `08e7e8cc` (2026-10-27)
#### Source snapshot
- CURRENT 画面:
  - `app/(admin)/admin/spreadsheet/page.tsx`（76 行）。非 admin は `notFound()`（:18）、`ADMIN_SPREADSHEET_ENABLED` が偽なら `notFound()`（:20）、client は `AdminSpreadsheetClient`（:73）。ただし `(admin)/layout.tsx:27` の redirect が先に走る。
  - `app/(admin)/admin/import/page.tsx`（27 行、`LegacyCanonicalImportClient` :24）。
- CURRENT components（`src/components/admin/spreadsheet/**` と `src/components/admin/LegacyCanonicalImportClient.tsx`）: `AdminSpreadsheetClient.tsx`（+ `.module.css`）、`SpreadsheetGrid.tsx`、`SpreadsheetGridFindBar.tsx`、`SpreadsheetGridFormulaBar.tsx`、`SpreadsheetGridStatusBar.tsx`、`SpreadsheetImportModal.tsx`、`SpreadsheetUndoRedoButtons.tsx`、`SpreadsheetContextMenu.tsx`、`SpreadsheetDelimitedTools.tsx`、`useAdminSpreadsheet.ts`、`useSpreadsheetExport.ts`、`useSpreadsheetImport.ts`、`spreadsheetApi.ts`、`spreadsheetHistory.ts`、`clipboardGrid.ts`、`spreadsheetGridUtils.ts`、`spreadsheetTypes.ts`、`spreadsheetErrors.ts`、`spreadsheetClientUtils.ts`、`LegacyCanonicalImportClient.tsx`（1332 行 + `.module.css`）。
- 純粋 module（移植候補、`@/lib/admin/spreadsheet/{validation,paste,cellFormat,apiTypes,importPrepCore,gridFind,constants}`、`@/lib/utils/{clipboardParse,delimited,clipboard,format}`、`@/lib/import/legacy/{range,cpuBudget}`、`@/lib/staticRebuild/publicReflectionNotice`）。`next/*`、`@/lib/db`、`@/lib/auth` を import するものは写さない（STOP）。
- 読み（既存 Hono、MIG-0605 U02 の read half）:
  - `GET /api/admin/spreadsheet/tables` … `apps/api/src/routes/admin/spreadsheet/read.ts:253`（client `spreadsheetApi.ts:34` の `fetchSpreadsheetCatalog`）
  - `GET /api/admin/spreadsheet/data` … `read.ts:182`（`spreadsheetApi.ts:54` の `fetchSpreadsheetPage`）
  - `GET /api/admin/spreadsheet/export` … `read.ts:216`（`spreadsheetApi.ts:133` / `:144`）
  - 環境の gate は `read.ts:58`（`ADMIN_SPREADSHEET_ENABLED`、404 `spreadsheet_disabled`）。
- 書き（SA は無し。Route Handler 系）:

| RH | 操作 | CURRENT の呼び出し元 | 所有 MIG | state |
| --- | --- | --- | --- | --- |
| RH-004 | `PATCH /api/admin/spreadsheet/data`（cell） | `spreadsheetApi.ts:73-82` `patchSpreadsheetCell` | MIG-0638 | READY |
| RH-005 | `POST /api/admin/spreadsheet/data`（row insert） | `spreadsheetApi.ts:90-98` `insertSpreadsheetRow` | MIG-0638 | READY |
| RH-006 | `DELETE /api/admin/spreadsheet/data`（row delete） | `spreadsheetApi.ts:101-110` `deleteSpreadsheetRow` | MIG-0638 | READY |
| RH-008 | `POST /api/admin/spreadsheet/import`（preview） | `spreadsheetApi.ts:155-165` `previewSpreadsheetImport` | MIG-0638 | READY |
| RH-008 | `POST /api/admin/spreadsheet/import`（apply） | `spreadsheetApi.ts:187-198` `runSpreadsheetImport` | MIG-0638 | READY |
| RH-002 | `POST /api/admin/import/legacy`（preview） | `LegacyCanonicalImportClient.tsx:660` | MIG-0645 | READY |
| RH-002 | `POST /api/admin/import/legacy`（apply） | `LegacyCanonicalImportClient.tsx:730` | MIG-0645 | READY |

- 既存の挙動: import の preview token は browser に返る（`spreadsheetApi.ts:177-193`、`useSpreadsheetImport.ts:180-200`）。legacy import は token を `sessionStorage` に置く（`LegacyCanonicalImportClient.tsx:204-236`）。batch 上限は `useSpreadsheetImport.ts:67`（`SPREADSHEET_IMPORT_MAX_BATCH_ROWS`）。
#### Owned paths
- 新規: `+apps/ops/src/routes/admin/spreadsheet/**`（2 画面、grid の移植、import modal）, `+apps/ops/src/api/spreadsheet.ts`（RH-003 / 004 / 005 / 006 / 007 / 008 / 009。1 行目 D-16-1 provisional）, `+apps/ops/src/api/legacyImport.ts`（RH-002、同）, `+apps/ops/src/lib/admin/spreadsheet/**` と `+apps/ops/src/lib/import/legacy/**`（上の純粋 module を 1 file ずつ。1 行目 `// Port of CURRENT <path> (MIG-0729). Same output.`）, `+apps/ops/src/styles/spreadsheet.css`（`portCssModule.mjs` の `MODULES` に `AdminSpreadsheetClient.module.css` と `LegacyCanonicalImportClient.module.css`）, `+apps/ops/test/spreadsheet.test.mjs`
- 新規（D-16-2）: `+apps/ops/src/api/write.ts`（先に merge した方が作る）
- 変更: `apps/ops/src/routes/router.tsx`（`/admin/spreadsheet`、`/admin/import` の Route 行）, `apps/ops/scripts/portCssModule.mjs`, `apps/ops/src/main.tsx`（css import）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(admin)/**`, `src/components/admin/**`, `src/lib/**`（移植元）, `apps/api/**`
#### Micro-units
- **U01 読みと grid**: `tables` / `data` / `export` の読み、table 一覧、grid（表示、選択、find、formula bar、status bar）。環境 off（404）の表示を CURRENT と同じにする。
- **U02 cell 編集**: PATCH / POST / DELETE（RH-004〜006）、undo / redo（`spreadsheetHistory.ts`）、context menu。失敗表示は `spreadsheetErrors.ts` の文言。
- **U03 spreadsheet import**: preview と apply（RH-008）、`SpreadsheetImportModal`、batch 上限（`useSpreadsheetImport.ts:67`）。preview token の扱いは CURRENT と同じ（browser に返る範囲だけ）。
- **U04 legacy import**: `/admin/import` の preview / apply（RH-002）、`sessionStorage` の credential（`LegacyCanonicalImportClient.tsx:204-236`）、`cpuBudget` と `range`。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | guest / user / moderator / owner / admin × 2 route | `(admin)/layout.tsx:23-27` と同じ（guest `/entry`、他は `/dashboard`） |
| T02 | `ADMIN_SPREADSHEET_ENABLED` 無効 | 404 相当の表示（`spreadsheet/page.tsx:20`、API `read.ts:58`） |
| T03 | preview token | CURRENT と同じ保存先（import 中のメモリ、legacy は `sessionStorage` のみ）。`localStorage` / IndexedDB へ保存しない |
| T04 | import 途中失敗 | 全件ロールバックの表示（API 側 MIG-0638。SPA は結果の表示だけ） |
| T05 | batch 上限を超える import | CURRENT と同じ拒否（`useSpreadsheetImport.ts:67`） |
| T06 | cell 編集 → undo → redo | `spreadsheetHistory.ts` の結果と同じ |
| T07 | export（CSV / TSV） | 形式と列順が CURRENT と同じ（`useSpreadsheetExport.ts`） |
| T08 | DOM を検査 | 任意 SQL を入力する欄と実行 button が無い |
| T09 | legacy import の preview → apply | 2 段階、`planHash` と `expiresAt` が CURRENT と同じ（`LegacyCanonicalImportClient.tsx:691-694`） |
#### Commands
```bash
npm ci --no-audit --no-fund
node apps/ops/scripts/portCssModule.mjs
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `app/(admin)/admin/spreadsheet/**` と `app/(admin)/admin/import/page.tsx` を IN_PROGRESS（移植先）。`API_MATRIX.md` の RH-002 / 003 / 004 / 005 / 006 / 007 / 008 / 009 に SPA の呼び出し元。`work-items/MIG-0729.md` に U01〜U04 の表。
#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T09 が PASS
- [ ] MIG-0605 / 0638 / 0645 が DONE で、client が `packages/contracts` の schema を使っている（D-16-1）
- [ ] 任意 SQL の入力欄が無い（T08）
- [ ] 独立レビュー（Opus）が APPROVE
- [ ] browser 確認（390px / 1440px）が PR にある
#### STOP
- 任意 SQL を実行する画面が必要に見えたら止める（MIG-0705 の STOP）。
- preview token を CURRENT より長く保持する実装が必要に見えたら止める。
- `ADMIN_SPREADSHEET_ENABLED` の判定を SPA 側で持つ必要が出たら止める（Hono が正）。
#### Rollback
PR を revert（`apps/ops` は本番に配信されていない）。

### MIG-0730: admin operations（workers・health・integrity・security・cost-guard・notifications・static-builds・YouTube quota / sync・retry）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — BLOCKED（D-17-1: MIG-0705 の分割。読みは MIG-0626（READY）、書きは MIG-0637 / 0642 / 0643（READY）。MIG-0707 の merge 後に READY。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0707 / **Decisions:** D-05 DECIDED, D-13-51（deep health の per-check 化）, D-14-10, D-15-9（RH-017 は MIG-0660。admin 画面の deep 実行とは別）, D-16-1, D-16-2, D-16-4, D-17-1
- **Merge gate:** MIG-0626（ops の読み全部と integrity / health の per-check、U05 / U06）, MIG-0637（SA-016..020）, MIG-0642（SA-045..048）, MIG-0643（SA-050, SA-069..073, SA-106）
- **Verified against:** `08e7e8cc` (2026-10-27)
#### Source snapshot
- CURRENT 画面（10 route）:
  - `app/(admin)/admin/workers/page.tsx`（305 行、`AdminSectionTabs` :73、読みは `lib/admin/workerMonitoring` :19 を直接）。
  - `app/(admin)/admin/health/page.tsx`（130 行。`DiagnosticStatusResults` :122、`?deep=1` / `run=1` の full run :45、link :93）。
  - `app/(admin)/admin/health/integrity/page.tsx`（318 行。`run=1` の 28 check :234 付近）。
  - `app/(admin)/admin/security/page.tsx`（101 行、`DiagnosticStatusResults` :93）。
  - `app/(admin)/admin/cost-guard/page.tsx`（266 行。`CostGuardForm` :156、`CostGuardOverrideForm` :161、`CostGuardDisabledFeaturesForm` :165）。
  - `app/(admin)/admin/notifications/page.tsx`（476 行。`NotificationActionButton` :264 / :454 / :457、`NotificationCancelButton` :462、`NotificationPayloadButton` :445）。
  - `app/(admin)/admin/static-builds/page.tsx`（740 行。`enqueueSharedRelatedInputsRebuildAdmin` :278、`enqueueStaticRebuildAdmin` :342 / :638、`repairDanglingPublicVisibilityManifestEntry` :400、`enqueueStaticBackfillBatch` :469、`StaticRebuildQueuePanel` :572〜574）。
  - `app/(admin)/admin/youtube-quota/page.tsx`（151 行、読みのみ。`lib/youtube/quotaPolicy` :14）。
  - `app/(admin)/admin/youtube-sync/page.tsx`（381 行。`queueYoutubeMetadataResync` form :325）。
  - `app/(admin)/admin/youtube-sync/playlists/page.tsx`（452 行、読みのみ、filter の GET form :279）。
- CURRENT components（`src/components/admin/**`）: `AdminSectionTabs.tsx`（50 行 + `.module.css`、0730 / 0731 / 0726 が共有）, `DiagnosticStatusResults.tsx`（249）, `CostGuardForm.tsx`（67）, `CostGuardOverrideForm.tsx`（79）, `CostGuardDisabledFeaturesForm.tsx`（150）, `NotificationActionButton.tsx`（174）, `NotificationCancelButton.tsx`（70）, `NotificationPayloadButton.tsx`（95）, `StaticRebuildQueuePanel.tsx`（190）。共通: `src/components/ui/ConfirmDialog`（`CostGuardForm.tsx:6`）、`src/components/notifications/NotificationOutboxSummary`。
- 読み（既存 Hono、`apps/api/src/routes/adminRead/ops.ts`。MIG-0626 の code は main にあるが task は READY）:
  - `GET /api/admin-read/ops/workers` … `ops.ts:462`（helper `workerMonitoring.ts`）
  - `GET /api/admin-read/ops/health` … `ops.ts:236`（operational view のみ。`deep=1` / `run=1` は 501 `deep_unsupported`、`ops.ts:239-240`）
  - `GET /api/admin-read/ops/integrity` … `ops.ts:328`（idle のみ。`run=1` は 501、`ops.ts:329`）
  - `GET /api/admin-read/ops/security` … `ops.ts:573`（`run=1` 付き、API_MATRIX.md:399）
  - `GET /api/admin-read/ops/cost-guard` … `ops.ts:880`
  - `GET /api/admin-read/ops/notifications` … `ops.ts:110`
  - `GET /api/admin-read/ops/static-builds` … `ops.ts:360`（shared-input の body 診断は未提供、API_MATRIX.md:401）
  - `GET /api/admin-read/ops/youtube-quota` … `ops.ts:765`（ローカル usage counter のみ、YouTube には問い合わせない、API_MATRIX.md:396）
  - `GET /api/admin-read/ops/youtube-sync` … `ops.ts:965`
  - `GET /api/admin-read/ops/youtube-playlists` … `ops.ts:641`（helper `playlistHealth.ts`）
- 書き（SA id → CURRENT の呼び出し元 → 所有 MIG → state）:

| SA | CURRENT 関数 | 呼び出し元 | 所有 MIG | state |
| --- | --- | --- | --- | --- |
| SA-016 | `setCostGuardMode` | `CostGuardForm.tsx:30` | MIG-0637 | READY |
| SA-017 | `setMaintenanceMode` | `CostGuardForm.tsx:30`（ON は ConfirmDialog :64） | MIG-0637 | READY |
| SA-018 | `setCostGuardOverride` | `CostGuardOverrideForm.tsx:32`（`OVERRIDE` 入力 :73） | MIG-0637 | READY |
| SA-020 | `clearCostGuardOverride` | `CostGuardOverrideForm.tsx:32`（`CLEAR` 入力 :74） | MIG-0637 | READY |
| SA-019 | `setDisabledFeatures` | `CostGuardDisabledFeaturesForm.tsx:102`（`APPLY` 入力 :142） | MIG-0637 | READY |
| SA-045 | `retryFailedNotification` | `NotificationActionButton.tsx:34`（kind `retry`、確認なし :45） | MIG-0642 | READY |
| SA-047 | `forceResendNotification` | `NotificationActionButton.tsx:35`（確認 :55） | MIG-0642 | READY |
| SA-048 | `retryAllFailedNotifications` | `NotificationActionButton.tsx:36`（page :264、確認 :67） | MIG-0642 | READY |
| SA-046 | `cancelNotification` | `NotificationCancelButton.tsx:24`（page :462） | MIG-0642 | READY |
| SA-050 | `repairDanglingPublicVisibilityManifestEntry` | `static-builds/page.tsx:400` | MIG-0643 | READY |
| SA-069 | `enqueueStaticBackfillBatch` | `static-builds/page.tsx:469` | MIG-0643 | READY |
| SA-071 | `enqueueStaticRebuildAdmin` | `static-builds/page.tsx:342`, `:638` | MIG-0643 | READY |
| SA-072 | `enqueueSharedRelatedInputsRebuildAdmin` | `static-builds/page.tsx:278` | MIG-0643 | READY |
| SA-070 | `retryFailedStaticRebuild` | `StaticRebuildQueuePanel.tsx:147`（retry） | MIG-0643 | READY |
| SA-073 | `retryAllFailedStaticRebuild` | `static-builds/page.tsx:574` → `StaticRebuildQueuePanel.tsx:76` | MIG-0643 | READY |
| SA-106 | `queueYoutubeMetadataResync` | `youtube-sync/page.tsx:325` | MIG-0643 | READY |

- 対象外の操作: `workers` / `health` / `integrity` / `security` / `youtube-quota` / `youtube-sync/playlists` は書き込み無し（form / button 無し）。
#### Owned paths
- 新規: `+apps/ops/src/routes/admin/ops/**`（10 route の画面と form component）, `+apps/ops/src/api/ops.ts`（読み `/api/admin-read/ops/*`、書きは各 MIG の endpoint。1 行目 D-16-1 provisional）, `+apps/ops/test/adminOps.test.mjs`
- 新規（D-16-2、D-16-4）: `+apps/ops/src/api/write.ts` と `+apps/ops/src/components/shared/ConfirmDialog.tsx` は 0728 が先に merge していれば import のみ
- 新規（D-16-4、先に merge した方が作る）: `+apps/ops/src/components/shared/AdminSectionTabs.tsx` と `.module.css`（0726 / 0731 と共有）、`portCssModule.mjs` の `MODULES` に `AdminSectionTabs.module.css` の行
- 変更: `apps/ops/src/routes/router.tsx`（10 route 行）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(admin)/**`, `src/components/admin/**`, `src/lib/admin/**`（移植元）, `apps/api/**`, `apps/ops/src/routes/admin/{identity,spreadsheet,audit,shell,events,videos}/**`
#### Micro-units
- **U01 読みだけの画面**: `workers`、`health`（operational view）、`integrity`（idle）、`security`、`youtube-quota`、`youtube-sync/playlists`。`DiagnosticStatusResults` を共有 leaf として移植（`src/components/shared` に置くか、0730 内に置く）。`deep=1` / `run=1` は MIG-0626 U05 / U06 の per-check が main に入るまで出さない（D-17）。
- **U02 cost-guard**: 読み（`ops/cost-guard`）と SA-016〜020。`CostGuardForm` の maintenance は `ConfirmDialog`（`:64`）、override は `OVERRIDE` / `CLEAR`、features は `APPLY`。
- **U03 notifications と static-builds**: 読み（`ops/notifications`、`ops/static-builds`）、SA-045〜048（retry / force-resend / cancel / bulk、確認は `NotificationActionButton.tsx:55` と `:67`）、SA-050 / SA-069〜073。`retry` は CURRENT と同じく確認なし。
- **U04 youtube-sync と retry**: `ops/youtube-sync` の読みと SA-106（`youtube-sync/page.tsx:325`）。再試行の表示（`StaticRebuildQueuePanel` の失敗件数 :78）を CURRENT と同じにする。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | guest / user / moderator / owner / admin × 10 route | `(admin)/layout.tsx:23-27` と同じ（guest `/entry`、他は `/dashboard`）。API は `adminRead/index.ts:36-38` |
| T02 | cost-guard の書き込みを権限なし（`requireCostGuardControlAdmin`、`src/lib/auth/writeGuard.ts:269`）で実行 | 返った `message` を表示（`CostGuardForm.tsx:31` の fallback「失敗しました。」） |
| T03 | maintenance ON → 確認を閉じる | API を呼ばない（`CostGuardForm.tsx:64`） |
| T04 | override の `OVERRIDE` / `CLEAR` 入力 | 入力が一致するまで button が無効（`CostGuardOverrideForm.tsx:73-74`） |
| T05 | features 適用の `APPLY` 入力 | 入力が一致するまで無効（`CostGuardDisabledFeaturesForm.tsx:142`） |
| T06 | notifications の retry（確認なし）/ force-resend（確認あり）/ bulk-retry（確認あり） | CURRENT と同じ確認の有無（`NotificationActionButton.tsx:45`, `:55`, `:67`、実行は `:92-93`） |
| T07 | `health?deep=1` / `integrity?run=1` | 501 を見せず、MIG-0626 U05 / U06 までは実行 UI を出さない（`ops.ts:240`, `:329`） |
| T08 | `youtube-quota` | YouTube へ問い合わせない表示（ローカル counter、API_MATRIX.md:396） |
| T09 | `static-builds` の retry all | 失敗件数の表示と確認の有無が CURRENT と同じ（`StaticRebuildQueuePanel.tsx:76`, `:78`） |
| T10 | 読みの失敗（`ops/notifications` の `query_failed`、`ops/cost-guard` の defaults） | CURRENT と同じ表示（API_MATRIX.md:390-391） |
| T11 | `workers` | 外部 Cloudflare API を呼ばない（API_MATRIX.md:400） |
#### Commands
```bash
npm ci --no-audit --no-fund
node apps/ops/scripts/portCssModule.mjs
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `app/(admin)/admin/{workers, health/**, security, cost-guard, notifications, static-builds, youtube-quota, youtube-sync/**}` を IN_PROGRESS（移植先）。`API_MATRIX.md` の SA-016〜020, SA-045〜048, SA-050, SA-069〜073, SA-106 に SPA の呼び出し元。`work-items/MIG-0730.md` に U01〜U04 の表。
#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T11 が PASS
- [ ] MIG-0626 / 0637 / 0642 / 0643 が DONE で、client が `packages/contracts` の schema を使っている（D-16-1）
- [ ] retry と cost guard の確認が CURRENT と同じ
- [ ] `deep=1` / `run=1` の実行 UI が、MIG-0626 U05 / U06 の per-check endpoint を使うまで出ていない
- [ ] 独立レビュー（Opus）が APPROVE
- [ ] browser 確認（390px / 1440px）が PR にある
#### STOP
- 運用モードや cost guard の判定を SPA 側で決める必要が出たら止める（Hono が正）。
- `deep=1` / `run=1` を 1 request で実行する形にしそうになったら止める（MIG-0626 U05 / U06 へ返す）。
- static-builds の shared-input body 診断（R2 の読み）が必要になったら止める（MIG-0627 は BLOCKED、STATUS.md:340）。
- 任意の Worker / Route / Custom Domain を操作する必要が出たら止める（明示承認事項）。
#### Rollback
PR を revert（`apps/ops` は本番に配信されていない）。

### MIG-0731: admin audit（audit 一覧・詳細・restore（dry-run → apply）・settings・history redirect）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — BLOCKED（D-17-1: MIG-0705 の分割。読みは MIG-0626（READY）。dry-run と settings は MIG-0629（DONE）。apply（SA-011）は MIG-0662のため U03 は STOP。MIG-0707 の merge 後に READY。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0707, MIG-0629, MIG-0616 / **Decisions:** D-05 DECIDED, D-13-53（`auditPreloaded`）, D-13-54（dry-run の host）, D-13-55, D-16-1, D-16-2, D-17-1
- **Merge gate:** MIG-0626（audit 一覧、詳細、payload chunk、restore 一覧、audit-settings の読み）, MIG-0662（SA-011 `POST /api/admin/audit/restore`、D-17-4）
- **Verified against:** `08e7e8cc` (2026-10-27)
#### Source snapshot
- CURRENT 画面（5 route）:
  - `app/(admin)/admin/audit/page.tsx`（821 行。tabs `AdminSectionTabs` :189、filter の GET form :191、`AuditDiffDetail` :451、`AuditTargetLink`）。
  - `app/(admin)/admin/audit/[id]/page.tsx`（395 行。`AuditDiffDetail` :278、`AuditRestoreForm` :303。直接 DB 読み :53）。
  - `app/(admin)/admin/audit/restore/page.tsx`（130 行。実行 form なし。直近 50 件の run の表示、tabs :53、`FnTable` :12）。
  - `app/(admin)/admin/audit/settings/page.tsx`（106 行。`AuditSettingsForm` :101）。
  - `app/(admin)/admin/history/page.tsx`（5 行、`redirect("/admin/audit")` :5）。
- CURRENT components（`src/components/admin/**`）: `AuditDiffDetail.tsx`（164 行）, `AuditRestoreForm.tsx`（376）, `AuditSettingsForm.tsx`（178）, `AuditTargetLink.tsx`（111）, `AdminSectionTabs.tsx`（50 + `.module.css`、0730 と共有）。
- 読み（既存 Hono、`apps/api/src/routes/adminRead/**`、MIG-0626 の code は main にある）:
  - `GET /api/admin-read/audit?table&operation&actor&record&restore_status&limit&since&until` … `audit.ts:45`（本文は 48 KiB で truncate、API_MATRIX.md:387）
  - `GET /api/admin-read/audit/:id` … `audit.ts:171`（prev / next を含む）
  - `GET /api/admin-read/audit/:id/payload/:field?offset` … `audit.ts:210`（12,000 字の chunk、`nextOffset`）
  - `GET /api/admin-read/audit/restore` … `audit.ts:137`（直近 50 件の run）
  - `GET /api/admin-read/audit-settings` … `settings.ts:260`
- 書き（SA id → CURRENT の呼び出し元 → 所有 MIG → state）:

| SA | CURRENT 関数 | 呼び出し元 | 所有 MIG | state |
| --- | --- | --- | --- | --- |
| SA-009 | `updateAuditLogSettingsAction` | `AuditSettingsForm.tsx:50` → `POST /api/admin/audit/settings`（`apps/api/src/routes/admin/audit.ts:59`） | MIG-0629 | DONE |
| SA-010 | `getAuditLogDryRun` | `AuditRestoreForm.tsx:48` → `POST /api/admin/audit/dry-run`（`admin/audit.ts:99`、write は 0） | MIG-0629 | DONE |
| SA-011 | `restoreAuditLogAction` | `AuditRestoreForm.tsx:66`（apply） → Hono の endpoint は無し | MIG-0662 | BLOCKED |

- SA-011 の core（`restoreAuditLog`）は MIG-0616（DONE）。Hono の apply endpoint は MIG-0662（D-17-4）。
- 確認: `RESTORE ${auditId}` を入力するまで apply 不可（`AuditRestoreForm.tsx:24`, `:57`, `:229`）。
#### Owned paths
- 新規: `+apps/ops/src/routes/admin/audit/**`（一覧、詳細、restore 一覧、settings、history の redirect）, `+apps/ops/src/api/audit.ts`（読みは `/api/admin-read/audit*`、dry-run は `POST /api/admin/audit/dry-run`、settings は `POST /api/admin/audit/settings`、apply は `POST /api/admin/audit/restore`（MIG-0662）。1 行目 D-16-1 provisional）, `+apps/ops/test/adminAudit.test.mjs`
- 新規（D-16-2）: `+apps/ops/src/api/write.ts`（先に merge した方が作る）
- 新規（D-16-4、先に merge した方が作る）: `+apps/ops/src/components/shared/AdminSectionTabs.tsx` と `.module.css`（0730 / 0726 と共有。先に merge した方が作る）
- 変更: `apps/ops/src/routes/router.tsx`（`/admin/audit`、`/admin/audit/:id`、`/admin/audit/restore`、`/admin/audit/settings`、`/admin/history`）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(admin)/**`, `src/components/admin/**`, `src/lib/audit/**`, `apps/api/**`（SA-011 の endpoint は MIG-0662）
#### Micro-units
- **U01 一覧・詳細・payload**: `audit`（filter 7 項目、truncate の表示）、`audit/:id`（prev / next、`AuditDiffDetail`）、`payload/:field` の chunk 読み。`AuditTargetLink` を移植。
- **U02 restore 一覧と dry-run**: `audit/restore` の一覧（直近 50 件、`FnTable`）と、詳細の `AuditRestoreForm` の dry-run（SA-010）。dry-run は書き込みを行わない（D-13-54）。
- **U03 apply（SA-011）**: `RESTORE <id>` の入力と apply。apply は MIG-0662 の `POST /api/admin/audit/restore`（D-17-4）を呼ぶ。client は D-16-1 の暫定の型で作る。
- **U04 settings と history**: `audit/settings` の読みと `AuditSettingsForm`（SA-009）、`/admin/history` → `/admin/audit` の redirect（`history/page.tsx:5`）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | guest / user / moderator / owner / admin × 5 route | `(admin)/layout.tsx:23-27` と同じ（guest `/entry`、他は `/dashboard`） |
| T02 | `/admin/audit` の filter（table / operation / actor / record / restore_status / since / until） | CURRENT と同じ行（`audit.ts:45`、API_MATRIX.md:387） |
| T03 | 詳細の prev / next と payload の chunk（`nextOffset`） | 同じ順序と同じ文字列（`audit.ts:171`, `:210`） |
| T04 | dry-run | diff の表示。書き込み 0 件（`admin/audit.ts:99`、D-13-54） |
| T05 | `RESTORE <id>` が未入力 | apply が無効（`AuditRestoreForm.tsx:229`）。API を呼ばない |
| T06 | apply の conflict / error / 結果 | CURRENT の 3 状態を表示（FEATURE_CATALOG.md UX-ADM-017） |
| T07 | settings の保存（5 項目） | 検証文言と成功文言が CURRENT と同じ（`AuditSettingsForm.tsx:50` 周辺） |
| T08 | `/admin/history` | `/admin/audit` へ redirect（`history/page.tsx:5`） |
| T09 | 権限なしで dry-run / settings | `requireAdmin` の拒否 message を表示（`src/lib/actions/audit-admin.ts:22`, `:50`, `:94`） |
#### Commands
```bash
npm ci --no-audit --no-fund
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `app/(admin)/admin/audit/**` と `app/(admin)/admin/history/page.tsx` を IN_PROGRESS（移植先）。`API_MATRIX.md` の SA-009 / SA-010 に SPA の呼び出し元。SA-011 は所有 MIG が決まった時点で記録する。`work-items/MIG-0731.md` に U01〜U04 の表（U03 は STOP と書く）。
#### DONE checklist
- [ ] U01〜U02 と U04 が DONE、T01〜T09 が PASS。MIG-0662 が DONE
- [ ] MIG-0626 が DONE で、client が `packages/contracts` の schema（`adminReadOps.ts` の audit 系、`admin/audit.ts`）を使っている（D-16-1）
- [ ] dry-run が書き込みを行わないことを確認
- [ ] 独立レビュー（Opus）が APPROVE
- [ ] browser 確認（390px / 1440px）が PR にある
#### STOP
- restore が可能かどうかの判定（`restore_status`、`restore_strategy`）を SPA 側で決める必要が出たら止める（Hono が正）。
- restore の apply を dry-run なしで実行できる形にしない（CURRENT は dry-run の後に確認して apply）。
#### Rollback
PR を revert（`apps/ops` は本番に配信されていない）。

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
