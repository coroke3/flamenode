# Legacy Import

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `22e5d52`
> Source of truth: `src/lib/import/legacy/`

legacy dataはcanonical shapeへnormalizeしてからvalidate、dry run、署名preview、staging、atomic apply、integrity、enqueue、auditの順に処理する。旧列をruntime fallbackとして保存・二重書込みしない。

## 有効化とsecret

通常は無効。実行時だけ `ENABLE_LEGACY_IMPORT_TOOL=true` と、32文字以上の `LEGACY_IMPORT_PREVIEW_SECRET` をPages secretまたはローカル `.dev.vars` に設定する。secretはGit、ログ、監査snapshot、Issueへ出力しない。preview tokenは短時間で期限切れになり、実行者、入力hash、plan hash、parser/schema versionが一致しないapplyを拒否する。

## Preview staging and lease

- analyze は canonical plan JSON、plan hash、preview expiry を `legacy_import_batches` に固定する。apply request body は保存済み canonical plan と同一 hash でなければ受け付けない。
- apply は `previewed` から条件付き更新で lease を取得した一回だけが実行できる。lease token、expiry、operator、file hash、plan hash が一致しない実行は fail-closed にする。
- preview 時と claim 前に event/video と関係行の version/hash を再照合する。失効 preview / lease は一回最大20件だけ failed として回収し、canonical data や監査履歴を削除しない。
- canonical mutation、event_staff owner 保護、audit、static rebuild queue、batch status の finalize は同じ D1 batch で確定する。D1 batch 上限を超える plan は書き込み前に拒否する。
- previewの表示上限100件とは別に、events、videos、staff、members、relations等のcanonical entityごとにhard capを設ける。parse/normalize後かつDB write前に、bulk IN readとfinalize予約を含むD1 50 query予算を検査し、超過入力は分割を求める。
- version captureとdry runは、entityごとのqueryやPromise並列query列を作らず、上限付きIN集合queryを順次実行する。これはquery call countの静的・fake DB検証であり、実D1統合試験の代替とは扱わない。

## cleanup

import後はbatch状態、警告、auditを確認してから、期限切れpreview・一時ファイル・不要な入力artifactをretentionに従って削除する。import対象の正本データやaudit_logsをcleanup対象にしない。静的JSON artifactの期限切れcleanupは `content-jobs` が制限付きで行う。再実行は新しいpreviewから開始し、使用済みtokenや失敗batchを直接再利用しない。
