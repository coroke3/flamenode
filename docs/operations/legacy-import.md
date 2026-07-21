# 旧形式インポート運用

> Status: Active
> Last verified: 2026-07-21
> Verified against commit: `33b9b7b6`
> Source of truth: `app/(admin)/admin/import/`, `app/api/admin/import/legacy/`, `src/lib/import/legacy/`

旧JSON・CSV・TSVは、管理者専用の入力境界で新DB正本へ一方向変換します。通常ランタイム、公開API、Workerは旧形式を解釈しません。

## 処理順

1. 管理者が `/admin/import` でファイルと競合方針を選択する。
2. `parse` が入力形式と行位置を保持して解析する。
3. `normalize` がイベント、X名義、owner、作品、メンバー、チャプター、YouTube情報、使用ソフトを新正本DTOへ変換する。`eventinfo.json` の `menberpost` と、`video_new.json` の `memberchapter` もこの境界で解釈する。
4. 動画行に正規カラムへ対応しない非空項目があれば、既定では警告付きで無視してプレビューを続行する。カスタム質問へ保存したい列だけ、任意で質問文Qを指定して再プレビューする。
5. `preflight` が件数上限、参照整合性、owner、重複YouTube ID、質問・回答のevent整合、手動作成データの保護をread-onlyで検査する。
6. preview内容と項目判断をR2へ署名付きで固定し、同じ計画だけをapplyする。apply時にファイルや項目判断を再解釈しない。
7. applyはR2の継続カーソルに沿い、system_user → X名義群 → ソフト群 → イベント1件 → カスタム質問群 → 作品1件の原子単位で進める。各ステップは監査付きD1 batchで新正本へ保存し、同一batch内の変更とauditはいずれかが失敗するとまとめてrollbackする。大量作品でもD1呼出上限内に収まるよう複数リクエストへ分割し、途中失敗後は同じpreview tokenから再開できる。

## 保存先

- イベント公開状態は `private` / `public` のみ。
- 作品状態は `pending` / `public` / `private` / `voided` のみ。
- ownerは `event_staff.permission_preset = owner`。
- X名義と認証ユーザーの関連は `x_user_account_links`。Discord未連携のX名義には、インポート時にプレースホルダー認証ユーザー（`discord_id` なし）と owner リンクを作成する。
- YouTube動画IDは `videos.youtube_video_id`。
- チャプターは `video_chapters`。
- 旧動画項目から作る質問は `event_custom_questions`、回答は `video_custom_answers`。質問は任意回答の `textarea`、管理・審査向けの `review` とし、元項目名と管理者が指定した質問文Qをplanへ固定する。

`memberchapter` は全時刻を `video_chapters` へ保存し、`member` / `memberid` と先頭から同じ位置で人物へ関連付ける。件数が一致しない後半は足りない側を空欄のまま保持して警告し、対応する時刻がない人物についてはチャプター行を作らない。

カスタム質問は既存分を含めイベントごとに18件まで、回答は複数イベントへの複製を含め作品ごとに4件まで、質問文Qは120文字、回答は1,000文字までとする。既存の同一質問は決定IDと定義が完全一致する場合だけ再利用する。手動作成された質問・回答は上書きしない。

`chapters_json`、`x_users.linked_user_id`、旧X ID申請テーブル、旧YouTube ID列、旧状態へは書き込みません。

## 競合方針

既存ID競合は停止、スキップ、旧形式インポート由来行だけ置換のいずれかを明示します。`replace_imported`でも手動作成データは上書きしません。

## 失敗時

入力エラーは行番号と理由を返します。正規カラムへ対応しない動画項目は、既定では警告付きで無視してpreviewを続行します。カスタム質問へ割り当てたい列は質問文Qを指定して再previewします。各イベント・作品のD1 batchは監査対象を含めて原子的ですが、現行route全体は複数batchで処理するため、import全体のall-or-nothingを保証するものではありません。失敗結果を確認して再previewし、`replace_imported`でも旧形式インポート由来と証明できる行だけを再処理します。D1 migration自体のロールバックは、適用前バックアップと対応するアプリケーションを同時復元します。

## 検証

```sh
npm run typecheck
npm run test:unit
npm run test:integration
npm run check:db-legacy
npm run check:docs
```
