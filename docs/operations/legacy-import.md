# 旧形式インポート運用

> Status: Active
> Last verified: 2026-07-20
> Verified against commit: `4789dc6`
> Source of truth: `src/lib/import/legacy/`

## 目的

保管済みの旧JSON / CSV / TSVを、旧DB構造や旧状態を復活させず、現在の41テーブル・409カラムの正本へ一方向変換する。これは通常ランタイムの後方互換ではなく、管理者だけが必要時に使用する移行入力境界である。

## 入口

- 管理画面: `/admin/import`
- API: `/api/admin/import/legacy`
- 実装: `src/lib/import/legacy/`
- 対応形式: JSON、CSV、TSV
- 保存先: `events`、`event_staff`、`x_users`、`x_user_account_links`、`videos`、`video_events`、`video_members`、`video_chapters`、`video_youtube_metadata`、`software_catalog`、`video_softwares`などの新正本

一般利用者向け画面、公開API、Workerでは旧形式を解釈しない。旧DTO出力、旧列fallback、dual-read、dual-writeは提供しない。

## 実行手順

1. 0043適用済みで、`npm run check:db-schema`と`npm run check:db-legacy`が成功していることを確認する。
2. Remote D1を操作する前にバックアップを取得する。
3. 管理者として`/admin/import`を開き、入力ファイルを選択する。
4. `create_only`、`skip_existing`、`replace_imported`から競合処理を選ぶ。
5. プレビューを実行し、件数、警告、owner、X名義、YouTube ID、チャプター、使用ソフトを確認する。
6. 同じ利用者・preview token・plan hashでapplyする。
7. 完了後にDB、owner、公開API、監査ログを再検査する。

## 安全条件

- 管理者以外はAPIを利用できない。
- apply単独実行は拒否し、先にpreviewを必須とする。
- preview planはR2へ短期間だけ保存し、利用者、token、SHA-256 hash、期限、claim状態を照合する。
- ファイル数、1ファイル容量、合計容量、行数、保存plan容量に上限を設ける。
- 解釈不能な値、owner不在、X名義重複、YouTube ID重複、D1上限超過は黙って補正せず停止する。
- `replace_imported`は過去に同機能で作成したイベント・作品だけを置換対象とし、手動作成データを上書きしない。
- イベント単位・作品単位のmutationと監査ログを同じ原子的処理で確定する。
- 失敗したpreview claimは解放し、部分成功を成功として返さない。

## 状態変換

イベントの保存値は`private` / `public`へ正規化する。作品は`pending` / `public` / `private` / `voided`へ正規化し、分類不能な値は拒否する。YouTube限定公開はFlameNode内の公開状態と分離する。

## 正本への保存

- owner: `event_staff.permission_preset='owner'`
- X名義と認証ユーザー: `x_user_account_links`
- YouTube動画ID: `videos.youtube_video_id`
- チャプター: `video_chapters`
- 使用ソフト: `software_catalog`と`video_softwares`
- 監査: `audit_logs`

`chapters_json`、`x_users.linked_user_id`、旧X ID申請表、`video_youtube_metadata.youtube_video_id`、旧インポートbatch表へは書き込まない。

## 検証

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
node --test src/lib/import/legacy/canonicalImport.test.mjs
npm run check:db-schema
npm run check:db-legacy
npm run check:event-owners
npm run check:public-api-leaks
npm run check:docs
```

空DBと既存データ入りDBの双方でpreview・apply・監査・ロールバック拒否条件を確認する。Remote D1への実データ投入は、バックアップとプレビューの確認後に限る。
