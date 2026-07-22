# 旧形式インポート運用

> Status: Active
> Last verified: 2026-07-23
> Verified against commit: `823e9561`
> Source of truth: `app/(admin)/admin/import/`, `app/api/admin/import/legacy/`, `src/lib/import/legacy/`

旧JSON・CSV・TSVは、管理者専用の入力境界で新DB正本へ一方向変換します。通常ランタイム、公開API、Workerは旧形式を解釈しません。

## 処理順

1. 管理者が `/admin/import` でファイルと競合方針を選択する。
2. `parse` が入力形式と行位置を保持して解析し、ファイルごとの開始・終了位置（1始まり、終了を含む）を適用する。空欄は先頭・末尾を意味する。選択範囲と元ファイル上の行位置はpreviewへ明示する。
3. `normalize` がイベント、X名義、owner、作品、メンバー、チャプター、YouTube情報、使用ソフトを新正本DTOへ変換する。`eventinfo.json` の `menberpost` と、`video_new.json` の `memberchapter` もこの境界で解釈する。動画ファイルのみでも、参照 `eventid` からイベントを自動作成する（owner付き）。
4. 動画行に正規カラムへ対応しない非空項目があれば、既定では警告付きで無視してプレビューを続行する。カスタム質問へ保存したい列だけ、任意で質問文Qを指定して再プレビューする。
5. `preflight` が件数上限、参照整合性、owner、重複YouTube ID、質問・回答のevent整合、手動作成データの保護をread-onlyで検査する。
6. preview内容と項目判断をR2へ署名付きで固定し、同じ計画だけをapplyする。apply時にファイルや項目判断を再解釈しない。各applyステップの直前に `legacyImportCpuBudgetErrors` でplanを再検査し、超過時はclaimを解放して `requires_repreview: true` を返す。
7. applyはR2の継続カーソルに沿い、system_user → X名義群 → ソフト群 → イベント1件 → カスタム質問群 → 作品1件の原子単位で進める。各ステップは監査付きD1 batchで新正本へ保存し、同一batch内の変更とauditはいずれかが失敗するとまとめてrollbackする。Cloudflare Workersのsubrequest/CPU上限を入力件数に連動して消費しないよう、1 HTTP リクエストでは原子ステップを1件だけ確定する（無料枠のCPU約10ms・内部subrequest上限を守るため、複数原子ステップを1リクエストへ詰めない）。途中失敗後は同じpreview tokenから再開できる。応答断で残ったR2 claimは1分で失効し、preview plan の最大存続時間は6時間。
8. 旧形式インポート中はYouTube APIを呼ばない。YouTube IDがある作品には同期状態 `pending` だけを同一D1 batchで保存し、後続のsync-jobs cronが割当quota内で少しずつ取得する。

## 保存先

- イベント公開状態は `private` / `public` のみ。
- 作品状態は `pending` / `public` / `private` / `voided` のみ。
- ownerは `event_staff.permission_preset = owner`。
- X名義と認証ユーザーの関連は `x_user_account_links`。Discord未連携のX名義には認証ユーザー（空の `discord_id`）を作らない。X名義（`x_users`）と `event_staff` owner だけを正本とし、Discordログイン後の連携申請で紐付ける。
- `/admin/users` の Discord タブは `discord_id IS NOT NULL` の認証ユーザーだけを表示する。過去に作られた `usr_imp_*` プレースホルダーは X ID タブ側で確認する。

## 過去プレースホルダーの掃除（任意・明示実行）

過去の import で作られた空 `discord_id` 認証ユーザー（ID が `usr_imp_` + 8桁hex）が残っている場合、一覧には出ないが DB には残る。Remote D1 の変更は運用者が対象を確認して明示実行する。先に件数確認だけ行う。

```sql
-- 件数確認（read-only）
SELECT COUNT(*) AS placeholder_users
FROM "user"
WHERE discord_id IS NULL
  AND id GLOB 'usr_imp_[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
  AND id != 'system_legacy_import';

SELECT COUNT(*) AS placeholder_links
FROM x_user_account_links
WHERE auth_user_id GLOB 'usr_imp_[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]';
```

RESTRICT 参照（`videos.submitted_by_user_id` など）が無いことを確認してから、リンク削除 → `active_x_user_id` 解除 → user 削除の順で実施する。`system_legacy_import` は技術用 principal のため削除しない。
- YouTube動画IDは `videos.youtube_video_id`。
- チャプターは `video_chapters`。
- 旧動画項目から作る質問は `event_custom_questions`、回答は `video_custom_answers`。質問は任意回答の `textarea`、管理・審査向けの `review` とし、元項目名と管理者が指定した質問文Qをplanへ固定する。

`memberchapter` は全時刻を `video_chapters` へ保存し、`member` / `memberid` と先頭から同じ位置で人物へ関連付ける。件数が一致しない後半は足りない側を空欄のまま保持して警告し、対応する時刻がない人物についてはチャプター行を作らない。

カスタム質問は既存分を含めイベントごとに18件まで、回答は複数イベントへの複製を含め作品ごとに4件まで、質問文Qは120文字、回答は1,000文字までとする。既存の同一質問は決定IDと定義が完全一致する場合だけ再利用する。手動作成された質問・回答は上書きしない。

`chapters_json`、`x_users.linked_user_id`、旧X ID申請テーブル、旧YouTube ID列、旧状態へは書き込みません。

## 競合方針

既存ID競合は停止、スキップ、旧形式インポート由来行だけ置換のいずれかを明示します。`replace_imported`でも手動作成データは上書きしません。

## 運用目安

- 1回の選択範囲の合計上限は250行、1ファイル2MB、合計4MBとする。大きなJSONは「1〜250」「251〜500」のように重ならない範囲で複数回preview/applyするか、2MB以下へ物理分割する。物理的に分割した複数ファイルも同じ画面へ追加できる。管理画面はファイル追加時に行数を推定し、250行超（または選択したチャンクサイズ超）の場合は `suggestLegacyImportRowRanges(total, chunkSize)` で提案した範囲をワンクリック入力できる。チャンクサイズは 50 / 100 / 150 / 250 から選べる（提案の刻みのみ。開始・終了の手入力は常に可能）。小さいチャンクほど preview plan が軽く、Workers 無料枠の CPU に有利。複数チャンクがあるファイルでは「次のチャンクを入力」と完了バッジで順次進め、apply 完了後は次範囲の案内を表示する（preview/apply の自動連鎖はしない）。
- 「複数ずつ」は (1) 行をチャンクサイズでまとめて1 preview に載せる、(2) 軽いエンティティは1原子ステップ内で既に複数件（X名義40・ソフト40・質問6）扱う、の二通り。作品・イベントの原子ステップは無料枠のため 1 HTTP = 1件のまま。
- 分割取込では既定の `skip_existing` を使い、各範囲のapply完了を確認してから次をpreviewする。同じ行を重ねて指定しても動画IDは決定的だが、重複範囲を処理済みと誤認しないよう、運用記録にはファイル名・開始・終了・plan hashを残す。
- preview は正規化後planをR2へ固定する。applyごとのJSON parse/hash/CASをCloudflare CPU内に収めるため、保存planは512KBをhard capとし、80%超で警告する。イベント・作品1ステップは128KB以内で、作品ごとの所属イベント16、メンバー64、チャプター128、使用ソフト32、イベント運営64件まで。超過時は範囲・ファイルまたは1作品内データを分割する。
- CPU hard cap導入前に作成した旧preview tokenは再開しない。デプロイ後は範囲を指定して新しいpreviewを作り直す。
- apply は作品 1 件 / ステップ、1 HTTP リクエスト / ステップで進む。途中失敗後も監査済みステップを検出して同じ preview token から再開できる。import 全体の all-or-nothing ロールバックはない。各 D1 batch 内だけが原子的。preview plan の最大存続時間は6時間。
- ブラウザは1ステップずつ順次POSTする（並列化しない。claim 競合を避ける）。成功が続くとステップ間隔を 0〜40ms へ適応短縮し、一時エラー時は従来どおり最大4回・約10秒で停止する。1ランの最大ステップ数は 100 / 250 / 500（既定）から選べ、到達時は意図的に一時停止する。「書き込む／再開」で同じcursorから続行できる。R2 claim失効後は手動再開する。sessionStorage で未完了previewをページ再読込後も再開できる。画面にはこのランのステップ数と全体進捗（stage / completed / total）を表示する。
- カスタム質問は未対応列のみ指定できる。`title` や `ylink` など正規カラムへ対応する列は割り当て不可。列と質問文 Q を指定したうえで再プレビューし、plan に含まれた件数を確認してから apply する。

## 枠一括生成（参考）

管理画面の枠一括生成は最大 100 件まで要求できる。D1 の bind / query 上限を守るため、内部では 3 件ずつ原子的に chunk 実行する。`MAX_ATOMIC_SLOT_ROWS` は引き上げない。

## 失敗時

入力エラーは元ファイル基準の行番号と理由を返します。正規カラムへ対応しない動画項目は、既定では警告付きで無視してpreviewを続行します。カスタム質問へ割り当てたい列は質問文Qを指定して再previewします。各イベント・作品のD1 batchは監査対象を含めて原子的ですが、現行route全体は複数batchで処理するため、import全体のall-or-nothingを保証するものではありません。apply中の一時エラー（claim競合・R2一時障害・ネットワーク断など）は短い自動再試行後に停止します。preview credentialは消さず、約1分後に「書き込む／再開」を押してください。ページ再読込後も sessionStorage に保存した credential から未完了 preview を再開できます。決定的エラーは再previewし、`replace_imported`でも旧形式インポート由来と証明できる行だけを再処理します。D1 migration自体のロールバックは、適用前バックアップと対応するアプリケーションを同時復元します。

## 検証

```sh
npm run typecheck
npm run test:unit
npm run test:integration
npm run check:db-legacy
npm run check:docs
```
