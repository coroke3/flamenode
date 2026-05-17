# Session Handoff (2026-05-17)

## 概要

main ブランチ上で連続実装。すべて small-batch、typecheck/build 通過、commit + push 済み。
Opus は未使用。Sonnet (flamenode-implementation-agent) / Haiku (flamenode-repo-cartographer) のみ。

## このセッションで完了した Batch (新→旧)

| # | Batch | Commit |
|---|---|---|
| 0a | /admin/audit にテーブル/操作/実行者/件数フィルタ追加 | de0d40d |
| 0b | slot時間重複検査をスイープラインに変更し全ペア検出 | d2af936 |
| 0c | session-handoff.md 追加 | fa86ea7 |
| 1 | rules ページ renderMarkdown も sanitizeUserHtml 経由で多重防御 | 174acdc |
| 2 | custom_pages HTMLサニタイザ + security check 追加 (XSS修正) | b693341 |
| 3 | 複数イベント並走時の entry CTA 優先度 (entry_end_time近い順) | 4ea5a8b |
| 4 | メンバー候補上限 200→2000 | 0ed1a07 |
| 5 | VideoForm section disabled 表示 + 編集ヒント | 03fe2b3 |
| 6 | 募集期間カラム導入 (entry_start_time / entry_end_time) + migration 0001 | 9cc9901 |
| 7 | SlotGrid viewerActiveX 配線 (extend/merge UI 有効化) | 6076a29 |
| 8 | owner用 extend/merge UI を SlotGrid に追加 | 3650ee1 |
| 9 | Worker監査ドキュメント notification_outbox 整合後に更新 | dbb6d17 |
| 10 | notification-dispatcher Worker を notification_outbox 実カラムに整合 | aa27a55 |
| 11 | 残り6ファイルの window.confirm を ConfirmDialog に置換 | 9354c58 |
| 12 | slot重複/like差分チェックと通知テーブル名統一 | be44b7b |
| 13 | admin 系 4 ファイルの window.confirm を ConfirmDialog に置換 | cfaa012 |
| 14 | SlotList に slot part 番号表示 | ca032e8 |
| 15 | health: deprecated項目検出 (video_comments / outro_comment / marker_kind) | c9ce62b |
| 16 | scripts/check-db-legacy.mjs (静的 deprecated 書き込み検出) | 7adfe04 |
| 17 | docs/operations.md (migration/rollback/Worker/leak check/管理者操作) | 64e4e79 |
| 18 | SlotGrid に連続枠 owner 向け extend/merge ヘルプ表示 | 876d255 |
| 19 | イベント詳細に募集開始前/募集終了/募集期間を表示 | b5a065f |
| 20 | docs/workers.md (Worker実装状況 L-1) | ef19351 |
| 21 | ダッシュボード上部バー重複ナビ削除 (C-1/C-2 整合) | b6b1098 |
| 22 | エントリーカードに募集終了時刻を表示 | fed5635 |
| 23 | cleanup Worker に notification_outbox TTL削除 (sent 14d / failed 30d) | 12e24af |
| 24 | /admin トップに「今日やること」+ X ID 承認待ち | 2b07160 |
| 25 | /admin/security に状態フィルタ | ca2301b |
| 26 | /admin/health に状態フィルタ | fa433fe |
| 27 | /admin/notifications で notification_outbox 一覧表示 (K-4) | 4ba342c |
| 28 | docs/workers.md に /admin/notifications を反映 | 8c91d47 |
| 29 | /admin/notifications に failed の手動リトライ | 97db6e6 |
| 30 | /admin/notifications に payload整形モーダル | 4d2aae4 |
| 31 | モバイル関連動画位置改善 (本文側に出して下部押し込み解消) | bc48c8a |
| 32 | cleanup Worker に history_logs TTL削除 (normal 90d / long_audit 365d) | 569fd3d |
| 33 | /admin/audit に行ごと差分詳細パネル (P-5) | 3acac66 |
| 34 | メンバー表をモバイルでカード積み上げに改善 | f9bf453 |
| 35 | slot 表示名 localStorage 記憶 (次回確保時の既定値) | 9320e66 |
| 36 | HomeIntroBand に募集開始前/募集終了ラベル | 54163ad |
| 37 | cleanup Worker に voided 動画の論理削除タイマー (30日) | 3d5b905 |
| 38 | /admin/audit に record_id 完全一致フィルタ | e861d0d |
| 39 | cost_guard_mode 非 normal 時の上部バナー (E-5) | d456349 |
| 40 | cleanup Worker が system_settings.history_retention_days を読む | a7d646c |
| 41 | /admin/x-link-requests に直近の承認/却下履歴 | 4161fc0 |
| 42 | /admin トップに直近の管理操作 5件 | 979c98a |
| 43 | /admin/cost-guard に変更履歴 (system_settings) | 025552e |
| 44 | /manage 受信箱トップ (K-5最小) | 768cb09 |
| 45 | AuthHeader に /manage リンク | b7027b8 |
| 46 | /admin/videos に event フィルタ追加 | e56c592 |
| 47 | /manage/events/[id] イベント個別運営ページ | 28a7515 |
| 48 | 手動リトライ時の attempt_count リセット (fix) + 履歴拡充 | 7157797 |
| 49 | notification_outbox.event_id 追加 (migration 0002) + /manage で event 通知表示 | 7d76c47 |
| 50 | /manage/events/[id] にも event-scoped 通知一覧 | e27df67 |
| 51 | HomeIntroBand に募集締切/開始カウントダウン | d7d7bcc |
| 52 | docs/operations.md に migration 0002 追記 | 32f3dfa |
| 53 | /admin/events に並び替え/フィルタ/検索 | 6ac98cc |
| 54 | enqueueNotification ヘルパー + X ID 承認/却下通知 | bdcfe91 |
| 55 | video status 変更時に投稿主へ通知発火 (event-scoped) | 5e71ff1 |
| 56 | cleanup retention 純粋関数化 + 単体テスト追加 | 69466ea |
| 57 | /admin/users/[id] にユーザー固有 history_logs 表示 | 81afeb8 |
| 58 | slot 強制解放時に枠所有者へ通知 (event-scoped) | b335131 |
| 59 | public チャプター追加時に動画オーナーへ通知 | d1ce698 |
| 60 | /manage 配下に担当イベント一覧サイドバー | d20704f |
| 61 | /admin/notifications に event_id フィルタ | 1fb84f4 |
| 62 | manage→admin 通知ログリンク追加 | 9e80cb4 |
| 63 | enqueue payload バリデーション + テスト 10件 | 0b07d53 |
| 64 | YouTube ID / URL ユーティリティのテスト 13件 | e6a9acc |
| 65 | X ID 正規化テスト 5件 | aa05ea4 |
| 66 | slot grouping core 切り出し + テスト 9件 | eb69dda |
| 67 | format ユーティリティのテスト 17件 | dc0d6e1 |
| 68 | X ID 連携申請の却下理由入力 (履歴+通知に反映) | 90f7486 |
| 69 | /admin/audit/[id] 詳細ページ | 8a42552 |
| 70 | /manage/events/[id]/slots スロット運営一覧 | bda4f57 |
| 71 | /manage/events/[id]/staff 運営メンバー一覧 | 90fa914 |
| 72 | docs/operations.md に単体テスト実行手順追記 | 47dd346 |
| 73 | publicDto テスト 11件 (pickKeys / assertNoForbiddenKeys) | 10c08db |
| 74 | eventStatus core 分離 + テスト 14件 (累計 87件) | d25d7ce |
| 75 | sanitizeUserHtml テスト 15件 (累計 102件) | 5e8f9c7 |
| 76 | cleanup Worker runCleanup を D1 モックで実行 (5件、累計 107件) | c6739d4 |
| 77 | メンバー表 client 化 + 列ソート対応 | 3c5f95f |
| 78 | X ID 連携申請 merge/alias 分岐 (alias は x_user_aliases、merge は拒否) | ffde0ed |
| 79 | イベント運営ページの通知に type 別カテゴリフィルタ | 8ca432a |
| 80 | video_members に order_index / name インデックス (migration 0003) | 06961f3 |
| 81 | cleanup ウォーム内即時リトライ (transient 最大3回、テスト 7件、累計 114件) | c6c6729 |
| 82 | /admin/announcements に通知対象件数 dry-run プレビュー | 6261605 |
| 83 | /admin/rules に major 公開時の影響範囲 dry-run プレビュー | 2a65540 |
| 84 | /admin/users に moderator/TOS未同意/active X未設定フィルタ | 3940151 |
| 85 | イベント運営の通知をDB直接フィルタ化 (GROUP BY + LIKE) | fefee62 |
| 86 | video_members.name_for_sort 追加+書き込み時同期 (migration 0004) | 68de4a0 |
| 87 | docs/ops に未適用 migration 0001-0004 適用手順 | c086877 |
| 88 | security: banned 投稿チャプター/孤立 approved X ID 検出 | dd17cef |
| 89 | notification_outbox に (status,created_at)/(event_id) インデックス (migration 0005) | a856c67 |
| 90 | /admin/users/[id] に email認証/TOS/再同意要求ステータス表示 | a6a53a6 |
| 91 | health: orphan video_member / name_for_sort NULL 検出 | 675f5ee |
| 92 | check-public-api-leaks に offset/limit バリエーション追加 | df34f3e |
| 93 | /admin/announcements に audience/status フィルタ | 6730e1f |
| 94 | /admin/rules に状態フィルタ (published/draft/archived) | bde23f7 |
| 95 | cn ユーティリティのテスト 5件 (累計 119件) | 2cfb458 |
| 96 | id ユーティリティのテスト 6件 (累計 125件) | e0c5430 |
| 97 | /admin/health に WARN サマリパネル | 4aaae3f |
| 98 | /admin/security に WARN サマリパネル | 2fbcc4c |
| 99 | /admin トップ「今日やること」にヘルス/セキュリティWARN件数 | 85d8576 |
| 100 | /admin/x-link-requests に直近の却下リクエスト一覧 | 826622c |
| 101 | /admin トップに直近の失敗通知 3件パネル | 850b441 |
| 102 | /admin/notifications に状態サマリパネル | c8b4049 |
| 103 | /admin/events/[id] にスロット/動画状態の集計バッジ | 6fac2ff |
| 104 | /admin/audit/[id] に同 record_id の前後ナビ | 1c047c6 |
| 105 | /admin/users/[id] にメール認証日時表示 | ddceae4 |
| 106 | /admin/notifications に payload LIKE 検索追加 | 4567dcb |
| 107 | /admin/audit に日付範囲フィルタ (since/until, JST境界) | 9a984d0 |
| 108 | /admin/notifications に failed 一括リトライボタン (上限 50) | 28d76a6 |
| 109 | /admin/users 一覧から監査ログへのクイックリンク | d291ee9 |
| 110 | /admin/users/[id] に X ID 連携申請履歴セクション | 1fb6d4b |
| 111 | /admin/x-link-requests に link_type フィルタ | 178aed8 |
| 112 | /admin/notifications 各行から監査ログ直リンク | a0375b4 |
| 113 | /admin/videos 一覧から監査ログクイックリンク | 730072e |
| 114 | /admin/events 一覧から監査ログクイックリンク | 9950419 |
| 115 | /manage トップに担当イベントの failed 通知バナー | f2f8821 |
| 116 | /admin/users 一覧の Active X ID をプロフィールリンク化 | 23c5edf |
| 117 | /admin/audit/[id] に table 別 詳細ページジャンプリンク | d095322 |
| 118 | /manage/events/[id]/staff に個別編集権限テーブル追加 | 595f0ca |
| 119 | /admin/announcements 一覧から監査ログクイックリンク | bf76871 |
| 120 | /admin/rules 一覧から監査ログクイックリンク | 00d0d6f |
| 121 | docs/operations.md に health/security チェック一覧反映 | 42d79d7 |
| 122 | /admin/users/[id] に active X ID ライブラリ件数表示 | 4862081 |
| 123 | /manage staff の approved_by を admin 限定でリンク化 | a225c69 |
| 124 | /admin/events/[id] に運営ビュー/監査ログリンク | e8fe8d6 |

## 残る Opus判断候補 (Sonnet で対応可能なものも含む)

- like_count 実数差分の閾値再評価 (現状 5)
- イベントごとの slot 部区切り `gapSec` を events テーブル設定可に拡張
- メンバー候補検索の本格 API 化 (2000 上限の更なるスケール)
- 募集期間自動切替 cron (現状はリアルタイム判定で動作)
- 関連動画 UI の mobile 位置最適化
- メンバー表 / 関連動画の mobile レイアウト改善

## 既知の未適用

- migration `0001_young_fat_cobra.sql` (entry_start_time / entry_end_time) は本番 D1 へ未適用。
- migration `0002_hot_colleen_wing.sql` (notification_outbox.event_id) は本番 D1 へ未適用。
- migration `0003_loose_whiplash.sql` (video_members インデックス) は本番 D1 へ未適用。
- migration `0004_tough_kronos.sql` (name_for_sort + バックフィル) は本番 D1 へ未適用。
- migration `0005_curvy_karnak.sql` (notification_outbox インデックス) は本番 D1 へ未適用。
- 本番 deploy も未実施。

## 次に着手しやすい小粒 Batch 候補

1. merge フロー完全実装 (Opus 判断候補)
2. announcement / terms 本格 enqueue 戦略 (Opus 判断候補。dry-run 実装済み)
3. cleanup Worker の Durable Object 永続化 (Opus 判断候補。ウォーム内リトライ実装済み)
4. legacy/normalize の pure 関数を core 切り出し (Opus 判断候補。Shift_JIS mojibake トークン埋め込みで文字化けリスク高)
5. /manage/events/[id]/audience プレビュー (event の登録者リスト)
6. /admin/events/[id]/edit のフォーム小改善 (entry_start/end の datepicker)
7. /admin/notifications の bulk retry 履歴可視化 (bulk_retry record_id のフィルタ)

## 進め方ルール

- 調査: flamenode-repo-cartographer (Haiku)
- 実装: flamenode-implementation-agent (Sonnet)
- Opus は使わない
- typecheck / build / commit / push まで自走
- deploy / 本番 migration 適用だけは 1 行ログ
- 確認待ちはしない

## ops 関連スクリプト

```sh
npm run check:db-legacy            # deprecated DB 書き込みの静的検出
npm run check:public-api-leaks     # 公開 API 漏洩検査 (dev server 必須)
npm run test:unit                  # 全単体テスト (累計 102件、node:test)
npm run test:workers               # Worker 純粋関数のみ
npm run test:notif                 # 通知 payload バリデーションのみ
npm run test:youtube               # YouTube ID 抽出/URL のみ
```
