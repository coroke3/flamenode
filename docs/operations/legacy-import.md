# Legacy Import

> Status: Active
> Last verified: 2026-07-11
> Verified against commit: `5f48e0f` + working tree
> Source of truth: `src/lib/import/legacy/`

legacy dataはcanonical shapeへnormalizeしてからvalidate、dry run、署名preview、staging、atomic apply、integrity、enqueue、auditの順に処理する。旧列をruntime fallbackとして保存・二重書込みしない。

## 有効化とsecret

通常は無効。実行時だけ `ENABLE_LEGACY_IMPORT_TOOL=true` と、32文字以上の `LEGACY_IMPORT_PREVIEW_SECRET` をPages secretまたはローカル `.dev.vars` に設定する。secretはGit、ログ、監査snapshot、Issueへ出力しない。preview tokenは短時間で期限切れになり、実行者、入力hash、plan hash、parser/schema versionが一致しないapplyを拒否する。

## cleanup

import後はbatch状態、警告、auditを確認してから、期限切れpreview・一時ファイル・不要な入力artifactをretentionに従って削除する。import対象の正本データやaudit_logsをcleanup対象にしない。静的JSON artifactの期限切れcleanupは `content-jobs` が制限付きで行う。再実行は新しいpreviewから開始し、使用済みtokenや失敗batchを直接再利用しない。
