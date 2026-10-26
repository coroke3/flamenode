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

### MIG-0704: manage（Manage イベント運営画面群の Final audit）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — D-17-11: 画面は MIG-0719〜0725 に分割。本 task は Final audit だけで、MIG-0719〜0725 の DONE 後
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0719..MIG-0725 / **Decisions:** D-05 DECIDED, D-14-3, D-15-13, D-16-5, D-17-11
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- CURRENT の Manage 12 ルート（`CURRENT_ROUTES.md:64-75`、review は互換 redirect）と layout（`app/(manage)/layout.tsx`）。分割先: MIG-0719（枠・`/manage`・review・`apps/ops/wrangler.toml`）、0720（概要・audience）、0721（編集）、0722（slots）、0723（staff）、0724（videos・1 件）、0725（playlist・通知・X 連携）。
#### Owned paths
- 変更: `docs/migration/work-items/MIG-0704.md`（audit 表だけ）, `docs/migration/ROUTE_MATRIX.md`（Manage 12 の移行先）
- 触らない: `apps/**`, `app/**`, `src/**`
#### Micro-units
- **U01 route 表**: 12 ルート × 分割先 task × merge PR × UX / FN / SA の対応表を work item に書く。1 つでも欠けたら本 task は REVIEW にしない（TASK_MICRO_UNITS MIG-0704 の Final audit）。
- **U02 横断の確認**: 担当外 event の URL が全画面で 404、Personal と Ops の build で asset が混ざらない、deep URL の再読込。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | Personal と Ops の build | CSS/JS が互いに混ざらない |
| T02 | 担当外イベントの URL（8 画面） | 拒否 |
| T03 | 最後の owner の解任 | 拒否（MIG-0723 T02） |
| T04 | `/manage/events/[id]/review` | `videos?status=pending` へ互換 redirect（MIG-0719 T04） |
| T05 | route × role（guest, user, staff, owner, admin）（G12） | Location（`error` query を含む）が CURRENT の layout と同じ |
| T06 | Ops の HTML（G12） | `meta robots noindex` がある |
#### Commands
```bash
npm run build --workspace=@flamenode/app
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run check:event-owners
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の Manage 12 行が分割先の task で DONE になっていることを確かめる（変更はしない）。`ROUTE_MATRIX.md` に移行先。
#### DONE checklist
- [ ] U01〜U02 が DONE、T01〜T06 が PASS
- [ ] MIG-0719〜0725 が DONE
#### STOP
- 分割先に無いルート・機能が見つかったら止めて、新しい MIG を lead に提案する。
- Ops の Worker / Route を本番に作る必要が出たら止める（明示承認事項）。
#### Rollback
audit の PR を revert。

### MIG-0705: admin（Admin 全体管理者画面群の Final audit）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — D-17-11: 画面は MIG-0726〜0737 に分割。本 task は Final audit だけで、MIG-0726〜0737 の DONE 後
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0726..MIG-0737 / **Decisions:** D-05 DECIDED, D-13-56, D-14-14, D-15-15, D-16-5, D-16-13, D-17-11
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- CURRENT の Admin 45 ルート（`CURRENT_ROUTES.md:81-125`）と layout（`app/(admin)/layout.tsx`）。分割先: MIG-0726（枠・`/admin`・simulator・redirect 5）、0727（お知らせ 3・API endpoint・規約 3）、0728（group 3・event 一覧・template）、0721（`/admin/events/new`）、0729（video 一覧・1 件）、0730（member）、0731（user 3・moderation）、0732（X 連携・統合）、0733（監査 4）、0734（cost guard・通知）、0735（static builds・YouTube 3）、0736（health 2・security・workers）、0737（spreadsheet・import）。
#### Owned paths
- 変更: `docs/migration/work-items/MIG-0705.md`（audit 表だけ）, `docs/migration/ROUTE_MATRIX.md`（Admin 45 の移行先）
- 触らない: `apps/**`, `app/**`, `src/**`
#### Micro-units
- **U01 route 表**: 45 ルート × 分割先 task × merge PR × UX / FN / SA / RH の対応表（TASK_MICRO_UNITS MIG-0705 U08）。1 つでも欠けたら REVIEW にしない。
- **U02 横断の確認**: 権限表（guest / user / moderator / owner / admin）、Personal の bundle に Ops の code が無い、危険操作が各 task で独立レビュー済み。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | guest / user / moderator / owner / admin × 45ルート | CURRENT と同じ可否 |
| T02 | spreadsheet の import 途中失敗 | 全件ロールバック（MIG-0737 T03） |
| T03 | 発行 token | ブラウザに渡らない（MIG-0737 T05） |
| T04 | Personal bundle | admin のコードが入っていない |
| T05 | admin guard の Location（`error` query を含む）（G12） | CURRENT の layout と同じ（MIG-0726 T01） |
| T06 | Admin 45 の読み取り（G13） | `/api/admin-read/*` などの endpoint を使い、直接 D1 を import しない |
#### Commands
```bash
npm run build --workspace=@flamenode/ops
npm run build --workspace=@flamenode/app
npm run test --workspace=@flamenode/ops
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の Admin 45 行が分割先の task で DONE になっていることを確かめる。`ROUTE_MATRIX.md` に移行先。
#### DONE checklist
- [ ] U01〜U02 が DONE、T01〜T06 が PASS
- [ ] MIG-0726〜0737 が DONE、危険操作が独立レビューを通っている
#### STOP
- 任意SQLを実行できる画面が必要に見えたら止める。
- 分割先に無いルート・機能が見つかったら止めて、新しい MIG を lead に提案する。
#### Rollback
audit の PR を revert。

### MIG-0707: Ops SPA の土台（`apps/ops` の package・build・guard、MIG-0704 U01）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-15-13: MIG-0704 U01 の scaffold を分割。読み API（MIG-0624 / MIG-0625 / RH-001）は DONE。D-17-1 で Ops の画面 task（MIG-0719〜0737）の Merge gate になり、D-17-2 / 3 / 6 の共通部品を U05 で持つ。最初に着手すると画面 task の暫定の土台が要らなくなる。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0102, MIG-0608, MIG-0624, MIG-0625 / **Decisions:** D-05 DECIDED, D-13-4, D-15-13, D-17-1, D-17-2, D-17-3, D-17-6
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- 手本（Personal SPA、MIG-0701）: `apps/app/package.json`（scripts `build: "tsc && vite build"`、`test: "tsc -p tsconfig.test.json && node --test test/*.test.mjs"`、deps `@flamenode/contracts` / `@flamenode/ui` / react 19 / react-router-dom 7）、`apps/app/vite.config.ts`（`base: "/"`, `build.assetsDir: "_personal_assets"`）、`apps/app/tsconfig.json`、`apps/app/index.html`、`apps/app/src/{main,App}.tsx`、`apps/app/src/routes/guard.tsx`（`LoginRequired` / `BannedNotice` / `AuthErrorView`）、`apps/app/public/_headers`。
- CURRENT の guard: `app/(manage)/layout.tsx`（user 無し → `/entry`、`enrichmentFailed` → `/entry?error=auth_temporarily_unavailable`、`canAccessAdmin` も `canAccessManage` も無い → `/dashboard`、robots noindex/nofollow）、`app/(admin)/layout.tsx`（同じ順で、`role !== "admin"` → `/dashboard`）。
- guard の入力: RH-001 `GET /api/account/summary`（`apps/api/src/routes/account/summary.ts`、`canAccessAdmin` / `canAccessManage` :282-302）。sidebar の event 一覧は `GET /api/manage/navigation`（`apps/api/src/routes/manage/navigation.ts`）。
- `CostGuardBanner`（`src/components/layout/CostGuardBanner.tsx`、server で `resolveCostGuardBannerSnapshot` を読む）を返す HTTP endpoint は main に無い（`apps/api/src/routes/live/operationMode.ts` は live API 内部用）。D-15-13 で banner は MIG-0704 に残す。
- CI: `.github/workflows/migration-docs-check.yml:103`（`npm run build --workspace=@flamenode/app`）。
#### Owned paths
- 新規: `+apps/ops/package.json`（`@flamenode/ops`）, `+apps/ops/index.html`（`<meta name="robots" content="noindex, nofollow">`）, `+apps/ops/tsconfig.json`, `+apps/ops/tsconfig.test.json`, `+apps/ops/vite.config.ts`（`base: "/"`, `build.assetsDir: "_ops_assets"`）, `+apps/ops/src/{main,App}.tsx`, `+apps/ops/src/routes/{router,guard}.tsx`, `+apps/ops/src/api/account.ts`, `+apps/ops/public/_headers`, `+apps/ops/test/{guard,build}.test.mjs`
- 新規（U05、D-17-2 / 3 / 6）: `+apps/ops/src/api/{read,write}.ts`, `+apps/ops/src/routes/{useApiResult.ts,NotFoundView.tsx}`, `+apps/ops/src/components/shared/{ConsolePageHeader,ConsolePanel,ConsoleShell,ConsoleDrawer,FnTable,EmptyState,ConfirmDialog,AutoSubmitSelect,Pagination,SaveSuccessNotice,PublicReflectionDelayNotice,Icon,AdminResourceTabs,AdminSectionTabs,ManageXIcon}.tsx`, `+apps/ops/src/styles/current/{globals,redesign-public,mobile-public,admin-manage,admin-mobile,mobile-hardening}.css`, `+apps/ops/src/styles/{fonts,shared}.css`, `+apps/ops/src/assets/FlameNodeSans.otf`, `+apps/ops/scripts/portCssModule.mjs`, `+apps/ops/test/{api,styles,shared}.test.mjs`
- 新規（MIG-0701 U04b が main に無いときだけ。その Work Order の文面のまま、D-16-4）: `+apps/app/scripts/portCssModule.mjs`
- 変更: `package-lock.json`, `.github/workflows/migration-docs-check.yml`（Ops の build と test を 2 行）, `apps/site/src/gateway/assetHeaders.test.mjs`（D-13-4 の `ops` 追加）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `apps/app/**`, `app/(manage)/**`, `app/(admin)/**`, `packages/ui/**`
#### Micro-units
- **U01 package + build**: `apps/app` と同じ形で package / tsconfig / vite.config / index.html を作る（`assetsDir` と noindex だけが違う）。`npm ci` で lock を更新。
- **U02 router + guard**: `/manage`、`/manage/*`、`/admin`、`/admin/*` の route 枠（中身は「未移行」の空ページ。MIG-0704 / 0705 が埋める）。guard は RH-001 の応答で CURRENT の layout と同じ Location に `window.location.assign`（SPA 間は通常の navigation、D-05）。error boundary は `apps/app` の `AuthErrorView` と同じ文言。
- **U03 `_headers`**（D-13-4、MIG-0704 から移す）: `apps/ops/public/_headers` に `/_ops_assets/*` `Cache-Control: public, max-age=31536000, immutable`（HTML には rule を置かない）。`assetHeaders.test.mjs` に `const ops = parse(await read("apps/ops/public/_headers"));` を足し、T01 の `/_ops_assets/index-AbC123.js` / `.css` / `a-AbC.svg` が `IMMUTABLE`、T03 の HTML の loop と `for (const rules of [site, app])` に `ops` を足す。
- **U04 CI**: workflow に `npm run build --workspace=@flamenode/ops` と `npm run test --workspace=@flamenode/ops`。
- **U05 共通部品（D-17-2 / 3 / 6）**:
  - `api/read.ts`: D-17-2 の `getJson` と `OpsResult<T>`。`api/write.ts`: D-16-2 の `send` と同じ signature・写像。`routes/useApiResult.ts`: MIG-0708 U01 の `useApiResult`（`refreshKey` 付き）と同じ本体で、第 1 引数を `fetchFn` にしたもの。`routes/NotFoundView.tsx`: CURRENT の 404（`app/not-found.tsx`）と同じ文言。
  - global CSS: MIG-0701 U04a と同じ `cp` を `apps/ops/src/styles/current/` に対して行い、`cmp` で 6 file が byte 一致（中身は編集しない）。font は MIG-0701 U04c の `fonts.css` と otf を `apps/ops` に同じ内容で作る。
  - `apps/ops/scripts/portCssModule.mjs`: 1 行目 `export { portCssModule } from "../../app/scripts/portCssModule.mjs";`、`MODULES` は `[["empty", "src/components/ui/EmptyState.module.css", "apps/ops/src/styles/shared.css"], ...]` の形で、EmptyState（78 行）・ConfirmDialog（109 行）・AdminSectionTabs（11 行）の 3 module を 1 file `shared.css` に順に連結して書く（prefix は `empty` / `confirm` / `sectabs`）。CLI の部分は MIG-0701 U04b と同じ。画面 task は自分の module をこの `MODULES` に行で足し、出力先は `apps/ops/src/styles/<task の名前>.css`。
  - leaf 部品: `src/components/` の `layout/ConsolePageHeader.tsx`（81 行）, `layout/ConsolePanel.tsx`（35）, `layout/ConsoleShell.tsx`（34）, `layout/ConsoleDrawer.tsx`（254）, `ui/FnTable.tsx`（21）, `ui/EmptyState.tsx`（98）, `ui/ConfirmDialog.tsx`（139）, `forms/AutoSubmitSelect.tsx`（169、`AutoSubmitCheckbox` を含む）, `ui/Pagination.tsx`（139）, `ui/SaveSuccessNotice.tsx`（29）, `ui/PublicReflectionDelayNotice.tsx`（17）, `ui/Icon.tsx`（403）, `admin/AdminResourceTabs.tsx`（40）, `admin/AdminSectionTabs.tsx`（50）, `manage/ManageXIcon.tsx`（42）を `apps/ops/src/components/shared/` に 1 対 1 で移す。置き換えは 3 種類だけ: `next/link` の `Link` → Ops 内の path は `react-router-dom` の `Link`、それ以外は `<a>`。`next/navigation` の `useRouter().push` / `refresh` → D-17-3。CSS module の `styles.x` → `className="<prefix>-x"`。文言・class・aria・props の名前は変えない。1 行目は `// Port of CURRENT <path> (MIG-0707 U05, D-17-6). Same output.`。
  - `test/shared.test.mjs`: 各部品を jsdom で render し、CURRENT の同じ props の出力と class・文言が同じ（`apps/app/test/helpers.mjs` の render と同じ書き方）。`test/api.test.mjs`: `getJson` の 6 写像と `send` の 3 写像。`test/styles.test.mjs`: MIG-0701 U04d の 1 と 2 を `apps/ops` の path で。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | Personal と Ops の build | 両方成功、`dist/_personal_assets` と `dist/_ops_assets` に分かれ、互いの chunk 名が出ない |
| T02 | guard: 未ログイン / enrichment 失敗 / manage 権限なし / admin 以外が `/admin` | Location が CURRENT の layout と同じ（`error` query を含む） |
| T03 | Ops の HTML | `meta robots noindex` がある |
| T04 | `/_ops_assets/*`（MIG-0620 T01） | immutable 1 年、HTML は null |
| T05 | `getJson` に 200 / 401 / 403 `{redirect}` / 404 / 501 / 500 | ok / anonymous / forbidden（redirect を保つ）/ notFound / unsupported / unavailable |
| T06 | shared 部品 15 個 | CURRENT と同じ class・文言・aria |
| T07 | `apps/ops/src/styles/current/*.css` | CURRENT `src/styles/*.css` と byte 一致 |
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
- [ ] U01〜U05 が DONE、T01〜T07 が PASS
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

### MIG-0719: Ops の Manage の枠・`/manage`・review の互換 redirect・`apps/ops/wrangler.toml`（MIG-0704 U01/U02 の一部、D-17）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-17: MIG-0704 から分割。契約先行で、merge は MIG-0707・MIG-0661・MIG-0628 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0624, MIG-0608 / **Decisions:** D-05 DECIDED, D-13-6, D-14-3, D-16-1, D-16-13, D-17-1, D-17-2, D-17-3, D-17-6, D-17-11
- **Merge gate:** MIG-0707, MIG-0661, MIG-0628 が DONE（D-16-1, D-17-1）
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- layout: `app/(manage)/layout.tsx`（52 行）。guard は `getLayoutAuthSurface()`（:27）→ user 無し `/entry`（:29）、`enrichmentFailed` → `/entry?error=auth_temporarily_unavailable`（:30-32）、`!canAccessAdmin && !canAccessManage` → `/dashboard`（:33-35）。robots noindex（:11-13）。wrapper `<div data-manage-shell data-fn-surface="manage">`（:38）、`<CostGuardBanner />`（:39、公開 source、D-16-13）、`ConsoleShell consoleMode="manage"` に `navigation=<ConsoleSidebar consoleMode="manage" />`（:41-44）、`<main className="manage-main">`（:45）。`PublicHeader` / `PublicFooter`（:40, :49）は FIX-0701-1（D-13-6、D-17-6）。
- sidebar: `src/components/layout/ConsoleSidebar.tsx`（120 行）の manage 分岐（:93-117）。admin でなく、担当 event が 0 件で、`canManageXIdLinkRequests` も無いと null（:99-103）。`ManageSidebarNav`（`src/components/manage/ManageSidebarNav.tsx`、275 行、client、`usePathname` の一致 :34-37）に `events` / `showXLinkRequests` / `warnActiveX` / `activeX`。CSS は `src/components/admin/AdminSidebarNav.module.css`（105 行）。
- 読み: `GET /api/manage/navigation`（`apps/api/src/routes/manage/navigation.ts:9`、CURRENT `getManageNavigationSnapshot` = `src/lib/manage/navigationEvents.ts:200`）。guard は MIG-0707 の RH-001 guard。banner は `GET /api/operation-mode/banner`（MIG-0661、D-16-13）、表示は `src/components/layout/CostGuardBanner.tsx`（98 行）:77-95 と `CostGuardBanner.module.css`（17 行）。
- `/manage`: `app/(manage)/manage/page.tsx`（439 行）。session 無しは `/entry?next=`、BAN は BannedNotice（:46-47）。DB 無しは「DB に接続できませんでした」の header（:51-61）。event 0 件は EmptyState（:134-168）。非 admin に `ManageActiveXNotice`（`src/components/layout/ManageActiveXNotice.tsx`、31 行、:172-177）。KPI（:193-221、pending > 0 で warn :205、failed > 0 で danger :215）、failed の alert → `/manage/notifications?status=failed`（:223-229）、schema 欠落の注意（:231-236）、event card（:241-328、`/manage/events/{id}`・`/videos?status=pending` :297、admin だけ `/edit` :317-324）、`/manage/x-link-requests` の link は `canManageXIdLinkRequests` のときだけ（:186-190）、非 admin の「代表」「運営」badge（:262-266）。部品 `NotificationOutboxSummary`（`src/components/notifications/NotificationOutboxSummary.tsx`、138 行）。読み `GET /api/manage`（`apps/api/src/routes/manage/dashboard.ts:13`、`eventsTruncated` :41）。
- review: `app/(manage)/manage/events/[id]/review/page.tsx`（13 行）は `redirect('/manage/events/{encodeURIComponent(id)}/videos?status=pending')`（:12）だけ。
- `apps/ops/wrangler.toml`: D-14-3。形は MIG-0628 の `apps/app/wrangler.toml`（静的 asset だけ、id は placeholder）。
#### Owned paths
- 新規: `+apps/ops/src/routes/manage/{ManageLayout,ManageSidebarNav,ManageActiveXNotice,ManageDashboard,ManageReviewRedirect}.tsx`, `+apps/ops/src/components/layout/CostGuardBanner.tsx`, `+apps/ops/src/api/{manageNavigation,manageDashboard,operationMode}.ts`（`operationMode.ts` の 1 行目は D-16-1 の provisional comment）, `+apps/ops/src/styles/manage-shell.css`（`portCssModule` の `MODULES` に AdminSidebarNav と CostGuardBanner の 2 行）, `+apps/ops/test/manageShell.test.mjs`, `+apps/ops/wrangler.toml`
- 新規（MIG-0720 / 0725 / 0734 と先に merge した方が作る、D-17-6）: `+apps/ops/src/components/notifications/NotificationOutboxSummary.tsx`
- 変更: `apps/ops/src/routes/router.tsx`（`/manage` の枠を `ManageLayout` に、index と review の route 行）, `apps/ops/scripts/portCssModule.mjs`（`MODULES` に行）, `apps/ops/src/main.tsx`（css import 1 行）, `.github/workflows/migration-docs-check.yml`（`wrangler deploy --dry-run --config apps/ops/wrangler.toml` 1 行）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(manage)/**`, `src/components/**`, `apps/api/**`, `apps/app/**`, MIG-0707 の Owned paths（route 行を除く）
#### Micro-units
- **U01 枠**: `ManageLayout` が MIG-0707 の guard を通った後に `GET /api/manage/navigation` を読み、CURRENT の wrapper・banner・`ConsoleShell`・sidebar・`<main className="manage-main">` を同じ順で出す。navigation の 403 `{reason:"manage_access_required"}` は `/dashboard` へ（D-17-2）。sidebar が null になる条件は CURRENT :99-103 と同じ。応答に `showXLinkRequests` / `warnActiveX` / `activeX` の材料が無いと分かったら STOP（API を変えない）。
- **U02 banner**: `CostGuardBanner` は MIG-0718 と同じ表示（4 mode の label / 説明 / reason、normal と失敗で何も出さない）。client は `GET /api/operation-mode/banner`。
- **U03 `/manage`**: `ManageDashboard` を CURRENT :46-328 の分岐の順に移植（文言・class を変えない）。`NotificationOutboxSummary` は D-17-6。
- **U04 review redirect**: `/manage/events/:id/review` は `<Navigate to={"/manage/events/" + encodeURIComponent(id) + "/videos?status=pending"} replace />`。
- **U05 wrangler**: MIG-0628 の `apps/app/wrangler.toml` を写し、`name = "flamenode-ops"` と assets の directory を `apps/ops/dist` にする。Route・Custom Domain は書かない。CI に dry-run 1 行。
- **U06 merge 直前**（D-16-1 の 5、D-17-1）: MIG-0707・0661・0628 の DONE 後の main を取り込み、暫定の土台を main の版に戻し、`operationMode.ts` を MIG-0661 の contracts の schema に置き換える。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | account summary: 未ログイン / enrichment 失敗 / manage 権限なし | Location が CURRENT layout :29-35 と同じ |
| T02 | navigation の event 0 件・admin でない・X 承認権限なし | sidebar を出さない（:99-103） |
| T03 | `/manage` の pending 3 / failed 1 | KPI に warn / danger の class、failed の alert link |
| T04 | `/manage/events/a%20b/review` | `/manage/events/a%20b/videos?status=pending` に replace |
| T05 | banner の mode 4 種 / normal / 503 | CURRENT と同じ表示 / 何も出さない |
| T06 | `wrangler deploy --dry-run --config apps/ops/wrangler.toml` | 成功、Route なし |
#### Commands
```bash
node apps/ops/scripts/portCssModule.mjs
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npx wrangler deploy --dry-run --outdir /tmp/wr-ops --config apps/ops/wrangler.toml
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と、`app/(manage)/layout.tsx`・`app/(manage)/manage/page.tsx`・`.../review/page.tsx`・`ConsoleSidebar.tsx`・`ManageSidebarNav.tsx`・`ManageActiveXNotice.tsx` 行の移植先（MIG-0719、IN_PROGRESS）。
#### DONE checklist
- [ ] U01〜U06 が DONE、T01〜T06 が PASS
- [ ] MIG-0707・0661・0628 が DONE で、暫定の土台と型が残っていない（D-17-1）
- [ ] browser 確認（390px / 1440px、guest / staff / admin）が PR にある
#### STOP
- Ops の Worker / Route / Custom Domain を作る必要が出たら止める（明示承認事項）。
- navigation / account summary に無い値が要ると分かったら止める（API を変えない）。
- 暫定の土台が MIG-0707 の版と合わず画面が動かないときは止めて MIG-0707 に返す（D-17-1）。
#### Rollback
Phase 7 共通契約のとおり（`apps/ops` は本番に配信されていない）。

### MIG-0720: `/manage/events/:id` の概要と `/audience`（SA-035、MIG-0704 U02 の一部、D-17）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-17: MIG-0704 から分割。契約先行で、merge は MIG-0707・MIG-0719・MIG-0655 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0624 / **Decisions:** D-05 DECIDED, D-16-1, D-17-1, D-17-2, D-17-3, D-17-6
- **Merge gate:** MIG-0707, MIG-0719, MIG-0655 が DONE（D-16-1, D-17-1）
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- 共通の枠: `src/components/manage/ManageEventPageShell.tsx`（70 行。`ConsolePageHeader` + `ManageEventTabs`（181 行、client）+ `ManageEventMoreMenu`（74 行）、`showActiveXNotice` で `ManageActiveXNotice` :46-51）。Manage の event 画面 8 つが使う。本 task が `apps/ops/src/components/manage/` に作り、MIG-0721〜0725 は import だけ（本 task より先に merge する task があれば、その task が同じ内容で作る、D-17-6）。
- 概要: `app/(manage)/manage/events/[id]/page.tsx`（657 行）。guard: session（:81-84）、DB 無し / `canAccessManageEventFromSnapshot` 不可 / navigation に無い → `notFound()`（:88, :96, :99-100）。`?notif=` は video / x_id / slot / chapter / other のどれか、それ以外は all（:73-80）。admin だけ `SaveEventTemplateForm`（`src/components/manage/SaveEventTemplateForm.tsx`、88 行、:440）。通知（:519）と監査（:601）の `<details className="manage-collapsible">`、通知の絞り込み link（:535-542）、pending 行は `/dashboard/edit/{id}?privileged=event`。読み `GET /api/manage/events/:id?notif=`（`apps/api/src/routes/manage/overview.ts:51`、上限 pending 10 / 監査 15 / 通知 20 :21-24、権限なしは 404 :61）。
- SA-035 `saveEventAsTemplate`（`SaveEventTemplateForm.tsx:29`）。FormData `event_id`（hidden :40）、`name`（:48）、`description`（:60、任意）。`busy` で送信不可、成功で文言 + `router.refresh()`（:34-35）。API は MIG-0655 `POST /api/admin/event-templates`（body `{ event_id, name, description }`）。
- audience: `app/(manage)/manage/events/[id]/audience/page.tsx`（257 行）。guard: session（:47）、DB 無し・navigation に無い・非 admin で権限 0 → `notFound()`（:54, :63, :68）。並び（:161）、名前の link `/user/{id}`（:234）、`ManageXIcon`。読み `GET /api/manage/events/:id/audience`（`audience.ts:27`、各 100 件で `truncated` :11-12）。
#### Owned paths
- 新規: `+apps/ops/src/components/manage/{ManageEventPageShell,ManageEventTabs,ManageEventMoreMenu}.tsx`, `+apps/ops/src/routes/manage/{EventOverview,EventAudience,SaveEventTemplateForm}.tsx`, `+apps/ops/src/api/{manageEvent,eventTemplates}.ts`（`eventTemplates.ts` の 1 行目は D-16-1 の provisional comment）, `+apps/ops/test/manageEventOverview.test.mjs`
- 新規（MIG-0719 / 0725 / 0734 と先に merge した方、D-17-6）: `+apps/ops/src/components/notifications/NotificationOutboxSummary.tsx`
- 変更: `apps/ops/src/routes/router.tsx`（route 2 行）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(manage)/**`, `src/components/**`, `apps/api/**`
#### Micro-units
- **U01 event の枠**: `ManageEventPageShell` / `ManageEventTabs` / `ManageEventMoreMenu` を 1 対 1 で移植（MIG-0707 U05 の置き換え規則）。
- **U02 概要**: `EventOverview` を CURRENT の分岐の順に移植。`?notif=` は `useSearchParams`。404 は `NotFoundView`。
- **U03 template 保存**: `SaveEventTemplateForm` を移植。`router.refresh()` は `refreshKey`（D-17-3）。
- **U04 audience**: `EventAudience` を移植。
- **U05 merge 直前**（D-16-1 の 5）: MIG-0655 の schema に置き換え、fixture を `parse` に通す。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `?notif=foo` | all として読む（CURRENT :73-80） |
| T02 | 担当外 event の URL | API 404 → 404 画面 |
| T03 | 非 admin | template 保存 form を出さない |
| T04 | template 保存を連打 / `{ok:false,message}` | fetch 1 回 / message を出し入力を残す |
| T05 | audience 100 件超 | CURRENT と同じ並び、`truncated` は表示しない（D-17-7） |
#### Commands
```bash
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と、`events/[id]/page.tsx`・`audience/page.tsx`・`ManageEventPageShell.tsx`・`ManageEventTabs.tsx`・`ManageEventMoreMenu.tsx`・`SaveEventTemplateForm.tsx` 行の移植先。`API_MATRIX.md` の SA-035 に画面の呼び出し元。
#### DONE checklist
- [ ] U01〜U05 が DONE、T01〜T05 が PASS
- [ ] MIG-0707・0719・0655 が DONE で、暫定の土台と型が残っていない
- [ ] browser 確認（390px / 1440px）が PR にある
#### STOP
- API の契約が CURRENT と違うときは止めて MIG-0655 に返す。
- 暫定の土台が MIG-0707 の版と合わないときは止める（D-17-1）。
#### Rollback
Phase 7 共通契約のとおり（`apps/ops` は本番に配信されていない）。

### MIG-0721: Ops の `EventForm` 移植・`/manage/events/:id/edit`・`/admin/events/new`（SA-021..024、MIG-0704 U02 / MIG-0705 U03 の一部、D-17）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-17: `EventForm` を使う 2 画面をまとめて分割。契約先行で、merge は MIG-0707・0719・0726・0652 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0624, MIG-0625 / **Decisions:** D-05 DECIDED, D-16-1, D-17-1, D-17-2, D-17-3, D-17-6
- **Merge gate:** MIG-0707, MIG-0719, MIG-0726, MIG-0652 が DONE（D-16-1, D-17-1）
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- `src/components/admin/EventForm.tsx`（1120 行、client）+ `EventForm.module.css`（242 行）。import 先: `PermissionKeysField`（180 行）、`YoutubeDescriptionTemplateEditor`（465 行 + css 164）、`EventCustomQuestionsEditor`（390 行 + css 82）、`SaveSuccessNotice`、`src/lib/interactions/useUnsavedChangesGuard.ts`（25 行）、`useFormDraft`（:456-545）。
- 送信: `new FormData(event.currentTarget)`（:597-598）。二重送信防止 `busy || submitInFlightRef.current`（:580-596、finally で解除 :622）。成功で draft 消去（:610）、create は `router.push('/manage/events/{id}/edit')`（:613-614）、edit は `router.refresh()`（:616）。`useUnsavedChangesGuard({ dirty && !busy })`（:545）。key（name の行）: id 666, event_type 679, title 692, explanation 703, icon_url 725, img_url 735, accent_color 745, start_time 758, end_time 768, entry_start_time 783, entry_end_time 793, visibility_status 804, allow_user_video_event_links 815, allow_unslotted_posts 826, allow_user_video_edits 842, user_video_edit_permission_keys_json 855, custom_questions_present 860（custom_question_* 872-874）, required_video_fields_present 977, required_video_fields_json 980, slot_type 1019, max_slots_per_video 1027, max_slot_reservation_groups_per_xid 1040, slot_visibility_mode 1052, slot_interval_minutes 1061, slot_part_gap_minutes 1075, parts_text 1088, youtube_description_template（:711）、general_custom_question_*（`EventCustomQuestionsEditor.tsx:114-273`）、create の hidden `template_id`（:658）、edit の `id`（:652）と `revision`（:655）。file を含まないので JSON（D-16-1 の 2）。
- Manage の編集: `app/(manage)/manage/events/[id]/edit/page.tsx`（179 行）。guard: session（:35）、DB 無し・event 無し・event.basic / publish / questions / slots のどれも無い → `notFound()`（:42, :47, :63-70）。`editableSections`（:106-111）、`showActiveXNotice={!isAdmin}`（:86）、`/slots` への link（:95）。admin だけ危険操作（:154-176）: `RenameEventIdForm`（98 行、SA-021、key `old_event_id` :43 / `new_event_id` :51 / `confirm` :72、成功で `router.replace('/manage/events/{newId}/edit')` + refresh :29-30）、`DeleteEventForm`（103 行、SA-024、`event_id` / `confirm` :39-40、`confirm !== eventId` で送らない :34-37・button 無効 :96、成功で `router.push('/manage')` :47）。読み `GET /api/manage/events/:id/edit`（`eventEdit.ts:82`、custom question 18 件超は 503 :15,:155）。
- `/admin/events/new`: `app/(admin)/admin/events/new/page.tsx`（127 行）。template picker（`?template={id}` の link :80-109）、template 無しは初期値なし（:51-57）。読み `GET /api/admin-read/events/new?template=`（`adminRead/eventTemplates.ts:105`、`formInitial: "deferred"` なので画面が CURRENT の `parseEventTemplateSnapshot` / `snapshotToFormInitial`（`src/lib/admin/eventTemplateSettings`）と同じ変換をする）。
- API（MIG-0652、D-16-1）: SA-022 `POST /api/admin/events`、SA-023 `PATCH /api/manage/events/:eventId`、SA-024 `DELETE /api/admin/events/:eventId` body `{ confirm }`、SA-021 `POST /api/admin/events/:eventId/rename` body `{ new_event_id, confirm }`。
#### Owned paths
- 新規: `+apps/ops/src/components/event/{EventForm,PermissionKeysField,YoutubeDescriptionTemplateEditor,EventCustomQuestionsEditor}.tsx`, `+apps/ops/src/lib/{useUnsavedChangesGuard,useFormDraft,eventTemplateSettings}.ts`（1 行目 `// Port of CURRENT <path> (MIG-0721). Same output.`）, `+apps/ops/src/routes/manage/{EventEdit,RenameEventIdForm,DeleteEventForm}.tsx`, `+apps/ops/src/routes/admin/EventNew.tsx`, `+apps/ops/src/api/eventLifecycle.ts`（1 行目は D-16-1 の provisional comment）, `+apps/ops/src/styles/event-form.css`（`MODULES` に 3 行）, `+apps/ops/test/eventForm.test.mjs`
- 変更: `apps/ops/src/routes/router.tsx`（route 2 行）, `apps/ops/scripts/portCssModule.mjs`, `apps/ops/src/main.tsx`（css 1 行）, `apps/ops/package.json` と `package-lock.json`（`@flamenode/domain` が要るときだけ）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(manage)/**`, `app/(admin)/**`, `src/components/**`, `src/lib/**`, `apps/api/**`
#### Micro-units
- **U01 部品**: `EventForm` と import 先 3 部品・2 hook を 1 対 1 で移植。CURRENT の pure な `src/lib` 関数は `@flamenode/domain` にあれば import、無ければ `apps/ops/src/lib/` に写す（1 行目の comment）。
- **U02 Manage 編集**: `EventEdit` と危険操作 2 form。`router.replace` / `push` は D-17-3。
- **U03 admin 新規**: `EventNew`（template picker と `EventForm mode="create"`）。
- **U04 client**: `eventLifecycle.ts` に `createEvent` / `updateEvent` / `deleteEvent` / `renameEvent`（`write.ts` の `send`）。
- **U05 merge 直前**（D-16-1 の 5）: MIG-0652 の `packages/contracts/src/eventLifecycle.ts` に置き換える。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 保存を連打 | fetch 1 回（:580） |
| T02 | 選択式の質問に選択肢 0 | 送らずに CURRENT と同じ文言（:575-590） |
| T03 | 変更して離脱 | 未保存の確認（:545） |
| T04 | create 成功 | `/manage/events/{id}/edit` へ、draft 消去 |
| T05 | 削除の確認文字列が違う | API を呼ばない、button 無効 |
| T06 | 権限が event.slots だけの staff | 編集できる section が CURRENT `editableSections` と同じ |
| T07 | `?template=` 無し / 不明 | 初期値なし（:51-57） |
#### Commands
```bash
node apps/ops/scripts/portCssModule.mjs
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と移植元 9 file 行の移植先。`API_MATRIX.md` の SA-021〜024 に画面の呼び出し元。
#### DONE checklist
- [ ] U01〜U05 が DONE、T01〜T07 が PASS
- [ ] MIG-0707・0719・0726・0652 が DONE で、暫定の土台と型が残っていない
- [ ] browser 確認（390px / 1440px）が PR にある
#### STOP
- API の契約が CURRENT の FormData の key と違うときは止めて MIG-0652 に返す。
- `EventForm` の挙動（draft・未保存確認・二重送信防止）を変える必要が出たら止める。
#### Rollback
Phase 7 共通契約のとおり（`apps/ops` は本番に配信されていない）。

### MIG-0722: `/manage/events/:id/slots`（SA-056..064、MIG-0704 U03 の一部、D-17）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-17: MIG-0704 から分割。契約先行で、merge は MIG-0707・0719・0656 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0624 / **Decisions:** D-05 DECIDED, D-16-1, D-17-1, D-17-2, D-17-3, D-17-6, D-17-7
- **Merge gate:** MIG-0707, MIG-0719, MIG-0656 が DONE（D-16-1, D-17-1）
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- `app/(manage)/manage/events/[id]/slots/page.tsx`（198 行）。guard: session（:59）、DB 無し・event 無し・`event.slots` 権限なし → `notFound()`（:64, :67, :79-81）。`?status=available|reserved|submitted`、それ以外は all（:53-58）。表示上限 500（:113）。絞り込み nav（:141-160）、`SlotBatchForm`（:163）、`SlotList`（:186）か EmptyState（:173）。
- `src/components/manage/SlotBatchForm.tsx`（271 行 + `SlotBatchForm.module.css` 20 行）: SA-058 `generateSlotsBatch`（:47、`event_id` / `mode` :44-45 と input `start_at` / `end_at` / `interval_minutes` / `count` / `label_prefix` / `start_index`）、SA-059 `deleteAvailableSlots`（:66、`event_id` :64、`ConfirmDialog` は `confirmClear` :35, :231「全削除する」）。
- `src/components/manage/SlotList.tsx`（476 行）: `run()`（:107-135）で SA-060 / 061 / 062 / 063 / 064 / 056 / 057（import :10-20、dispatch :442-468）。key `event_id`（:446）、`slot_id`（:453）、`slot_ids` = 選択 id の JSON（:463）、`label`（:465）。危険操作は全部 `ConfirmDialog`（:417-439）、`busy` で無効（:202, :211, :226, :376, :389）、提出済みの操作は `canManageSubmittedSlots` のときだけ（:389）、成功で選択解除（:123）、成否に関わらず `router.refresh()`（:131）。
- 読み `GET /api/manage/events/:id/slots?status=&offset=`（`slots.ts:55`、1 回 100 件、`offset` 0..400 :10、権限なしは 404 :66）。
- API（MIG-0656、D-16-1）: `POST /api/manage/events/:eventId/slots/generate`、`DELETE .../slots/available`、`POST .../slots/:slotId/release`、`DELETE .../slots/:slotId`、`POST .../slots/batch-delete`、`POST .../slots/batch-release`、`PATCH .../slots/labels`、`POST .../slots/:slotId/force-release-submitted`、`POST .../slots/:slotId/release-video-keep-reservation`。
#### Owned paths
- 新規: `+apps/ops/src/routes/manage/{EventSlots,SlotBatchForm,SlotList}.tsx`, `+apps/ops/src/api/manageSlots.ts`（1 行目は D-16-1 の provisional comment）, `+apps/ops/src/styles/slot-batch.css`（`MODULES` に 1 行）, `+apps/ops/test/manageSlots.test.mjs`
- 変更: `apps/ops/src/routes/router.tsx`（route 1 行）, `apps/ops/scripts/portCssModule.mjs`, `apps/ops/src/main.tsx`（css 1 行）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(manage)/**`, `src/components/**`, `apps/api/**`
#### Micro-units
- **U01 読み**: `manageSlots.ts` の `listSlots(eventId, status)` は `offset` 0, 100, … と順に読み、500 件か最後の頁で止める（D-17-7）。count は最初の応答のもの。
- **U02 画面**: `EventSlots` と 2 部品を移植。`run()` の「成否に関わらず refresh」は `refreshKey` を必ず 1 増やす。
- **U03 client**: 9 操作を `send` で。
- **U04 merge 直前**（D-16-1 の 5）: MIG-0656 の `packages/contracts/src/manageSlotsWrite.ts` に置き換える。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 枠 450 件 | 読みは 5 回、450 件を表示 |
| T02 | 全削除 | 確認 dialog の後だけ API |
| T03 | 提出済みの解放（権限なし） | button 無効 |
| T04 | 一括操作の `{ok:false}` | message を出し、再取得もする（:131） |
| T05 | `?status=bad` | all |
#### Commands
```bash
node apps/ops/scripts/portCssModule.mjs
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と `slots/page.tsx`・`SlotBatchForm.tsx`・`SlotList.tsx` 行の移植先。`API_MATRIX.md` の SA-056〜064 に画面の呼び出し元。
#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T05 が PASS
- [ ] MIG-0707・0719・0656 が DONE で、暫定の土台と型が残っていない
- [ ] browser 確認（390px / 1440px）が PR にある
#### STOP
- API の契約が CURRENT と違うときは止めて MIG-0656 に返す。
- 500 件を読むのに 5 回を超える request が要ると分かったら止める（D-17-7）。
#### Rollback
Phase 7 共通契約のとおり（`apps/ops` は本番に配信されていない）。

### MIG-0723: `/manage/events/:id/staff`（SA-031..034、MIG-0704 U03 の一部、D-17）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-17: MIG-0704 から分割。契約先行で、merge は MIG-0707・0719・0654 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0624 / **Decisions:** D-05 DECIDED, D-16-1, D-17-1, D-17-2, D-17-3, D-17-6
- **Merge gate:** MIG-0707, MIG-0719, MIG-0654 が DONE（D-16-1, D-17-1）
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- `app/(manage)/manage/events/[id]/staff/page.tsx`（187 行）。guard: session（:41）、DB 無し・navigation に無い・非 admin で権限 0 → `notFound()`（:47, :56, :61）。`canManageMembers = isAdmin || has("event.members")`（:62-63）。可なら `EventStaffManager`（:145）、不可なら `EventStaffReadOnlyList`（63 行、:162）と注意（:165-167）。`SummaryCard`（:174-186）。
- `src/components/manage/EventStaffManager.tsx`（821 行）: `run()`（:140-165、`useTransition` の `busy` :130、成功で追加 form を閉じて `router.refresh()` :162）。SA-031 `upsertEventStaffMember`（編集 :366、追加 :552。key `event_id` / `staff_id`（編集）/ `permission_preset` / `permission_keys`（custom 以外は空の CSV）/ `x_user_id` / `display_name` / `is_public` / `public_role_label` / `reason` / `confirm_text`）、SA-032 `bulkUpsertEventStaffFromCsv`（:729、FormData でなく `{eventId, reason, rows}`、`busy || preview.hasErrors || !reason.trim()` で無効 :726）、SA-033 `removeEventStaffMember`（`event_id` / `staff_id` / `reason` / `confirm_text` :494-502、自分の解任は `window.prompt` で `REMOVE SELF {eventId}`、null で中止 :497-503）、SA-034 `transferEventOwnershipAction`（`event_id` / `from_staff_id` / `to_staff_id` / `reason` / `confirm_text` / `self_confirm_text`）。
- 読み `GET /api/manage/events/:id/staff`（`staff.ts:40`、100 件 `MAX_STAFF_MEMBERS` :12、`membersTruncated` :77）。
- API（MIG-0654、D-16-1）: 追加 `POST /api/manage/events/:eventId/staff`、編集 `PUT .../staff/:staffId`、解任 `DELETE .../staff/:staffId`（body `{ reason, confirm_text }`）、CSV `POST .../staff/csv`（body `{ reason, rows }`）、移譲 `POST .../owner-transfer`。
#### Owned paths
- 新規: `+apps/ops/src/routes/manage/{EventStaff,EventStaffManager,EventStaffReadOnlyList}.tsx`, `+apps/ops/src/api/manageStaff.ts`（1 行目は D-16-1 の provisional comment）, `+apps/ops/test/manageStaff.test.mjs`
- 変更: `apps/ops/src/routes/router.tsx`（route 1 行）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(manage)/**`, `src/components/**`, `apps/api/**`
#### Micro-units
- **U01 画面**: 3 component を移植（CSV の preview・prompt・確認文字列を変えない）。CURRENT の pure な CSV parse は `@flamenode/domain` にあれば import、無ければ `apps/ops/src/lib/` に写す。
- **U02 client**: 5 操作を `send` で。
- **U03 merge 直前**（D-16-1 の 5）: MIG-0654 の `packages/contracts/src/manageStaffWrite.ts` に置き換える。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 自分の解任で prompt を cancel | API を呼ばない |
| T02 | 最後の owner の解任（API 409 `{ok:false,message}`） | CURRENT と同じ文言（MIG-0704 T03） |
| T03 | CSV に error 行 / reason 空 | 取り込み button 無効 |
| T04 | `event.members` の無い staff | 読み取り一覧と注意だけ |
#### Commands
```bash
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:event-owners
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と `staff/page.tsx`・`EventStaffManager.tsx`・`EventStaffReadOnlyList.tsx` 行の移植先。`API_MATRIX.md` の SA-031〜034 に画面の呼び出し元。
#### DONE checklist
- [ ] U01〜U03 が DONE、T01〜T04 が PASS
- [ ] MIG-0707・0719・0654 が DONE で、暫定の土台と型が残っていない
- [ ] browser 確認（390px / 1440px）が PR にある
#### STOP
- API の契約が CURRENT と違うときは止めて MIG-0654 に返す。
- owner 0 の判定を画面側で持つ必要が出たら止める（core の責務）。
#### Rollback
Phase 7 共通契約のとおり（`apps/ops` は本番に配信されていない）。

### MIG-0724: `/manage/events/:id/videos` と作品 1 件の画面（SA-040..042、MIG-0704 U04 の一部、D-17）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-17: MIG-0704 から分割。契約先行で、merge は MIG-0707・0719・0603 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0624, MIG-0630 / **Decisions:** D-05 DECIDED, D-16-1, D-16-5, D-17-1, D-17-2, D-17-3, D-17-6, D-17-7
- **Merge gate:** MIG-0707, MIG-0719, MIG-0603 が DONE（D-16-1, D-17-1）
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- 一覧: `app/(manage)/manage/events/[id]/videos/page.tsx`（218 行）。guard: session（:75）、DB 無し・manage 不可・navigation に無い → `notFound()`（:82, :90, :92）。`canApproveVideoStatus`（`video.status`、:94-98）。`?status=` 既定 review（:68）、`normalizeVideoVisibilityFilter`（:69）、上限 200（:124）。`VideoReviewQueueTable`（`src/components/admin/VideoReviewQueueTable.tsx`、201 行、:204）と `VideoReviewQuickApproveButton`（95 行）。SA-040 `approveManageVideoPublic` を `quickApproveAction` に（:212）、key `event_id`（hidden :213）・`video_id`（button :46）。二重送信防止 `submitting` + `submittingRef`（button :32-39）、失敗・retryable・通信失敗・成功のどれでも `router.refresh()`（:55-64）、pending 行で `canApprove` のときだけ（table :69, :169-174）。読み `GET /api/manage/events/:id/videos?status=&offset=`（`videos.ts:48`、1 回 100 件、`offset` 0..100 :13）。
- 1 件: `app/(manage)/manage/events/[id]/videos/[videoId]/page.tsx`（138 行）。guard: session（:42）、DB 無し・manage 不可・navigation に無い・作品無し → `notFound()`（:49, :56, :58, :61）。`canReview`（:65-69）。`VideoReviewDetailPanel`（204 行 + css 11、:83）、`VideoApproveActions`（`src/components/video/VideoApproveActions.tsx`、134 行、SA-040 / 041、:88、key `event_id` / `video_id` :58-62、`nextHref` で `router.push` :79）、`ManageVideoStatusForm`（`src/components/video/VideoStatusForm.tsx`、370 行、SA-042 :111, :220、key `event_id` / `video_id` / `status` / `reason` / `void_reason_category` / `case_id` :198-211、送る前の検査 :181-192、`nextHref` で push :239）、権限なしの文言（:106-108）、footer link（:111-134、admin だけ `/admin/videos/{id}`）。読み `GET /api/manage/events/:id/videos/:videoId`（`videoDetail.ts:64`、各 100 件 :14、link 無しは 404 :104, :119）。
- API（MIG-0603 U02c、D-16-1）: `POST /api/manage/events/:eventId/videos/:videoId/status`（body は CURRENT `manage-video.ts:58-73` の `formData.set` と同じ写像。SA-041 は `and_next: "1"`）。
- 共有部品（MIG-0729 と先に merge した方が作る、D-17-6）: `VideoReviewQueueTable` / `VideoReviewQuickApproveButton` / `VideoApproveActions` / `VideoStatusForm` / `VideoReviewDetailPanel`。
#### Owned paths
- 新規: `+apps/ops/src/routes/manage/{EventVideos,EventVideoDetail}.tsx`, `+apps/ops/src/api/manageVideoStatus.ts`（1 行目は D-16-1 の provisional comment）, `+apps/ops/test/manageVideos.test.mjs`
- 新規（MIG-0729 と先に merge した方、D-17-6）: `+apps/ops/src/components/videoReview/{VideoReviewQueueTable,VideoReviewQuickApproveButton,VideoApproveActions,VideoStatusForm,VideoReviewDetailPanel}.tsx`, `+apps/ops/src/styles/video-review.css`（`MODULES` に 1 行）
- 変更: `apps/ops/src/routes/router.tsx`（route 2 行）, `apps/ops/scripts/portCssModule.mjs`, `apps/ops/src/main.tsx`, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(manage)/**`, `src/components/**`, `apps/api/**`
#### Micro-units
- **U01 共有部品**: 5 部品を移植。`action` prop は `(fd: FormData) => Promise<Result>` のまま残し、画面が API client を渡す（Manage は `manageVideoStatus.ts`、Admin は MIG-0729 の client）。
- **U02 一覧**: `offset` 0 と 100 を順に読む（D-17-7）。
- **U03 1 件**: CURRENT の順に移植。
- **U04 merge 直前**（D-16-1 の 5）: MIG-0603 の `packages/contracts/src/admin/videoStatus.ts` に置き換える。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 作品 150 件 | 読みは 2 回、150 件 |
| T02 | 即承認を連打 | fetch 1 回 |
| T03 | 承認して次へ | 応答の `nextHref` へ移動 |
| T04 | 同じ status を選ぶ / void で理由なし | 送らずに CURRENT の文言 |
| T05 | `video.status` の無い staff | 承認 UI を出さず、権限なしの文言 |
#### Commands
```bash
node apps/ops/scripts/portCssModule.mjs
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と移植元 7 file 行の移植先。`API_MATRIX.md` の SA-040〜042 に画面の呼び出し元。
#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T05 が PASS
- [ ] MIG-0707・0719・0603 が DONE で、暫定の土台と型が残っていない
- [ ] browser 確認（390px / 1440px）が PR にある
#### STOP
- API の契約が CURRENT と違うときは止めて MIG-0603 に返す。
#### Rollback
Phase 7 共通契約のとおり（`apps/ops` は本番に配信されていない）。

### MIG-0725: `/manage/events/:id/youtube-playlist`・`/manage/notifications`・`/manage/x-link-requests`（SA-038/039, 090/091、MIG-0704 U04/U05 の一部、D-17）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-17: MIG-0704 から分割。契約先行で、merge は MIG-0707・0719・0655・0605 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0624 / **Decisions:** D-05 DECIDED, D-15-6, D-16-1, D-17-1, D-17-2, D-17-3, D-17-5, D-17-6, D-17-7
- **Merge gate:** MIG-0707, MIG-0719, MIG-0655, MIG-0605 が DONE（D-16-1, D-17-1）
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- playlist: `app/(manage)/manage/events/[id]/youtube-playlist/page.tsx`（361 行）。guard: session（:106）、DB 無し・manage 不可・navigation に無い → `notFound()`（:112, :121, :123）、`canEdit`（:125）。health の label（:41-98）、`?saved=1` / `?queued=1` / `?error=` の banner（:204, :209, :214）。設定 form（:228、SA-038、`event_id` / `playlist_id` / `sync_mode` / `sync_interval_minutes`、`canEdit` でなければ input 無効・送信 button なし :237, :280）、同期 form（:336、SA-039、`event_id`、`canEdit && config.enabled === 1` のときだけ :334）。どちらも action が `redirect()` で `?saved=1` / `?queued=1` / `?error=` に戻る（`src/lib/actions/event-youtube-playlist.ts:63,250,258,367`、`event_id` 空は `/manage` :59, :255）。読み `GET /api/manage/events/:id/youtube-playlist`（`playlist.ts:64`）。
- 通知: `app/(manage)/manage/notifications/page.tsx`（304 行）。guard: session（:62）、DB 無し → `notFound()`（:79）、触れない `?event=` → `notFound()`（:107-113）、admin は event 選択なし（:98-100）。`<form method="get">`（:216）に `AutoSubmitSelect` 3 つ（`event` / `notif` / `status`）、`?status=failed` は終端失敗の集合（:134-139）、50 件（:155, :163）、admin へ `/admin/notifications?status=failed`（:210）、event の link（:289）。書き込み無し。読み `GET /api/manage/notifications?event=&notif=&status=`（`notificationCenter.ts:25`、50 件 :22、schema 欠落 :19-21）。
- X 連携: `app/(manage)/manage/x-link-requests/page.tsx`（97 行）。guard: session（:20）、DB 無し・`!canManageXIdLinkRequests` → `notFound()`（:23, :28）。`XLinkRequestTable`（`src/components/admin/XLinkRequestTable.tsx`、312 行、:94）: SA-090 / 091（`run` :120、key `request_id` :116 と却下の `reason` :117）、`useTransition` の pending（:104, :248, :256, :287）、却下の理由欄（:258-262、取り消し :296-300、500 字 :275-282）、成功で `router.refresh()`（:122-125）、例外の文言（:128）。読み `GET /api/manage/x-link-requests`（`xlink.ts:51`、100 件 :16、権限なしは 404 :58）。
- API（D-16-1）: MIG-0655 `PUT /api/manage/events/:eventId/youtube-playlist`・`POST .../youtube-playlist/sync`（応答は D-17-5 の query 値）、MIG-0605 `POST /api/xid/link-requests/:requestId/approve`・`/reject`。
- 共有部品: `XLinkRequestTable`（MIG-0732 と先に merge した方、D-17-6）、`NotificationOutboxSummary`（MIG-0719 / 0720 / 0734 と先に merge した方）。
#### Owned paths
- 新規: `+apps/ops/src/routes/manage/{EventYoutubePlaylist,ManageNotifications,ManageXLinkRequests}.tsx`, `+apps/ops/src/api/{managePlaylist,xidLinkRequests}.ts`（1 行目は D-16-1 の provisional comment）, `+apps/ops/test/manageMisc.test.mjs`
- 新規（D-17-6 の先に merge した方）: `+apps/ops/src/components/xid/XLinkRequestTable.tsx`, `+apps/ops/src/components/notifications/NotificationOutboxSummary.tsx`
- 変更: `apps/ops/src/routes/router.tsx`（route 3 行）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(manage)/**`, `src/components/**`, `src/lib/actions/**`, `apps/api/**`
#### Micro-units
- **U01 playlist**: 2 form を `<form onSubmit>` にし、API の応答の query（`saved=1` / `queued=1` / `error=`）の URL へ `useNavigate()`（D-17-5）。banner の分岐は CURRENT のまま。
- **U02 通知**: GET form は D-17-7。
- **U03 X 連携**: `XLinkRequestTable` を移植し、`run` の action を `xidLinkRequests.ts` に。
- **U04 merge 直前**（D-16-1 の 5）: MIG-0655 と MIG-0605 の schema に置き換える。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | playlist 設定の保存成功 | `?saved=1` の URL と banner（:204） |
| T02 | `canEdit` でない staff | input 無効、送信 button なし |
| T03 | 通知の `?event=` に担当外 | API 404 → 404 画面 |
| T04 | 通知の select を変える | URL の query が変わり再取得 |
| T05 | X 連携の承認を連打 | fetch 1 回 |
| T06 | 却下の理由 501 字 | 500 字で止まる |
#### Commands
```bash
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と移植元 4 file 行の移植先。`API_MATRIX.md` の SA-038 / 039 / 090 / 091 に画面の呼び出し元。
#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T06 が PASS
- [ ] MIG-0707・0719・0655・0605 が DONE で、暫定の土台と型が残っていない
- [ ] browser 確認（390px / 1440px）が PR にある
#### STOP
- API の契約が CURRENT と違うときは止めて MIG-0655 / MIG-0605 に返す。
- playlist 同期の反映遅れ（D-15-6、最悪約 45 分）を画面で隠す必要が出たら止める（Yugo の判断）。
#### Rollback
Phase 7 共通契約のとおり（`apps/ops` は本番に配信されていない）。

### MIG-0726: Ops の Admin の枠・`/admin`・permission simulator・互換 redirect 5 本（MIG-0705 U01 の一部、D-17）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-17: MIG-0705 から分割。契約先行で、merge は MIG-0707・MIG-0661 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0625 / **Decisions:** D-05 DECIDED, D-13-6, D-16-1, D-16-13, D-17-1, D-17-2, D-17-3, D-17-6
- **Merge gate:** MIG-0707, MIG-0661 が DONE（D-16-1, D-17-1）
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- layout: `app/(admin)/layout.tsx`（42 行）。user 無し `/entry`（:23）、`enrichmentFailed` → `/entry?error=auth_temporarily_unavailable`（:24-26）、`role !== "admin"` → `/dashboard`（:27）、robots noindex（:11-13）。`<div data-admin-shell data-fn-surface="admin">`、`CostGuardBanner source="admin"`（:31）、`ConsoleShell consoleMode="admin"` に `ConsoleSidebar consoleMode="admin"`（:33-38）、`<main className="admin-main">`（:37）。`PublicHeader` / `PublicFooter`（:32, :39）は FIX-0701-1（D-13-6）。
- sidebar: `ConsoleSidebar.tsx` の admin 分岐（:78-89、user・db が無いか admin でなければ null、`SidebarModeBanner` + `AdminSidebarNav groups={buildAdminNavGroups()}`）。`src/components/admin/AdminSidebarNav.tsx`（96 行 + `AdminSidebarNav.module.css` 105 行）。`buildAdminNavGroups` は静的な定義（D1 を読まない）。
- 読み: `/api/admin-read/*` は session → requireAuth（401）→ admin 以外 403 `{error:"Forbidden", redirect:"/dashboard"}`（`apps/api/src/routes/adminRead/index.ts:27-41`）。banner は `GET /api/admin-read/cost-guard-banner`（MIG-0661、D1 1 文）。
- `/admin`: `app/(admin)/admin/page.tsx`（376 行）。`PendingCountCard`（:333-376）10 件（:37-136、`reservedOpenSlots` だけ合計に入れない）、合計 0 で EmptyState（:237-251）、`aria-live="polite"`（:178-180）、card の link（`/admin/videos?status=pending`、`/admin/x-id-merges?view=reverts`、`/admin/notifications?status=failed|processing`、`/admin/youtube-sync?failed=1`、`/admin/moderation?status=open[&overdue=1]`、:41-125）、mode の badge（:263-271）、固定 link（:279-324）。読み `GET /api/admin-read/ops/top`（`adminRead/ops.ts:817`、失敗は既定値 :850-872）。
- simulator: `app/(admin)/admin/permissions/simulator/page.tsx`（39 行）+ `src/components/admin/PermissionSimulatorPanel.tsx`（138 行）。GET form の `event_id`（:27）・`x_user_id`（:37）、trim（page :17-18）、結果の link `/manage/events/{id}/staff`（panel :84）。読み `GET /api/admin-read/permissions/simulator?event_id=&x_user_id=`（`adminRead/settings.ts:182`）。
- 互換 redirect（server redirect だけ）: `/admin/events/:id` → `/manage/events/:id`、`/edit` → `/manage/events/:id/edit`、`/slots` → `/manage/events/:id/slots`、`/staff` → `/manage/events/:id/staff`（`app/(admin)/admin/events/[id]/**/page.tsx` 各 12〜17 行、id は `encodeURIComponent`）、`/admin/history` → `/admin/audit`（`history/page.tsx:5`）。
#### Owned paths
- 新規: `+apps/ops/src/routes/admin/{AdminLayout,AdminSidebarNav,AdminTop,PermissionSimulator,AdminRedirects}.tsx`, `+apps/ops/src/api/{adminTop,adminBanner}.ts`（`adminBanner.ts` の 1 行目は D-16-1 の provisional comment）, `+apps/ops/src/styles/admin-shell.css`（`MODULES` に AdminSidebarNav 1 行。MIG-0719 が先なら行を足すだけ）, `+apps/ops/test/adminShell.test.mjs`
- 新規（MIG-0719 と先に merge した方、D-17-6）: `+apps/ops/src/components/layout/CostGuardBanner.tsx`
- 変更: `apps/ops/src/routes/router.tsx`（`/admin` の枠と route 7 行）, `apps/ops/scripts/portCssModule.mjs`, `apps/ops/src/main.tsx`, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(admin)/**`, `src/components/**`, `apps/api/**`
#### Micro-units
- **U01 枠**: `AdminLayout` が MIG-0707 の guard の後に CURRENT の wrapper・banner・`ConsoleShell`・sidebar・`<main className="admin-main">` を同じ順で出す。`/api/admin-read/*` の 403 は body の `redirect` へ（D-17-2）。
- **U02 banner**: `CostGuardBanner`（MIG-0719 と共有）に `source="admin"` で `GET /api/admin-read/cost-guard-banner` を読む分岐。
- **U03 `/admin` と simulator**: CURRENT の順に移植。
- **U04 redirect 5 本**: `<Navigate replace>`。`/manage/*` は Ops 内の route なので `useNavigate` の範囲。
- **U05 merge 直前**（D-16-1 の 5）: MIG-0661 の schema に置き換える。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | guest / user / moderator / admin で `/admin` | Location が CURRENT layout :23-27 と同じ（MIG-0705 T05） |
| T02 | top の件数が全部 0 | EmptyState |
| T03 | `reservedOpenSlots` だけ 5 | 合計に入れない |
| T04 | simulator の片方が空 | API を呼ばず結果なし |
| T05 | `/admin/events/a%2Fb/staff` | `/manage/events/a%2Fb/staff` に replace |
| T06 | `/admin/history` | `/admin/audit` |
#### Commands
```bash
node apps/ops/scripts/portCssModule.mjs
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と、`app/(admin)/layout.tsx`・`admin/page.tsx`・`permissions/simulator/page.tsx`・redirect 5 file・`AdminSidebarNav.tsx`・`PermissionSimulatorPanel.tsx` 行の移植先。
#### DONE checklist
- [ ] U01〜U05 が DONE、T01〜T06 が PASS
- [ ] MIG-0707・0661 が DONE で、暫定の土台と型が残っていない
- [ ] browser 確認（390px / 1440px）が PR にある
#### STOP
- Ops の Worker / Route を本番に作る必要が出たら止める（明示承認事項）。
- 暫定の土台が MIG-0707 の版と合わないときは止める（D-17-1）。
#### Rollback
Phase 7 共通契約のとおり（`apps/ops` は本番に配信されていない）。

### MIG-0727: `/admin/announcements` 3 画面・`/admin/api-endpoints`・`/admin/rules` 3 画面（SA-004..008, 051..055、MIG-0705 U02 の一部、D-17）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-17: MIG-0705 から分割。SA-004〜008 の API は main にある（MIG-0602）。規約は契約先行で、merge は MIG-0707・0726・0642 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0602, MIG-0625 / **Decisions:** D-05 DECIDED, D-16-1, D-17-1, D-17-2, D-17-3, D-17-4, D-17-5, D-17-6, D-17-7
- **Merge gate:** MIG-0707, MIG-0726, MIG-0642 が DONE（D-16-1, D-17-1）
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- お知らせ一覧: `app/(admin)/admin/announcements/page.tsx`（195 行）。`audience` all / creators / admins と `status` published / draft の絞り込み（:24-29、`AutoSubmitSelect`）、50 件（:48-55）、link `/admin/announcements/{id}/edit` と `/admin/audit?table=announcements&record={id}`（:163-170）。読み `GET /api/admin-read/announcements?audience=&status=`（`adminRead/settings.ts:38`）。
- お知らせ新規 / 編集: `new/page.tsx`（24 行）、`[id]/edit/page.tsx`（71 行、DB 無し・行無し → `notFound()` :25, :29）。`src/components/admin/AnnouncementForm.tsx`（183 行 + css 12）: SA-004 / 005（:48-49）、key `title` / `body` / `severity` / `target_audience` / `is_published` / `publish_at` / `expire_at`（:83-153）と編集の `id` / `base_updated_at`（:72, :76）、`busy`（:35, :174）、create 成功で `router.push('/admin/announcements/{id}/edit')`（:55-56）、他は refresh（:58）。`DeleteAnnouncementForm.tsx`（62 行）: SA-006（`id` :23）、`ConfirmDialog`「お知らせを削除」（:50-59）、成功で `/admin/announcements`（:30）。読み `GET /api/admin-read/announcements/:id`（`settings.ts:66`）。API（main）: `POST /api/admin/announcements`（`apps/api/src/routes/admin/announcements.ts:100`）、`PUT /:id`（:162）、`DELETE /:id`（:238）。
- API endpoint: `app/(admin)/admin/api-endpoints/page.tsx`（286 行）。page 内 action SA-108（:30-38、SA-007 を包む）と SA-109（:40-48、SA-008 を包む）。key 作成 `event_id`（:131）、無効化 `id` / `public_api_enabled="0"`（:246-247）。結果は `redirect('/admin/api-endpoints?notice=…|error=…')`（:25-47）と banner（:104-113）。`EventExportLinkBuilder`（132 行）は href を作るだけ。読み `GET /api/admin-read/api-endpoints`（`settings.ts:239`）。API（main）: `POST /api/admin/api-endpoints`（`apiEndpoints.ts:173`）、`PATCH /:id`（:185）。
- 規約一覧: `app/(admin)/admin/rules/page.tsx`（218 行）。`status` 絞り込み、20 件、再同意の対象（最大 31 読み 30 表示「件以上」:62-70）。`TermsReacceptBroadcastButton.tsx`（215 行、SA-054、key `terms_id` / `cursor` / `confirm` / `content` :34-37、`role="alertdialog"` の独自 modal、`confirmText === "TERMS"` と本文が要る :205、`cursor` を進め `enqueuedTotal` を足す :44-47、件数 0 で無効 :58）。読み `GET /api/admin-read/rules?status=`（`settings.ts:80`）。
- 規約新規 / 編集: `new/page.tsx`（36 行、初期値 `DEFAULT_TERMS_VERSION_LABEL` / `DEFAULT_TERMS_MARKDOWN`、severity major :25-32）、`[id]/edit/page.tsx`（73 行、`notFound()` :23, :27）。`TermsForm.tsx`（225 行 + css 10）: SA-051 / 052（:66）、SA-053（:86）、SA-055（:94）、key `version_label` / `severity` / `body_markdown`（:108-133）と `id`（:103）、draft 以外は readOnly（:38, :123）、公開・archive は `ConfirmDialog`（:198-221、major は全員再同意の文言）、create 成功で `/admin/rules/{id}/edit`（:53-54）。読み `GET /api/admin-read/rules/:id`（`settings.ts:169`）。
- API（MIG-0642、D-17-4）: SA-051 `POST /api/admin/terms`、SA-052 `PATCH /api/admin/terms/:id`、SA-053 `POST /api/admin/terms/:id/publish`、SA-054 `POST /api/admin/terms/:id/reaccept-broadcast`、SA-055 `POST /api/admin/terms/:id/archive`。
#### Owned paths
- 新規: `+apps/ops/src/routes/admin/{Announcements,AnnouncementEdit,AnnouncementForm,DeleteAnnouncementForm,ApiEndpoints,EventExportLinkBuilder,Rules,RuleEdit,TermsForm,TermsReacceptBroadcastButton}.tsx`, `+apps/ops/src/api/{adminAnnouncements,adminApiEndpoints,adminTerms}.ts`（`adminTerms.ts` の 1 行目は D-16-1 の provisional comment）, `+apps/ops/src/styles/admin-content.css`（`MODULES` に 2 行）, `+apps/ops/test/adminContent.test.mjs`
- 変更: `apps/ops/src/routes/router.tsx`（route 7 行）, `apps/ops/scripts/portCssModule.mjs`, `apps/ops/src/main.tsx`, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(admin)/**`, `src/components/**`, `apps/api/**`
#### Micro-units
- **U01 お知らせ 3 画面**: main の contracts（`packages/contracts/src/admin/*`）を最初から使う（D-17-3）。
- **U02 API endpoint**: SA-108 / 109 の redirect は D-17-5（応答の後に `?notice=` / `?error=` の URL へ）。query の文言は CURRENT の `pageHref` の値と同じ。
- **U03 規約 3 画面と再同意 button**: 独自 modal・`TERMS` の確認・cursor の連続実行を変えない。
- **U04 merge 直前**（D-16-1 の 5）: MIG-0642 の `packages/contracts/src/admin/termsNotifications.ts` に置き換える。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | お知らせ作成成功 | `/admin/announcements/{id}/edit` へ |
| T02 | 編集の `base_updated_at` が古い（409） | CURRENT と同じ文言 |
| T03 | API endpoint の作成成功 / 失敗 | `?notice=` / `?error=` の URL と banner |
| T04 | 公開済みの規約を開く | 入力が readOnly |
| T05 | 再同意の確認文字列が `TERMS` でない | 送信 button 無効 |
| T06 | 再同意の 2 回目 | 前回の `cursor` を送る |
#### Commands
```bash
node apps/ops/scripts/portCssModule.mjs
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と移植元 13 file 行の移植先。`API_MATRIX.md` の SA-004〜008, 051〜055, 108, 109 に画面の呼び出し元。
#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T06 が PASS
- [ ] MIG-0707・0726・0642 が DONE で、暫定の土台と型が残っていない
- [ ] browser 確認（390px / 1440px）が PR にある
#### STOP
- API の契約が CURRENT と違うときは止めて MIG-0602 / MIG-0642 に返す。
#### Rollback
Phase 7 共通契約のとおり（`apps/ops` は本番に配信されていない）。

### MIG-0728: `/admin/event-groups` 3 画面・`/admin/events`・`/admin/events/templates`（SA-025..030, 036, 037、MIG-0705 U02/U03 の一部、D-17）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-17: MIG-0705 から分割。契約先行で、merge は MIG-0707・0726・0653 の DONE 後。template 削除の API は main にある。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0625 / **Decisions:** D-05 DECIDED, D-16-1, D-17-1, D-17-2, D-17-3, D-17-6, D-17-7
- **Merge gate:** MIG-0707, MIG-0726, MIG-0653 が DONE（D-16-1, D-17-1）
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- group 一覧: `app/(admin)/admin/event-groups/page.tsx`（197 行）。`visibility` / `type` の絞り込み（:42-49）、100 件、公開ページ link は `_blank`（:168-176、`eventGroupPublicHref`）。`AdminSectionTabs hub="events"`（MIG-0707 U05）。読み `GET /api/admin-read/event-groups?visibility=&type=`（`adminRead/eventGroups.ts:22`）。
- group 新規 / 編集: `new/page.tsx`（27 行）、`[id]/edit/page.tsx`（116 行、`notFound()` :29, :34）。`EventGroupForm.tsx`（228 行）: SA-026 / 027（:60-61）、key `name` / `slug`（pattern :115）/ `description` / `group_type` / `visibility_status` / `sort_order` / `icon_url` / `accent_color`（:99-198）と編集の `id` / `base_updated_at`（:87, :91）、create 成功で `/admin/event-groups/{id}/edit`（:70-71）。`EventGroupMembersEditor.tsx`（315 行）: SA-025 検索（:60、`{groupId, query, cursor}`、古い検索を捨てる `searchRequestRef` :48-65、cursor の重複除去 :70-79）、SA-029 追加（:110、`{groupId, eventIds}`）、SA-030 削除（:132、`{groupId, eventId}`、確認なし）、成功で refresh（:120, :137）。`DeleteEventGroupForm.tsx`（84 行、SA-028 は `deleteEventGroup(id)`、`ConfirmDialog`、成功で `/admin/event-groups` :34-35）。読み `GET /api/admin-read/event-groups/:id`（`eventGroups.ts:51`、member 100 件と最初の候補 80 件）。
- event 一覧: `app/(admin)/admin/events/page.tsx`（237 行）。`q` と `filter` / `sort` の 2 select（:87-116）、60 件「上限 60」（:118-120）、状態 badge（`src/lib/utils/eventStatus`、:143-171）、行の link（:174-198）、空のときの link（`/admin/events/new`・`/admin/events/templates`）。読み `GET /api/admin-read/events?sort=&filter=&q=`（`adminRead/events.ts:20`）。
- template: `app/(admin)/admin/events/templates/page.tsx`（101 行）。SA-037 は読み（`GET /api/admin-read/events/templates`、`eventTemplates.ts:96`）。`DeleteEventTemplateButton.tsx`（77 行、SA-036、`template_id` :27、`ConfirmDialog`、成功で refresh :37）。API（main）: `DELETE /api/admin/event-templates/:id`（`apps/api/src/routes/events/templates.ts:57`）。
- API（MIG-0653、D-16-1）: SA-025 `GET /api/admin/event-groups/event-options?q=&cursor=`、SA-026 `POST /api/admin/event-groups`、SA-027 `PATCH /api/admin/event-groups/:groupId`、SA-028 `DELETE /api/admin/event-groups/:groupId`、SA-029 `POST /api/admin/event-groups/:groupId/events` body `{ eventIds }`、SA-030 `DELETE /api/admin/event-groups/:groupId/events/:eventId`。
#### Owned paths
- 新規: `+apps/ops/src/routes/admin/{EventGroups,EventGroupEdit,EventGroupForm,EventGroupMembersEditor,DeleteEventGroupForm,AdminEvents,EventTemplates,DeleteEventTemplateButton}.tsx`, `+apps/ops/src/api/{adminEventGroups,adminEvents}.ts`（`adminEventGroups.ts` の 1 行目は D-16-1 の provisional comment）, `+apps/ops/test/adminEvents.test.mjs`
- 変更: `apps/ops/src/routes/router.tsx`（route 5 行）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(admin)/**`, `src/components/**`, `apps/api/**`
#### Micro-units
- **U01 group 3 画面**: 移植。member 検索の cursor と古い検索の破棄を変えない。
- **U02 event 一覧と template**: 移植。template 削除は main の contracts（D-17-3）。
- **U03 merge 直前**（D-16-1 の 5）: MIG-0653 の `packages/contracts/src/admin/eventGroups.ts` に置き換える。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | member 検索を素早く 2 回 | 古い応答を捨てる |
| T02 | 「さらに読む」で同じ event が重複 | 1 回だけ表示 |
| T03 | group 作成成功 | `/admin/event-groups/{id}/edit` へ |
| T04 | template 削除の確認で cancel | API を呼ばない |
| T05 | event 一覧の `q` | URL の query と再取得 |
#### Commands
```bash
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と移植元 9 file 行の移植先。`API_MATRIX.md` の SA-025〜030, 036, 037 に画面の呼び出し元。
#### DONE checklist
- [ ] U01〜U03 が DONE、T01〜T05 が PASS
- [ ] MIG-0707・0726・0653 が DONE で、暫定の土台と型が残っていない
- [ ] browser 確認（390px / 1440px）が PR にある
#### STOP
- API の契約が CURRENT と違うときは止めて MIG-0653 に返す。
#### Rollback
Phase 7 共通契約のとおり（`apps/ops` は本番に配信されていない）。

### MIG-0729: `/admin/videos` と `/admin/videos/:id`（SA-001..003, 043、MIG-0705 U04 の一部、D-17）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-17: MIG-0705 から分割。契約先行で、merge は MIG-0707・0726・0603 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0625, MIG-0635 / **Decisions:** D-05 DECIDED, D-16-1, D-16-5, D-17-1, D-17-2, D-17-3, D-17-6, D-17-7
- **Merge gate:** MIG-0707, MIG-0726, MIG-0603 が DONE（D-16-1, D-17-1）
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- 一覧: `app/(admin)/admin/videos/page.tsx`（394 行）。`AdminVideoManagementTabs`（63 行）、審査の絞り込みなら `VideoReviewQueueTable`（:192, :253-286）、それ以外は `FnTable`（:288-381）。`q` / `status` / `event` / `page`（:64-68）、50 件（:41）、hidden `status`（:231）、event select（:238）、解除（:246-250）、`Pagination`（:183-190）、審査詳細の link は `?event=` を保つ（:257-261）。SA-001 を `quickApproveAction` に（:22, :264）、key `video_id` と任意の `review_event_id`（:265-267）。読み `GET /api/admin-read/videos?q=&status=&event=&page=`（`adminRead/videos.ts:34`）。
- 1 件: `app/(admin)/admin/videos/[id]/page.tsx`（199 行、`notFound()` :42, :45）。`AdminVideoTabs`（36 行）、`VideoReviewDetailPanel`、`VideoApproveActions`（SA-001 / 002、:99-100）、`AdminVideoStatusForm`（`VideoStatusForm.tsx`、SA-003、`allowVoidReason` は常に true、`case_id` が要るとき :211）、`CreateModerationCaseForm`（`src/components/admin/CreateModerationCaseForm.tsx`、129 行、SA-043 :161、key `video_id` / `case_type` / `public_reason` / `private_note` / `due_at` / `related_x_user_id` / `video_status` :177-228、成功で reset と refresh :170-171）。`openVoidCaseId` は最初の open な void の case、無ければ最初の open な case（:65-68）。`?event=` は hidden の `review_event_id` と戻り先（:40, :70-73）。footer link（:115-131、`/dashboard/edit/{id}?privileged=admin` は Ops 外）。読み `GET /api/admin-read/videos/:id?event=`（`adminRead/videoDetail.ts:67`、404 :130）。
- API（MIG-0603 U02b、D-16-1）: `POST /api/admin/videos/:videoId/status`（SA-001 = `status: "public"`、SA-002 = + `and_next: "1"`、SA-003 = 任意 status）、SA-043 `POST /api/admin/moderation/cases`。
- 共有部品（MIG-0724 と先に merge した方、D-17-6）: video 審査の 5 部品。
#### Owned paths
- 新規: `+apps/ops/src/routes/admin/{AdminVideos,AdminVideoDetail,CreateModerationCaseForm}.tsx`, `+apps/ops/src/components/admin/{AdminVideoManagementTabs,AdminVideoTabs}.tsx`, `+apps/ops/src/api/adminVideoStatus.ts`（1 行目は D-16-1 の provisional comment）, `+apps/ops/test/adminVideos.test.mjs`
- 新規（MIG-0724 と先に merge した方、D-17-6）: `+apps/ops/src/components/videoReview/{VideoReviewQueueTable,VideoReviewQuickApproveButton,VideoApproveActions,VideoStatusForm,VideoReviewDetailPanel}.tsx`, `+apps/ops/src/styles/video-review.css`
- 変更: `apps/ops/src/routes/router.tsx`（route 2 行）, `apps/ops/scripts/portCssModule.mjs`, `apps/ops/src/main.tsx`, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(admin)/**`, `src/components/**`, `apps/api/**`
#### Micro-units
- **U01 一覧**: GET form と `Pagination` は D-17-7。
- **U02 1 件**: 共有部品に `adminVideoStatus.ts` を渡す。`CreateModerationCaseForm` を移植。
- **U03 merge 直前**（D-16-1 の 5）: MIG-0603 の schema に置き換える。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `?status=review&event=e1` の即承認 | `review_event_id=e1` を送る |
| T02 | 承認して次へ | `nextHref` へ |
| T03 | un-void で case 無し | 送らずに CURRENT の文言 |
| T04 | case 作成成功 | form を reset し再取得 |
| T05 | page 3 | `Pagination` の href が CURRENT と同じ |
#### Commands
```bash
node apps/ops/scripts/portCssModule.mjs
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と移植元 file 行の移植先。`API_MATRIX.md` の SA-001〜003, 043 に画面の呼び出し元。
#### DONE checklist
- [ ] U01〜U03 が DONE、T01〜T05 が PASS
- [ ] MIG-0707・0726・0603 が DONE で、暫定の土台と型が残っていない
- [ ] browser 確認（390px / 1440px）が PR にある
#### STOP
- API の契約が CURRENT と違うときは止めて MIG-0603 に返す。
#### Rollback
Phase 7 共通契約のとおり（`apps/ops` は本番に配信されていない）。

### MIG-0730: `/admin/videos/:id/members`（SA-085、`VideoMembersField` を `packages/ui` へ、MIG-0705 U04 の一部、D-17）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0713 の後（D-17-10: `VideoMembersField` の移植は MIG-0713。Ops から `apps/app` を import しないために、MIG-0713 の移植を `packages/ui` に移す）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0635, MIG-0713 / **Decisions:** D-05 DECIDED, D-16-1, D-16-11, D-17-1, D-17-10
- **Merge gate:** MIG-0707, MIG-0726, MIG-0650, MIG-0648 が DONE（D-16-1, D-17-1）
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- `app/(admin)/admin/videos/[id]/members/page.tsx`（136 行）。`notFound()`: DB 無し（:31）、作品無し（:45）、member が `MAX_VIDEO_MEMBERS`（100）超（:60）。`AdminVideoMembersForm.tsx`（166 行）: SA-085（:8, :50）、`new FormData(form)`（:45）、key `video_id`（:74）、`is_collab`（hidden `"false"` :75 と checkbox `"true"` :101-103）、`members_json`（`VideoMembersField.tsx:115` の hidden、:802）。二重送信防止 `submitInFlightRef` + `useTransition`（:39-67）、`!ok` は `redirectForGuardReason`（:55-57、`src/lib/client/guardRedirect.ts:39`）、成功で refresh（:59）、collab を外すと member を消す文言（:126）。
- `VideoMembersField` は MIG-0713 が `apps/app/src/components/forms/VideoMembersField.tsx` に adapter 付きで移す（`searchXUsers` / `applyPermissionBatch`）。
- 読み `GET /api/admin-read/videos/:id/members`（`adminRead/videoMembers.ts:30`、404 :49）。
- API（D-16-1）: MIG-0650 SA-085 `PUT /api/videos/:videoId/members`（body `{ is_collab, members_json }`）、MIG-0648 RH-019 の X user 検索（`searchXUsers` adapter が呼ぶ。path は MIG-0648 の Work Order）。
#### Owned paths
- 移動: MIG-0713 の `apps/app/src/components/forms/VideoMembersField.tsx` と部品が使う pure module・CSS → `+packages/ui/src/forms/videoMembers/`（中身は変えない）。`apps/app` の import をそこへ向ける。
- 新規: `+apps/ops/src/routes/admin/{AdminVideoMembers,AdminVideoMembersForm}.tsx`, `+apps/ops/src/api/adminVideoMembers.ts`（1 行目は D-16-1 の provisional comment）, `+apps/ops/test/adminVideoMembers.test.mjs`
- 変更: `packages/ui/src/index.ts`（export）, `packages/ui/package.json`（exports が要るときだけ）, `apps/app/src/**` の import 行, `apps/ops/src/routes/router.tsx`（route 1 行）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(admin)/**`, `src/components/**`, `apps/api/**`
#### Micro-units
- **U01 移動**: MIG-0713 の移植を `packages/ui/src/forms/videoMembers/` に移す（`git mv`、中身の diff 0）。`npm run build --workspace=@flamenode/app` と `npm run test --workspace=@flamenode/app` が変わらず PASS。
- **U02 画面**: `AdminVideoMembers` と form を移植。`redirectForGuardReason` は D-17-2 の写像（`/entry` / `/dashboard`）。
- **U03 merge 直前**（D-16-1 の 5）: MIG-0650 / 0648 の schema に置き換える。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 保存を連打 | fetch 1 回 |
| T02 | collab を外して保存 | `is_collab=false`、CURRENT の文言 |
| T03 | member 101 人 | API 404 → 404 画面 |
| T04 | U01 の後の Personal SPA | build と test が同じ結果 |
#### Commands
```bash
npm run build --workspace=@flamenode/app
npm run test --workspace=@flamenode/app
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `VideoMembersField.tsx` 行の移植先を `packages/ui/src/forms/videoMembers/` に、`members/page.tsx`・`AdminVideoMembersForm.tsx` 行の移植先。
#### DONE checklist
- [ ] U01〜U03 が DONE、T01〜T04 が PASS
- [ ] MIG-0707・0726・0650・0648 が DONE で、暫定の土台と型が残っていない
#### STOP
- `packages/ui` の境界（network を呼ばない、`src/` を import しない）に合わない部分が見つかったら止める。
#### Rollback
Phase 7 共通契約のとおり（U01 の移動は revert で戻る）。

### MIG-0731: `/admin/users` 3 画面と `/admin/moderation`（SA-044, 049, 077..081、MIG-0705 U05 の一部、D-17）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-17: MIG-0705 から分割。契約先行で、merge は MIG-0707・0726・0637・0642・0603 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0625, MIG-0635 / **Decisions:** D-05 DECIDED, D-16-1, D-17-1, D-17-2, D-17-3, D-17-4, D-17-6, D-17-7
- **Merge gate:** MIG-0707, MIG-0726, MIG-0637, MIG-0642, MIG-0603 が DONE（D-16-1, D-17-1）
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- 一覧: `app/(admin)/admin/users/page.tsx`（625 行、`DiscordTable` :395-533、`XIdTable` :535-612）。`view=links` は `/admin/x-link-requests` へ（:89）、不明な view は discord（:90-91）。`q` / `status` / `view` / `page`（:83-88）、50 件（:33）、`AutoSubmitSelect`（:353-362）、解除（:364-368）、`buildHref`（:315-322）、permissions の view は `Pagination` なし（:381-390）。`AdminUserManagementTabs`（47 行）。permissions の view の `GlobalEditableFieldsPanel.tsx`（462 行、SA-049 :84、`new FormData` :80、checkbox `default_editable_fields` / `upcoming_editable_fields` を値ごとに繰り返す :58, :69, :451-458、`busy` :32, :299、stale props の保護 `skipPropsSyncRef` :42-52、成功で refresh :98）。読み `GET /api/admin-read/users?view=&q=&status=&page=`（`adminRead/users.ts:117`、`view=links` は `{redirect}` :122-125）。
- 詳細: `users/[id]/page.tsx`（437 行、書き込み無し、`notFound()` :28, :41）。読み `GET /api/admin-read/users/:id`（`users.ts:216`）。
- 編集: `users/[id]/edit/page.tsx`（65 行、`notFound()` :24, :28）。`UserAdminForm.tsx`（242 行、`run()` :41-64）: SA-077（`user_id` / `role` :96-98）、SA-078（解除 `is_banned="0"` :121-123、BAN `is_banned="1"` + `reason` :233-236、`ConfirmDialog` danger :223-239、理由が空なら無効 :142、500 字 :137）、SA-080（`can_create_events` :165-167）、SA-079（`is_notification_enabled` :183-185）、SA-081（`x_user_id` :213-214）。`busy` で全 button 無効、成功で `SaveSuccessNotice` と refresh（:58-62）、error は `role="alert"`（:69）。読み `GET /api/admin-read/users/:id/edit`（`userEdit.ts:19`）。
- moderation: `app/(admin)/admin/moderation/page.tsx`（216 行）。`type` / `status` / `overdue=1`（:34-40、`AutoSubmitSelect` / `AutoSubmitCheckbox` :109-123）、期限切れ badge（:142, :146）、open だけ更新 form、他は監査の link（:190-198）、100 件。`ModerationCaseStatusForm.tsx`（88 行、SA-044 :24、key `id` / `status`（resolved / rejected / cancelled / expired）/ `video_status` / `private_note` :42-72、pending で無効、成功で `storeModerationSaveNotice` → refresh :29-33）、`ModerationFlashNotice.tsx`（44 行、sessionStorage `flamenode:moderation-save-notice`）。読み `GET /api/admin-read/moderation?type=&status=&overdue=`（`adminRead/moderation.ts:11`）。
- API（D-16-1 / D-17-4）: MIG-0637 SA-077〜081（`POST /api/admin/users/:userId/{role,banned,notifications,can-create-events}`、`POST /api/admin/x-users/:xUserId/icon-refresh`）、MIG-0642 SA-049 `PUT /api/admin/permissions/editable-fields`、MIG-0603 SA-044 `POST /api/admin/moderation/cases/:caseId/status`。
#### Owned paths
- 新規: `+apps/ops/src/routes/admin/{AdminUsers,AdminUserDetail,AdminUserEdit,UserAdminForm,GlobalEditableFieldsPanel,AdminModeration,ModerationCaseStatusForm,ModerationFlashNotice}.tsx`, `+apps/ops/src/components/admin/{AdminUserManagementTabs,AdminUserTabs}.tsx`, `+apps/ops/src/api/{adminUsers,adminModeration}.ts`（1 行目は D-16-1 の provisional comment）, `+apps/ops/test/adminUsers.test.mjs`
- 変更: `apps/ops/src/routes/router.tsx`（route 4 行）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(admin)/**`, `src/components/**`, `apps/api/**`
#### Micro-units
- **U01 一覧と permissions の view**: SA-049 は checkbox を値の配列にして JSON（`{ default_editable_fields: [...], upcoming_editable_fields: [...] }`、D-16-1 の 2 の「同じ key の繰り返しは配列」）。
- **U02 詳細と編集**: 5 SA の form を移植。
- **U03 moderation**: sessionStorage の key と flash の出し方を変えない。
- **U04 merge 直前**（D-16-1 の 5）: MIG-0637 / 0642 / 0603 の schema に置き換える。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `/admin/users?view=links` | `/admin/x-link-requests` へ |
| T02 | BAN の理由が空 | button 無効 |
| T03 | BAN の確認 dialog | 確認の後だけ API |
| T04 | moderation の更新成功 | 再取得の後に flash を 1 回 |
| T05 | `overdue=1` の checkbox | URL の query と再取得 |
#### Commands
```bash
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と移植元 file 行の移植先。`API_MATRIX.md` の SA-044, 049, 077〜081 に画面の呼び出し元。
#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T05 が PASS
- [ ] MIG-0707・0726・0637・0642・0603 が DONE で、暫定の土台と型が残っていない
- [ ] 危険操作（BAN・role）が独立レビューを通っている（MIG-0705 の DONE checklist）
#### STOP
- API の契約が CURRENT と違うときは止めて担当の API task に返す。
#### Rollback
Phase 7 共通契約のとおり（`apps/ops` は本番に配信されていない）。

### MIG-0732: `/admin/x-link-requests` と `/admin/x-id-merges`（SA-090..097, 110、MIG-0705 U05 の一部、D-17）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-17: MIG-0705 から分割。契約先行で、merge は MIG-0707・0726・0605・0644 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0625 / **Decisions:** D-05 DECIDED, D-16-1, D-17-1, D-17-2, D-17-3, D-17-4, D-17-5, D-17-6
- **Merge gate:** MIG-0707, MIG-0726, MIG-0605, MIG-0644 が DONE（D-16-1, D-17-1）
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- X 連携: `app/(admin)/admin/x-link-requests/page.tsx`（190 行）。`XLinkRequestTable`（:138、MIG-0725 と共有、D-17-6）、`AdminUserManagementTabs active="link-requests"`（MIG-0731 と先に merge した方が作る）、pending 100 / 却下 10 / 監査 30（:18-93）、link `/admin/x-id-merges`（:135）と監査（:166）。読み `GET /api/admin-read/x-link-requests`（`adminRead/xLinkRequests.ts:86`）。
- X ID 統合: `app/(admin)/admin/x-id-merges/page.tsx`（384 行、`MergePreviewPanel` :176-273、`MergeRequestTable` :275-345、`RevertTable` :347-384）。`view=reverts`（:152-153）、`impact=<id>` は trim して 128 字（:51）、影響は pending / approved のときだけ（:108-120）、preview は 50 行と切り捨ての注意（:177-178, :262-266）。page 内の `run()`（`"use server"`、SA-110、:32-35）が form の action: SA-092（`from_x_user_id` / `to_x_user_id`、:160-162）、SA-093 / 094（`id`、:323-324）、SA-096（`id` / `confirm`、placeholder `MERGE`、:328-330）、SA-097（`id` / `confirm`、placeholder `REVERT`、:366-368）、SA-095（`id`、:372）。revert の button は期限内で `restore_snapshot_json` があるときだけ（:365）。pending 表示・二重送信防止は無く、form action の再描画（D-17-5）。読み `GET /api/admin-read/x-id-merges?view=&impact=`（`adminRead/xIdMerges.ts:86`）。
- API（D-16-1 / D-17-4）: MIG-0605 `POST /api/xid/link-requests/:requestId/approve`・`/reject`、MIG-0644 の 6 path（D-17-4）。
#### Owned paths
- 新規: `+apps/ops/src/routes/admin/{AdminXLinkRequests,AdminXIdMerges}.tsx`, `+apps/ops/src/api/adminXidMerges.ts`（1 行目は D-16-1 の provisional comment）, `+apps/ops/test/adminXid.test.mjs`
- 新規（D-17-6 の先に merge した方）: `+apps/ops/src/components/xid/XLinkRequestTable.tsx`, `+apps/ops/src/api/xidLinkRequests.ts`, `+apps/ops/src/components/admin/AdminUserManagementTabs.tsx`
- 変更: `apps/ops/src/routes/router.tsx`（route 2 行）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(admin)/**`, `src/components/**`, `apps/api/**`
#### Micro-units
- **U01 X 連携**: `XLinkRequestTable` を使う。
- **U02 統合**: 3 table と preview を移植。SA-110 の dispatcher は画面の `onSubmit` で action ごとに D-17-4 の path を呼ぶ形にする。結果は D-17-5（同じ URL を再取得）。CURRENT に無い pending 表示は足さないが、送信中の二重送信だけは送信中 flag で防ぐ（SPA では再描画が無いため）。
- **U03 merge 直前**（D-16-1 の 5）: MIG-0605 / 0644 の schema に置き換える。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `?impact=` に 200 字 | 128 字で読む |
| T02 | 実行の確認が空 | 送らない（required） |
| T03 | 期限切れの revert | button を出さない |
| T04 | 統合の承認成功 | 同じ URL の再取得で一覧が変わる |
#### Commands
```bash
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と移植元 file 行の移植先。`API_MATRIX.md` の SA-090〜097, 110 に画面の呼び出し元。
#### DONE checklist
- [ ] U01〜U03 が DONE、T01〜T04 が PASS
- [ ] MIG-0707・0726・0605・0644 が DONE で、暫定の土台と型が残っていない
- [ ] 危険操作（統合・revert）が独立レビューを通っている
#### STOP
- `MERGE` / `REVERT` の確認を画面だけで検査する必要が出たら止める（server 側の検査の有無を MIG-0644 に確かめる）。
#### Rollback
Phase 7 共通契約のとおり（`apps/ops` は本番に配信されていない）。

### MIG-0733: `/admin/audit` 4 画面（SA-009..011、MIG-0705 U08 の一部、D-17）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-17: MIG-0705 から分割。SA-009 / 010 の API は main にある（MIG-0629）。restore は契約先行で、merge は MIG-0707・0726・0662 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0625, MIG-0629 / **Decisions:** D-05 DECIDED, D-16-1, D-17-1, D-17-2, D-17-3, D-17-4, D-17-6, D-17-7, D-17-9
- **Merge gate:** MIG-0707, MIG-0726, MIG-0662 が DONE（D-16-1, D-17-1）
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- 一覧: `app/(admin)/admin/audit/page.tsx`（821 行）。query `table` / `operation` / `actor`（`operator` は旧名）/ `record` / `restore_status` / `since` / `until` / `limit`（既定 50、上限 100 :49-50）/ `view`（table / timeline / cards :45）、`since` / `until` は JST の日境界（:106-111）。`AdminSectionTabs hub="audit"`、GET form（:191）、`ViewModeSwitch`（:344）、3 つの view（:322-326）、`AuditDiffDetail`（164 行、:451）、`AuditTargetLink`（111 行）。読み `GET /api/admin-read/audit`（`adminRead/audit.ts:45`。一覧は before / after の本文を返さず長さだけ :80-83、48 KiB で切る :105-115、本文は `GET /api/admin-read/audit/:id/payload/:field?offset=N` :210）。
- 詳細: `audit/[id]/page.tsx`（395 行、`notFound()` :47, :50, :55）。前後の link（:132-148）、table ごとの管理 link（:215-237）、`AuditDiffDetail`（:278）、raw の 3 節（:283-295）、`AuditRestoreForm.tsx`（376 行、:303）: SA-010（`audit_id` / `reason` :46-48、理由が空なら無効 :164）、SA-011（`audit_id` / `reason` / `confirm_text` / `force_overwrite` "1"/"0" :62-66、確認文字列 `RESTORE ${auditId}` :24, :57, :227-229）、`restore_status === "restorable"` のときだけ（:36）、結果はその場に出す。読み `GET /api/admin-read/audit/:id`（`audit.ts:171`）と payload（:210、12,000 字ずつ `nextOffset`）。
- restore 履歴: `audit/restore/page.tsx`（130 行、50 件）。読み `GET /api/admin-read/audit/restore`（`audit.ts:137`）。
- 設定: `audit/settings/page.tsx`（106 行）+ `AuditSettingsForm.tsx`（178 行、SA-009 :50、key 5 つ :45-49、`loading` :120、短くするときの注意 :36-39）。読み `GET /api/admin-read/audit-settings`（`adminRead/settings.ts:260`。`/audit/` の下ではない）。
- API: main に `POST /api/admin/audit/settings`（`apps/api/src/routes/admin/audit.ts:59`）と `POST /api/admin/audit/dry-run`（:99、JSON）。SA-011 は MIG-0662 `POST /api/admin/audit/restore`（D-17-4 / 9）。
#### Owned paths
- 新規: `+apps/ops/src/routes/admin/{AuditList,AuditDetail,AuditRestoreRuns,AuditSettings,AuditDiffDetail,AuditTargetLink,AuditRestoreForm,AuditSettingsForm}.tsx`, `+apps/ops/src/lib/auditPayload.ts`（payload を `nextOffset` で最後まで読む）, `+apps/ops/src/api/adminAudit.ts`（restore の部分だけ D-16-1 の provisional の型）, `+apps/ops/test/adminAudit.test.mjs`
- 変更: `apps/ops/src/routes/router.tsx`（route 4 行）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(admin)/**`, `src/components/**`, `apps/api/**`
#### Micro-units
- **U01 一覧**: 3 view と GET form。差分を開いたときだけ payload を読む（一覧の応答に本文が無いため）。
- **U02 詳細と restore form**: dry-run は main の contracts（`AuditDryRunSchema`）。restore は provisional の型。
- **U03 履歴と設定**: 設定は main の contracts（`AuditSettingsPatchSchema`）。
- **U04 merge 直前**（D-16-1 の 5）: MIG-0662 の schema に置き換える。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `?operator=u1` | `actor=u1` と同じ結果 |
| T02 | `limit=500` | 100 |
| T03 | payload 30,000 字 | 3 回読んで全文を表示 |
| T04 | restore の確認文字列が違う | 送らない |
| T05 | `restore_status` が restorable でない | restore form を出さない |
| T06 | 保持日数を短くする | CURRENT の注意 |
#### Commands
```bash
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と移植元 8 file 行の移植先。`API_MATRIX.md` の SA-009〜011 に画面の呼び出し元。
#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T06 が PASS
- [ ] MIG-0707・0726・0662 が DONE で、暫定の土台と型が残っていない
- [ ] restore が独立レビューを通っている
#### STOP
- 一覧の応答に無い本文を一覧で出す必要が出たら止める（CURRENT の一覧の表示を確かめ、要るなら MIG-0626 に返す）。
#### Rollback
Phase 7 共通契約のとおり（`apps/ops` は本番に配信されていない）。

### MIG-0734: `/admin/cost-guard` と `/admin/notifications`（SA-016..020, 045..048、MIG-0705 U07 の一部、D-17）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-17: MIG-0705 から分割。契約先行で、merge は MIG-0707・0726・0637・0642 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0625 / **Decisions:** D-05 DECIDED, D-16-1, D-17-1, D-17-2, D-17-3, D-17-4, D-17-6, D-17-7
- **Merge gate:** MIG-0707, MIG-0726, MIG-0637, MIG-0642 が DONE（D-16-1, D-17-1）
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- cost guard: `app/(admin)/admin/cost-guard/page.tsx`（266 行）。`CostGuardForm.tsx`（67 行、SA-016 `mode` / `reason`、SA-017 `is_maintenance_mode` / `reason` :30-54、maintenance ON だけ `ConfirmDialog` :59-64、`useTransition` :23）、`CostGuardOverrideForm.tsx`（79 行、SA-018 / 020 :32、`reason` / `confirm`（`OVERRIDE` / `CLEAR`）/ 設定のときだけ `features` の繰り返し :27-29, :73-74）、`CostGuardDisabledFeaturesForm.tsx`（150 行、SA-019 :102、`features` の繰り返し / `expected_disabled_features_json`（CAS）/ `reason` / `confirm`（`APPLY`）:96-99, :144）。成功で refresh（各 :32, :35, :107）、MODES の説明（:22-58）、履歴 20 件（:82-92）。読み `GET /api/admin-read/ops/cost-guard`（`adminRead/ops.ts:880`）。
- 通知: `app/(admin)/admin/notifications/page.tsx`（476 行）。`status`（:62-73、failed は終端失敗 :75-81）/ `type` / `event` / `q`（100 字 :112）/ `cat`（:113-119）、100 件。`NotificationActionButton.tsx`（174 行、retry = SA-045、force-resend = SA-047、bulk-retry = SA-048、:108-111、`id` :105、force-resend と bulk-retry は `window.confirm` :93）、`NotificationCancelButton.tsx`（70 行、SA-046 `id` / `reason` :20-24）、`NotificationPayloadButton`（95 行）、`NotificationOutboxSummary`。読み `GET /api/admin-read/ops/notifications`（`ops.ts:110`）。
- API（D-17-4）: MIG-0637 の cost guard 5 path、MIG-0642 の通知 4 path。
#### Owned paths
- 新規: `+apps/ops/src/routes/admin/{AdminCostGuard,CostGuardForm,CostGuardOverrideForm,CostGuardDisabledFeaturesForm,AdminNotifications,NotificationActionButton,NotificationCancelButton,NotificationPayloadButton}.tsx`, `+apps/ops/src/api/{adminCostGuard,adminNotifications}.ts`（1 行目は D-16-1 の provisional comment）, `+apps/ops/test/adminOps.test.mjs`
- 新規（D-17-6 の先に merge した方）: `+apps/ops/src/components/notifications/NotificationOutboxSummary.tsx`
- 変更: `apps/ops/src/routes/router.tsx`（route 2 行）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(admin)/**`, `src/components/**`, `apps/api/**`
#### Micro-units
- **U01 cost guard**: 3 form を移植。`features` の繰り返しは配列。確認文字列と CAS の値を変えない。
- **U02 通知**: `window.confirm` の文言を変えない。
- **U03 merge 直前**（D-16-1 の 5）: MIG-0637 / 0642 の schema に置き換える。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | maintenance ON | 確認の後だけ API、OFF は確認なし |
| T02 | override の確認が `OVERRIDE` でない | 送らない |
| T03 | disabled features の CAS 不一致（409） | CURRENT の文言 |
| T04 | force-resend の confirm で cancel | API を呼ばない |
| T05 | `?status=failed` | 終端失敗の集合で読む |
#### Commands
```bash
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と移植元 file 行の移植先。`API_MATRIX.md` の SA-016〜020, 045〜048 に画面の呼び出し元。
#### DONE checklist
- [ ] U01〜U03 が DONE、T01〜T05 が PASS
- [ ] MIG-0707・0726・0637・0642 が DONE で、暫定の土台と型が残っていない
- [ ] 危険操作（maintenance・override）が独立レビューを通っている
#### STOP
- API の契約が CURRENT と違うときは止めて MIG-0637 / 0642 に返す。
#### Rollback
Phase 7 共通契約のとおり（`apps/ops` は本番に配信されていない）。

### MIG-0735: `/admin/static-builds`・`/admin/youtube-sync` 2 画面・`/admin/youtube-quota`（SA-050, 069..073, 106、MIG-0705 U07 の一部、D-17）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-17: MIG-0705 から分割。契約先行で、merge は MIG-0707・0726・0643 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0625 / **Decisions:** D-05 DECIDED, D-16-1, D-17-1, D-17-2, D-17-3, D-17-4, D-17-5, D-17-6, D-17-7
- **Merge gate:** MIG-0707, MIG-0726, MIG-0643 が DONE（D-16-1, D-17-1）
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- static builds: `app/(admin)/admin/static-builds/page.tsx`（740 行）。結果の query `backfill_kind` / `backfill_cursor` / `backfill_scanned` / `backfill_enqueued` / `backfill_done` / `backfill_error` / `backfill_state_persisted` / `visibility_repair`（:59-68、`backfill_state_persisted=0` の注意）。form action: SA-072（:277-278、引数なし）、SA-071（:342、`target_type` / `target_id` / `reason`、診断ごとの form :638-653）、SA-050（:399-400、`entity_type` / `entity_id` / `fence_token`、必ず `?visibility_repair=<result>` へ redirect）、SA-069（:467-478、`kind` / `cursor` / `mode`（continue / restart :543, :559）、`?backfill_*` へ redirect、完了なら continue を無効 :546）。`StaticRebuildQueuePanel.tsx`（190 行、SA-070 `queue_id` :147-148、SA-073 :76）。確認 dialog・pending 表示は無い。読み `GET /api/admin-read/ops/static-builds`（`adminRead/ops.ts:360`。`sharedInputs` は R2 object の状態だけで、読み込み状態・`generatedAt`・`itemCount` は返さない :343-350）。
- YouTube 同期: `app/(admin)/admin/youtube-sync/page.tsx`（381 行）。query 7 つ（:93-99）、100 件 + `hasMore`（:39, :162-163）、`AdminVideoManagementTabs`（MIG-0729 と先に merge した方）、SA-106 の form（:325、`video_id` :326、再描画だけ）。読み `GET /api/admin-read/ops/youtube-sync`（`ops.ts:965`）。
- playlist: `youtube-sync/playlists/page.tsx`（452 行）。`enabled` / `status`（:117-120）、100 件 + `hasMore`、健康度の並び（:236-250）、link（:348, :395, :402）。書き込み無し。読み `GET /api/admin-read/ops/youtube-playlists`（`ops.ts:641`）。
- quota: `app/(admin)/admin/youtube-quota/page.tsx`（151 行、書き込み無し）。読み `GET /api/admin-read/ops/youtube-quota`（`ops.ts:765`）。
- API（D-17-4）: MIG-0643 の 7 path。結果は D-17-5（API が CURRENT の redirect の query 値を返し、画面がその URL へ）。
#### Owned paths
- 新規: `+apps/ops/src/routes/admin/{StaticBuilds,StaticRebuildQueuePanel,YoutubeSync,YoutubePlaylists,YoutubeQuota}.tsx`, `+apps/ops/src/api/adminStaticBuilds.ts`（1 行目は D-16-1 の provisional comment）, `+apps/ops/test/adminStaticBuilds.test.mjs`
- 新規（MIG-0729 と先に merge した方）: `+apps/ops/src/components/admin/AdminVideoManagementTabs.tsx`
- 変更: `apps/ops/src/routes/router.tsx`（route 4 行）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(admin)/**`, `src/components/**`, `apps/api/**`
#### Micro-units
- **U01 static builds**: form を `onSubmit` + D-17-5 にする。CURRENT に無い確認は足さない。送信中の二重送信だけ送信中 flag で防ぐ。`sharedInputs` の診断の欠け（`ops.ts:343-350`）は CURRENT の表示と比べ、出せない値の欄は「—」にして work item に記録する（STOP ではない。MIG-0627 の担当、`ROUTE_MATRIX.md` の Admin 45 担当表）。
- **U02 YouTube 3 画面**: GET form は D-17-7。
- **U03 merge 直前**（D-16-1 の 5）: MIG-0643 の `packages/contracts/src/admin/staticRebuildOps.ts` に置き換える。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | backfill の continue | 応答の query の URL、結果の表示が CURRENT と同じ |
| T02 | `backfill_done=1` | continue を無効 |
| T03 | visibility repair の成功 / 失敗 | `?visibility_repair=<result>` |
| T04 | youtube-sync の `failed=1` | URL の query と再取得 |
| T05 | 101 件目がある | `hasMore` の表示 |
#### Commands
```bash
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と移植元 file 行の移植先。`API_MATRIX.md` の SA-050, 069〜073, 106 に画面の呼び出し元。
#### DONE checklist
- [ ] U01〜U03 が DONE、T01〜T05 が PASS
- [ ] MIG-0707・0726・0643 が DONE で、暫定の土台と型が残っていない
#### STOP
- API の契約が CURRENT と違うときは止めて MIG-0643 に返す。
#### Rollback
Phase 7 共通契約のとおり（`apps/ops` は本番に配信されていない）。

### MIG-0736: `/admin/health`・`/admin/health/integrity`・`/admin/security`・`/admin/workers`（MIG-0705 U07 の一部、D-17）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-17: MIG-0705 から分割。読みだけ。全件実行の 501 は MIG-0626 U05 / U06 が埋めるので、merge は MIG-0707・0726・0626 の DONE 後（D-17-8）。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0625 / **Decisions:** D-05 DECIDED, D-16-1, D-17-1, D-17-2, D-17-6, D-17-8
- **Merge gate:** MIG-0707, MIG-0726, MIG-0626 が DONE（D-16-1, D-17-1）
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- health: `app/(admin)/admin/health/page.tsx`（130 行）。`status` all / warn / info / ok（:35-43）、`deep=1` か `run=1` で全件（:44, :54-55）、link（:93-101）、`DiagnosticStatusResults kind="health"`（249 行、:122、状態の絞り込みは client だけ :59, :102-110、「最新状態を再チェック」は refresh :114）。読み `GET /api/admin-read/ops/health`（`ops.ts:236`、`deep=1` / `run=1` は main で 501 :240-242）。
- integrity: `health/integrity/page.tsx`（318 行）。`run=1` のときだけ実行（:204, :213）、`Metric` / `CheckCard`、issue の link（:115-121）。読み `GET /api/admin-read/ops/integrity`（`ops.ts:328`、`run=1` は main で 501 :329）。
- security: `app/(admin)/admin/security/page.tsx`（101 行）。`run=1` で実行（:44, :51）、`DiagnosticStatusResults kind="security"`（:93）。読み `GET /api/admin-read/ops/security`（`ops.ts:573`）。
- workers: `app/(admin)/admin/workers/page.tsx`（305 行）。`StatCard` / `WorkerRow` / `QueueMetricsRow` / `PipelineRow`、`FnTable` 3 つ（:161, :171, :216）、外部 dashboard の link（:247-248）、更新は同じ URL の link。読み `GET /api/admin-read/ops/workers`（`ops.ts:462`）。
#### Owned paths
- 新規: `+apps/ops/src/routes/admin/{AdminHealth,AdminIntegrity,AdminSecurity,AdminWorkers,DiagnosticStatusResults}.tsx`, `+apps/ops/src/api/adminDiagnostics.ts`, `+apps/ops/test/adminDiagnostics.test.mjs`
- 変更: `apps/ops/src/routes/router.tsx`（route 4 行）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(admin)/**`, `src/components/**`, `apps/api/**`
#### Micro-units
- **U01 health と security**: `DiagnosticStatusResults` を移植。「再チェック」は `refreshKey`。
- **U02 integrity と workers**: 移植。
- **U03 merge 直前**: MIG-0626 が DONE の main で `deep=1` / `run=1` が 200 になったことを test で確かめる。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `/admin/health?status=warn` | warn だけ表示（client の絞り込み） |
| T02 | `/admin/health?deep=1`（MIG-0626 の後） | 全件の結果 |
| T03 | `/admin/health/integrity` | 実行せず、実行の link だけ |
| T04 | security の check が 1 件失敗 | warn の項目 |
#### Commands
```bash
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と移植元 5 file 行の移植先。
#### DONE checklist
- [ ] U01〜U03 が DONE、T01〜T04 が PASS
- [ ] MIG-0707・0726・0626 が DONE で、全件実行が 501 でない
#### STOP
- MIG-0626 が 501 を残すと決めたら止める（機能の欠落なので Yugo の判断、D-17-8）。
#### Rollback
Phase 7 共通契約のとおり（`apps/ops` は本番に配信されていない）。

### MIG-0737: `/admin/spreadsheet` と `/admin/import`（RH-002..009、MIG-0705 U06、D-17）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-17: MIG-0705 から分割。Route Handler の path は CURRENT のまま。契約先行で、merge は MIG-0707・0726・0638・0645 の DONE 後。実装は Sonnet、review は Opus）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0625 / **Decisions:** D-05 DECIDED, D-16-1, D-17-1, D-17-2, D-17-6
- **Merge gate:** MIG-0707, MIG-0726, MIG-0638, MIG-0645 が DONE（D-16-1, D-17-1）
- **Verified against:** `08e7e8c` (2026-10-27)
#### Source snapshot
- spreadsheet: `app/(admin)/admin/spreadsheet/page.tsx`（76 行）。`isAdminSpreadsheetEnabled()` が偽なら説明の card（:20-49）、`?table=`（:51-52）、`AdminSpreadsheetClient`（261 行）と `src/components/admin/spreadsheet/` の部品（`SpreadsheetGrid` 1086 行、`SpreadsheetImportModal` 202 行など、CSS `AdminSpreadsheetClient.module.css` 858 行を 9 部品が import）。client の fetch は `src/components/admin/spreadsheet/spreadsheetApi.ts`: RH-009 `GET /api/admin/spreadsheet/tables[?refresh=1]`（:38-39）、RH-003 `GET /data?table=&page=`（:60）、RH-004 `PATCH /data`（:80-82）、RH-005 `POST /data`（:94-95）、RH-006 `DELETE /data`（:105-106）、RH-007 `GET /export`（:113, :120）、RH-008 `POST /import`（preview :163、実行 :196）。import の `window.confirm`（`useSpreadsheetImport.ts:185-188`、preview token の後だけ :180-183）、行削除の `window.confirm`（`SpreadsheetGrid.tsx:738`）、undo / redo（`spreadsheetHistory.ts`）。main の Hono: RH-009（`apps/api/src/routes/admin/spreadsheet/read.ts:253`）、RH-003（:182）、RH-007（:216）。flag が偽だと Hono は 404 `{error:"spreadsheet_disabled"}`（:62-64）で、CURRENT は説明の card を出す。
- import: `app/(admin)/admin/import/page.tsx`（27 行）+ `src/components/admin/LegacyCanonicalImportClient.tsx`（1332 行 + css 215）。RH-002 `POST /api/admin/import/legacy`（preview :655-660、`mode="preview"` / `video_custom_field_decisions` / `files` の繰り返しと form の field、apply :727-730 `mode="apply"` / `preview_token` / `plan_hash`、段ごとの再試行 :700-800）、apply の `window.confirm`（:644）、`submitInFlightRef`（:299, :616, :648, :849）、preview の資格を sessionStorage（:204-236）、form を変えると preview をやり直す（`formRevisionRef`）、期限切れの文言（:640）。
- API（D-16-1）: MIG-0638 RH-004〜008（path・method は CURRENT のまま）、MIG-0645 RH-002（同じ）。multipart は D-16-1 の 2 のとおり FormData のまま送る。
#### Owned paths
- 新規: `+apps/ops/src/routes/admin/{AdminSpreadsheet,AdminImport}.tsx`, `+apps/ops/src/components/spreadsheet/**`（CURRENT `src/components/admin/spreadsheet/` の 1 対 1 の移植）, `+apps/ops/src/components/import/LegacyCanonicalImportClient.tsx`, `+apps/ops/src/styles/{admin-spreadsheet,legacy-import}.css`（`MODULES` に 2 行）, `+apps/ops/test/adminSpreadsheet.test.mjs`
- 変更: `apps/ops/src/routes/router.tsx`（route 2 行）, `apps/ops/scripts/portCssModule.mjs`, `apps/ops/src/main.tsx`, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `app/(admin)/**`, `app/api/**`, `src/components/**`, `apps/api/**`
#### Micro-units
- **U01 spreadsheet**: 部品を移植。fetch の path は CURRENT と同じなので `spreadsheetApi.ts` は path を変えない。`tables` の 404 `spreadsheet_disabled` は CURRENT の説明 card を出す（`.dev.vars` の説明文を含め CURRENT の文言）。
- **U02 import**: 移植。sessionStorage の key・再試行・確認を変えない。
- **U03 merge 直前**: MIG-0638 / 0645 の DONE 後の main で、書き込み・import が Hono で 200 になることを fixture で確かめる。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | flag が偽（404 `spreadsheet_disabled`） | CURRENT と同じ説明 card |
| T02 | import の confirm で cancel | 実行の request を出さない |
| T03 | import 途中で失敗（API の rollback） | CURRENT と同じ文言（MIG-0705 T02） |
| T04 | legacy import の form を preview 後に変える | 「入力が変更されたため…」の文言、apply 不可 |
| T05 | preview の token・`plan_hash` | 画面に出さない（MIG-0705 T03） |
#### Commands
```bash
node apps/ops/scripts/portCssModule.mjs
npm run build --workspace=@flamenode/ops
npm run test --workspace=@flamenode/ops
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file と移植元 file 行の移植先。`API_MATRIX.md` の RH-002〜009 に画面の呼び出し元。
#### DONE checklist
- [ ] U01〜U03 が DONE、T01〜T05 が PASS
- [ ] MIG-0707・0726・0638・0645 が DONE で、暫定の土台が残っていない
- [ ] spreadsheet 書き込みと import が独立レビューを通っている
#### STOP
- 任意 SQL を実行できる画面が必要に見えたら止める（MIG-0705 の STOP）。
- 移植元 1 file が 1 回の review に収まらない（`SpreadsheetGrid` 1086 行、`LegacyCanonicalImportClient` 1332 行）なら U01 / U02 を別 PR に分けてよい（同じ task の中で）。
#### Rollback
Phase 7 共通契約のとおり（`apps/ops` は本番に配信されていない）。

### MIG-0706: Phase 7 Gate
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — Phase Gate はエージェントが自動承認しない
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0704, MIG-0705 / **Decisions:** D-05 DECIDED, D-17-11
- **Verified against:** `08e7e8c` (2026-10-27)
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
