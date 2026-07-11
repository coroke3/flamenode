# X ID統合

> Status: Active
> Last verified: 2026-07-11
> Source of truth: `src/lib/actions/merge-admin.ts`, `src/lib/actions/xid-merge-admin.ts`, `src/lib/event/eventOwnershipCore.ts`

X ID統合は `/admin/x-id-merges` の申請・承認・`MERGE`確認を経由する管理者操作だけで実行する。`x_account_link_requests`の通常承認からは実行しない。

統合はD1 batchで、重複interaction・icon・aliasを解消し、作品・チャプター・メンバー・slot・staffのX IDを付け替え、旧IDをaliasとして残す。同一イベントのstaff主体が衝突し、旧側がownerなら、対象staffをownerへ昇格してから旧行を削除する。すべての書込みとMERGE監査は同じbatchで確定し、競合時は全体をrollbackする。

統合監査は影響件数と`event_staff`の完全before/after snapshotをlong auditに保存する。複数テーブルにまたがる統合は自動restore対象ではないため、実行前にdry-runとバックアップを確認する。
