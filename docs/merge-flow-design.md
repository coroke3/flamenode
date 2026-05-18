# X ID merge フロー 設計メモ

**Status**: 設計のみ、未実装。Opus 判断候補 #8 を残す代わりに最小実装手順を確定。

## 背景

`x_account_link_requests.link_type = 'merge'` の申請を承認する場合:
- 旧 X ID (`requested_x_id`) を新 X ID (`target_x_user_id`) に統合する
- 旧 ID で投稿された video, video_chapter, video_member, slot, etc. を新 ID に付け替える
- 旧 ID のレコードは保持するか削除するかを決める

現状の実装 (`src/lib/actions/xid-admin.ts`) は `link_type === 'merge'` を **拒否** している (`Batch 78`)。

## 実装スコープ

### Phase A: dry-run スクリプト (危険度: 低)
- `scripts/merge-dry-run.mjs` を追加
- 引数: `--from <oldXId> --to <newXId>`
- 出力: 影響を受ける行数 (videos, video_chapters, video_members, slots, video_interactions)
- DB を書き換えない
- 既存の `check-public-api-leaks.mjs` と同パターン

### Phase B: 単一 X ID merge Server Action (危険度: 中)
- `mergeXIds(fromXId, toXId)` action を追加
- トランザクション内で以下を実行:
  - `videos.creator_id = toXId WHERE creator_id = fromXId`
  - `video_chapters.x_user_id = toXId WHERE x_user_id = fromXId`
  - `video_members.x_user_id = toXId WHERE x_user_id = fromXId`
  - `slots.x_user_id = toXId WHERE x_user_id = fromXId`
  - `video_interactions.x_user_id = toXId WHERE x_user_id = fromXId` (UNIQUE 制約に注意)
  - `x_user_aliases (target=toXId, alias=fromXId)` を追加
  - 旧 `x_users.linked_discord_user_id` を NULL に
  - history_logs (retention_class='long_audit') に詳細記録
- 通知: 旧 ID/新 ID の Discord に enqueue

### Phase C: admin UI から起動 (危険度: 高)
- `/admin/x-link-requests` で merge 申請を承認可能にする
- 確認モーダルで影響件数表示 + 「実行するには 'MERGE' と入力」
- 失敗時のロールバック手順を docs に追加

## UNIQUE 制約の注意

`video_interactions_uniq` は `(x_user_id, video_id, interaction_type)`。
旧 ID と新 ID が同じ動画にライクしている場合、UPDATE で UNIQUE 衝突する。
事前に `DELETE FROM video_interactions WHERE x_user_id = fromXId AND (video_id, interaction_type) IN (SELECT video_id, interaction_type FROM video_interactions WHERE x_user_id = toXId)` で重複削除する。

## 旧 ID 削除 vs 保持

**Phase A〜C では保持** を採用 (`x_users` 行は残す、`linked_discord_user_id` だけ NULL にする)。
完全削除は別フェーズで検討。

## ロールバック

- 全 UPDATE は `WHERE x_user_id = toXId AND <旧 ID の痕跡>` ベースで逆向きに復元する SQL を `scripts/merge-rollback.mjs` で提供
- 但しコメント / interaction 削除済みは復元不可。事前 dump 必須

## 関連 Opus 判断候補

- **#8 merge フロー完全実装** (本ドキュメント)
- **legacy/normalize core 切り出し** (#9) と独立
