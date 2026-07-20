# FlameNode DB正本移行 実装方針

> Status: Active
> Canonical schema: 41 tables / 409 columns

## 方針

一般ランタイムの後方互換は提供しない。`src/lib/db/schema.ts` を唯一の公開入口とし、旧テーブル・旧カラムをアプリケーションから参照しない。

旧形式インポートは入力アダプターとして維持する。JSON/CSV/TSVの旧入力を解析してcanonical planへ変換し、そのplanを新正本へ適用する。旧DB構造へ書き戻さない。

## 不変条件

- `events.max_slots_per_video` を削除しない。
- 各イベントに `permission_preset='owner'` が1人以上必要。
- YouTube動画IDは `videos.youtube_video_id` のみを正本とする。
- X名義と認証ユーザーの関係は `x_user_account_links` のみを正本とする。
- チャプターは `video_chapters` のみを正本とし、時刻昇順で表示する。
- スタッフ権限は `permission_preset`、公開肩書は `public_role_label` を使用する。

## 旧形式インポート

- 旧入力形式の解析・正規化は維持する。
- previewは短期nonceとplan hashで保護する。
- canonical plan本体はR2に短期保存する。
- applyは新正本テーブルだけへ書き込む。
- 適用結果・不一致・警告は `audit_logs` に残す。
- `legacy_import_batches` と `legacy_import_batch_items` は使用しない。
