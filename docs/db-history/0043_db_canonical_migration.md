# 0043 DB正本移行

> Status: Active

対象: `migrations/0043_db_canonical_migration.sql`

## 目的

FlameNodeのDBを、X名義・認証ユーザー・イベントowner・作品関連・監査設定が重複しない修正後正本へ統一する。一般ランタイムでは旧テーブル・旧カラムとの後方互換を持たない。旧形式インポートだけは入力変換機能として維持し、保存先は新正本に限定する。

## 変更内容

- `x_identity_requests` と `x_user_account_links` を追加する。
- X ID申請3テーブルを `x_identity_requests` へ統合する。
- X名義と認証ユーザーの直接FKを多対多リンクへ移行する。
- イベント代表者を `event_staff.permission_preset='owner'` へ統一する。
- `event_staff.role` と公開肩書・権限の重複を解消する。
- `video_members.chapters_json` を `video_chapters` の行へ展開する。
- YouTube動画IDを `videos.youtube_video_id` へ一本化する。
- 監査設定を `system_settings.audit_*` へ統合する。
- 複合主キーへ変更するテーブルを再作成する。
- 正本に含まれない旧テーブル8件、旧カラム25件、旧名称2件を削除する。
- `events.max_slots_per_video` は値を保持したまま維持する。

## データ損失

意図的なデータ損失を含む。廃止機能だけを削除対象とし、以下は移行または補完する。

- X ID申請、X名義とログインユーザーの関係、owner、チャプター、YouTube動画ID、監査設定は新正本へ移行する。
- 外部由来の `video_interactions` は廃止し、FlameNode内反応のみを残す。
- 旧アイコン・YouTubeチャンネル候補履歴は代表値を正本へ反映後に削除する。
- owner不在イベントには既存スタッフの昇格または移行専用保留ownerを作成する。

## ロールバック

適用後の逆migrationは提供しない。適用前にD1バックアップを取得し、問題発生時は次を同時に戻す。

1. D1を適用前バックアップへ復元する。
2. アプリケーションを0043適用前commitへ戻す。
3. R2へ保存した旧形式インポートのpreview・移行資料を保持する。

## 検証

- 空DBへactive migrationを全件適用する。
- Drizzle正本とD1のテーブル・カラム・index・外部キー・CHECKを照合する。
- 正本が41テーブル・409カラムであることを確認する。
- 旧テーブル8件、旧カラム25件、旧名称2件が存在しないことを確認する。
- `PRAGMA foreign_key_check` と `PRAGMA integrity_check` を実行する。
- 全イベントにownerが1人以上存在することを確認する。
- `events.max_slots_per_video` が保持されることを確認する。
- 旧形式インポートが新正本だけへ保存することを回帰テストする。
