# 旧形式インポート運用

> Status: Active
> Last verified: 2026-07-20
> Verified against commit: `6be5485`
> Source of truth: `app/(admin)/admin/import/`, `app/api/admin/import/legacy/`, `src/lib/import/legacy/`

旧JSON・CSV・TSVは、管理者専用の入力境界で新DB正本へ一方向変換します。通常ランタイム、公開API、Workerは旧形式を解釈しません。

## 処理順

1. 管理者が `/admin/import` でファイルと競合方針を選択する。
2. `parse` が入力形式と行位置を保持して解析する。
3. `normalize` がイベント、X名義、owner、作品、メンバー、チャプター、YouTube情報、使用ソフトを新正本DTOへ変換する。
4. `preflight` が件数上限、参照整合性、owner、重複YouTube ID、手動作成データの保護を検査する。
5. preview内容を署名付きで固定し、同じ計画だけをapplyする。
6. applyは監査付き原子処理で新正本へ保存する。途中成功は残さない。

## 保存先

- イベント公開状態は `private` / `public` のみ。
- 作品状態は `pending` / `public` / `private` / `voided` のみ。
- ownerは `event_staff.permission_preset = owner`。
- X名義と認証ユーザーの関連は `x_user_account_links`。
- YouTube動画IDは `videos.youtube_video_id`。
- チャプターは `video_chapters`。

`chapters_json`、`x_users.linked_user_id`、旧X ID申請テーブル、旧YouTube ID列、旧状態へは書き込みません。

## 競合方針

既存ID競合は停止、スキップ、旧形式インポート由来行だけ置換のいずれかを明示します。`replace_imported`でも手動作成データは上書きしません。

## 失敗時

入力エラーは行番号と理由を返します。apply失敗時はトランザクションを中断し、監査対象を含めて部分適用を残しません。D1 migration自体のロールバックは、適用前バックアップと対応するアプリケーションを同時復元します。

## 検証

```sh
npm run typecheck
npm run test:unit
npm run test:integration
npm run check:db-legacy
npm run check:docs
```
