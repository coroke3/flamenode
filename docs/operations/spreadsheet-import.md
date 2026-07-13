# Spreadsheet import運用

> Status: Active
> Last verified: 2026-07-13
> Source of truth: `src/lib/admin/spreadsheet/`, `src/lib/db/schema.ts`

## 必須secret

Pages runtimeへ`SPREADSHEET_IMPORT_PREVIEW_SECRET`を32文字以上の独立したランダム値として登録する。`AUTH_SECRET`やlegacy import secretと共用しない。値はGit、ログ、監査snapshot、Issueへ出力しない。

未設定・短すぎる場合、dry-runとapplyは`preview_unavailable`でfail-closedになる。

## preview / apply

- dry-runは実行者、table、mode、canonical payload hash、columns/PK/schema fingerprint、暗号学的nonce、発行・失効時刻をHMAC-SHA256署名する。
- tokenの有効期限は5分。`spreadsheet_import_runs`へnonceを保存する。
- applyは署名と全claimsを再検証し、nonceの条件付き消費、本体mutation、監査を同じD1 batchで実行する。
- tokenは一回限り。期限切れ、別実行者、table/mode/payload/schema変更、二重applyを拒否する。
- D1 query/bind安全枠とnonce guardを含め、1回のapplyは最大14行。previewは最大500行で、分割applyする。

## cleanup

既存`content-jobs` cleanupがconsumedまたはexpired runを1回500件まで削除する。無制限cleanupや常駐Workerは追加しない。

## migration

`0001_spreadsheet_import_runs.sql`は運用者がbackup確認後に手動適用する。Codex、PR CI、runtimeはRemote D1 migrationを行わない。
