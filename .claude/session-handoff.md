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

## 残る Opus判断候補 (Sonnet で対応可能なものも含む)

- like_count 実数差分の閾値再評価 (現状 5)
- イベントごとの slot 部区切り `gapSec` を events テーブル設定可に拡張
- メンバー候補検索の本格 API 化 (2000 上限の更なるスケール)
- 募集期間自動切替 cron (現状はリアルタイム判定で動作)
- 関連動画 UI の mobile 位置最適化
- メンバー表 / 関連動画の mobile レイアウト改善

## 既知の未適用

- migration `0001_young_fat_cobra.sql` (entry_start_time / entry_end_time) は本番 D1 へ未適用。
- 本番 deploy も未実施。

## 次に着手しやすい小粒 Batch 候補

1. 入力 UI 改善 (時刻ピッカー、候補ボタン)
2. イベント運営者向け受信箱 (K-5)
3. voided 動画の論理削除タイマー
4. cleanup Worker の単体テスト追加
5. `system_settings.history_retention_days` を cleanup Worker が読む拡張
6. /admin/x-link-requests の差分/承認履歴の前後比較
7. メンバー表の column フィルタ・並び替え

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
```
