# FlameNode デザイン一式(コーディングエージェント向け)

FlameNode のデザインキャンバスで確定した全画面を、実装に渡せる形でまとめたものです。
書き出し元: claude.ai の Design アーティファクト(version 1792048584-12ca、2026-10-15 時点の公開版)。

## フォルダ構成

| パス | 中身 | 使い道 |
|---|---|---|
| `pages.json` | 全ページの一覧(名前・タイトル・ルート・区分・ソース・取り込み部品・リンク・各ファイルのパス) | エージェントが最初に読む索引 |
| `links.tsv` | ページ間リンクの全件(リンク元・ラベル・リンク先) | 遷移設計の一覧。実装後の導線テストにも使う |
| `static/*.html` | 各ページの初期状態を書き出した静的 HTML(JS なし、実際のクラス名と DOM 構造そのまま) | マークアップ・クラス構成の参照用 |
| `site/` | 実際に動く HTML 一式。`site/index.html` から全ページへ移動でき、ページ内のリンクもすべて実際のページにつながる(タブ切替・入力・メニュー開閉・確認ダイアログ・⌘K なども動作) | 挙動・状態遷移の確認用 |
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
- **テーマ**: ダーク/ライトの両方に全ページ対応。各ボードの `theme` プロパティ(`dark` / `light`)で切り替え、`<dc-import>` で埋め込んだ部品(ヘッダー・ナビ・タブの中身)にも同じ値を渡す。色は `fn.css` 冒頭のトークン(`--bg` `--ink` `--ink-muted` `--surface-*` `--brand-text` など)だけで指定し、固定色は画像・動画上の重ね(オーバーレイ)と色見本に限る。ページ外側の背景と `color-scheme`(スクロールバー・select など)もテーマに追従する。
- **角丸**: 面・ボタン・入力欄・サムネイルは角丸なし(0)。ただし**アイコンは全て丸**(アバター、アイコンタイル、イベントアイコン、丸ボタン `.ib`)。tokens.json の「円を使わない」はこの点で上書き。
- **カード**: 公開ページはカード表現を使わない(余計な見出し・サブタイトルも付けない)。ユーザーページの「次にやること」など、明示的にカード指定した箇所だけ背景付きのカード。
- **文字**: 太字は display / h1 / h2 だけ。見出しは画面幅に応じて連続的に変わる(display 24〜40px、h1 22〜32px、`clamp()`)。本文・補助はスマホ(≤640px)で一段小さい(本文 14px、補助 12px)。**12px 未満の文字は使わない**。説明文(`p.muted` など)は1行45字以内(`max-width: 45em`)。数字を見せる箇所は数字だけ大きく(例: 締切「あと **3** 日」、作品数)。
- **締切表示**: 「提出締切 日時」+「あと N 日(数字だけ大きく)」の形をトップ・イベント・上映枠・参加投稿・ダッシュボードで共通に使う。ただしトップのヒーローはスマホ幅(≤640px)で「あと N 日」を出さず締切日時だけ。トップのヒーローの文字欄が 520px 以上あるとき(画面幅およそ 560〜1007px)は「募集締切〜枠を確保」を右の2列目に置き、右揃え・下揃えにする。
- **枠あり／枠なし**: ユーザーに選ばせない。イベントを選ぶと、枠が必要なイベントは枠選びへ、不要なら提出画面へ自動で進む。
- **スマホのヘッダー**: 画面上部に固定。並びは「ロゴ・検索・アバター・≡」。アバターと ≡ はどちらも同じ統合メニューを開く。下部タブバーは廃止。641〜860px はナビと検索欄が並ばないため、検索をアイコンにして押すとヘッダー全体に検索欄を開く。
- **スマホの統合メニュー**: 使う頻度で強弱をつけた4段構成。①見る(作品/クリエイター/イベント)= 24px・行高 60px の大きな行 ②主操作 = Primary の全幅ボタン1つ(ログイン時「作品を投稿する」、未ログイン時「Discord でログイン」+説明1行)③自分 = 名前とアイコン(マイページへ)、ライブラリ/設定/運営/管理の4列タイル(運営は審査待ち件数を角の数字で表示)、活動名義(X ID)の切替と追加 ④設定系 = テーマ切替とログアウトを小さく下に。
- **スマホのフッター**: リンクは 12px・薄いグレー。
- **スクロールバー**: 画面内のスクロール領域では非表示(スクロール自体は可能)。
- **1行省略**: `.ell` はサイト全体で1行省略。
- **作品詳細(スマホ)**: 参加メンバーはチャプターのシート内に統合。下部ドックは「再生リスト / チャプター・コメント」。
- **ユーザーページ**: 状況(次にやること・締切)を先頭に、操作は1タップで届く位置へ。スマホではタブ4等分、行は情報を詰め(状態はアイコンのみ)、保存/次へは下に固定。
- **ウルトラワイド**: 本文は最大幅で止め、ヘッダー・フッター・棚の端を本文にそろえる。作品詳細は高さからプレーヤー幅を決める。
- **運営・審査の詳細パネル**: 固定表示にせず、通常のスクロールに組み込む(スマホでは一覧の上)。
- **アクセシビリティの下限**: キーボード操作時は 2px のフォーカス枠(`--focus-ring`。入力欄は枠の代わりに下線 2px)。文字のコントラストは 4.5:1 以上(大きい文字は 3:1)をダーク・ライト両方で全ページ確認済み。押せる範囲は見た目を変えずに `::before` で広げる(アイコンボタン +4px 四方、スマホ・タッチ端末の小ボタンは 44px 相当、テキストリンク・チップの×・色見本は上下 6〜8px)。`prefers-reduced-motion` ではアニメーションを止める。共通部品の `ariaLabel` などの props は `aria-label` に変換して渡す(`components.js` の `omit()`)。ラベルのない TextField は placeholder を読み上げ名に使う。

## レスポンシブの区切り

| 幅 | 主な変化 |
|---|---|
| ≤ 340 / 360px | 極小幅の詰め(ボタン・ヘッダーの余白) |
| ≤ 420px | 数値4つの並び(累計いいね等)を 2×2 にする |
| ≤ 640px | スマホ表示(固定ヘッダー+統合メニュー、文字一段小さく、フッター 12px)。マイページのタブは4等分(アイコン上・文字下)、行のサムネ 112px・タイトル2行・状態はアイコンのみ、保存/次へは画面下に固定(`.act-bar`) |
| 641–900px | 作品詳細はヘッダー固定+プレーヤー固定(既存実装と同じ) |
| ≤ 900px | 作品詳細が1カラム(プレーヤーを上部に固定し、下に情報・下部ドック)。運営の2カラム(一覧+詳細)が1カラム |
| ≤ 1007 / 1023px | トップのヒーローが画像の下に文字(左右の余白は本文と同じ 40px / スマホ 16px)、文字欄が 520px 以上なら締切〜操作を2列目へ(コンテナクエリ)。ヘッダー検索欄を縮小、管理系の一部1カラム |
| 641–860px | 公開ヘッダーの検索欄をアイコン化(押すと全幅の検索欄) |
| ≥ 901 / ≥ 1280px | 作品詳細が2カラム(プレーヤー+関連)。高さに応じてプレーヤー列の幅を制限 |
| ≥ 1440px | ヘッダー・フッターの左右を本文の端(`--edge`)にそろえる |
| ≥ 1600 / 1920 / 2560px | 本文の最大幅を 1360 → 1600 → 1840px に段階拡大。ヒーロー高さに上限 |
| 横長(21:9 以上・32:9) | 作品詳細を中央寄せし、両端に余白。棚(横スクロール列)は画面端まで流す |

一覧のグリッドは列の最小幅を画面幅で変える(作品 `clamp(200px,22vw,260px)`、イベント `clamp(280px,30vw,340px)`)。中間幅(700〜1000px)でも1列に落ちず、1440px での列数は変わらない。

確認範囲: 全ページを 280〜1600px は 10〜20px 刻み、それ以上は 2560px まで確認し、ページ全体の横はみ出し・文字の切れ/はみ出し・要素の重なりは 0(以前の確認では 5120px まで横はみ出しなし)。

## ページ間リンクの設計

全リンクは `links.tsv`(と `pages.json` の各ページの `links`)に一覧化しています。`site/` では全件が実在のページにつながることを機械的に確認済み(リンク切れ 0)。

### 1. ルール

| 種類 | 書き方 | 例 |
|---|---|---|
| ページ移動 | `Page.html` | 作品カード → `VideoDetail.html`、作者名 → `Creator.html` |
| タブを持つページの特定タブ | `Hub.html?tab=タブ名` | 「設定」→ `MyPage.html?tab=Settings`、「X ID連携申請」→ `AdminUsersHub.html?tab=AdminXLink` |
| 重ねて開くもの(ページ移動しない) | 確認ダイアログ・コマンドパレット | 「削除」→ 確認ダイアログ、検索欄/⌘K → コマンドパレット |
| ページ内の切替 | `#` / `#section` | 一覧の絞り込みチップ、入力画面の目次、状態カード |

- タブは URL に必ず出す。タブを切り替えると `?tab=` が書き換わり(履歴は増やさない)、そのURLを開くと同じタブが開く。共有・再読込・戻るで状態が失われないため。
- タブの中身だけのボード(`Settings`, `AdminXLink` など)へのリンクは、単体ページではなく**親ページ+`?tab=`** に向ける。単体ページは `site/` の「タブの中身」区分に確認用として残しているだけ。
- 確認ダイアログとコマンドパレットは URL を変えずに重ねて表示。Esc / 背景クリック / ボタンで閉じる。パレット内のリンクは元のページを移動する。

### 2. タブの対応表

| 親ページ | `?tab=` |
|---|---|
| `MyPage`(マイページ) | `Dashboard`(既定) / `Entry`(参加・投稿) / `Library` / `Settings` |
| `AdminUsersHub` | `AdminUsers`(既定) / `AdminXLink` / `AdminXIdMerges` |
| `AdminUserHub` | `AdminUser`(既定) / `AdminUserEdit` |
| `AdminVideosHub` | `AdminVideos`(既定) / `AdminYoutubeSync` / `AdminPlaylists` |
| `AdminVideoHub` | `AdminVideo`(既定) / `AdminVideoMembers` |
| `AdminEventsHub` | `AdminEvents`(既定) / `AdminEventGroups` / `AdminEventTemplates` |
| `AdminHealthHub` | `AdminHealth`(既定) / `AdminIntegrity` / `AdminWorkers` |
| `AdminAuditHub` | `AdminAudit`(既定) / `AdminAuditSettings` / `AdminAuditRestore` |

ラベルからタブを決める規則(例: 「参加・投稿」「作品を提出」→ `Entry`、「ライブラリ」「すべて見る」→ `Library`、「設定」「X ID」→ `Settings`)は書き出し処理で適用済みで、結果は `links.tsv` に反映されています。

### 3. 主な導線

- 見る: トップ → 作品一覧/トレンド/おすすめ/イベント → 作品詳細 → 作者(クリエイター)・イベント・関連作品
- 参加する: イベント詳細「枠を確保」→ 上映枠 →「作品登録」→ 提出画面 → マイページ「参加・投稿」タブ。枠のないイベントは「作品を提出」から直接提出画面へ。イベント外の投稿はマイページ「参加・投稿」の「イベントに関係なく投稿する」から
- 自分の作品: マイページ → 作品の編集 → 公開ページ(作品詳細)/削除は確認ダイアログ
- 運営: ヘッダーメニュー「運営」→ 運営トップ → イベント概要/枠/応募の審査/スタッフ/お知らせ
- 管理: ヘッダーメニュー「管理」→ 管理トップ → 各区分(ユーザー・作品・イベント・稼働・監査)の親ページ → 詳細 → 監査ログ

### 4. 意図的にページ移動にしていないもの(`#`)

一覧の絞り込み(状態チップ)、入力画面の目次(`ManageEventNew` の `#s-*`)、運営の作品/設定画面のセクション切替、Worker 状態カード、イベント一覧の「すべて表示」(その場で展開)、外部 API の「開く」(実装時は実 API の URL)。実装では、絞り込みは `?status=` などのクエリにすることを推奨します。

### 5. デザインキャンバスとの差

キャンバスの元データ(`source/boards`)ではリンク先を `Page.dc.html` で書いています。`?tab=` やダイアログの重ね表示は書き出し側で付け足したもので、元データのリンク先はタブを指定しない形のままです。実装では上の表を正としてください。

## 実装リポジトリとの対応メモ

一部の画面は、既存実装(flamenode リポジトリの `src/`)の部品の挙動に合わせています。

- 作品アイコンの選択: `src/components/forms/VideoIconPicker.tsx`(候補グリッド、指定しない、URL 直接入力)
- YouTube チャンネル選択: `src/components/settings/YoutubeChannelPicker.tsx`(候補から選ぶ / URL を入力)
- 合作メンバー・チャプター: `src/components/video/MemberSection.tsx` ほか。デザイン側には「サジェスト(承認・却下)」と「行クリックで個別編集」を追加している(実装側には未存在)。
- 枠表: 部の間に休憩行を入れる構成は `SlotGrid.tsx` と同じ。
- 作品詳細(スマホ)の下部ドック: `VideoUtilityDock.tsx` と同じ構成。
- 作品詳細のレスポンシブ(プレーヤー固定・列幅の制限・2カラム化の区切り): 既存実装の作品詳細ページの挙動に合わせている。

## 注意

- 表示データはすべてサンプルです。
- `site/` と `static/` は、デザインキャンバス本体ではなく互換の描画処理で書き出しています。細部の描画差がありえるので、迷ったら `screenshots/` と `source/` を正としてください。
- 日本語フォント LINE Seed JP は Google Fonts から読み込みます(オフラインでは代替フォント)。それ以外のフォント・アイコン・画像は同梱しています。

## ページ一覧

### 公開(15)

| ページ | ルート | ファイル |
|---|---|---|
| トップ | `/` | `Main` |
| 作品詳細 | `/[id]` | `VideoDetail` |
| FlameNodeについて | `/about` | `About` |
| イベント一覧 | `/event` | `Events` |
| イベント詳細 | `/event/[id]` | `EventDetail` |
| 上映枠 | `/event/[id]/slots` | `EventSlots` |
| 投稿予定 | `/event/[id]/release` | `EventRelease` |
| 作品一覧 | `/list` | `Videos` |
| おすすめ | `/recommend` | `Recommend` |
| 急上昇 | `/trending` | `Trending` |
| クリエイター一覧 | `/user` | `Creators` |
| クリエイター | `/user/[id]` | `Creator` |
| ポートフォリオ | `/user/[id]/portfolio` | `Portfolio` |
| 利用規約 | `/rules` | `Rules` |
| メンテナンス | `/maintenance` | `Maintenance` |

### ユーザー(8)

| ページ | ルート | ファイル |
|---|---|---|
| マイページ | `/dashboard ほか(ダッシュボード・投稿・ライブラリ・設定)` | `MyPage` |
| 作品編集 | `/dashboard/edit/[id]` | `VideoEdit` |
| 編集権限 | `/dashboard/edit/[id]/permissions` | `VideoPermissions` |
| ログイン前 | `/entry` | `EntrySignIn` |
| 枠に提出 | `/entry/slotted` | `EntrySlotted` |
| 枠なし投稿 | `/entry/unslotted` | `EntryUnslotted` |
| 初期設定 1/2 | `/onboarding` | `OnboardingTerms` |
| 初期設定 2/2 | `/onboarding` | `OnboardingXId` |

### 運営(14)

| ページ | ルート | ファイル |
|---|---|---|
| 運営トップ | `/manage` | `Manage` |
| イベント概要 | `/manage/events/[id]` | `ManageEvent` |
| 作品・審査 | `/manage/events/[id]/videos` | `ManageVideos` |
| 作品 | `/manage/events/[id]/videos/[videoId]` | `ManageVideo` |
| 受信箱 | `/manage/events/[id]/inbox` | `ManageInbox` |
| イベントを作成 | `/manage/events/new` | `ManageEventNew` |
| 枠管理 | `/manage/events/[id]/slots` | `ManageSlots` |
| 参加者 | `/manage/events/[id]/audience` | `ManageAudience` |
| イベント設定 | `/manage/events/[id]/edit` | `ManageEdit` |
| スタッフと権限 | `/manage/events/[id]/staff` | `ManageStaff` |
| 履歴 | `/manage/events/[id]/history` | `ManageHistory` |
| 配信・公開 | `/manage/events/[id]/youtube-playlist ほか` | `ManagePlaylist` |
| 通知センター | `/manage/notifications` | `ManageNotifications` |
| X ID申請 | `/manage/x-link-requests` | `ManageXLink` |

### 管理(24)

| ページ | ルート | ファイル |
|---|---|---|
| 管理ダッシュボード | `/admin` | `Admin` |
| 作品管理 | `/admin/videos(一覧・同期・再生リスト)` | `AdminVideosHub` |
| 作品詳細(管理) | `/admin/videos/[id]` (管理・メンバー) | `AdminVideoHub` |
| ユーザー | `/admin/users(ユーザー・X ID申請・統合)` | `AdminUsersHub` |
| ユーザー詳細 | `/admin/users/[id]` (詳細・設定編集) | `AdminUserHub` |
| モデレーション | `/admin/moderation` | `AdminModeration` |
| イベント | `/admin/events(一覧・グループ・テンプレート)` | `AdminEventsHub` |
| グループ作成・編集 | `/admin/event-groups/new · [id]/edit` | `AdminEventGroupEdit` |
| お知らせ | `/admin/announcements` | `AdminAnnouncements` |
| お知らせ作成・編集 | `/admin/announcements/new · [id]/edit` | `AdminAnnouncementEdit` |
| 規約管理 | `/admin/rules` | `AdminRules` |
| 規約作成・編集 | `/admin/rules/new · [id]/edit` | `AdminRuleEdit` |
| YouTube quota | `/admin/youtube-quota` | `AdminYoutubeQuota` |
| 通知配信 | `/admin/notifications` | `AdminNotifications` |
| 監査ログ | `/admin/audit(ログ・設定・復元)` | `AdminAuditHub` |
| 監査ログ詳細 | `/admin/audit/[id]` | `AdminAuditDetail` |
| コストガード | `/admin/cost-guard` | `AdminCostGuard` |
| 静的JSON再生成 | `/admin/static-builds` | `AdminStaticBuilds` |
| 稼働状況 | `/admin/health(ヘルス・DB整合性・Worker)` | `AdminHealthHub` |
| セキュリティ | `/admin/security` | `AdminSecurity` |
| 権限シミュレーター | `/admin/permissions/simulator` | `AdminPermSim` |
| 公開API管理 | `/admin/api-endpoints` | `AdminApi` |
| 旧形式インポート | `/admin/import` | `AdminImport` |
| DBスプレッドシート | `/admin/spreadsheet` | `AdminSpreadsheet` |

### タブの中身(23)

| ページ | ルート | ファイル |
|---|---|---|
| [監査ログ のタブ] 監査ログ | `/admin/audit` | `AdminAudit` |
| [監査ログ のタブ] ログ設定 | `/admin/audit/settings` | `AdminAuditSettings` |
| [監査ログ のタブ] 復元履歴 | `/admin/audit/restore` | `AdminAuditRestore` |
| [イベント のタブ] イベント管理 | `/admin/events` | `AdminEvents` |
| [イベント のタブ] イベントグループ | `/admin/event-groups` | `AdminEventGroups` |
| [イベント のタブ] テンプレート | `/admin/events/templates` | `AdminEventTemplates` |
| [稼働状況 のタブ] ヘルスチェック | `/admin/health` | `AdminHealth` |
| [稼働状況 のタブ] DB整合性 | `/admin/health/integrity` | `AdminIntegrity` |
| [稼働状況 のタブ] Worker監視 | `/admin/workers` | `AdminWorkers` |
| [作品管理 のタブ] 作品管理 | `/admin/videos` | `AdminVideos` |
| [作品管理 のタブ] YouTube同期 | `/admin/youtube-sync` | `AdminYoutubeSync` |
| [作品管理 のタブ] 再生リスト同期 | `/admin/youtube-sync/playlists` | `AdminPlaylists` |
| [ユーザー のタブ] ユーザー / X ID | `/admin/users` | `AdminUsers` |
| [ユーザー のタブ] X ID申請 | `/admin/x-link-requests` | `AdminXLink` |
| [ユーザー のタブ] X ID統合 | `/admin/x-id-merges` | `AdminXIdMerges` |
| [ユーザー詳細 のタブ] ユーザー詳細 | `/admin/users/[id]` | `AdminUser` |
| [ユーザー詳細 のタブ] ユーザー編集 | `/admin/users/[id]/edit` | `AdminUserEdit` |
| [作品詳細(管理) のタブ] 作品詳細 | `/admin/videos/[id]` | `AdminVideo` |
| [作品詳細(管理) のタブ] 参加者設定 | `/admin/videos/[id]/members` | `AdminVideoMembers` |
| [マイページ のタブ] ダッシュボード | `/dashboard` | `Dashboard` |
| [マイページ のタブ] 参加・投稿 | `/entry` | `Entry` |
| [マイページ のタブ] ライブラリ | `/dashboard/library` | `Library` |
| [マイページ のタブ] 設定 | `/dashboard/settings` | `Settings` |

### 共通パーツ(12)

| ページ | ルート | ファイル |
|---|---|---|
| 公開ヘッダー | `-` | `PublicHeader` |
| 公開フッター | `-` | `PublicFooter` |
| 管理サイドバー | `-` | `AdminNav` |
| 運営サイドバー | `-` | `ManageNav` |
| イベント運営ヘッダー | `-` | `ManageEventHead` |
| 確認ダイアログ | `-` | `ConfirmModal` |
| 合作メンバー編集(タイムライン/表/一括) | `-` | `MemberEditor` |
| 提出者情報(枠に提出・作品を投稿 共通) | `-` | `EntrySubmitter` |
| アイコン選択(候補/切り抜き) | `-` | `IconPicker` |
| 運営からの質問(質問種別ごとの入力) | `-` | `EntryQuestions` |
| リンク編集(URL貼り付けで種類判定) | `-` | `LinkEditor` |
| コマンドパレット(⌘K) | `-` | `CommandPalette` |

