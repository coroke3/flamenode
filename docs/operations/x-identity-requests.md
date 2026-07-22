# X ID申請とアカウントリンク

> Status: Active
> Last verified: 2026-07-22
> Source of truth: `src/lib/actions/xid.ts`, `src/lib/actions/xid-admin.ts`, `src/lib/auth/xIdentity.ts`, `src/lib/utils/xid.ts`

X ID申請は `x_identity_requests`、X名義とAuth.jsユーザーの関係は `x_user_account_links` を唯一の正本とする。

## 申請種類

一般ユーザーの連携画面は、初回・2件目以降とも「X IDを連携」の1フローだけを提供する。入力されたX IDが登録済みかどうかはサーバー側で判定し、内部の`new_link`または`existing_link`へ変換する。判定は`resolveCanonicalXUserId`（alias・imported・approvedを含む）と大文字小文字無視の存在確認を用いる。別名申請は新規作成せず、既存データの管理処理だけを維持する。統合申請は設定画面で、承認済みの自分のX ID同士を選択して行う。

`new_link`申請のあとでimport等により同じX名義が先に存在した場合、運営承認は再申請を要求せず**既存連携として承認**する。同一認証ユーザー・同一X IDの他のpending連携申請は、新規申請時および承認時に`cancelled`へ整理する。

| request_type | 用途 | 必須項目 |
| --- | --- | --- |
| `new_link` | 未登録X IDを新規作成して紐付ける | `requested_x_id` |
| `existing_link` | 既存X名義へ認証ユーザーを追加する | `requested_x_id` |
| `alias` | 既存申請の互換・管理処理のみ（一般ユーザーから新規申請しない） | `requested_x_id`, `target_x_user_id` |
| `merge` | 2つのX名義を統合する | `source_x_user_id`, `target_x_user_id` |
| `revert_merge` | 統合を期限内に差し戻す | `parent_request_id`, `restore_snapshot_json`, `revert_deadline_at` |

申請日時は常に `requested_at` を使用する。X名義行には申請日時を保持しない。

申請者本人は設定画面の「申請履歴」と、申請済みの場合の初回連携画面から、自分が申請した連携・統合申請の対象、種別、状態、申請日時を直近50件まで確認できる。取得条件はログイン中の`requested_by_auth_user_id`に限定し、認証ユーザーID、親申請ID、復元JSON、差し戻し期限は画面へ渡さない。

X IDは入力時の大文字・小文字を区別せず、`@`と前後空白を除去したうえで常に小文字へ正規化して保存・比較する。

## アカウントリンク

- 1つのX名義へ複数の認証ユーザーを紐付けられる。
- 同じ `(x_user_id, auth_user_id)` は複合主キーにより1件だけ保存する。
- 承認時に `link_role`, `created_by_request_id`, `created_at`, `updated_at` を保存する。
- アクティブX ID、プロフィール編集、イベント・作品権限は共通ヘルパーを通じてリンク表から解決する。
- 連携解除はリンク行だけを削除し、X名義自体や他の認証ユーザーのリンクは変更しない。

## 公開境界

公開API・公開画面へ認証ユーザーID、`created_by_request_id`、親申請ID、復元JSON、差し戻し期限を出さない。公開DTOはホワイトリストで構築し、禁止キー検査を通す。
