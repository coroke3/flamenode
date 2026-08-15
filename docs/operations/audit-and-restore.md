# Audit と Restore

> Status: Active
> Last verified: 2026-07-25
> Verified against commit: `dc46eefa`
> Source of truth: `src/lib/audit/`, `src/lib/event/eventOwnership.ts`, `audit_logs`

**AI:** 監査・復元・owner 保護。正本コードは `src/lib/audit/`。復元実装・owner 変更は上位モデル。

重要mutationは同じD1 batchでbefore取得、本体変更、after取得、監査INSERTを完了する。secret、token、cookie、sessionはsnapshotに保存しない。

復元は保存済みstatusを信用せず、adapter、snapshot、FK、競合、retention、owner不変条件を実行直前に再評価する。`event_staff.permission_preset = 'owner'` が代表者の正本で、最後のowner削除・降格は許可しない。

イベント／作品の監査復元も専用の公開状態遷移として扱う。復元対象の visibility_status が変わる場合は、R2 の公開ブロック manifest と D1 fence を同じ復元処理へ組み込み、静的 JSON の再生成キューと Cache API 無効化を必ず併せて行う。これにより、復元直後に古い公開成果物が再利用されない。
