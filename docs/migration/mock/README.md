# FlameNode デザイン一式(コーディングエージェント向け)

FlameNode のデザインキャンバスで確定した全画面を、実装に渡せる形でまとめたものです。
書き出し元: claude.ai の Design アーティファクト(version 1791816999-f0e9、2026-10-12 時点の公開版)。

## フォルダ構成

| パス | 中身 | 使い道 |
|---|---|---|
| `pages.json` | 全ページの一覧(名前・タイトル・ルート・区分・ソース・取り込み部品・リンク先・各ファイルのパス) | エージェントが最初に読む索引 |
| `static/*.html` | 各ページの初期状態を書き出した静的 HTML(JS なし、実際のクラス名と DOM 構造そのまま) | マークアップ・クラス構成の参照用 |
| `site/` | 実際に動く HTML 一式。`site/index.html` から全ページへ移動できる(タブ切替・入力・メニュー開閉など動作) | 挙動・状態遷移の確認用 |
| `screenshots/*.desktop.jpg` / `*.mobile.jpg` | 各ページの PC(1440px)・スマホ(390px)の全体スクリーンショット | 見た目の正解として比較する |
| `source/boards/*.dc.html` | デザインキャンバスの元データ(テンプレート+サンプルデータ+状態ロジック) | 状態の種類や条件分岐を読む |
| `source/fn.css` | 全ページ共通のスタイル(レスポンシブ規則を含む) | スタイル移植の基準 |
| `source/design-system/tokens.json` | 色・文字・余白・影のトークン | Tailwind / CSS 変数への変換元 |
| `source/design-system/components.js/.css` | 共通 React 部品(Button, TextField, Checkbox, Tabs, Status, ProgressBar, Row, VideoCard, Modal) | 部品 API の参照 |
| `source/canvas.json` | キャンバス上の配置とページ区分 | 区分・並び順の参照 |

`static/` と `screenshots/` はサンプルデータの初期状態です。別の状態(タブ・モーダル・エラー表示など)は `site/` で操作するか、`source/boards/` の `renderVals()` と `state` を読んでください。

## 元データ(.dc.html)の読み方

- `{{name}}` … `renderVals()` が返す値の差し込み。
- `<sc-if value="{{x}}">` … 条件表示。`<sc-for list="{{xs}}" as="x">` … 繰り返し。
- `<dc-import name="Board">` … 別ボードの埋め込み(ヘッダー、ナビ、タブの中身など)。属性は props として渡る。
- `<x-import component-from-global-scope="FlameNode.X">` … 共通 React 部品(`source/design-system/components.js`)。
- `<script type="text/x-dc">` 内の `class Component extends DCLogic` … `this.state` / `this.setState()` / `this.props` で状態を持つ。データはすべてサンプル。
- `embed` プロパティを持つボード(マイページのタブなど)は、`embed: true` で埋め込み表示、`false` で単体ページ表示。

## デザインの決まりごと(レビューで確定した内容)

トークン(`tokens.json`)を基本とし、レビューで以下を上書き・追加しています。トークンと食い違う場合はこちらを優先してください。

- **配色**: ダークが既定(背景 純黒、文字 純白)。Accent はライム `#d6ec8a` を Primary ボタンの塗りにだけ使う。
- **角丸**: 面・ボタン・入力欄・サムネイルは角丸なし(0)。ただし**アイコンは全て丸**(アバター、アイコンタイル、イベントアイコン、丸ボタン `.ib`)。tokens.json の「円を使わない」はこの点で上書き。
- **カード**: 公開ページはカード表現を使わない(余計な見出し・サブタイトルも付けない)。ユーザーページの「次にやること」など、明示的にカード指定した箇所だけ背景付きのカード。
- **文字**: 太字は display / h1 / h2 だけ。スマホ(≤640px)は全体的に一段小さい(h1 22px、本文 14px、補助 12px)。数字を見せる箇所は数字だけ大きく(例: 締切「あと **3** 日」、作品数)。
- **締切表示**: 「提出締切 日時」+「あと N 日(数字だけ大きく)」の形をトップ・イベント・上映枠・参加投稿・ダッシュボードで共通に使う。
- **枠あり／枠なし**: ユーザーに選ばせない。イベントを選ぶと、枠が必要なイベントは枠選びへ、不要なら提出画面へ自動で進む。
- **スマホのヘッダー**: 画面上部に固定。並びは「ロゴ・検索・アバター・≡」。アバターと ≡ はどちらも同じ統合メニューを開く(アカウント・活動名義の切替・ナビ・ライブラリ/設定/運営/管理・テーマ切替・ログアウト)。下部タブバーは廃止。
- **スマホのフッター**: リンクは 12px・薄いグレー。
- **スクロールバー**: 画面内のスクロール領域では非表示(スクロール自体は可能)。
- **1行省略**: `.ell` はサイト全体で1行省略。
- **作品詳細(スマホ)**: 参加メンバーはチャプターのシート内に統合。下部ドックは「再生リスト / チャプター・コメント」。
- **運営・審査の詳細パネル**: 固定表示にせず、通常のスクロールに組み込む(スマホでは一覧の上)。

## レスポンシブの区切り

| 幅 | 主な変化 |
|---|---|
| ≤ 1023px | ヘッダーの検索欄を縮小、管理系は一部1カラム化 |
| ≤ 1007px | トップのヒーローが画像の下に文字を回し、文字ブロック(360px)を中央寄せ |
| ≤ 900px | 作品詳細が1カラム+下部ドック、運営の2カラム(一覧+詳細)が1カラム |
| ≤ 700px / ≤ 640px | スマホ表示(上記のヘッダー・文字サイズ・フッター等) |

全ページ、280〜1280px で横はみ出しがないことを確認済みです。

## 実装リポジトリとの対応メモ

一部の画面は、既存実装(flamenode リポジトリの `src/`)の部品の挙動に合わせています。

- 作品アイコンの選択: `src/components/forms/VideoIconPicker.tsx`(候補グリッド、指定しない、URL 直接入力)
- YouTube チャンネル選択: `src/components/settings/YoutubeChannelPicker.tsx`(候補から選ぶ / URL を入力)
- 合作メンバー・チャプター: `src/components/video/MemberSection.tsx` ほか。デザイン側には「サジェスト(承認・却下)」と「行クリックで個別編集」を追加している(実装側には未存在)。
- 枠表: 部の間に休憩行を入れる構成は `SlotGrid.tsx` と同じ。
- 作品詳細(スマホ)の下部ドック: `VideoUtilityDock.tsx` と同じ構成。

## 注意

- 表示データはすべてサンプルです。
- `site/` と `static/` は、デザインキャンバス本体ではなく互換の描画処理で書き出しています。細部の描画差がありえるので、迷ったら `screenshots/` と `source/` を正としてください。
- 日本語フォント LINE Seed JP は Google Fonts から読み込みます(オフラインでは代替フォント)。それ以外のフォント・アイコン・画像は同梱しています。

## ページ一覧

### 公開(15)

| ページ | ルート | ソース | 静的HTML |
|---|---|---|---|
| トップ | `/` | `source/boards/Main.dc.html` | `static/Main.html` |
| 作品詳細 | `/[id]` | `source/boards/VideoDetail.dc.html` | `static/VideoDetail.html` |
| FlameNodeについて | `/about` | `source/boards/About.dc.html` | `static/About.html` |
| イベント一覧 | `/event` | `source/boards/Events.dc.html` | `static/Events.html` |
| イベント詳細 | `/event/[id]` | `source/boards/EventDetail.dc.html` | `static/EventDetail.html` |
| 上映枠 | `/event/[id]/slots` | `source/boards/EventSlots.dc.html` | `static/EventSlots.html` |
| 投稿予定 | `/event/[id]/release` | `source/boards/EventRelease.dc.html` | `static/EventRelease.html` |
| 作品一覧 | `/list` | `source/boards/Videos.dc.html` | `static/Videos.html` |
| おすすめ | `/recommend` | `source/boards/Recommend.dc.html` | `static/Recommend.html` |
| 急上昇 | `/trending` | `source/boards/Trending.dc.html` | `static/Trending.html` |
| クリエイター一覧 | `/user` | `source/boards/Creators.dc.html` | `static/Creators.html` |
| クリエイター | `/user/[id]` | `source/boards/Creator.dc.html` | `static/Creator.html` |
| ポートフォリオ | `/user/[id]/portfolio` | `source/boards/Portfolio.dc.html` | `static/Portfolio.html` |
| 利用規約 | `/rules` | `source/boards/Rules.dc.html` | `static/Rules.html` |
| メンテナンス | `/maintenance` | `source/boards/Maintenance.dc.html` | `static/Maintenance.html` |

### ユーザー(8)

| ページ | ルート | ソース | 静的HTML |
|---|---|---|---|
| マイページ | `/dashboard ほか(ダッシュボード・投稿・ライブラリ・設定)` | `source/boards/MyPage.dc.html` | `static/MyPage.html` |
| 作品編集 | `/dashboard/edit/[id]` | `source/boards/VideoEdit.dc.html` | `static/VideoEdit.html` |
| 編集権限 | `/dashboard/edit/[id]/permissions` | `source/boards/VideoPermissions.dc.html` | `static/VideoPermissions.html` |
| ログイン前 | `/entry` | `source/boards/EntrySignIn.dc.html` | `static/EntrySignIn.html` |
| 枠に提出 | `/entry/slotted` | `source/boards/EntrySlotted.dc.html` | `static/EntrySlotted.html` |
| 枠なし投稿 | `/entry/unslotted` | `source/boards/EntryUnslotted.dc.html` | `static/EntryUnslotted.html` |
| 初期設定 1/2 | `/onboarding` | `source/boards/OnboardingTerms.dc.html` | `static/OnboardingTerms.html` |
| 初期設定 2/2 | `/onboarding` | `source/boards/OnboardingXId.dc.html` | `static/OnboardingXId.html` |

### 運営(14)

| ページ | ルート | ソース | 静的HTML |
|---|---|---|---|
| 運営トップ | `/manage` | `source/boards/Manage.dc.html` | `static/Manage.html` |
| イベント概要 | `/manage/events/[id]` | `source/boards/ManageEvent.dc.html` | `static/ManageEvent.html` |
| 作品・審査 | `/manage/events/[id]/videos` | `source/boards/ManageVideos.dc.html` | `static/ManageVideos.html` |
| 作品 | `/manage/events/[id]/videos/[videoId]` | `source/boards/ManageVideo.dc.html` | `static/ManageVideo.html` |
| 受信箱 | `/manage/events/[id]/inbox` | `source/boards/ManageInbox.dc.html` | `static/ManageInbox.html` |
| イベントを作成 | `/manage/events/new` | `source/boards/ManageEventNew.dc.html` | `static/ManageEventNew.html` |
| 枠管理 | `/manage/events/[id]/slots` | `source/boards/ManageSlots.dc.html` | `static/ManageSlots.html` |
| 参加者 | `/manage/events/[id]/audience` | `source/boards/ManageAudience.dc.html` | `static/ManageAudience.html` |
| イベント設定 | `/manage/events/[id]/edit` | `source/boards/ManageEdit.dc.html` | `static/ManageEdit.html` |
| スタッフと権限 | `/manage/events/[id]/staff` | `source/boards/ManageStaff.dc.html` | `static/ManageStaff.html` |
| 履歴 | `/manage/events/[id]/history` | `source/boards/ManageHistory.dc.html` | `static/ManageHistory.html` |
| 配信・公開 | `/manage/events/[id]/youtube-playlist ほか` | `source/boards/ManagePlaylist.dc.html` | `static/ManagePlaylist.html` |
| 通知センター | `/manage/notifications` | `source/boards/ManageNotifications.dc.html` | `static/ManageNotifications.html` |
| X ID申請 | `/manage/x-link-requests` | `source/boards/ManageXLink.dc.html` | `static/ManageXLink.html` |

### 管理(24)

| ページ | ルート | ソース | 静的HTML |
|---|---|---|---|
| 管理ダッシュボード | `/admin` | `source/boards/Admin.dc.html` | `static/Admin.html` |
| 作品管理 | `/admin/videos(一覧・同期・再生リスト)` | `source/boards/AdminVideosHub.dc.html` | `static/AdminVideosHub.html` |
| 作品詳細(管理) | `/admin/videos/[id]` (管理・メンバー) | `source/boards/AdminVideoHub.dc.html` | `static/AdminVideoHub.html` |
| ユーザー | `/admin/users(ユーザー・X ID申請・統合)` | `source/boards/AdminUsersHub.dc.html` | `static/AdminUsersHub.html` |
| ユーザー詳細 | `/admin/users/[id]` (詳細・設定編集) | `source/boards/AdminUserHub.dc.html` | `static/AdminUserHub.html` |
| モデレーション | `/admin/moderation` | `source/boards/AdminModeration.dc.html` | `static/AdminModeration.html` |
| イベント | `/admin/events(一覧・グループ・テンプレート)` | `source/boards/AdminEventsHub.dc.html` | `static/AdminEventsHub.html` |
| グループ作成・編集 | `/admin/event-groups/new · [id]/edit` | `source/boards/AdminEventGroupEdit.dc.html` | `static/AdminEventGroupEdit.html` |
| お知らせ | `/admin/announcements` | `source/boards/AdminAnnouncements.dc.html` | `static/AdminAnnouncements.html` |
| お知らせ作成・編集 | `/admin/announcements/new · [id]/edit` | `source/boards/AdminAnnouncementEdit.dc.html` | `static/AdminAnnouncementEdit.html` |
| 規約管理 | `/admin/rules` | `source/boards/AdminRules.dc.html` | `static/AdminRules.html` |
| 規約作成・編集 | `/admin/rules/new · [id]/edit` | `source/boards/AdminRuleEdit.dc.html` | `static/AdminRuleEdit.html` |
| YouTube quota | `/admin/youtube-quota` | `source/boards/AdminYoutubeQuota.dc.html` | `static/AdminYoutubeQuota.html` |
| 通知配信 | `/admin/notifications` | `source/boards/AdminNotifications.dc.html` | `static/AdminNotifications.html` |
| 監査ログ | `/admin/audit(ログ・設定・復元)` | `source/boards/AdminAuditHub.dc.html` | `static/AdminAuditHub.html` |
| 監査ログ詳細 | `/admin/audit/[id]` | `source/boards/AdminAuditDetail.dc.html` | `static/AdminAuditDetail.html` |
| コストガード | `/admin/cost-guard` | `source/boards/AdminCostGuard.dc.html` | `static/AdminCostGuard.html` |
| 静的JSON再生成 | `/admin/static-builds` | `source/boards/AdminStaticBuilds.dc.html` | `static/AdminStaticBuilds.html` |
| 稼働状況 | `/admin/health(ヘルス・DB整合性・Worker)` | `source/boards/AdminHealthHub.dc.html` | `static/AdminHealthHub.html` |
| セキュリティ | `/admin/security` | `source/boards/AdminSecurity.dc.html` | `static/AdminSecurity.html` |
| 権限シミュレーター | `/admin/permissions/simulator` | `source/boards/AdminPermSim.dc.html` | `static/AdminPermSim.html` |
| 公開API管理 | `/admin/api-endpoints` | `source/boards/AdminApi.dc.html` | `static/AdminApi.html` |
| 旧形式インポート | `/admin/import` | `source/boards/AdminImport.dc.html` | `static/AdminImport.html` |
| DBスプレッドシート | `/admin/spreadsheet` | `source/boards/AdminSpreadsheet.dc.html` | `static/AdminSpreadsheet.html` |

### タブの中身(23)

| ページ | ルート | ソース | 静的HTML |
|---|---|---|---|
| [監査ログ のタブ] 監査ログ | `/admin/audit` | `source/boards/AdminAudit.dc.html` | `static/AdminAudit.html` |
| [監査ログ のタブ] ログ設定 | `/admin/audit/settings` | `source/boards/AdminAuditSettings.dc.html` | `static/AdminAuditSettings.html` |
| [監査ログ のタブ] 復元履歴 | `/admin/audit/restore` | `source/boards/AdminAuditRestore.dc.html` | `static/AdminAuditRestore.html` |
| [イベント のタブ] イベント管理 | `/admin/events` | `source/boards/AdminEvents.dc.html` | `static/AdminEvents.html` |
| [イベント のタブ] イベントグループ | `/admin/event-groups` | `source/boards/AdminEventGroups.dc.html` | `static/AdminEventGroups.html` |
| [イベント のタブ] テンプレート | `/admin/events/templates` | `source/boards/AdminEventTemplates.dc.html` | `static/AdminEventTemplates.html` |
| [稼働状況 のタブ] ヘルスチェック | `/admin/health` | `source/boards/AdminHealth.dc.html` | `static/AdminHealth.html` |
| [稼働状況 のタブ] DB整合性 | `/admin/health/integrity` | `source/boards/AdminIntegrity.dc.html` | `static/AdminIntegrity.html` |
| [稼働状況 のタブ] Worker監視 | `/admin/workers` | `source/boards/AdminWorkers.dc.html` | `static/AdminWorkers.html` |
| [作品管理 のタブ] 作品管理 | `/admin/videos` | `source/boards/AdminVideos.dc.html` | `static/AdminVideos.html` |
| [作品管理 のタブ] YouTube同期 | `/admin/youtube-sync` | `source/boards/AdminYoutubeSync.dc.html` | `static/AdminYoutubeSync.html` |
| [作品管理 のタブ] 再生リスト同期 | `/admin/youtube-sync/playlists` | `source/boards/AdminPlaylists.dc.html` | `static/AdminPlaylists.html` |
| [ユーザー のタブ] ユーザー / X ID | `/admin/users` | `source/boards/AdminUsers.dc.html` | `static/AdminUsers.html` |
| [ユーザー のタブ] X ID申請 | `/admin/x-link-requests` | `source/boards/AdminXLink.dc.html` | `static/AdminXLink.html` |
| [ユーザー のタブ] X ID統合 | `/admin/x-id-merges` | `source/boards/AdminXIdMerges.dc.html` | `static/AdminXIdMerges.html` |
| [ユーザー詳細 のタブ] ユーザー詳細 | `/admin/users/[id]` | `source/boards/AdminUser.dc.html` | `static/AdminUser.html` |
| [ユーザー詳細 のタブ] ユーザー編集 | `/admin/users/[id]/edit` | `source/boards/AdminUserEdit.dc.html` | `static/AdminUserEdit.html` |
| [作品詳細(管理) のタブ] 作品詳細 | `/admin/videos/[id]` | `source/boards/AdminVideo.dc.html` | `static/AdminVideo.html` |
| [作品詳細(管理) のタブ] 参加者設定 | `/admin/videos/[id]/members` | `source/boards/AdminVideoMembers.dc.html` | `static/AdminVideoMembers.html` |
| [マイページ のタブ] ダッシュボード | `/dashboard` | `source/boards/Dashboard.dc.html` | `static/Dashboard.html` |
| [マイページ のタブ] 参加・投稿 | `/entry` | `source/boards/Entry.dc.html` | `static/Entry.html` |
| [マイページ のタブ] ライブラリ | `/dashboard/library` | `source/boards/Library.dc.html` | `static/Library.html` |
| [マイページ のタブ] 設定 | `/dashboard/settings` | `source/boards/Settings.dc.html` | `static/Settings.html` |

### 共通パーツ(12)

| ページ | ルート | ソース | 静的HTML |
|---|---|---|---|
| 公開ヘッダー | `—` | `source/boards/PublicHeader.dc.html` | —(部品) |
| 公開フッター | `—` | `source/boards/PublicFooter.dc.html` | —(部品) |
| 管理サイドバー | `—` | `source/boards/AdminNav.dc.html` | —(部品) |
| 運営サイドバー | `—` | `source/boards/ManageNav.dc.html` | —(部品) |
| イベント運営ヘッダー | `—` | `source/boards/ManageEventHead.dc.html` | —(部品) |
| 確認ダイアログ | `—` | `source/boards/ConfirmModal.dc.html` | —(部品) |
| 合作メンバー編集(タイムライン/表/一括) | `—` | `source/boards/MemberEditor.dc.html` | —(部品) |
| 提出者情報(枠に提出・作品を投稿 共通) | `—` | `source/boards/EntrySubmitter.dc.html` | —(部品) |
| アイコン選択(候補/切り抜き) | `—` | `source/boards/IconPicker.dc.html` | —(部品) |
| 運営からの質問(質問種別ごとの入力) | `—` | `source/boards/EntryQuestions.dc.html` | —(部品) |
| リンク編集(URL貼り付けで種類判定) | `—` | `source/boards/LinkEditor.dc.html` | —(部品) |
| コマンドパレット(⌘K) | `—` | `source/boards/CommandPalette.dc.html` | —(部品) |
