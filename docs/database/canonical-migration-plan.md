# FlameNode DB正本移行仕様

> Status: Active
> Canonical schema: 41 tables / 409 columns
> Canonical schema version: `2026-07-20-canonical-1`

## 1. 方針

FlameNodeは本格運用前のため、旧DB構造、旧API、旧状態値に対するランタイム後方互換を提供しない。

通常ランタイム、公開API、Workerは後方互換を持たず、新正本だけを読み書きする。旧JSON・CSV・TSVが必要な場合は、管理者専用インポート境界で `parse → normalize → preview → apply` を行い、新正本へ一方向変換する。旧形式の型・列・状態を専用境界の外へ出さず、旧構造への二重書き込みを行わない。

## 適用対象と事前条件

`0043_db_canonical_migration.sql`は、`flamenode_schema_meta.version='2026-07-11-baseline-1'`で、廃止予定8テーブルがすべて存在し、canonical新規テーブルや`*_new`途中テーブルが存在しないDBだけを受け付ける。

破壊処理より前に次を検査し、満たさない場合はCHECK制約名を含むエラーで停止する。

- 旧DBの外部キー違反が0件。
- `video_members.chapters_json`が有効なJSON配列。
- `videos.youtube_video_id`と旧メタデータの動画IDに不一致・有効作品間重複がない。
- canonical化後の`event_staff(event_id, x_user_id)`が重複しない。
- `software_aliases.normalized_alias`が複数softwareへ重複しない。

事前検査後にschema versionを`2026-07-20-canonical-1-in-progress`へ更新する。再適用や途中状態は事前条件を満たさないため、正常な正本として扱わず明示的に停止する。

## 移行順序

1. 事前条件・旧データ整合性を検査し、移行元件数と`events.max_slots_per_video`を一時保存する。
2. `x_identity_requests`と`x_user_account_links`を作成し、旧X申請3テーブルと直接userリンクをバックフィルする。
3. Xプロフィール候補、イベント、owner、作品、YouTube動画IDをcanonical構造へ移す。
4. 旧`video_members`を残したまま`video_chapters_new`へJSONチャプターを展開し、件数・時刻・担当X名義を照合する。
5. 監査設定と複合主キー対象テーブルを再作成する。
6. 移行元・移行先件数、名称変更値、owner、外部キーを検査してから旧テーブル8件を削除する。
7. 41テーブル・409カラム、旧カラム25件不存在、名称変更2件、`quick_check`/FKを検査する。
8. 全検査合格後だけschema versionを`2026-07-20-canonical-1`へ確定する。

## 不変条件

- `events.max_slots_per_video`を削除せず、イベント単位で値を完全一致させる。
- 各イベントに`permission_preset='owner'`が1人以上必要。
- YouTube動画IDは`videos.youtube_video_id`のみを正本とする。
- X名義と認証ユーザーの関係は`x_user_account_links`のみを正本とする。
- チャプターは`video_chapters`のみを正本とし、時刻昇順で表示する。
- スタッフ権限は`permission_preset`、公開肩書は`public_role_label`を使用する。
- `x_user_account_links(x_user_id, auth_user_id)`、`software_aliases(software_id, normalized_alias)`、`video_interactions(x_user_id, video_id, interaction_type)`を複合主キーとする。

## D1適用方式

D1では`PRAGMA foreign_keys=OFF`と一時テーブル作成を使用できないため、`PRAGMA defer_foreign_keys=ON`とmigration専用の通常テーブルを使用する。親テーブル再作成時は参照行を退避・復元し、すべてのmigration専用テーブルを最終検査前後に削除する。D1内部の`d1_migrations`と`_cf_*`は41テーブル・409カラムの集計対象外とする。

D1が禁止する`PRAGMA integrity_check`はmigration内で実行せず、D1で許可される`PRAGMA quick_check`を使用する。完全な`integrity_check`はNode SQLite側のCI検査で実行する。

## 機械検証

`npm run check:db-migration`、`npm run check:db-d1-empty`、`npm run check:db-d1-legacy`で次を検証する。

- Node SQLiteとWranglerローカルD1の両方で、空DBへactive migration全件を適用できる。
- Node SQLiteとWranglerローカルD1の両方で、旧申請・直接userリンク・owner不在・JSONチャプター・監査設定・YouTube IDを含むfixtureを移行できる。
- 移行後が41テーブル・409カラムで、旧テーブル8件・旧カラム25件・旧名称2件を含まない。
- 外部キー違反とowner不在が0件で、移行元件数・`max_slots_per_video`・名称変更値が一致する。
- 不正JSONでは破壊前に失敗し、旧schema versionと旧構造を維持する。
- 完了済みDBへの再適用と`in-progress`途中状態を拒否する。

## ロールバック

逆migrationは提供しない。適用前のD1バックアップと0043適用前アプリケーションを同時に復元する。`in-progress`を検知した場合も、残存構造へ追加操作せず同じ手順で復元する。

## 2. 確定値

- 旧入力形式の解析・正規化は維持する。
- previewは短期nonceとplan hashで保護する。
- canonical plan本体はR2に短期保存する。
- applyは新正本テーブルだけへ書き込む。
- 適用結果・不一致・警告は`audit_logs`に残す。
- `legacy_import_batches`と`legacy_import_batch_items`は使用しない。
