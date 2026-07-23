# X ID申請とアカウントリンク

> Status: Active
> Last verified: 2026-07-23
> Source of truth: `src/lib/actions/xid.ts`, `src/lib/actions/xid-admin.ts`, `src/lib/actions/xid-merge-admin.ts`, `src/lib/auth/xIdentity.ts`, `src/lib/notifications/enqueue.ts`, `src/lib/utils/xid.ts`

X ID申請は `x_identity_requests`、X名義とAuth.jsユーザーの関係は `x_user_account_links` を唯一の正本とする。

## 申請種類

一般ユーザーの連携画面は、初回・2件目以降とも「X IDを連携」の1フローだけを提供する。入力されたX IDが登録済みかどうかはサーバー側で判定し、内部の`new_link`または`existing_link`へ変換する。判定は`resolveCanonicalXUserId`（alias・imported・approvedを含む）と大文字小文字無視の存在確認を用いる。別名申請は新規作成せず、既存データの管理処理だけを維持する。統合申請は設定画面で、承認済みの自分のX ID同士を選択して行う。

`new_link`申請のあとでimport等により同じX名義が先に存在した場合、運営承認は再申請を要求せず**既存連携として承認**する。`new_link`と`existing_link`は重複判定上同じ連携申請として扱い、同一認証ユーザー・同一X IDのpendingがあれば新しい行を作らず既存申請を成功結果として再利用する。承認時に残っていた同条件の古いpendingだけを`cancelled`へ整理する。

| request_type | 用途 | 必須項目 |
| --- | --- | --- |
| `new_link` | 未登録X IDを新規作成して紐付ける | `requested_x_id` |
| `existing_link` | 既存X名義へ認証ユーザーを追加する | `requested_x_id` |
| `alias` | 既存申請の互換・管理処理のみ（一般ユーザーから新規申請しない） | `requested_x_id`, `target_x_user_id` |
| `merge` | 2つのX名義を統合する | `source_x_user_id`, `target_x_user_id` |
| `revert_merge` | 統合を期限内に差し戻す | `parent_request_id`, `restore_snapshot_json`, `revert_deadline_at` |

申請日時は常に `requested_at` を使用する。X名義行には申請日時を保持しない。

申請者本人は設定画面の「申請履歴」と、申請済みの場合の初回連携画面から、自分が申請した連携・統合申請の対象、種別、全状態、申請日時、処理後の最終更新日時を直近50件まで確認できる。取得条件はログイン中の`requested_by_auth_user_id`に限定し、認証ユーザーID、親申請ID、復元JSON、差し戻し期限は画面へ渡さない。pending の連携・統合・別名申請は本人が「取り下げる」で`cancelled`にできる。

一般ユーザーと運営のServer Actionは、認証・D1 binding・権限取得の通常障害を画面表示用の失敗結果へ変換する。`redirect`、`notFound`などNext.jsの制御例外だけは`unstable_rethrow`で維持し、遷移を通常エラーとして握りつぶさない。D1 batch成功後の`revalidatePath`などpost-commit処理は`runPostCommitBestEffort`でbest-effort実行し、失敗してもmutation成功結果を失敗へ戻さない。申請・承認・拒否・取り下げのDB変更、監査ログ、通知outboxはD1 batchで不可分にし、対象行の状態を`pending`に限定したCASで競合時にfail closedとする。通知builderはasync関数からDrizzleのthenableを直接返さず、未実行statementをenvelopeに入れて返す。競合・一時障害時は正本状態を読み直し、未反映の場合だけ1回再試行する。

X IDは入力時の大文字・小文字を区別せず、`@`と前後空白を除去したうえで常に小文字へ正規化して保存・比較する。

## アカウントリンク

- 1つのX名義へ複数の認証ユーザーを紐付けられる。
- 同じ `(x_user_id, auth_user_id)` は複合主キーにより1件だけ保存する。
- 承認時に `link_role`, `created_by_request_id`, `created_at`, `updated_at` を保存する。
- アクティブX ID、プロフィール編集、イベント・作品権限は共通ヘルパーを通じてリンク表から解決する。
- 連携解除はリンク行だけを削除し、X名義自体や他の認証ユーザーのリンクは変更しない。

## 公開境界

公開API・公開画面へ認証ユーザーID、`created_by_request_id`、親申請ID、復元JSON、差し戻し期限を出さない。公開DTOはホワイトリストで構築し、禁止キー検査を通す。
