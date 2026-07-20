# 0044_simplify_visibility_statuses.sql

> Status: Active
> Last verified: 2026-07-20
> Implementation: PR #88
> Depends on: PR #89 / `0043_db_canonical_migration.sql`
> Parent synchronization: CI開始時に`agent/db-canonical-migration-v2`の最新headを取り込む
> Compatibility: 旧状態を一括変換し、旧default由来の`draft`だけを即時正規化する。その他の旧状態の新規書き込みは拒否する。
> Source of truth: `migrations/0044_simplify_visibility_statuses.sql`, `src/lib/db/schema.canonical.ts`, `src/lib/constants/collaborator-permissions.ts`, `src/lib/utils/eventStatusCore.ts`

## 目的

作品とイベントで重複していた下書き・アーカイブ・限定公開の意味を整理し、FlameNode上の公開状態とYouTube上の公開区分を分離します。

この変更は、41テーブル・409カラムの修正後DB正本への移行が完了した後に適用します。DB正本のテーブル・カラム削除や名称変更は本migrationでは行いません。

## 正本

- 作品のアプリ運用状態: `pending / public / private / voided`
- イベントの保存公開状態: `private / public`
- イベントの開始前・開催中・終了済み、および募集前・募集中・募集終了は日時から算出
- YouTube限定公開: `video_youtube_metadata.youtube_privacy_status = unlisted`
- YouTube動画IDの唯一の正本: `videos.youtube_video_id`

## 変更内容

- 旧作品`limited`は`public`へ移し、YouTube公開区分を`unlisted`として保持します。
- 旧作品`draft / archived / hidden`は原則`private`へ移します。
- `archived`を`private`へ移すことで既存の部分一意制約に抵触する行だけ、監査記録を作成して`voided`へ振り分けます。
- 重複行の`videos.youtube_video_id`は解除しません。正本IDと既存の部分一意制約を維持します。
- 旧イベント`draft`は`private`、`archived`は`public`へ移します。
- 旧物理defaultから入る`draft`だけをINSERT後に正規化します。
- `limited / archived / hidden`などの旧状態を新規INSERT・UPDATEする処理はDB triggerで拒否します。
- migration末尾で旧状態が0件であることを検証し、残存時は明示的に失敗します。

## 正本担当実装との接続

- イベント作成は`x_user_account_links`からowner X名義を解決し、イベントとownerを同じ監査mutationで登録します。
- イベントの非公開化は`visibility_status = private`へ更新し、廃止済み`archived`を書き込みません。
- テンプレートと管理編集画面から廃止済み`max_consecutive_slots_per_entry`を除去し、`events.max_slots_per_video`を維持します。
- 枠の部判定・公開表示では`slots.slot_kind`と優先再取得列を使用しません。
- 共通枠型はDB正本列を意味のある値として扱い、部分SELECTを許容するUI境界だけを任意項目にします。
- YouTube重複判定は現行状態では`voided`だけを対象外とし、IDの正本を`videos.youtube_video_id`へ維持します。

## 親PR同期

PR #88はPR #89をbaseとするスタックPRです。PR #89の更新で古いruntimeが残らないよう、PR #88のCIは検査開始前に`agent/db-canonical-migration-v2`の最新headをマージします。

- 親側の非競合変更はそのまま取り込む
- 状態整理と競合するファイルはPR #88側を優先する
- 同期コミットではCIワークフローを親版へ戻し、一時同期処理を最終差分へ残さない
- 同期後の作業ツリーに対して型検査、全テスト、Next.js/Pages build、DB・公開API・文書検査を実行する

## 適用前条件

- `0043_db_canonical_migration.sql`が完了していること。
- `x_user_account_links`が存在すること。
- `video_youtube_metadata.youtube_video_id`が削除済みであること。
- `events.representative_x_user_id`が削除済みであること。

条件を満たさないDBでは、データ更新前のguardで失敗します。

## データ損失

作品・イベント行、YouTube動画IDは削除しません。状態変更と、必要な重複`archived`行へのモデレーション記録だけを行います。

## ロールバック

状態の意味が変わるため完全自動ロールバックは行いません。適用前のD1バックアップから復元してください。

## 検証

- `npm run check:db-schema`
- `npm run check:db-history`
- `npm run typecheck`
- `npm run test:unit`
- `npm run test:workers`
- `npm run test:integration`
- 正本移行前DBへの誤適用がデータ更新前に失敗すること
- 旧状態変換、YouTube限定公開分離、部分一意制約維持、監査付き重複振り分け、triggerによる再流入防止をSQLite integration testで確認すること
