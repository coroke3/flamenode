# 0043 DB正本移行

> Status: Active
> Canonical version: `2026-07-20-canonical-1`

対象: `migrations/0043_db_canonical_migration.sql`

## 目的

FlameNodeのDBを、X名義・認証ユーザー・イベントowner・作品関連・監査設定が重複しない41テーブル・409カラムの修正後正本へ統一する。一般ランタイムでは旧テーブル・旧カラムとの後方互換を持たない。旧形式インポートだけは入力変換機能として維持し、保存先は新正本に限定する。

## 変更内容

- `x_identity_requests`と`x_user_account_links`を追加し、X ID申請3テーブルと直接user FKを全件移行する。
- イベント代表者を`event_staff.permission_preset='owner'`へ統一し、owner不在イベントを既存スタッフ昇格または移行専用X名義で補完する。
- `event_staff.approved_by_user_id`を`approved_by_auth_user_id`、`video_members.edit_granted_by_user_id`を`edit_granted_by_auth_user_id`へ値を保持して名称変更する。
- 旧`video_members`を保持した状態で`chapters_json`を`video_chapters`へ展開し、件数・担当X名義・時刻・ラベルを照合してから旧列を削除する。
- YouTube動画IDを`videos.youtube_video_id`へ一本化し、旧メタデータ行数とID一致を検査する。
- 監査設定を`system_settings.audit_*`へ統合する。
- `x_user_account_links`、`software_aliases`、`video_interactions`を確定複合主キーで再作成する。
- 正本に含まれない旧テーブル8件、旧カラム25件、旧名称2件を検査後に削除する。
- `events.max_slots_per_video`はイベント単位の値を保存・照合して維持する。

## 安全な失敗と途中状態

破壊処理前に旧schema version、旧テーブル8件、外部キー、チャプターJSON、YouTube ID、スタッフidentity、software aliasを検査する。適用対象でなければCHECK制約エラーで停止する。

事前検査後は`flamenode_schema_meta`を`2026-07-20-canonical-1-in-progress`にする。旧構造削除後の全検査に合格した場合だけ`2026-07-20-canonical-1`へ更新する。完了済みDBへの再適用と途中状態への再適用はいずれも拒否し、不完全なDBを正常扱いしない。

## データ損失

意図的なデータ損失を含む。ただし、削除対象は確定仕様で廃止された機能だけに限定する。

- X ID申請、X名義とログインユーザーの関係、owner、チャプター、YouTube動画ID、監査設定は新正本へ移行する。
- 外部由来の`video_interactions`は廃止し、FlameNode内反応だけを残す。
- 旧アイコン・YouTubeチャンネル候補履歴は最新有効値をプロフィール正本へ反映後に削除する。
- `legacy_import_batches`と`legacy_import_batch_items`は削除し、旧形式インポートの短期planはR2、claimは`spreadsheet_import_runs`、結果は`audit_logs`へ移す。

## ロールバック

適用後の逆migrationは提供しない。適用前にD1バックアップを取得し、問題発生時は次を同時に戻す。

1. D1を適用前バックアップへ復元する。
2. アプリケーションを0043適用前commitへ戻す。
3. R2へ保存した旧形式インポートのpreview・移行資料を保持する。

`in-progress`を検知した場合も、残存テーブルを手動で正本扱いせず、同じバックアップ復元手順を使用する。

## D1固有対応

- 外部キーを無効化せず`PRAGMA defer_foreign_keys=ON`で遅延検査し、親テーブル再作成時は参照行を退避・復元する。
- D1で禁止される一時テーブルを使わず、migration専用通常テーブルを作成し、完了前に全件削除する。
- D1内部テーブル`d1_migrations`と`_cf_*`を正本テーブル・カラム数から除外する。
- D1で禁止される`integrity_check`の代わりにmigration内は`quick_check`を使い、CIのNode SQLite検査で完全な`integrity_check`を補完する。
- D1ローカル実行で複合SELECT上限を超えないよう、移行元一覧と削除カラム一覧はステージング表への分割INSERTで構築する。

## 検証

`npm run check:db-schema`、`npm run check:db-migration`、`npm run check:db-d1-empty`、`npm run check:db-d1-legacy`で以下を機械検証する。

- Node SQLiteおよびWranglerローカルD1で、空DBへのactive migration全件適用成功。
- Node SQLiteおよびWranglerローカルD1で、旧データfixtureへの適用成功。
- 41テーブル・409カラム、廃止テーブル8件不存在、削除旧カラム25件不存在、名称変更2件成立。
- X申請4件、account link 2件、イベント3件、動画2件、メンバー2件、YouTube metadata 2件、チャプター2件のfixture移行一致。
- `PRAGMA foreign_key_check`違反0件、D1の`quick_check='ok'`、Node SQLiteの`integrity_check='ok'`、owner不在0件。
- `events.max_slots_per_video`のfixture値`3 / 2 / 4`をイベント単位で維持。
- 不正`chapters_json`は破壊前に失敗し、旧version・旧テーブル・旧カラムを維持。
- 完了済みDBと`in-progress`DBへの再適用を拒否。
