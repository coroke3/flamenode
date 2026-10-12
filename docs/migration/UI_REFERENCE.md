# FlameNode Migration UI Reference

> Status: `REGISTERED_HTML`
> Last updated: 2026-10-13
> Applies to: UI redesign / Phase 2 / route migration acceptance
> Reference status: REGISTERED_HTML (APPROVED)
> Reference file(s): [`docs/migration/mock/README.md`](mock/README.md) ([`pages.json`](mock/pages.json), `static/*.html`, `site/`, `source/`, `screenshots/`)
> Received at: 2026-10-13
> Version/hash: claude.ai Design artifact version `1791816999-f0e9` (2026-10-12)
> Scope: 全96ページ・パーツ（公開15、ユーザー8、運営14、管理24、タブ23、共通部品12）
> Excluded surfaces: 内部Cron/Queue Worker、内部ヘルスチェックプローブ（画面を持たないバックグラウンド処理）

## Current state

ユーザーが後日提供するHTML mock（新デザイン一式）を [`docs/migration/mock/README.md`](mock/README.md) に受領し、本ドキュメントへ登録完了（MIG-0200）。
旧 `docs/design-redesign/` および `app/(redesign)` の過去mockは引き続き廃止・使用禁止であり、本ドキュメントおよび [`docs/migration/mock/README.md`](mock/README.md) を新UIの唯一のビジュアル正本とする。

## User decision (2026-10-09 / 確定: 2026-10-13)

D-08=A: **新HTMLモックを確定してからUIを移行する**。
2026-10-13にモック一式を受領・検証し、本ドキュメントへ登録（MIG-0200）したため、D-08 は **DECIDED** となった。
Phase 2（MIG-0201: visual/IA抽出 + design tokens）がアンロックされ、Phase 4/5（公開画面 Astro SSG + React Islands）および Phase 7（非公開 SPA）のUI実装へ順次展開可能。

### デザイン適用戦略（案A正式採用）
[`README.md`](README.md) §デザイン適用戦略 および [`PHASE_7_SPEC.md`](PHASE_7_SPEC.md) §1 に基づき、画面区分ごとに以下の適用戦略を厳格に順守する：
1. **公開画面（Phase 4/5: Astro SSG + React Islands）**:
   - ユーザー提供の新 HTML mock（`static/*.html`）を視覚・IAの正本として完全一致させる。
   - 担当する `UX-*` 機能パリティを全件満たす。
2. **管理・マイページ・登録画面（Phase 7: Personal / Ops React SPA）**:
   - 現行 UI/コンポーネント資産（`packages/ui` へ抽出）を流用して移行効率を最大化する。
   - モック（`static/Admin*.html`, `static/Manage*.html`, `static/MyPage.html` 等）は、将来的なUIリファイン・情報階層の**参考デザイン（Reference Target）**として位置付ける。
   - Phase 7 の一次移行完了条件（Gate）は「現行機能パリティ（`UX-*` / `FN-*`）＋現行UI資産のSPA移行（`packages/ui`）」であり、新モックへの完全視覚追従は一次ブロッキング条件としない。

---

## Registered HTML mock reference (MIG-0200)

```text
Reference status: READY
Reference file(s): docs/migration/mock/ (README.md, pages.json, static/*.html, site/, source/, screenshots/)
Received at: 2026-10-13
Version/hash: claude.ai Design artifact version 1791816999-f0e9 (2026-10-12)
Scope: 公開15画面、ユーザー8画面、運営14画面、管理24画面、サブタブ23画面、共通部品12個（全96ページ・パーツ）
Excluded surfaces: 内部Cron/Queue Worker、内部ヘルスチェックプローブ（UIを持たないバックグラウンド処理）
```

### モック構造

| パス | 内容 | 役割 |
|---|---|---|
| [`pages.json`](mock/pages.json) | 全ページ一覧（名前・タイトル・ルート・区分・取り込み部品・リンク先） | 画面索引・ルーティング対応 |
| `static/*.html` | 各ページの初期状態静的HTML（マークアップ・クラス構造） | 実装マークアップ・DOM構造の参照 |
| `site/` | 動作確認用HTML一式（`site/index.html` から全ページ遷移・タブ・入力確認可能） | 状態遷移・挙動の確認 |
| `screenshots/*.desktop.jpg`, `*.mobile.jpg` | 各画面のPC（1440px）およびスマホ（390px）スクリーンショット | ビジュアル比較の正解基準 |
| `source/boards/*.dc.html` | デザインキャンバス元データ（テンプレート + 条件分岐 + 状態ロジック） | 状態の種類・条件分岐の参照 |
| `source/fn.css` | 共通CSS（レスポンシブ規則含む） | スタイル移植の基準 |
| `source/design-system/tokens.json` | 色・文字・余白・影のトークン定義 | `packages/ui` のデザイントークン変換元 |
| `source/design-system/components.js/.css` | 共通React部品定義 | コンポーネントAPIの参照 |

---

## デザイン原則・共通ルール（確定事項）

1. **配色**:
   - ダークが既定（背景: 純黒 `#000000`、文字: 純白 `#ffffff`）。
   - アクセントカラー: ライム `#d6ec8a` を Primary ボタンの塗りにのみ使用。
2. **角丸 (border-radius)**:
   - 面、ボタン、入力欄、サムネイルは**角丸なし (0px)**。
   - ただし、**アイコンは全て正円**（アバター、アイコンタイル、イベントアイコン、丸ボタン `.ib`）。
3. **カード表現**:
   - 公開ページではカード表現を使わない（不要な見出し・サブタイトル付きカード枠を廃止）。
   - ユーザーページの「次にやること」など、明示的に指定した箇所のみ背景付きカードを使用。
4. **タイポグラフィ・数値強調**:
   - 太字は display / h1 / h2 のみ。
   - スマホ（≤640px）は一段縮小（h1: 22px, 本文: 14px, 補助: 12px）。
   - 数字を見せる箇所は数字のみ大きく表示（例: 締切「あと **3** 日」、作品数）。
5. **締切表示フォーマット**:
   - 「提出締切 日時」+「あと N 日（数字のみ拡大）」の形式をトップ、イベント、上映枠、参加投稿、ダッシュボードで共通化。
6. **枠あり／枠なし投稿フロー**:
   - ユーザーに種別を手動選択させない。イベント選択後、枠が必要なイベントは枠選択へ、枠なしイベントは提出画面へ自動遷移。
7. **モバイルヘッダー (≤640px)**:
   - 画面上部に固定配置。並びは「ロゴ・検索・アバター・≡」。
   - アバターと ≡ はどちらも同一の統合ドロワーメニューを開く（名義切替、ナビ、ライブラリ/設定/運営/管理、テーマ切替、ログアウト）。下部タブバーは廃止。
8. **スクロールバー**:
   - 画面内スクロール領域ではスクロールバー非表示（スクロール操作自体は維持）。
9. **テキスト省略**:
   - `.ell` クラスによりサイト全体で1行省略を統一。
10. **作品詳細（モバイル）**:
    - 参加メンバーはチャプターシート内に統合。
    - 下部ドックは「再生リスト / チャプター・コメント」。
11. **運営・審査の詳細パネル**:
    - 固定フローティング表示にせず通常のスクロールに組み込む（スマホでは一覧の上部に配置）。
12. **レスポンシブブレークポイント**:
    - `≤ 1023px`: ヘッダー検索欄縮小、管理系一部1カラム化
    - `≤ 1007px`: トップヒーロー画像下文字回り込み（360pxブロック中央寄せ）
    - `≤ 900px`: 作品詳細1カラム + 下部ドック、運営2カラム→1カラム
    - `≤ 700px` / `≤ 640px`: スマホ表示（固定ヘッダー、文字サイズ、フッター12px）
    - 280〜1280px で横スクロールはみ出しなしを確認済み。

---

## モック画面と CURRENT ルート・移行先の対応表

各画面の関連UXは正本 [`screen-mapping/README.md`](screen-mapping/README.md) および [`FRONTEND_FEATURES.md`](FRONTEND_FEATURES.md) に準拠しています。

### 1. 公開画面 (14画面 + 1システム画面) → `apps/site` (Astro SSG + React Islands)
> **デザイン適用方針:** モック完全一致（Target Visual Reference = `docs/migration/mock/static/`）。

| モック名 | モックルート | 静的HTML | CURRENTルート | 画面区分 | 関連UX (正本) | 移行先 |
|---|---|---|---|---|---|---|
| `Main` | `/` | `static/Main.html` | `/` | VISUAL_SCREEN | UX-PUB-001..007 | `apps/site/src/pages/index.astro` |
| `VideoDetail` | `/[id]` | `static/VideoDetail.html` | `/[id]` | VISUAL_SCREEN | UX-AUTH-023, UX-VID-001..055 | `apps/site/src/pages/[id].astro` |
| `About` | `/about` | `static/About.html` | `/about` | VISUAL_SCREEN | UX-PUB-008..009 | `apps/site/src/pages/about.astro` |
| `Events` | `/event` | `static/Events.html` | `/event` | VISUAL_SCREEN | UX-EVENT-001..005, UX-GLOBAL-006 | `apps/site/src/pages/event.astro` |
| `EventDetail` | `/event/[id]` | `static/EventDetail.html` | `/event/[id]` | VISUAL_SCREEN | UX-EVENT-006..012, UX-SLOT-001, UX-SUB-016 | `apps/site/src/pages/event/[id].astro` |
| `EventRelease` | `/event/[id]/release` | `static/EventRelease.html` | `/event/[id]/release` | VISUAL_SCREEN | UX-EVENT-017..019 | `apps/site/src/pages/event/[id]/release.astro` |
| `EventSlots` | `/event/[id]/slots` | `static/EventSlots.html` | `/event/[id]/slots` | VISUAL_SCREEN | UX-EVENT-013..016 | `apps/site/src/pages/event/[id]/slots.astro` |
| `Videos` | `/list` | `static/Videos.html` | `/list` | VISUAL_SCREEN | UX-DISC-001..009, UX-DISC-016, UX-GLOBAL-005..006 | `apps/site/src/pages/list.astro` |
| `Recommend` | `/recommend` | `static/Recommend.html` | `/recommend` | VISUAL_SCREEN | UX-DISC-010..012, UX-DISC-016 | `apps/site/src/pages/recommend.astro` |
| `Rules` | `/rules` | `static/Rules.html` | `/rules` | VISUAL_SCREEN | UX-ADM-068, UX-AUTH-013, UX-PUB-010..011 | `apps/site/src/pages/rules.astro` |
| `Trending` | `/trending` | `static/Trending.html` | `/trending` | VISUAL_SCREEN | UX-DISC-013..016 | `apps/site/src/pages/trending.astro` |
| `Creators` | `/user` | `static/Creators.html` | `/user` | VISUAL_SCREEN | UX-GLOBAL-006, UX-USER-001..005, UX-USER-016 | `apps/site/src/pages/user.astro` |
| `Creator` | `/user/[id]` | `static/Creator.html` | `/user/[id]` | VISUAL_SCREEN | UX-USER-006..014, UX-USER-016 | `apps/site/src/pages/user/[id].astro` |
| `Portfolio` | `/user/[id]/portfolio` | `static/Portfolio.html` | `/user/[id]/portfolio` | VISUAL_SCREEN | UX-USER-015..016 | `apps/site/src/pages/user/[id]/portfolio.astro` |

| `Maintenance` | `/maintenance` | `static/Maintenance.html` | `/maintenance` | SYSTEM_SURFACE | UX-SYS-001..002 | `apps/site/src/pages/maintenance.astro` |

### 2. ユーザー／個人・登録画面 (9画面) → `apps/app` (Personal React SPA)
> **デザイン適用方針:** 案A（現行UI資産 `packages/ui` 流用優先。モックは参考デザイン）。

| モック名 | モックルート | 静的HTML | CURRENTルート | 画面区分 | 関連UX (正本) | 移行先 |
|---|---|---|---|---|---|---|
| `MyPage / Dashboard` | `/dashboard` | `static/MyPage.html / static/Dashboard.html` | `/dashboard` | VISUAL_SCREEN | UX-AUTH-023, UX-DASH-001..004, UX-SLOT-004 | `apps/app/src/pages/Dashboard.tsx` |
| `VideoEdit` | `/dashboard/edit/[id]` | `static/VideoEdit.html` | `/dashboard/edit/[id]` | VISUAL_SCREEN | UX-DASH-005..015, UX-SUB-015, UX-SUB-018, UX-VID-050..051 | `apps/app/src/pages/VideoEdit.tsx` |
| `VideoPermissions` | `/dashboard/edit/[id]/permissions` | `static/VideoPermissions.html` | `/dashboard/edit/[id]/permissions` | VISUAL_SCREEN | UX-DASH-016..019 | `apps/app/src/pages/VideoPermissions.tsx` |
| `Library` | `/dashboard/library` | `static/Library.html` | `/dashboard/library` | VISUAL_SCREEN | UX-LIB-001..012 | `apps/app/src/pages/Library.tsx` |
| `Settings` | `/dashboard/settings` | `static/Settings.html` | `/dashboard/settings` | VISUAL_SCREEN | UX-AUTH-006..007, UX-AUTH-015..019, UX-SET-001..005 | `apps/app/src/pages/Settings.tsx` |
| `EntrySignIn / Entry` | `/entry` | `static/EntrySignIn.html / static/Entry.html` | `/entry` | VISUAL_SCREEN | UX-AUTH-001..002, UX-AUTH-023, UX-ENTRY-001..007, UX-SLOT-001..007, UX-SUB-017, UX-SUB-025 | `apps/app/src/pages/Entry.tsx` |
| `EntrySlotted` | `/entry/slotted` | `static/EntrySlotted.html` | `/entry/slotted` | VISUAL_SCREEN | UX-SLOT-002..003, UX-SLOT-007..009, UX-SUB-002..021, UX-SUB-023..026 | `apps/app/src/pages/EntrySlotted.tsx` |
| `EntryUnslotted` | `/entry/unslotted` | `static/EntryUnslotted.html` | `/entry/unslotted` | VISUAL_SCREEN | UX-SLOT-002..003, UX-SLOT-007, UX-SUB-001..015, UX-SUB-017..020, UX-SUB-022..025 | `apps/app/src/pages/EntryUnslotted.tsx` |
| `OnboardingTerms / XId` | `/onboarding` | `static/OnboardingTerms.html / static/OnboardingXId.html` | `/onboarding` | VISUAL_SCREEN | UX-ADM-068, UX-AUTH-011..013 | `apps/app/src/pages/Onboarding.tsx` |


### 3. 運営画面 (11画面) → `apps/ops` (Ops React SPA - Manage)
> **デザイン適用方針:** 案A（現行UI資産 `packages/ui` 流用優先。モックは参考デザイン）。

| モック名 | モックルート | 静的HTML | CURRENTルート | 画面区分 | 関連UX (正本) | 移行先 |
|---|---|---|---|---|---|---|
| `Manage` | `/manage` | `static/Manage.html` | `/manage` | VISUAL_SCREEN | UX-MNG-001..004 | `apps/ops/src/pages/manage/Index.tsx` |
| `ManageEvent` | `/manage/events/[id]` | `static/ManageEvent.html` | `/manage/events/[id]` | VISUAL_SCREEN | UX-MNG-009..010 | `apps/ops/src/pages/manage/Event.tsx` |
| `ManageAudience` | `/manage/events/[id]/audience` | `static/ManageAudience.html` | `/manage/events/[id]/audience` | VISUAL_SCREEN | UX-MNG-010..012 | `apps/ops/src/pages/manage/Audience.tsx` |
| `ManageEdit` | `/manage/events/[id]/edit` | `static/ManageEdit.html` | `/manage/events/[id]/edit` | VISUAL_SCREEN | UX-MNG-010, UX-MNG-013..019 | `apps/ops/src/pages/manage/EventEdit.tsx` |
| `ManageSlots` | `/manage/events/[id]/slots` | `static/ManageSlots.html` | `/manage/events/[id]/slots` | VISUAL_SCREEN | UX-MNG-010, UX-MNG-027..036 | `apps/ops/src/pages/manage/Slots.tsx` |
| `ManageStaff` | `/manage/events/[id]/staff` | `static/ManageStaff.html` | `/manage/events/[id]/staff` | VISUAL_SCREEN | UX-MNG-010, UX-MNG-037..043 | `apps/ops/src/pages/manage/Staff.tsx` |
| `ManageVideos` | `/manage/events/[id]/videos` | `static/ManageVideos.html` | `/manage/events/[id]/videos` | VISUAL_SCREEN | UX-MNG-010, UX-MNG-044..045 | `apps/ops/src/pages/manage/Videos.tsx` |
| `ManageVideo` | `/manage/events/[id]/videos/[videoId]` | `static/ManageVideo.html` | `/manage/events/[id]/videos/[videoId]` | VISUAL_SCREEN | UX-MNG-010, UX-MNG-046..050 | `apps/ops/src/pages/manage/VideoDetail.tsx` |
| `ManagePlaylist` | `/manage/events/[id]/youtube-playlist` | `static/ManagePlaylist.html` | `/manage/events/[id]/youtube-playlist` | VISUAL_SCREEN | UX-MNG-010, UX-MNG-051..053 | `apps/ops/src/pages/manage/Playlist.tsx` |
| `ManageNotifications` | `/manage/notifications` | `static/ManageNotifications.html` | `/manage/notifications` | VISUAL_SCREEN | UX-MNG-054..057 | `apps/ops/src/pages/manage/Notifications.tsx` |
| `ManageXLink` | `/manage/x-link-requests` | `static/ManageXLink.html` | `/manage/x-link-requests` | VISUAL_SCREEN | UX-MNG-058..060 | `apps/ops/src/pages/manage/XLink.tsx` |


#### 3.1 運営画面モックの新規提案UI（CURRENTルートなし）

| モック名 | モックルート | 静的HTML | CURRENT状況 | 画面区分 | 扱い |
|---|---|---|---|---|---|
| `ManageInbox` | `/manage/events/[id]/inbox` | `static/ManageInbox.html` | CURRENTルートなし | PROPOSED_SCREEN | CURRENT_DIVERGENCE: モックの新規提案UI。一次移行では実装せず、後続機能として個別検討 |
| `ManageEventNew` | `/manage/events/new` | `static/ManageEventNew.html` | `/admin/events/new` に集約 | PROPOSED_SCREEN | CURRENT_DIVERGENCE: CURRENTではイベント新規作成は `/admin/events/new` に集約 |
| `ManageHistory` | `/manage/events/[id]/history` | `static/ManageHistory.html` | CURRENTルートなし | PROPOSED_SCREEN | CURRENT_DIVERGENCE: モックの新規提案UI。一次移行では実装せず、後続機能として個別検討 |

### 4. 管理画面 (40画面群 / CURRENT全45ルート対応) → `apps/ops` (Ops React SPA - Admin)
> **デザイン適用方針:** 案A（現行UI資産 `packages/ui` 流用優先。モックは参考デザイン）。

| モック名 | モックルート | 静的HTML | CURRENTルート | 画面区分 | 関連UX (正本) | 移行先 |
|---|---|---|---|---|---|---|
| `Admin` | `/admin` | `static/Admin.html` | `/admin` | VISUAL_SCREEN | UX-ADM-001 | `apps/ops/src/pages/admin/Dashboard.tsx` |
| `AdminAnnouncements` | `/admin/announcements` | `static/AdminAnnouncements.html` | `/admin/announcements` | VISUAL_SCREEN | UX-ADM-003, UX-ADM-006..007 | `apps/ops/src/pages/admin/Announcements.tsx` |
| `AdminAnnouncementEdit` | `/admin/announcements/[id]/edit` | `static/AdminAnnouncementEdit.html` | `/admin/announcements/[id]/edit` | VISUAL_SCREEN | UX-ADM-005..007 | `apps/ops/src/pages/admin/AnnouncementEdit.tsx` |
| `AdminAnnouncements (New)` | `/admin/announcements/new` | `static/AdminAnnouncements.html (new view)` | `/admin/announcements/new` | VISUAL_SCREEN | UX-ADM-004, UX-ADM-006..007 | `apps/ops/src/pages/admin/Announcements.tsx` |
| `AdminApi` | `/admin/api-endpoints` | `static/AdminApi.html` | `/admin/api-endpoints` | VISUAL_SCREEN | UX-ADM-008..010 | `apps/ops/src/pages/admin/ApiEndpoints.tsx` |
| `AdminAudit / Hub` | `/admin/audit` | `static/AdminAudit.html / static/AdminAuditHub.html` | `/admin/audit` | VISUAL_SCREEN | UX-ADM-011, UX-ADM-020 | `apps/ops/src/pages/admin/Audit.tsx` |
| `AdminAuditDetail` | `/admin/audit/[id]` | `static/AdminAuditDetail.html` | `/admin/audit/[id]` | VISUAL_SCREEN | UX-ADM-012..014, UX-ADM-020 | `apps/ops/src/pages/admin/AuditDetail.tsx` |
| `AdminAuditRestore` | `/admin/audit/restore` | `static/AdminAuditRestore.html` | `/admin/audit/restore` | VISUAL_SCREEN | UX-ADM-015..017 | `apps/ops/src/pages/admin/AuditRestore.tsx` |
| `AdminAuditSettings` | `/admin/audit/settings` | `static/AdminAuditSettings.html` | `/admin/audit/settings` | VISUAL_SCREEN | UX-ADM-018 | `apps/ops/src/pages/admin/AuditSettings.tsx` |
| `AdminCostGuard` | `/admin/cost-guard` | `static/AdminCostGuard.html` | `/admin/cost-guard` | VISUAL_SCREEN | UX-ADM-021..023 | `apps/ops/src/pages/admin/CostGuard.tsx` |
| `AdminEventGroups` | `/admin/event-groups` | `static/AdminEventGroups.html` | `/admin/event-groups` | VISUAL_SCREEN | UX-ADM-025, UX-ADM-028 | `apps/ops/src/pages/admin/EventGroups.tsx` |
| `AdminEventGroupEdit` | `/admin/event-groups/[id]/edit` | `static/AdminEventGroupEdit.html` | `/admin/event-groups/[id]/edit` | VISUAL_SCREEN | UX-ADM-027..028 | `apps/ops/src/pages/admin/EventGroupEdit.tsx` |
| `AdminEventGroups (New)` | `/admin/event-groups/new` | `static/AdminEventGroups.html (modal)` | `/admin/event-groups/new` | VISUAL_SCREEN | UX-ADM-026, UX-ADM-028 | `apps/ops/src/pages/admin/EventGroups.tsx` |
| `AdminEvents / Hub` | `/admin/events` | `static/AdminEvents.html / static/AdminEventsHub.html` | `/admin/events` | VISUAL_SCREEN | UX-ADM-029, UX-ADM-033, UX-ADM-036..037 | `apps/ops/src/pages/admin/Events.tsx` |
| `AdminEvents (New)` | `/admin/events/new` | `static/AdminEvents.html (new view)` | `/admin/events/new` | VISUAL_SCREEN | UX-ADM-031, UX-ADM-033, UX-ADM-036..037 | `apps/ops/src/pages/admin/EventNew.tsx` |
| `AdminEventTemplates` | `/admin/events/templates` | `static/AdminEventTemplates.html` | `/admin/events/templates` | VISUAL_SCREEN | UX-ADM-033, UX-ADM-036..040 | `apps/ops/src/pages/admin/EventTemplates.tsx` |
| `AdminHealth / Hub` | `/admin/health` | `static/AdminHealth.html / static/AdminHealthHub.html` | `/admin/health` | VISUAL_SCREEN | UX-ADM-041..042 | `apps/ops/src/pages/admin/Health.tsx` |
| `AdminIntegrity` | `/admin/health/integrity` | `static/AdminIntegrity.html` | `/admin/health/integrity` | VISUAL_SCREEN | UX-ADM-043..044 | `apps/ops/src/pages/admin/Integrity.tsx` |
| `AdminImport` | `/admin/import` | `static/AdminImport.html` | `/admin/import` | VISUAL_SCREEN | UX-ADM-049..052 | `apps/ops/src/pages/admin/Import.tsx` |
| `AdminModeration` | `/admin/moderation` | `static/AdminModeration.html` | `/admin/moderation` | VISUAL_SCREEN | UX-ADM-053..056 | `apps/ops/src/pages/admin/Moderation.tsx` |
| `AdminNotifications` | `/admin/notifications` | `static/AdminNotifications.html` | `/admin/notifications` | VISUAL_SCREEN | UX-ADM-057..060 | `apps/ops/src/pages/admin/Notifications.tsx` |
| `AdminPermSim` | `/admin/permissions/simulator` | `static/AdminPermSim.html` | `/admin/permissions/simulator` | VISUAL_SCREEN | UX-ADM-061..063 | `apps/ops/src/pages/admin/PermissionSimulator.tsx` |
| `AdminRules` | `/admin/rules` | `static/AdminRules.html` | `/admin/rules` | VISUAL_SCREEN | UX-ADM-064, UX-ADM-067..068 | `apps/ops/src/pages/admin/Rules.tsx` |
| `AdminRuleEdit` | `/admin/rules/[id]/edit` | `static/AdminRuleEdit.html` | `/admin/rules/[id]/edit` | VISUAL_SCREEN | UX-ADM-066..068 | `apps/ops/src/pages/admin/RuleEdit.tsx` |
| `AdminRules (New)` | `/admin/rules/new` | `static/AdminRules.html (new view)` | `/admin/rules/new` | VISUAL_SCREEN | UX-ADM-065, UX-ADM-067..068 | `apps/ops/src/pages/admin/RuleNew.tsx` |
| `AdminSecurity` | `/admin/security` | `static/AdminSecurity.html` | `/admin/security` | VISUAL_SCREEN | UX-ADM-045..046 | `apps/ops/src/pages/admin/Security.tsx` |
| `AdminSpreadsheet` | `/admin/spreadsheet` | `static/AdminSpreadsheet.html` | `/admin/spreadsheet` | VISUAL_SCREEN | UX-ADM-069..072 | `apps/ops/src/pages/admin/Spreadsheet.tsx` |
| `AdminStaticBuilds` | `/admin/static-builds` | `static/AdminStaticBuilds.html` | `/admin/static-builds` | VISUAL_SCREEN | UX-ADM-073..075 | `apps/ops/src/pages/admin/StaticBuilds.tsx` |
| `AdminUsers / Hub` | `/admin/users` | `static/AdminUsers.html / static/AdminUsersHub.html` | `/admin/users` | VISUAL_SCREEN | UX-ADM-076 | `apps/ops/src/pages/admin/Users.tsx` |
| `AdminUser / Hub` | `/admin/users/[id]` | `static/AdminUser.html / static/AdminUserHub.html` | `/admin/users/[id]` | VISUAL_SCREEN | UX-ADM-077..078, UX-ADM-081..082 | `apps/ops/src/pages/admin/UserDetail.tsx` |
| `AdminUserEdit` | `/admin/users/[id]/edit` | `static/AdminUserEdit.html` | `/admin/users/[id]/edit` | VISUAL_SCREEN | UX-ADM-079..082 | `apps/ops/src/pages/admin/UserEdit.tsx` |
| `AdminVideos / Hub` | `/admin/videos` | `static/AdminVideos.html / static/AdminVideosHub.html` | `/admin/videos` | VISUAL_SCREEN | UX-ADM-083 | `apps/ops/src/pages/admin/Videos.tsx` |
| `AdminVideo / Hub` | `/admin/videos/[id]` | `static/AdminVideo.html / static/AdminVideoHub.html` | `/admin/videos/[id]` | VISUAL_SCREEN | UX-ADM-084..087, UX-ADM-091 | `apps/ops/src/pages/admin/VideoDetail.tsx` |
| `AdminVideoMembers` | `/admin/videos/[id]/members` | `static/AdminVideoMembers.html` | `/admin/videos/[id]/members` | VISUAL_SCREEN | UX-ADM-085..091 | `apps/ops/src/pages/admin/VideoMembers.tsx` |
| `AdminWorkers` | `/admin/workers` | `static/AdminWorkers.html` | `/admin/workers` | VISUAL_SCREEN | UX-ADM-047..048 | `apps/ops/src/pages/admin/Workers.tsx` |
| `AdminXIdMerges` | `/admin/x-id-merges` | `static/AdminXIdMerges.html` | `/admin/x-id-merges` | VISUAL_SCREEN | UX-ADM-092..095 | `apps/ops/src/pages/admin/XIdMerges.tsx` |
| `AdminXLink` | `/admin/x-link-requests` | `static/AdminXLink.html` | `/admin/x-link-requests` | VISUAL_SCREEN | UX-ADM-096..099 | `apps/ops/src/pages/admin/XLink.tsx` |
| `AdminYoutubeQuota` | `/admin/youtube-quota` | `static/AdminYoutubeQuota.html` | `/admin/youtube-quota` | VISUAL_SCREEN | UX-ADM-100..101 | `apps/ops/src/pages/admin/YoutubeQuota.tsx` |
| `AdminYoutubeSync` | `/admin/youtube-sync` | `static/AdminYoutubeSync.html` | `/admin/youtube-sync` | VISUAL_SCREEN | UX-ADM-102..104 | `apps/ops/src/pages/admin/YoutubeSync.tsx` |
| `AdminPlaylists` | `/admin/youtube-sync/playlists` | `static/AdminPlaylists.html` | `/admin/youtube-sync/playlists` | VISUAL_SCREEN | UX-ADM-105..107 | `apps/ops/src/pages/admin/Playlists.tsx` |


### 5. 共通パーツ (12部品) → `packages/ui` (`@flamenode/ui`)

| 部品名 | ソース | 役割 | 移行先コンポーネント |
|---|---|---|---|
| `PublicHeader` | `source/boards/PublicHeader.dc.html` | 公開ヘッダー（ロゴ・検索・ナビ・アバター・≡） | `packages/ui/src/components/PublicHeader.tsx` |
| `PublicFooter` | `source/boards/PublicFooter.dc.html` | 公開フッター（12px薄グレーリンク・コピーライト） | `packages/ui/src/components/PublicFooter.tsx` |
| `AdminNav` | `source/boards/AdminNav.dc.html` | 管理サイドバー | `packages/ui/src/components/AdminNav.tsx` |
| `ManageNav` | `source/boards/ManageNav.dc.html` | 運営サイドバー | `packages/ui/src/components/ManageNav.tsx` |
| `ManageEventHead` | `source/boards/ManageEventHead.dc.html` | イベント運営ヘッダー | `packages/ui/src/components/ManageEventHead.tsx` |
| `ConfirmModal` | `source/boards/ConfirmModal.dc.html` | 確認モーダルダイアログ | `packages/ui/src/components/ConfirmModal.tsx` |
| `MemberEditor` | `source/boards/MemberEditor.dc.html` | 合作メンバー編集（タイムライン/表/一括） | `packages/ui/src/components/MemberEditor.tsx` |
| `EntrySubmitter` | `source/boards/EntrySubmitter.dc.html` | 提出者情報（枠提出・作品投稿共通） | `packages/ui/src/components/EntrySubmitter.tsx` |
| `IconPicker` | `source/boards/IconPicker.dc.html` | アイコン選択（候補グリッド/切り抜き） | `packages/ui/src/components/IconPicker.tsx` |
| `EntryQuestions` | `source/boards/EntryQuestions.dc.html` | 運営からの質問（質問種別ごとの入力） | `packages/ui/src/components/EntryQuestions.tsx` |
| `LinkEditor` | `source/boards/LinkEditor.dc.html` | リンク編集（URL貼り付けで種類自動判定） | `packages/ui/src/components/LinkEditor.tsx` |
| `CommandPalette` | `source/boards/CommandPalette.dc.html` | コマンドパレット（⌘K） | `packages/ui/src/components/CommandPalette.tsx` |

---

## Authority boundary（権限境界・不変条件）

モックが正本となる範囲（公開画面）:
- layout（レイアウト構造）
- visual hierarchy（視覚階層）
- typography（フォント・文字サイズ・太さ）
- spacing（余白・パディング）
- navigation placement（ナビゲーション配置）
- component appearance（コンポーネント外見）
- density（表示密度）
- responsive intent（画面幅による配置変化）
- information architecture（情報設計）

モック単体では変更しない範囲（現行コード/テスト/仕様が正本）:
- auth/permission（認可・ロール判定）
- owner rules（所有権ルール、イベントオーナー最低1名維持など）
- validation/business rules（入力検証・ビジネスロジック）
- public/private visibility（公開・非公開判定、fail-closed）
- database ownership（D1スキーマ、正規化データ所有権）
- API semantics（Honoエンドポイントのリクエスト/レスポンス契約）
- Queue/retry/idempotency（非同期ジョブ、べき等性、リトライ上限）
- notification/audit side effects（通知配信・監査ログ記録）
- URL/canonical compatibility（URL正規性・後方互換性）
- destructive operation semantics（論理削除・物理削除・復元セマンティクス）

これらは [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md)、[`FRONTEND_FEATURES.md`](FRONTEND_FEATURES.md)、[`FUNCTION_INVENTORY.md`](FUNCTION_INVENTORY.md)、現行コード/テストが正本。

---

## Design acceptance gate（受入基準）

各画面の実装完了判定は、画面区分に応じて以下をすべて満たすこと:

### 1. 公開画面（Phase 4/5: Astro SSG + React Islands）
```text
visual target implemented（docs/migration/mock/static/ の該当HTMLモックと一致）
+ required UX IDs mapped（担当UX機能がすべて実装されている）
+ CURRENT behavior parity verified（現行機能との動作同等性を検証済み）
+ permissions verified（サーバーサイドでの権限検証・fail-closed）
+ loading/error/empty/pending/degraded states verified（全状態の表示確認）
+ responsive/accessibility verified（スマホ〜PC表示、キーボード操作、フォーカス）
+ URL/history behavior verified（ブラウザ戻る/進む、ディープリンク、クエリパラメータ保持）
+ backend side effects verified where applicable（副作用・監査ログの検証）
```

### 2. 非公開画面（Phase 7: Personal / Ops React SPA）
```text
CURRENT UI asset migrated（packages/ui の現行コンポーネント資産を流用）
+ required UX IDs mapped（担当UX機能がすべて実装されている）
+ CURRENT behavior parity verified（現行機能との動作同等性を検証済み）
+ permissions verified（サーバーサイドでの厳格な認可・ロール検証）
+ loading/error/empty/pending/degraded states verified（全状態の表示確認）
+ responsive/accessibility verified（PC・操作端末での表示・キーボード操作）
+ URL/history behavior verified（ブラウザ戻る/進む、SPA遷移、クエリ保持）
+ backend side effects verified where applicable（副作用・監査ログの検証）
（※ docs/migration/mock/static/ のモックは将来UIリファインの参考デザインであり、一次移行の完全一致は必須としない）
```
