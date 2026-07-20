# X ID統合

> Status: Active
> Last verified: 2026-07-20
> Source of truth: `src/lib/actions/xid-merge-admin.ts`, `src/lib/xid/merge.ts`, `src/lib/auth/xIdentityRequestCore.ts`

X ID統合は、`x_identity_requests.request_type = 'merge'` の申請を `/admin/x-id-merges` で承認し、管理者が確認文字列 `MERGE` を入力した場合だけ実行する。通常のX ID連携承認画面からは実行しない。

## 権限境界

- 利用者は、自分の認証ユーザーに `x_user_account_links` で紐づくX名義同士だけを統合申請できる。
- 管理者は任意の既存X名義同士について統合申請を作成できる。
- 承認・実行・差し戻しはsite admin限定。
- `x_users`の単一所有者列は使用しない。統合時は、統合元の全アカウントリンクを統合先へ移し、同一組合せは複合主キーで統合する。

## 実行内容

統合実行前に、X名義、アカウントリンク、作品、チャプター、メンバー、枠、interaction、event staff、aliasを `restore_snapshot_json` に保存する。統合後は次を行う。

- 作品関連行とevent staffの `x_user_id` を統合先へ付け替える。
- interaction、event staff、aliasの一意制約衝突を解消する。
- 統合元の `x_user_account_links` を統合先へ移す。ownerとmanagerが衝突した場合はownerを維持する。
- 統合元X IDを統合先のaliasとして登録する。
- 完了した申請を `done` にし、復元JSONと差し戻し期限を同じ申請行へ保存する。

## 差し戻し

統合完了後7日間は、利用者が `revert_merge` 申請を作成できる。申請には次を保存する。

- `parent_request_id`: 元のmerge申請ID
- `restore_snapshot_json`: merge実行前の復元情報
- `revert_deadline_at`: 差し戻し可能期限

管理者は期限内のみ確認文字列 `REVERT` で差し戻せる。期限超過、復元JSON欠落、親申請不整合はfail-closedで拒否する。

## 運用上の注意

統合と申請状態更新は監査ログへlong auditとして保存する。外部サービス側の状態は復元対象外なので、重大な統合前にはD1バックアップも確認する。
