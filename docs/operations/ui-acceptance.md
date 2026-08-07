# UI受入検査

> Status: Active
> Last verified: 2026-07-21
> Verified against commit: `fb0256a`
> Source of truth: `app/`, `src/components/`, `src/styles/`, `scripts/check-ui-acceptance.mjs`

## SEOブランド素材

- favicon は正方形の16px・32px・48pxを格納した実ICOとし、安定URL `/favicon.ico` で配信する。
- 検索・ホーム画面用ロゴは正式な `flamenode-mark.svg` から生成した192px・512px・maskable 512px・Apple 180pxを使用する。
- 既定のOpen Graph / X共有画像は正式なマークとワードマークから生成した1200×630px PNGを使用し、個別作品など固有画像があるページは従来どおり固有画像を優先する。
- トップページの `Organization` / `WebSite` JSON-LD は512px正方形ロゴのクロール可能な絶対URLを参照する。
- 派生画像は `npm run generate:brand-assets` で同じ原本とデザイントークンから再生成できる。

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

- 640px以下では本文を15px基準、通常ボタンを13px基準として、主要見出しも段階的に縮小する。入力欄はiOSの自動ズームを避ける16pxを維持し、タップ領域の高さは変更しない。
- `/entry`からイベント参加と枠なし投稿の両方へ移動できる。
- 未提出reserved slotが提出済み枠より先に表示される。
- 投稿フォームは提出者情報、作品情報、YouTube URL、確認・送信の順に進み、戻る操作とエラー箇所への復帰ができる。枠提出では YouTube URL は任意で、未入力でも次へ進める。
- custom answerと合作memberの進捗が現在値から更新される。
- イベント一覧は検索、状態、並び替えをURLで保持し、static JSONとDB fallbackで同じfilter結果になる。
- 作品一覧はタイル、コンパクト、一覧を切り替え、queryを保持したままページングできる。
- テーマの初期値はOS設定に追従し、画面上ではライトとダークの2択を切り替える。明示選択後は再読込後も選択が維持される。
- モバイル管理drawerはEscape、背景クリック、閉じるボタンで閉じ、開いている間はフォーカスが内部に留まる。
- モバイル公開メニューはページ途中から開いてもヘッダー直下の先頭から表示し、再度開いた場合もメニュー内部のスクロール位置を引き継がない。
- 900px以下の固定ヘッダーは境界線込み50pxとし、動画playerなどの固定要素も共通の`--header-h`へ追従する。
- トップの「今週のピックアップ」は`top.json`を正本として維持し、JSONを変更せずrequestごとの表示順だけをランダム化する。
- トップの「FlameNodeで注目」は R2 `analytics/trending.json` を正本とし、上位12件を順位順で `TopLoopShelf` 表示する（他のトップ棚と同じ full-bleed 幅・自動スクロール。向きは注目→left / ピックアップ→right / 新着→left / 懐かし→right）。24時間超のデータは非表示。degraded D1 でも R2 が正常なら表示する。
- `/trending` は急上昇ランキング（上位30件・直近2日間の視聴急増で順位・各作品に1週間の視聴回数（views_7d）のみ表示・JST最終更新）を表示し、データ欠損や stale でも404/500にしない。2日/5日/30日の期間別視聴数は出さない。
- `/recommend` の「人気作品」レール（旧「伸びている」）は表示名のみ変更し、算出は `recommend.json` のまま維持する。
- Shelfはhover、focus、pointer、touch、wheel操作中に停止し、reduced motion、viewport外、非表示tabでは自動送りしない。
- トップの4棚（注目・ピックアップ・新着・懐かし）は`TopLoopShelf`（3グループ複製 + scrollLeftテレポート）を使い、汎用`Shelf`のloop rotateとは分離する。`TopLoopShelf`もhover、focus、pointer、wheel、操作後一時停止、reduced motion、viewport外、非表示tabで自動送りを止める。
- `/admin`と`/manage`のナビ項目が混在しない。
- 動画詳細は、モバイルの固定playerをヘッダー直下へ水平ずれなく配置する。PCではチャプターコメント一覧だけを約200px上限の可変スクロールとし、関連動画はページ本体でスクロールできる。
- hydration errorと主要操作時のconsole errorがない。

## Footer・Aboutクレジット

- Footer Guide に「問い合わせ」や `/rules#contact` を置かない。イベント開催相談は `/rules#event-host` を維持する。
- Footer に `NODE.0426` や `Built on Cloudflare...` を表示しない。
- `/about` の制作クレジットは FlameNode Logo と FlameNode Sans のみを対象とし、foriio / X の外部リンクを含む。

## 枠確保表（`/event/[id]/slots`）

- 枠確保表は actual slot 行と 1:1 で表示する。連続予約でも行を collapse しない。
- 連続予約の 2 枠目以降は、名前の横に小さく「n枠目」を表示する。1 枠目は通常の単枠と同じ見た目にする。
- 1 作品あたり最大枠数の正本は `events.max_slots_per_video` で、設定範囲は 1〜20。
- 連続グループ内の各枠は個別に解放できる。中央解放では前後の segment が別の連続枠に分かれうる。
- イベント最大枠数を後から下げても、既存予約の提出・個別解放・管理者強制解放は可能とする（拡張・結合でのサイズ増加のみ拒否）。
- 埋まり枠数は reservation group 数ではなく actual slot 行数で集計する。
- `anonymous` / `hidden` で他人が閲覧する場合は「確保済み」のみとし、連続枠の位置情報からグループ構造を推測できないようにする。
- Discord のみログイン（X ID 未連携）でも、利用規約同意後は枠確保できる。`canTakeSlot` は `onboarding.canReserveSlot` ベースであり `viewerXId != null` を要求しない。
- 枠行の高さは `SlotGrid.module.css` の `--slot-row-height` で統一する。
- 提出済み枠のアイコンは `slot-submission-icon/{slotId}` 経由で表示する（`submitted_icon_url` / `submittedIcon`）。
- 設定・オンボーディングの文言は「枠確保は規約同意後、投稿は X ID 承認後」とし、「枠確保は X ID 申請後」は使わない。

## 自動検査

`npm run check:ui-acceptance` は上記機能を支える実装契約と、この幅一覧の欠落を検出します。実ブラウザでの最終確認は、production secretを使わないOpenNext / `wrangler dev`ローカルpreviewで行います。
