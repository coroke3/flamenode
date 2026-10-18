# 代表3画面 UX 分類台帳 (Representative Screens UX Ledger)

> Status: Active
> Last updated: 2026-10-18
> Owner task: MIG-0205
> Source of truth: UX ID は `docs/migration/frontend/PUBLIC.md`、見た目は登録済み mock `docs/migration/mock/static/{VideoDetail,EventDetail,Creator}.html` と `screenshots/`、入口は CURRENT `app/(public)/[id]/page.tsx`・`app/(public)/event/[id]/page.tsx`・`app/(public)/user/[id]/UserProfilePage.tsx`

## 概要

| 部品 | CURRENT route | mock |
| --- | --- | --- |
| `packages/ui/src/screens/VideoDetailView.tsx` | `/[id]` | `VideoDetail` |
| `packages/ui/src/screens/EventDetailView.tsx` | `/event/[id]` | `EventDetail` |
| `packages/ui/src/screens/CreatorView.tsx` | `/user/[id]` | `Creator` |

- 3部品は表示専用。可視性判定・データ取得・時刻計算はしない。呼び出し側（MIG-0403 / Phase 5 の Astro page）が gateway（MIG-0405）を通った公開データと、CURRENT がデータから決める href（公開プロフィールがある人だけ `/user/{id}` など）を渡す。公開されていない・存在しないときは `null` を渡し、部品は EmptyState だけを描く（T02）。
- mock のクラス構成（`vd-*` / `ed-*` / `pf-head` / `split` / `metrics` / `fn-row` / `fn-vc`）をそのまま使う。CSS は `packages/ui/src/styles/screens.css`（`fn.css` から該当クラスの規則だけを移植し、mock の style 属性をクラスに置き換えたもの）と `components.css`（mock `components.css` の Button / Status / Row / VideoCard / Progress と、mock に規則が無い Pagination / TableScroll / EmptyState の補完）。色・余白は `tokens.css` の変数だけ。
- 操作系は Island の差し込み口だけを置く（`player` / `interactions` / `members` / `chapters` props と `data-island` 属性）。既定の静的描画には何もしないボタンを置かない（unit test で `button` 0件を固定）。

## 状態の定義

- **保持**: 本部品の静的描画で CURRENT と同じ情報・入口を出す。
- **未対応**: 本部品では出さない。理由を書く。
- **次MIG**: 本部品の Island 差し込み口・呼び出し側で、記載の MIG が実装する。

## 1. 作品詳細 (`VideoDetailView` / `/[id]`)

| UX ID | 機能 | 本部品での扱い | 状態 | 次MIG |
| --- | --- | --- | --- | --- |
| UX-VID-001 | internal video ID の URL で開く | ルート解決は呼び出し側 | 次MIG | MIG-0403 / MIG-0507 |
| UX-VID-002 | YouTube video ID alias で開く | 同上（MIG-0404 route map） | 次MIG | MIG-0507 |
| UX-VID-003 | 可視性に応じた表示/非表示 | 非公開は呼び出し側が `null` を渡し EmptyState のみ（T02） | 次MIG | MIG-0405 |
| UX-VID-004 | YouTube player で再生 | `player` Island 口。既定はサムネイルの静止画 | 次MIG | MIG-0507 (`VideoPlayerIsland`) |
| UX-VID-005 | YouTube 未登録の fallback | `hasYoutube=false` で CURRENT 文言「YouTube動画は未登録ですが、作品情報を公開しています。」 | 保持 | — |
| UX-VID-006 | view 計測 | `player` Island に含める（CURRENT `VideoViewTracker`） | 次MIG | MIG-0507 |
| UX-VID-007 | title | `h1.vd-title` | 保持 | — |
| UX-VID-008 | creator identity/icon/X ID | アバター・表示名・`@id`・公開日 | 保持 | — |
| UX-VID-009 | FlameNode profile へ | `profileHref` があるときだけ名前と人アイコンをリンク | 保持 | — |
| UX-VID-010 | X profile を外部で開く | `https://x.com/{id}`（新規タブ・noopener） | 保持 | — |
| UX-VID-011 | YouTube channel を外部で開く | `youtubeChannelUrl` があるときだけ | 保持 | — |
| UX-VID-012 | music/credit | `music / credit`（CURRENT と同じ連結） | 保持 | — |
| UX-VID-013 | music reference URL | 楽曲リンク（外部） | 保持 | — |
| UX-VID-014 | intro comment | 作品情報の段落 | 保持 | — |
| UX-VID-015 | 使用 software | 作品情報の `meta-i` | 保持 | — |
| UX-VID-016 | highlights | 「詳細コメント」`details` 内 `dl.kv` | 保持 | — |
| UX-VID-017 | production story | 同上 | 保持 | — |
| UX-VID-018 | closing comment | 同上 | 保持 | — |
| UX-VID-019 | primary event と status、event へ移動 | アイコン・`/event/{id}`・状態 Badge | 保持 | — |
| UX-VID-020 | event 受付中 | 「受付中」Badge（CURRENT と同じく状態とは別） | 保持 | — |
| UX-VID-021 | event playlist を外部で開く | `playlistUrl` があるときだけ | 保持 | — |
| UX-VID-022 | 複数所属 event を tag から開く | 「他の所属」ボタン型リンク | 保持 | — |
| UX-VID-023 | member 一覧・role/comment | 静的テーブル（名前・`@id` の X リンク・役割・コメント）。公開プロフィールのある人だけ名前リンク | 保持 | — |
| UX-VID-024 | member の chapter 担当 | テーブルのチャプター列 | 保持 | — |
| UX-VID-025 | like を付ける/外す | `interactions` Island 口。既定はいいね数の表示だけ | 次MIG | MIG-0507 (`VideoInteractionIsland`) |
| UX-VID-026 | bookmark/save | 同上 | 次MIG | MIG-0507 |
| UX-VID-027 | interaction pending/active | 同上 | 次MIG | MIG-0507 |
| UX-VID-028 | 未ログインで login へ | 同上 | 次MIG | MIG-0507 |
| UX-VID-029 | terms 未同意で rules へ | 同上 | 次MIG | MIG-0507 |
| UX-VID-030 | banned/auth unavailable の理由 | 同上 | 次MIG | MIG-0507 |
| UX-VID-031 | public chapter/comment 一覧 | 静的リスト（時刻・ラベル・作者、メンバー/コメントのアイコン） | 保持 | — |
| UX-VID-032 | chapter で seek | `chapters` Island 口 | 次MIG | MIG-0507 |
| UX-VID-033 | 再生位置の chapter active | 同上 | 次MIG | MIG-0507 |
| UX-VID-034 | private chapter を権限者だけ badge 付き | 同上（viewer overlay） | 次MIG | MIG-0507 |
| UX-VID-035 | 動画尺外 chapter | 同上 | 次MIG | MIG-0507 |
| UX-VID-036 | 投稿 sheet を現在位置から開く | 同上 | 次MIG | MIG-0507 |
| UX-VID-037 | chapter time 手入力 | composer は Island | 次MIG | MIG-0507 |
| UX-VID-038 | 「現在位置」反映 | 同上 | 次MIG | MIG-0507 |
| UX-VID-039 | label/title 入力 | 同上 | 次MIG | MIG-0507 |
| UX-VID-040 | note 入力 | 同上 | 次MIG | MIG-0507 |
| UX-VID-041 | public/private 投稿 | 同上 | 次MIG | MIG-0507 |
| UX-VID-042 | 投稿に login が必要 | 同上 | 次MIG | MIG-0507 |
| UX-VID-043 | 投稿に terms 同意が必要 | 同上 | 次MIG | MIG-0507 |
| UX-VID-044 | 投稿に approved Active X が必要 | 同上（mock の「投稿には承認済み X ID が必要です」も Island 側） | 次MIG | MIG-0507 |
| UX-VID-045 | validation error | 同上 | 次MIG | MIG-0507 |
| UX-VID-046 | private 投稿直後の overlay 反映 | 同上 | 次MIG | MIG-0507 |
| UX-VID-047 | public 投稿後の反映待ち notice | 同上 | 次MIG | MIG-0507 |
| UX-VID-048 | 追加 item へ scroll | 同上 | 次MIG | MIG-0507 |
| UX-VID-049 | Active X 切替時の破棄確認 | 同上 | 次MIG | MIG-0507 |
| UX-VID-050 | chapter CSV 一括登録 UI | 同上 | 次MIG | MIG-0507 |
| UX-VID-051 | CSV 上限/行 error/成功件数 | 同上 | 次MIG | MIG-0507 |
| UX-VID-052 | viewer utility dock（playlist 等） | `chapters` Island 口（mock の再生リスト sheet・スマホ下部 dock も Island） | 次MIG | MIG-0507 |
| UX-VID-053 | related videos | `fn-row--compact` のリスト、最大12件（CURRENT `firstCount`） | 保持 | — |
| UX-VID-054 | related 利用不能の degraded message | `relatedUnavailable` で CURRENT 文言（`role="status"`）、0件は「関連動画はまだありません。」 | 保持 | — |
| UX-VID-055 | VideoObject JSON-LD/metadata | head は page 側 | 次MIG | MIG-0403 / MIG-0507 |

## 2. イベント詳細 (`EventDetailView` / `/event/[id]`)

| UX ID | 機能 | 本部品での扱い | 状態 | 次MIG |
| --- | --- | --- | --- | --- |
| UX-EVENT-006 | title/icon/description 概要 | メインビジュアル（`img_url ?? icon_url`）・アイコン・`h1`・説明文 | 保持 | — |
| UX-EVENT-007 | stage/status | 状態 Badge（呼び出し側が「募集期間中」または `eventStatusLabel`） | 保持 | — |
| UX-EVENT-008 | 募集受付中/終了の状態 | Badge・期間・`metrics`（作品・クリエイター・埋まり枠・`getDayMetric`）・日程 `dl`（募集期間/投稿期間）・上映枠ごとの埋まり `meter` | 保持 | — |
| UX-EVENT-009 | 所属 public 作品一覧 | `grid-v` の VideoCard。href は CURRENT と同じ `/{youtube id or id}?playlist={event id}`。表示件数より多いと「すべて見る」→ `/list?event=` | 保持 | — |
| UX-EVENT-010 | entry 可能時の参加/投稿導線 | `entryAction`: reserve→`/event/{id}/slots`「枠を確保する」、submit→`/entry`「作品を提出する」、それ以外は出さない（CURRENT と同じ1つだけ） | 保持 | — |
| UX-EVENT-011 | external/playlist 等の関連 link | YouTube再生リスト（外部）・ガイドライン `/rules`・枠表 `/event/{id}/slots`・投稿予定 `/event/{id}/release`（mock 追加の入口）・運営の profile と X | 保持 | — |
| UX-EVENT-012 | 非公開/blocked で露出しない | 呼び出し側が `null` を渡し EmptyState のみ | 次MIG | MIG-0405 |
| （CURRENT 入口） | 枠数のライブ更新 | build 時の値だけ。ライブは Island | 次MIG | MIG-0502 |
| （CURRENT 入口） | Event JSON-LD | head は page 側 | 次MIG | MIG-0403 / MIG-0502 |
| （CURRENT） | `EventRecruitCard`（空き枠と導線） | 同じ情報を `metrics` の埋まり枠と `entryAction` / 枠表リンクで出す（mock にカードは無い） | 保持 | — |
| （mock のみ） | 「グループ」欄 | CURRENT の詳細ページに無い（UX-EVENT-020..024 は MERGED_INTO_OTHER）。追加しない | 未対応 | — |

## 3. クリエイター (`CreatorView` / `/user/[id]`)

| UX ID | 機能 | 本部品での扱い | 状態 | 次MIG |
| --- | --- | --- | --- | --- |
| UX-USER-006 | identity/icon/display name | アバター・`h1`（`x_name || id`）・`@id`・「クリエイター一覧」へ戻る | 保持 | — |
| UX-USER-007 | X profile を外部で開く | `https://x.com/{id}` | 保持 | — |
| UX-USER-008 | YouTube channel を外部で開く | `youtubeChannelUrl` があるときだけ | 保持 | — |
| UX-USER-009 | profile blocks/about | About / Contact（無いときは aside ごと出さない）・その他 social link（`mailto:` は同じタブ） | 保持 | — |
| UX-USER-010 | works | 「作品」と総数、VideoCard、ポートフォリオ `/user/{id}/portfolio`。0件は CURRENT 文言 | 保持 | — |
| UX-USER-011 | collab | 「参加作品」と総数。0件は CURRENT と同じく欄を出さない | 保持 | — |
| UX-USER-012 | works/collab の独立 paginate | MIG-0204 `Pagination` を2つ。href は呼び出し側の `buildHref`（CURRENT: 1ページ目は素の URL、以降 `?worksPage=` / `?collabPage=`） | 保持 | — |
| UX-USER-013 | query の deep-link/reload/back-forward | URL の解釈は page 側 | 次MIG | MIG-0504 |
| UX-USER-014 | empty states | 作品0件の文言、collab 0件は非表示 | 保持 | — |
| （CURRENT） | Person JSON-LD | head は page 側 | 次MIG | MIG-0403 / MIG-0504 |

## 4. mock との差（意図したもの）

- mock の Font Awesome は使わない（icon font 未導入）。`screens/parts.tsx` の inline SVG で同じ位置に描く。
- 作品詳細のスマホ固定プレーヤー（`vd-player-pane{position:fixed}`）・下部 dock・チャプター sheet は Island（MIG-0507）と一緒に入れる。静的描画ではプレーヤーは通常の流れ、チャプターとメンバー表はページ内にそのまま出す。
- mock で見出しを隠している（`.vh`）作品詳細の「チャプター」「参加メンバー」は、表示切替・追加ボタンが Island 側にあるため見出しを見せる。
- mock の「作品を提出」「枠を確保」の2ボタン同時表示は CURRENT の1つだけの導線に合わせた（機能 parity 優先）。
- mock の Creator スマホ表示は About の下に大きな空きがある（`.split>.side{flex:1 1 320px}` が縦並びで高さになる）。mock どおりに移植しており、直すなら mock 側の判断が要る。

## 5. 検証

- unit: `packages/ui/test/screens.dom.test.mjs`（CURRENT の入口 href、公開プロフィール有無、Island 差し込み、T01 / T02 / T04、a11y の名前・id、CSS 変数が tokens のもの）。
- browser: Playwright（chromium headless shell）で 1440px / 390px の全ページスクリーンショットと、横はみ出し（`scrollWidth == innerWidth`、viewport 外の要素0件）・Tab 順を計測。結果と画像は PR #317 のコメントに記録。
