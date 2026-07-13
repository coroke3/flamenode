# Audit と Restore

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `c18c9bb`
> Source of truth: `src/lib/audit/`, `src/lib/event/eventOwnership.ts`, `audit_logs`

重要mutationは同じD1 batchでbefore取得、本体変更、after取得、監査INSERTを完了する。secret、token、cookie、sessionはsnapshotに保存しない。

復元は保存済みstatusを信用せず、adapter、snapshot、FK、競合、retention、owner不変条件を実行直前に再評価する。`event_staff.permission_preset = 'owner'` が代表者の正本で、最後のowner削除・降格は許可しない。
