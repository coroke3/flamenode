# Auth / Terms / Post-commit 信頼性修正 — 運用メモ

> Status: Active
> Last verified: 2026-07-29
> Source of truth: `src/lib/auth/`, `src/lib/actions/terms.ts`, `src/lib/audit/postCommit.ts`, workers
> Video collaborator permission actions catch D1 binding and preparation failures before mutation and return a UI-facing failure result.

## 変更概要

- Discord OAuth 後は `/auth/complete` を経由してから目的画面へ遷移する
- `/auth/complete` はcallback直後にsession読取が一時的にnull/失敗となる場合だけ短時間自動再試行し、取得済みsession userを使って重複D1照会を行わない
- Auth layout は `getRequestAuthContext` で認証取得を1回に集約する
- 規約同意は scoped CAS + 冪等 Commit → redirect（`revalidatePath` なし）
- Commit 成功後の revalidate / Queue 派生は `runPostCommitBestEffort`
- Notification: Discord 送信成功後の `markSent` 失敗は再送せず lease 回復で `sent` 化
- Static rebuild: R2 成功後の `markDone` 失敗は再生成せず回復
- Legacy import: D1 成功・R2 progress 失敗は `committed_progress_pending`

## Cloudflare 手動確認手順

1. Cookie を削除してログアウト状態にする
2. `/entry` から Discord ログイン
3. callback 後の最初の URL が `/auth/complete?next=...` であること
4. 直後の画面でヘッダーがログイン済みであること（汎用エラーなし）
5. `/rules` で規約同意 → 正常 redirect、再読み込みなしで同意済み
6. consent が同一規約で1件であること（重複 INSERT なし）
7. 同意ボタン連打が安全であること
8. Active X ID 切替が即時反映すること
9. （可能なら）Queue/R2 障害時でも保存成功表示になること

## ロールバック

1. 作業ブランチの PR を merge 済みなら、直前の `main` tip へ revert PR を作成する
2. Remote D1 migration は本変更では追加していないため、DB rollback は不要
3. Worker は notification / json-generator の sentinel `last_error` / `error` 文字列に依存する。旧 Worker へ戻す場合、残存 sentinel 行は lease 回復で `pending` に戻る可能性があるため、必要なら手動で `sent` / `done` へ更新する

## 追補（穴つぶし）

- manage/admin: `enrichmentFailed` 時は誤 `/dashboard` ではなく一時障害扱い
- admin layout: banned を `getLayoutAuthSurface` で弾く
- account summary: 503/`unavailable`、degraded 時に SSR ログイン・権限を潰さない
- moderation 作成フォーム: 失敗を UI 表示
- rules broadcast: terms touch 失敗を `warning` で明示
- admin/slot/user/youtube/permissions/collab/cost-guard/api-endpoints/submitSlotVideo: `unstable_rethrow` + post-commit
- cost-guard: D1成功後の KV 失敗を保存失敗扱いしない
