# 旧形式インポート運用

> Status: Active
> Last verified: 2026-07-20
> Verified against commit: `275343c2aff1cad301617ad4d018cfbef8507714`
> Source of truth: `app/api/admin/import/legacy/route.ts`, `src/lib/import/legacy/`

旧JSON・CSV・TSVを、新DB正本へ一方向変換する管理者専用の入力境界である。通常ランタイム、公開API、Workerは旧形式を解釈せず、インポート後は新正本だけを読み書きする。

## 不変条件

- 操作できるのは認証済みのサイト管理者だけ。
- 入力は `parse → normalize → preview → preflight → apply` の順で処理する。
- previewのcanonical planはR2へ短期保存し、利用者、plan hash、有効期限、一度限りclaimを固定する。
- apply requestの内容から保存計画を再構築しない。
- `chapters_json`、旧X ID申請表、旧YouTube ID列などの廃止構造へ書き戻さない。
- 手動作成データは `replace_imported` でも上書きしない。
- 一般画面や公開APIへ旧形式パーサーを流用しない。

## 入力上限

- 最大20ファイル
- 1ファイル最大5 MB
- 合計最大12 MB
- 1回最大5,000行

入力上限を超えた場合や、必須値、状態値、ID対応を解釈できない場合は行番号付きで停止する。黙った補正や部分的な読み飛ばしは行わない。

## 手順

1. D1のバックアップを取得する。
2. 管理画面の「旧形式インポート」を開く。
3. JSON・CSV・TSVを選択し、イベントと作品の移行後公開状態を指定する。
4. 競合戦略を選択する。
   - `create_only`: 既存IDがあれば停止する。
   - `skip_existing`: 既存IDを変更せずスキップする。
   - `replace_imported`: 旧形式インポート用技術主体が作成した行だけを置換する。
5. previewを実行し、件数、警告、エラー、イベント、作品の変換結果を確認する。
6. preview tokenとplan hashが表示された状態でapplyを実行する。
7. 完了後、監査ログと対象イベント・作品を確認する。

## 失敗時

- preview失敗: 入力を修正して再度previewする。
- token期限切れ、hash不一致、別管理者による操作: 新しいpreviewを作成する。
- apply前preflight失敗: DBは変更されない。競合内容を解消して再度previewする。
- apply中失敗: 応答の再試行可否に従う。`create_only`で部分書込みが疑われる場合は、同じ入力を再previewし、監査ログを確認してから`replace_imported`を使用する。
- 手動作成行との競合: 自動上書きせず、管理画面で対象を確認する。

問題発生時に旧構造を通常ランタイムへ復活させない。必要な復旧はD1バックアップ、R2上のpreview plan、監査ログを使用して行う。

## 検証

変更後は次を実行する。

- `npm run typecheck`
- `npm run test:unit`
- `npm run test:integration`
- `npm run check:db-legacy`
- `npm run check:db-schema`
- `npm run check:docs`
