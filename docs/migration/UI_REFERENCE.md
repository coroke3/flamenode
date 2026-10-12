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

ユーザー提供HTML mock（新デザイン一式）を [`docs/migration/mock/README.md`](mock/README.md) に受領し、本ドキュメントへ登録完了（MIG-0200）。
旧 `docs/design-redesign/` および `app/(redesign)` の過去mockは引き続き廃止・使用禁止であり、本ドキュメントおよび [`docs/migration/mock/README.md`](mock/README.md) を公開新UIのビジュアル正本とする。

## User decision (2026-10-09 / 確定: 2026-10-13)

D-08=A: **新HTMLモックを確定してからUIを移行する**。
2026-10-13にモック一式を受領・検証し、本ドキュメントへ登録（MIG-0200）したため、D-08 は **DECIDED** となった。
Phase 2（MIG-0201: visual/IA抽出 + design tokens）は依存を満たして開始可能。Phase 4/5の公開UIは登録mockを適用する。Phase 7の非公開SPAは採用済みOption Aに従いCURRENT UIを再利用し、private mockは参考資料とする。各MIGの依存・レビュー・Gateはモック登録後も必要。

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
Reference status: REGISTERED_HTML (APPROVED)
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

## 公開UIのデザイン原則・共通ルール

以下はmockの意図。公開surfaceへ適用し、非公開はCURRENT UIを維持する。投稿の自動遷移・メニュー操作などの振る舞いはmockだけで承認せず、CURRENTのUX/FNと照合する。

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
    - 280〜1280px はmockの参考幅。移行実装で横スクロール・キーボード・フォーカスを改めて検証する。

---

## CURRENT route と mock の対応

契約参照: [CURRENT_SCREEN_MAPPING](screen-mapping/README.md)。各行の CURRENT route を同台帳で検索し、その行の UX/FN、permission、state、URL/query/history、responsive/a11y をすべて読む。ここでは機能IDや未確定の移行先ファイルを重複定義しない。移行先は対象MIGカードと FILE_MIGRATION_MATRIX が管理する。

- PUBLIC_MOCK: 公開visualのmock適用。maintenanceはSYSTEMの運用意味を保持した上で外見だけ参照する。
- CURRENT_UI_REUSE: 非公開visualはCURRENT UIを移植。private mockは参考であり受入基準にしない。
- PRESERVE_REDIRECT / PRESERVE_SYSTEM: canonical台帳のredirect/query/auth契約を維持。独立した新画面の追加指示ではない。
- DEV_ONLY: 開発用surface。本番visualへ昇格しない。

| CURRENT route | Class | Visual policy | Mock references |
| --- | --- | --- | --- |
| `/` | VISUAL_SCREEN | PUBLIC_MOCK | `Main` |
| `/[id]` | VISUAL_SCREEN | PUBLIC_MOCK | `VideoDetail` |
| `/about` | VISUAL_SCREEN | PUBLIC_MOCK | `About` |
| `/event` | VISUAL_SCREEN | PUBLIC_MOCK | `Events` |
| `/event/[id]` | VISUAL_SCREEN | PUBLIC_MOCK | `EventDetail` |
| `/event/[id]/release` | VISUAL_SCREEN | PUBLIC_MOCK | `EventRelease` |
| `/event/[id]/slots` | VISUAL_SCREEN | PUBLIC_MOCK | `EventSlots` |
| `/groups` | COMPAT_REDIRECT | PRESERVE_REDIRECT | — |
| `/groups/[slug]` | COMPAT_REDIRECT | PRESERVE_REDIRECT | — |
| `/list` | VISUAL_SCREEN | PUBLIC_MOCK | `Videos` |
| `/recommend` | VISUAL_SCREEN | PUBLIC_MOCK | `Recommend` |
| `/rules` | VISUAL_SCREEN | PUBLIC_MOCK | `Rules` |
| `/trending` | VISUAL_SCREEN | PUBLIC_MOCK | `Trending` |
| `/user` | VISUAL_SCREEN | PUBLIC_MOCK | `Creators` |
| `/user/[id]` | VISUAL_SCREEN | PUBLIC_MOCK | `Creator` |
| `/user/[id]/portfolio` | VISUAL_SCREEN | PUBLIC_MOCK | `Portfolio` |
| `/dashboard` | VISUAL_SCREEN | CURRENT_UI_REUSE | `Dashboard`, `MyPage` |
| `/dashboard/edit/[id]` | VISUAL_SCREEN | CURRENT_UI_REUSE | `VideoEdit` |
| `/dashboard/edit/[id]/permissions` | VISUAL_SCREEN | CURRENT_UI_REUSE | `VideoPermissions` |
| `/dashboard/library` | VISUAL_SCREEN | CURRENT_UI_REUSE | `Library` |
| `/dashboard/settings` | VISUAL_SCREEN | CURRENT_UI_REUSE | `Settings` |
| `/dashboard/youtube-playlists` | COMPAT_REDIRECT | PRESERVE_REDIRECT | — |
| `/entry` | VISUAL_SCREEN | CURRENT_UI_REUSE | `EntrySignIn`, `Entry` |
| `/entry/slotted` | VISUAL_SCREEN | CURRENT_UI_REUSE | `EntrySlotted` |
| `/entry/unslotted` | VISUAL_SCREEN | CURRENT_UI_REUSE | `EntryUnslotted` |
| `/manage` | VISUAL_SCREEN | CURRENT_UI_REUSE | `Manage` |
| `/manage/events/[id]` | VISUAL_SCREEN | CURRENT_UI_REUSE | `ManageEvent` |
| `/manage/events/[id]/audience` | VISUAL_SCREEN | CURRENT_UI_REUSE | `ManageAudience` |
| `/manage/events/[id]/edit` | VISUAL_SCREEN | CURRENT_UI_REUSE | `ManageEdit` |
| `/manage/events/[id]/review` | COMPAT_REDIRECT | PRESERVE_REDIRECT | — |
| `/manage/events/[id]/slots` | VISUAL_SCREEN | CURRENT_UI_REUSE | `ManageSlots` |
| `/manage/events/[id]/staff` | VISUAL_SCREEN | CURRENT_UI_REUSE | `ManageStaff` |
| `/manage/events/[id]/videos` | VISUAL_SCREEN | CURRENT_UI_REUSE | `ManageVideos` |
| `/manage/events/[id]/videos/[videoId]` | VISUAL_SCREEN | CURRENT_UI_REUSE | `ManageVideo` |
| `/manage/events/[id]/youtube-playlist` | VISUAL_SCREEN | CURRENT_UI_REUSE | `ManagePlaylist` |
| `/manage/notifications` | VISUAL_SCREEN | CURRENT_UI_REUSE | `ManageNotifications` |
| `/manage/x-link-requests` | VISUAL_SCREEN | CURRENT_UI_REUSE | `ManageXLink` |
| `/admin` | VISUAL_SCREEN | CURRENT_UI_REUSE | `Admin` |
| `/admin/announcements` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminAnnouncements` |
| `/admin/announcements/[id]/edit` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminAnnouncementEdit` |
| `/admin/announcements/new` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminAnnouncementEdit` |
| `/admin/api-endpoints` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminApi` |
| `/admin/audit` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminAudit`, `AdminAuditHub` |
| `/admin/audit/[id]` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminAuditDetail` |
| `/admin/audit/restore` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminAuditRestore` |
| `/admin/audit/settings` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminAuditSettings` |
| `/admin/cost-guard` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminCostGuard` |
| `/admin/event-groups` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminEventGroups` |
| `/admin/event-groups/[id]/edit` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminEventGroupEdit` |
| `/admin/event-groups/new` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminEventGroupEdit` |
| `/admin/events` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminEvents`, `AdminEventsHub` |
| `/admin/events/[id]` | COMPAT_REDIRECT | PRESERVE_REDIRECT | — |
| `/admin/events/[id]/edit` | COMPAT_REDIRECT | PRESERVE_REDIRECT | — |
| `/admin/events/[id]/slots` | COMPAT_REDIRECT | PRESERVE_REDIRECT | — |
| `/admin/events/[id]/staff` | COMPAT_REDIRECT | PRESERVE_REDIRECT | — |
| `/admin/events/new` | VISUAL_SCREEN | CURRENT_UI_REUSE | — |
| `/admin/events/templates` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminEventTemplates` |
| `/admin/health` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminHealth`, `AdminHealthHub` |
| `/admin/health/integrity` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminIntegrity` |
| `/admin/history` | COMPAT_REDIRECT | PRESERVE_REDIRECT | — |
| `/admin/import` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminImport` |
| `/admin/moderation` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminModeration` |
| `/admin/notifications` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminNotifications` |
| `/admin/permissions/simulator` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminPermSim` |
| `/admin/rules` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminRules` |
| `/admin/rules/[id]/edit` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminRuleEdit` |
| `/admin/rules/new` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminRuleEdit` |
| `/admin/security` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminSecurity` |
| `/admin/spreadsheet` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminSpreadsheet` |
| `/admin/static-builds` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminStaticBuilds` |
| `/admin/users` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminUsers`, `AdminUsersHub` |
| `/admin/users/[id]` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminUser`, `AdminUserHub` |
| `/admin/users/[id]/edit` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminUserEdit` |
| `/admin/videos` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminVideos`, `AdminVideosHub` |
| `/admin/videos/[id]` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminVideo`, `AdminVideoHub` |
| `/admin/videos/[id]/members` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminVideoMembers` |
| `/admin/workers` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminWorkers` |
| `/admin/x-id-merges` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminXIdMerges` |
| `/admin/x-link-requests` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminXLink` |
| `/admin/youtube-quota` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminYoutubeQuota` |
| `/admin/youtube-sync` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminYoutubeSync` |
| `/admin/youtube-sync/playlists` | VISUAL_SCREEN | CURRENT_UI_REUSE | `AdminPlaylists` |
| `/dev/ui-surfaces` | DEV_ONLY | DEV_ONLY | — |
| `/maintenance` | SYSTEM_SURFACE | PUBLIC_MOCK | `Maintenance` |
| `/onboarding` | VISUAL_SCREEN | CURRENT_UI_REUSE | `OnboardingTerms`, `OnboardingXId` |
| `/auth/complete` | SYSTEM_SURFACE | PRESERVE_SYSTEM | — |
| `/list/~query` | SYSTEM_SURFACE | PRESERVE_SYSTEM | — |
| `/user/~query` | SYSTEM_SURFACE | PRESERVE_SYSTEM | — |
| `/event/~query` | SYSTEM_SURFACE | PRESERVE_SYSTEM | — |
| `/user/[id]/paged` | SYSTEM_SURFACE | PRESERVE_SYSTEM | — |

### CURRENT route を持たないmock

これらは REFERENCE_ONLY。新URL・機能追加・CURRENT画面との置換を許可しない。

| Mock | Disposition | Reason |
| --- | --- | --- |
| `ManageInbox` | REFERENCE_ONLY | 対応するCURRENT routeが存在しない。追加は別の要件決定を要する。 |
| `ManageEventNew` | REFERENCE_ONLY | 対応するCURRENT routeが存在しない。追加は別の要件決定を要する。 |
| `ManageHistory` | REFERENCE_ONLY | 対応するCURRENT routeが存在しない。追加は別の要件決定を要する。 |

### 共通パーツの適用範囲

公開mockのCSS/tokensは公開rootへscopeする。非公開CURRENTのテーマ・部品・入力/操作フローへglobal CSSを波及させない。共通パーツの新規実装先・採否は対象MIGカードで決める。

| Mock | Visual policy | Scope |
| --- | --- | --- |
| `PublicHeader` | PUBLIC_MOCK | 公開surfaceのみ |
| `PublicFooter` | PUBLIC_MOCK | 公開surfaceのみ |
| `AdminNav` | CURRENT_UI_REUSE | 非公開CURRENT部品を維持。mockは参考資料 |
| `ManageNav` | CURRENT_UI_REUSE | 非公開CURRENT部品を維持。mockは参考資料 |
| `ManageEventHead` | CURRENT_UI_REUSE | 非公開CURRENT部品を維持。mockは参考資料 |
| `ConfirmModal` | CURRENT_UI_REUSE | 非公開CURRENT部品を維持。mockは参考資料 |
| `MemberEditor` | CURRENT_UI_REUSE | 非公開CURRENT部品を維持。mockは参考資料 |
| `EntrySubmitter` | CURRENT_UI_REUSE | 非公開CURRENT部品を維持。mockは参考資料 |
| `IconPicker` | CURRENT_UI_REUSE | 非公開CURRENT部品を維持。mockは参考資料 |
| `EntryQuestions` | CURRENT_UI_REUSE | 非公開CURRENT部品を維持。mockは参考資料 |
| `LinkEditor` | CURRENT_UI_REUSE | 非公開CURRENT部品を維持。mockは参考資料 |
| `CommandPalette` | CURRENT_UI_REUSE | 非公開CURRENT部品を維持。mockは参考資料 |

---

## Authority boundary（権限境界・不変条件）

公開surfaceでモックが正本となる範囲（privateはCURRENT UI）:
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

各画面の実装完了判定は、該当routeのvisual policyとcanonical契約を満たすこと。PUBLIC_MOCKは登録mockを検証し、CURRENT_UI_REUSEはCURRENT UIの外見・操作を維持する。redirect/system/devは分類に対応した契約を検証する。

```text
visual policy verified（公開mock適用 / 非公開CURRENT UI維持 / redirect・system・dev契約）
+ required UX IDs mapped（担当UX機能がすべて実装されている）
+ CURRENT behavior parity verified（現行機能との動作同等性を検証済み）
+ permissions verified（サーバーサイドでの権限検証）
+ loading/error/empty/pending/degraded states verified（全状態の表示確認）
+ responsive/accessibility verified（スマホ〜PC表示、キーボード操作、フォーカス）
+ URL/history behavior verified（ブラウザ戻る/進む、ディープリンク、クエリパラメータ保持）
+ backend side effects verified where applicable（副作用・監査ログの検証）
```
