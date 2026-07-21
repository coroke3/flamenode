# UI受入検査

> Status: Active
> Last verified: 2026-07-21
> Verified against commit: `fb0256a`
> Source of truth: `app/`, `src/components/`, `src/styles/`, `scripts/check-ui-acceptance.mjs`

公開画面、投稿画面、管理画面の回帰確認は次の幅で行います。横方向のページ全体overflow、操作不能な固定要素、隠れた主要CTA、フォーカス不能なdialogを失敗とします。

| 幅 | 主な確認対象 | 合格条件 |
| ---: | --- | --- |
| 360px | 最小スマートフォン | `/entry`の2カードが縦に収まり、投稿ステップ、フォーム、表の横スクロールが画面全体を押し広げない |
| 390px | 標準スマートフォン | 作品カード、イベントカード、ヘッダー操作、主要CTAが重ならない |
| 430px | 大型スマートフォン | モバイル2行Shelf、フィルター、管理drawerが操作可能 |
| 640px | モバイル最大域 | 700px境界前でもtop、header、動画詳細のモバイル順と2行Shelfを維持する |
| 768px | タブレット境界 | 760pxのConsoleDrawer切替前後でイベント運営・サイト管理の導線が消えない |
| 1024px | 小型デスクトップ | admin/manageの2カラム、作品詳細、一覧filterが欠けない |
| 1280px | 中型デスクトップ | PC動画詳細、固定player、sidebar、一覧の最大幅が衝突しない |
| 1440px | 標準デスクトップ | 最大幅、余白、Shelf矢印、一覧密度が過度に拡張しない |
| 1920px | 大型デスクトップ | コンテンツ幅が制御され、巨大な空白や過大なカードが発生しない |

## 必須操作

- `/entry`からイベント参加と枠なし投稿の両方へ移動できる。
- 未提出reserved slotが提出済み枠より先に表示される。
- 投稿フォームは提出者情報、作品情報、YouTube URL、確認・送信の順に進み、戻る操作とエラー箇所への復帰ができる。
- custom answerと合作memberの進捗が現在値から更新される。
- イベント一覧は検索、状態、並び替えをURLで保持し、static JSONとDB fallbackで同じfilter結果になる。
- 作品一覧はタイル、コンパクト、一覧を切り替え、queryを保持したままページングできる。
- テーマの初期値はOS設定に追従し、画面上ではライトとダークの2択を切り替える。明示選択後は再読込後も選択が維持される。
- モバイル管理drawerはEscape、背景クリック、閉じるボタンで閉じ、開いている間はフォーカスが内部に留まる。
- Shelfはhover、focus、pointer、touch、wheel操作中に停止し、reduced motion、viewport外、非表示tabでは自動送りしない。
- `/admin`と`/manage`のナビ項目が混在しない。
- 動画詳細はモバイルだけ表示順を変更し、PC構成と固定playerを維持する。
- hydration errorと主要操作時のconsole errorがない。

## 自動検査

`npm run check:ui-acceptance` は上記機能を支える実装契約と、この幅一覧の欠落を検出します。実ブラウザでの最終確認は、production secretを使わないOpenNext / `wrangler dev`ローカルpreviewで行います。
