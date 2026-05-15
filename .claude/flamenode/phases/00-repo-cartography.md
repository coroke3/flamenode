# Phase 0: 現状把握・ファイル地図

## 目的

コード変更を始める前に、FlameNodeの現行実装が4つの原典要求に対してどこまで満たしているかを把握する。

## 推奨モデル

- Haiku: grep、Glob、Readによる探索だけ
- Sonnet: ズレの分類、PR分割案
- Opus: 仕様衝突の判断

## 必ず読むファイル

- `/CLAUDE.md`
- `/claude-code-subagent-assignment.md`
- `/.claude/flamenode/README.md`
- `/.claude/flamenode/requirements-map.md`
- `/.claude/flamenode/source/flamenode_final_detailed_design.md`
- `/.claude/flamenode/source/flamenode_final_implementation_checklist.md`
- `/.claude/flamenode/source/flamenode_final_consistency_audit.md`

## 調査対象領域

1. ID / 権限 / CurrentUser / Active X ID
2. 投稿 / 枠なし投稿 / 枠あり提出 / YouTube ID
3. スロット / reservation_group_id / 部番号
4. いいね / セーブ / ライブラリ / 再生リスト
5. チャプターコメント / videoChapters / video_comments
6. 公開API
7. health / security / admin
8. UI / 上部バー / エントリー / ダッシュボード / 入力フォーム
9. DB / deprecated項目 / legacy import / audit logs
10. 通知 / Worker / 静的JSON

## 出力形式

コード変更はしない。次の形式で出す。

```md
# Phase 0 調査結果

## 読んだファイル

## 関連ファイル地図
| 領域 | 関連ファイル | 責務 | 対応要求ID | リスク | 推奨モデル |
|---|---|---|---|---|---|

## 実装済み・不足・要確認
| 領域 | 実装済み | 不足 | 要Opus判断 |
|---|---|---|---|

## 推奨PR分割

## 最初に着手すべきPR

## まだコード変更していないことの確認
```

## 対応要求ID

A-1〜A-5、B-1〜B-7、C-1〜C-8、D-1〜D-7、E-1〜E-6、F-1〜F-6、G-1〜G-7、H-1〜H-8、I-1〜I-6、J-1〜J-17、K-1〜K-5、L-1〜L-6、M-1〜M-5、N-1〜N-6、O-1〜O-5、P-1〜P-6、Q-1〜Q-6

Phase 0では全要求IDを地図に載せる。