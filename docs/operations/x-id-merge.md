# X ID統合

> Status: Active
> Last verified: 2026-10-01
> Source of truth: `src/lib/actions/xid-merge-admin.ts`, `src/lib/xid/merge.ts`, `src/lib/xid/mergeSafety.ts`, `src/lib/actions/xidPendingInsert.ts`, `src/lib/auth/xIdentityRequestCore.ts`

X ID統合は、`x_identity_requests.request_type = 'merge'` の申請を `/admin/x-id-merges` で承認し、管理者が確認文字列 `MERGE` を入力した場合だけ実行する。通常のX ID連携承認画面からは実行しない。

## 権限境界

- 利用者は、自分の認証ユーザーに `x_user_account_links` で紐づくX名義同士だけを統合申請できる。
- 管理者は任意の既存X名義同士について統合申請を作成できる。
- 承認・実行・差し戻しはsite admin限定。
- `x_users`の単一所有者列は使用しない。統合時は、統合元の全アカウントリンクを統合先へ移し、同一組合せは複合主キーで統合する。

## 実行内容

統合実行前に、X名義、アカウントリンク、作品、チャプター、メンバー、枠、interaction、event staff、aliasを `restore_snapshot_json` に保存する。各relationは500行、全体は2,000行、UTF-8 JSONは1 MiBで上限を設け、超過時はR2/D1書込み前に拒否する。relation readは順に取得するがsnapshot isolationとはみなさず、実行batch直前に全対象relationのexact before-stateをCAS検証する。

- 作品関連行とevent staffの `x_user_id` を統合先へ付け替える。
- interaction、event staff、aliasの一意制約衝突を解消する。
- 統合元の `x_user_account_links` を統合先へ移す。ownerとmanagerが衝突した場合はownerを維持する。
- 統合元X IDを統合先のaliasとして登録する。
- 統合元の `x_users` 行は削除せず `approval_status = 'rejected'` にする。旧ID文字列は再利用できず、alias解決と期限内差し戻しに使う。
- 完了した申請を `done` にし、復元JSONと差し戻し期限を同じ申請行へ保存する。
- 完了SQLは、統合元の現行参照が残っていないことを同じbatchで確認してから通す。履歴 (`x_identity_requests`) と `alias_x_id` は意図的に旧ID文字列を残す。
- static rebuild target数、D1の実caller read・atomic batch budget、各statementのbind数をR2 visibility pre-commitより先に検査する。Free上限50 queryを超える、target数が100を超える、またはbind数が100を超える統合は副作用なしで拒否する。

## 差し戻し

統合完了後7日間は、利用者が `revert_merge` 申請を作成できる。子申請には次を保存する。

- `parent_request_id`: 元のmerge申請ID
- `revert_deadline_at`: 差し戻し可能期限

復元JSONの唯一の正本は完了済み親merge申請であり、子へ複製しない。同一親のactiveな差し戻し申請は条件付きprepared INSERTで1件に制限する。利用者は `/dashboard/settings` の申請履歴から、完了した統合について期限内に「統合を取り消す申請」を送る。pending の差し戻しは本人が取り下げできる。管理者は期限内のみ確認文字列 `REVERT` で差し戻せる。期限超過、親snapshot欠落、親申請不整合はfail-closedで拒否する。

差し戻しはsnapshot集合をDELETEして再INSERTする方式ではない。統合自身が変更したrow/valueだけを逆操作し、実行直前にmerge直後のexpected after-stateと完全一致することを検査する。統合後のtarget-only account linkやalias等は保持し、統合が触れたstaff権限・link role・公開metadata等が別途変更されていればtransaction全体を競合として中止する。

## 運用上の注意

統合と申請状態更新は監査ログへlong auditとして保存する。外部サービス側の状態は復元対象外なので、重大な統合前にはD1バックアップも確認する。
