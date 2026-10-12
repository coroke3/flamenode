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

### 1. 公開画面 (15画面) → `apps/site` (Astro SSG + React Islands)

| モック名 | モックルート | 静的HTML | CURRENTルート | 画面区分 | 関連UX | 移行先 |
|---|---|---|---|---|---|---|
| `Main` | `/` | `static/Main.html` | `/` | VISUAL_SCREEN | UX-TOP-001..008 | `apps/site/src/pages/index.astro` |
| `VideoDetail` | `/[id]` | `static/VideoDetail.html` | `/[id]` | VISUAL_SCREEN | UX-VID-001..012 | `apps/site/src/pages/[id].astro` |
| `About` | `/about` | `static/About.html` | `/about` | VISUAL_SCREEN | UX-ABOUT-001..003 | `apps/site/src/pages/about.astro` |
| `Events` | `/event` | `static/Events.html` | `/event` | VISUAL_SCREEN | UX-EVT-001..005 | `apps/site/src/pages/event.astro` |
| `EventDetail` | `/event/[id]` | `static/EventDetail.html` | `/event/[id]` | VISUAL_SCREEN | UX-EVTD-001..008 | `apps/site/src/pages/event/[id].astro` |
| `EventSlots` | `/event/[id]/slots` | `static/EventSlots.html` | `/event/[id]/slots` | VISUAL_SCREEN | UX-SLOT-001..005 | `apps/site/src/pages/event/[id]/slots.astro` |
| `EventRelease` | `/event/[id]/release` | `static/EventRelease.html` | `/event/[id]/release` | VISUAL_SCREEN | UX-EVTR-001..004 | `apps/site/src/pages/event/[id]/release.astro` |
| `Videos` | `/list` | `static/Videos.html` | `/list` | VISUAL_SCREEN | UX-LIST-001..008 | `apps/site/src/pages/list.astro` |
| `Recommend` | `/recommend` | `static/Recommend.html` | `/recommend` | VISUAL_SCREEN | UX-REC-001..004 | `apps/site/src/pages/recommend.astro` |
| `Trending` | `/trending` | `static/Trending.html` | `/trending` | VISUAL_SCREEN | UX-TRD-001..004 | `apps/site/src/pages/trending.astro` |
| `Creators` | `/user` | `static/Creators.html` | `/user` | VISUAL_SCREEN | UX-USR-001..005 | `apps/site/src/pages/user.astro` |
| `Creator` | `/user/[id]` | `static/Creator.html` | `/user/[id]` | VISUAL_SCREEN | UX-USRD-001..008 | `apps/site/src/pages/user/[id].astro` |
| `Portfolio` | `/user/[id]/portfolio` | `static/Portfolio.html` | `/user/[id]/portfolio` | VISUAL_SCREEN | UX-PORT-001..004 | `apps/site/src/pages/user/[id]/portfolio.astro` |
| `Rules` | `/rules` | `static/Rules.html` | `/rules` | VISUAL_SCREEN | UX-RULE-001..003 | `apps/site/src/pages/rules.astro` |
| `Maintenance` | `/maintenance` | `static/Maintenance.html` | `/maintenance` | SYSTEM_SURFACE | UX-SYS-001..002 | `apps/site/src/pages/maintenance.astro` |

### 2. ユーザー／個人画面 (8画面 + 4タブ) → `apps/app` (Personal React SPA)

| モック名 | モックルート | 静的HTML | CURRENTルート | 画面区分 | 関連UX | 移行先 |
|---|---|---|---|---|---|---|
| `MyPage` | `/dashboard` ほか | `static/MyPage.html` | `/dashboard` | VISUAL_SCREEN | UX-DASH-001..008 | `apps/app/src/pages/Dashboard.tsx` |
| `VideoEdit` | `/dashboard/edit/[id]` | `static/VideoEdit.html` | `/dashboard/edit/[id]` | VISUAL_SCREEN | UX-VEDT-001..010 | `apps/app/src/pages/VideoEdit.tsx` |
| `VideoPermissions` | `/dashboard/edit/[id]/permissions` | `static/VideoPermissions.html` | `/dashboard/edit/[id]/permissions` | VISUAL_SCREEN | UX-VPRM-001..005 | `apps/app/src/pages/VideoPermissions.tsx` |
| `EntrySignIn` | `/entry` | `static/EntrySignIn.html` | `/entry` (未ログイン) | VISUAL_SCREEN | UX-ENT-001..005 | `apps/app/src/pages/Entry.tsx` |
| `EntrySlotted` | `/entry/slotted` | `static/EntrySlotted.html` | `/entry` (枠あり) | VISUAL_SCREEN | UX-SLOT-001..005 | `apps/app/src/pages/EntrySlotted.tsx` |
| `EntryUnslotted` | `/entry/unslotted` | `static/EntryUnslotted.html` | `/entry` (枠なし) | VISUAL_SCREEN | UX-UNSL-001..004 | `apps/app/src/pages/EntryUnslotted.tsx` |
| `OnboardingTerms` | `/onboarding` | `static/OnboardingTerms.html` | `/onboarding` (step 1) | VISUAL_SCREEN | UX-ONB-001..003 | `apps/app/src/pages/Onboarding.tsx` |
| `OnboardingXId` | `/onboarding` | `static/OnboardingXId.html` | `/onboarding` (step 2) | VISUAL_SCREEN | UX-ONB-004..006 | `apps/app/src/pages/Onboarding.tsx` |
| `Dashboard` (タブ) | `/dashboard` | `static/Dashboard.html` | `/dashboard` | VISUAL_SCREEN | UX-DASH-001..004 | `apps/app/src/pages/Dashboard.tsx` |
| `Entry` (タブ) | `/entry` | `static/Entry.html` | `/entry` | VISUAL_SCREEN | UX-ENT-001..005 | `apps/app/src/pages/Entry.tsx` |
| `Library` (タブ) | `/dashboard/library` | `static/Library.html` | `/dashboard/library` | VISUAL_SCREEN | UX-LIB-001..004 | `apps/app/src/pages/Library.tsx` |
| `Settings` (タブ) | `/dashboard/settings` | `static/Settings.html` | `/dashboard/settings` | VISUAL_SCREEN | UX-SET-001..008 | `apps/app/src/pages/Settings.tsx` |

### 3. 運営画面 (14画面) → `apps/ops` (Ops React SPA - Manage)

| モック名 | モックルート | 静的HTML | CURRENTルート | 画面区分 | 関連UX | 移行先 |
|---|---|---|---|---|---|---|
| `Manage` | `/manage` | `static/Manage.html` | `/manage` | VISUAL_SCREEN | UX-MNG-001..006 | `apps/ops/src/pages/manage/Index.tsx` |
| `ManageEvent` | `/manage/events/[id]` | `static/ManageEvent.html` | `/manage/events/[id]` | VISUAL_SCREEN | UX-MEVT-001..006 | `apps/ops/src/pages/manage/Event.tsx` |
| `ManageVideos` | `/manage/events/[id]/videos` | `static/ManageVideos.html` | `/manage/events/[id]/videos` | VISUAL_SCREEN | UX-MVID-001..008 | `apps/ops/src/pages/manage/Videos.tsx` |
| `ManageVideo` | `/manage/events/[id]/videos/[videoId]` | `static/ManageVideo.html` | `/manage/events/[id]/videos/[videoId]` | VISUAL_SCREEN | UX-MVD-001..006 | `apps/ops/src/pages/manage/VideoDetail.tsx` |
| `ManageInbox` | `/manage/events/[id]/inbox` | `static/ManageInbox.html` | `/manage/events/[id]/inbox` | VISUAL_SCREEN | UX-MINB-001..005 | `apps/ops/src/pages/manage/Inbox.tsx` |
| `ManageEventNew` | `/manage/events/new` | `static/ManageEventNew.html` | `/manage/events/new` | VISUAL_SCREEN | UX-MNEW-001..004 | `apps/ops/src/pages/manage/EventNew.tsx` |
| `ManageSlots` | `/manage/events/[id]/slots` | `static/ManageSlots.html` | `/manage/events/[id]/slots` | VISUAL_SCREEN | UX-MSLT-001..006 | `apps/ops/src/pages/manage/Slots.tsx` |
| `ManageAudience` | `/manage/events/[id]/audience` | `static/ManageAudience.html` | `/manage/events/[id]/audience` | VISUAL_SCREEN | UX-MAUD-001..004 | `apps/ops/src/pages/manage/Audience.tsx` |
| `ManageEdit` | `/manage/events/[id]/edit` | `static/ManageEdit.html` | `/manage/events/[id]/edit` | VISUAL_SCREEN | UX-MEDT-001..006 | `apps/ops/src/pages/manage/EventEdit.tsx` |
| `ManageStaff` | `/manage/events/[id]/staff` | `static/ManageStaff.html` | `/manage/events/[id]/staff` | VISUAL_SCREEN | UX-MSTF-001..005 | `apps/ops/src/pages/manage/Staff.tsx` |
| `ManageHistory` | `/manage/events/[id]/history` | `static/ManageHistory.html` | `/manage/events/[id]/history` | VISUAL_SCREEN | UX-MHST-001..004 | `apps/ops/src/pages/manage/History.tsx` |
| `ManagePlaylist` | `/manage/events/[id]/youtube-playlist` | `static/ManagePlaylist.html` | `/manage/events/[id]/youtube-playlist` | VISUAL_SCREEN | UX-MPLS-001..004 | `apps/ops/src/pages/manage/Playlist.tsx` |
| `ManageNotifications` | `/manage/notifications` | `static/ManageNotifications.html` | `/manage/notifications` | VISUAL_SCREEN | UX-MNTF-001..004 | `apps/ops/src/pages/manage/Notifications.tsx` |
| `ManageXLink` | `/manage/x-link-requests` | `static/ManageXLink.html` | `/manage/x-link-requests` | VISUAL_SCREEN | UX-MXLK-001..004 | `apps/ops/src/pages/manage/XLink.tsx` |

### 4. 管理画面 (24画面 + 19タブ) → `apps/ops` (Ops React SPA - Admin)

| モック名 | モックルート | 静的HTML | CURRENTルート | 画面区分 | 関連UX | 移行先 |
|---|---|---|---|---|---|---|
| `Admin` | `/admin` | `static/Admin.html` | `/admin` | VISUAL_SCREEN | UX-ADM-001..006 | `apps/ops/src/pages/admin/Dashboard.tsx` |
| `AdminVideosHub` | `/admin/videos` | `static/AdminVideosHub.html` | `/admin/videos` | VISUAL_SCREEN | UX-AVID-001..006 | `apps/ops/src/pages/admin/Videos.tsx` |
| `AdminVideoHub` | `/admin/videos/[id]` | `static/AdminVideoHub.html` | `/admin/videos/[id]` | VISUAL_SCREEN | UX-AVD-001..005 | `apps/ops/src/pages/admin/VideoDetail.tsx` |
| `AdminUsersHub` | `/admin/users` | `static/AdminUsersHub.html` | `/admin/users` | VISUAL_SCREEN | UX-AUSR-001..006 | `apps/ops/src/pages/admin/Users.tsx` |
| `AdminUserHub` | `/admin/users/[id]` | `static/AdminUserHub.html` | `/admin/users/[id]` | VISUAL_SCREEN | UX-AUD-001..005 | `apps/ops/src/pages/admin/UserDetail.tsx` |
| `AdminModeration` | `/admin/moderation` | `static/AdminModeration.html` | `/admin/moderation` | VISUAL_SCREEN | UX-AMOD-001..004 | `apps/ops/src/pages/admin/Moderation.tsx` |
| `AdminEventsHub` | `/admin/events` | `static/AdminEventsHub.html` | `/admin/events` | VISUAL_SCREEN | UX-AEVT-001..006 | `apps/ops/src/pages/admin/Events.tsx` |
| `AdminEventGroupEdit` | `/admin/event-groups/new` · `[id]/edit` | `static/AdminEventGroupEdit.html` | `/admin/event-groups/new`, `[id]/edit` | VISUAL_SCREEN | UX-AEGE-001..004 | `apps/ops/src/pages/admin/EventGroupEdit.tsx` |
| `AdminAnnouncements` | `/admin/announcements` | `static/AdminAnnouncements.html` | `/admin/announcements` | VISUAL_SCREEN | UX-AANN-001..004 | `apps/ops/src/pages/admin/Announcements.tsx` |
| `AdminAnnouncementEdit` | `/admin/announcements/new` · `[id]/edit` | `static/AdminAnnouncementEdit.html` | `/admin/announcements/new`, `[id]/edit` | VISUAL_SCREEN | UX-AANE-001..004 | `apps/ops/src/pages/admin/AnnouncementEdit.tsx` |
| `AdminRules` | `/admin/rules` | `static/AdminRules.html` | `/admin/rules` | VISUAL_SCREEN | UX-ARUL-001..004 | `apps/ops/src/pages/admin/Rules.tsx` |
| `AdminRuleEdit` | `/admin/rules/new` · `[id]/edit` | `static/AdminRuleEdit.html` | `/admin/rules/new`, `[id]/edit` | VISUAL_SCREEN | UX-ARLE-001..004 | `apps/ops/src/pages/admin/RuleEdit.tsx` |
| `AdminYoutubeQuota` | `/admin/youtube-quota` | `static/AdminYoutubeQuota.html` | `/admin/youtube-quota` | VISUAL_SCREEN | UX-AYTQ-001..004 | `apps/ops/src/pages/admin/YoutubeQuota.tsx` |
| `AdminNotifications` | `/admin/notifications` | `static/AdminNotifications.html` | `/admin/notifications` | VISUAL_SCREEN | UX-ANTF-001..004 | `apps/ops/src/pages/admin/Notifications.tsx` |
| `AdminAuditHub` | `/admin/audit` | `static/AdminAuditHub.html` | `/admin/audit` | VISUAL_SCREEN | UX-AAUD-001..006 | `apps/ops/src/pages/admin/Audit.tsx` |
| `AdminAuditDetail` | `/admin/audit/[id]` | `static/AdminAuditDetail.html` | `/admin/audit/[id]` | VISUAL_SCREEN | UX-AADD-001..004 | `apps/ops/src/pages/admin/AuditDetail.tsx` |
| `AdminCostGuard` | `/admin/cost-guard` | `static/AdminCostGuard.html` | `/admin/cost-guard` | VISUAL_SCREEN | UX-ACST-001..004 | `apps/ops/src/pages/admin/CostGuard.tsx` |
| `AdminStaticBuilds` | `/admin/static-builds` | `static/AdminStaticBuilds.html` | `/admin/static-builds` | VISUAL_SCREEN | UX-ASBD-001..004 | `apps/ops/src/pages/admin/StaticBuilds.tsx` |
| `AdminHealthHub` | `/admin/health` | `static/AdminHealthHub.html` | `/admin/health` | VISUAL_SCREEN | UX-AHLT-001..006 | `apps/ops/src/pages/admin/Health.tsx` |
| `AdminSecurity` | `/admin/security` | `static/AdminSecurity.html` | `/admin/security` | VISUAL_SCREEN | UX-ASEC-001..004 | `apps/ops/src/pages/admin/Security.tsx` |
| `AdminPermSim` | `/admin/permissions/simulator` | `static/AdminPermSim.html` | `/admin/permissions/simulator` | VISUAL_SCREEN | UX-APRM-001..004 | `apps/ops/src/pages/admin/PermissionSimulator.tsx` |
| `AdminApi` | `/admin/api-endpoints` | `static/AdminApi.html` | `/admin/api-endpoints` | VISUAL_SCREEN | UX-AAPI-001..004 | `apps/ops/src/pages/admin/ApiEndpoints.tsx` |
| `AdminImport` | `/admin/import` | `static/AdminImport.html` | `/admin/import` | VISUAL_SCREEN | UX-AIMP-001..004 | `apps/ops/src/pages/admin/Import.tsx` |
| `AdminSpreadsheet` | `/admin/spreadsheet` | `static/AdminSpreadsheet.html` | `/admin/spreadsheet` | VISUAL_SCREEN | UX-ASPR-001..004 | `apps/ops/src/pages/admin/Spreadsheet.tsx` |

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

モックが正本となる範囲:
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

各画面の実装完了判定は、以下をすべて満たすこと:

```text
visual target implemented（docs/migration/mock/ の該当画面と一致）
+ required UX IDs mapped（担当UX機能がすべて実装されている）
+ CURRENT behavior parity verified（現行機能との動作同等性を検証済み）
+ permissions verified（サーバーサイドでの権限検証）
+ loading/error/empty/pending/degraded states verified（全状態の表示確認）
+ responsive/accessibility verified（スマホ〜PC表示、キーボード操作、フォーカス）
+ URL/history behavior verified（ブラウザ戻る/進む、ディープリンク、クエリパラメータ保持）
+ backend side effects verified where applicable（副作用・監査ログの検証）
```
