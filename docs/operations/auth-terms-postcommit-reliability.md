# Auth / Terms / Post-commit 信頼性修正 — 運用メモ

> Status: Active
> Last verified: 2026-10-04
> Source of truth: `src/lib/auth/currentUser.ts`, `src/lib/auth/`, `src/lib/actions/terms.ts`, `src/lib/audit/postCommit.ts`, workers
> Video collaborator permission actions catch D1 binding and preparation failures before mutation and return a UI-facing failure result.

## 変更概要

- Discord OAuth 後は `/auth/complete` を経由してから目的画面へ遷移する
- Auth.js error loggerはerror typeだけを記録し、D1 bind値を含み得るmessage/stackは出力しない
- `/auth/complete` はcallback直後にsession読取が一時的にnull/失敗となる場合だけ短時間自動再試行し、取得済みsession userを使って重複D1照会を行わない
- Auth layout は `getRequestAuthContext` で認証取得を1回に集約する
- 規約同意は scoped CAS + 冪等 Commit → redirect（`revalidatePath` なし）
- Commit 成功後の revalidate / Queue 派生は `runPostCommitBestEffort`
- Notification: Discord 送信成功後の `markSent` 失敗は再送せず lease 回復で `sent` 化
- Static rebuild: R2 成功後の `markDone` 失敗は再生成せず回復
- Legacy import: D1 成功・R2 progress 失敗は `committed_progress_pending`

## 公開ヘッダー account summary の負荷境界

- 公開 layout は引き続き server auth を呼ばない。hydration 直後に `GET /api/account/summary?view=presence` を一度だけ取得し、ログイン表示に必要な名前・icon だけを表示する。
- `Cookie` header が空の場合だけ presence route は Auth.js より前に logged-out を返す。Cookie が1つでもあれば、名前を推測せず Auth.js の database session を検証する。cookie 値・presence DTO は認可根拠ではなく、role / management 権限はDTOへ含めない。
- full summary は従来どおり既定の `GET /api/account/summary` で返し、desktop account menu または mobile menu の初回表示、Active X変更、明示再試行で取得する。同一layout lifetime内は完了結果をメモリで保持し、同じfull requestを重複させない。account summary専用contextはterms再同意判定を実行せず、protected routeの標準contextは引き続き判定する。
- approved X IDのある一般ユーザーのfull pathは、コード経路上5 read statements: Auth.js session+user join 1、account user 1、linked X 1、pending X 1、manageable event staff 1。manage可否は全event IDをmaterializeせず、permission preset/custom JSONを同じ意味で評価する `LIMIT 1` queryにし、返却行を最大1件に抑える。admin、またはapproved X IDなしでは最後のmanagement queryが省略される。Auth.js は `updateAge` 経過時にsession更新writeを1件追加し得る。presence はCookieなしなら0件、検証済みsessionがある場合はjoin read 1件と条件付き更新write。これはコードから数えたstatement/返却行上限であり、実行ごとのD1 rows-scanned/CPU計測値ではない。メニューを開くPVでは後からfull pathが加わるため、初回landingが軽くなる一方、同じPVの総statement数が必ず減るとは限らない。
- presence/detail とも `private, no-store` を維持する。公開 layout をdynamic化せず、protected route の標準 `getCurrentUserContext` / terms enforcement とserver-side permission gatesは変えない。detail未取得・取得失敗中はActive X未連携やmanage/admin可否を断定表示しない。
- Cloudflare Workers GraphQL `workersInvocationsAdaptive` はWorker単位のrequest/CPU quantilesを返すが、route path、D1 rows、R2/KV readsやmiddleware/route内のCPU splitは返さない。したがってこの集計だけからPV単位・route単位のCPUやD1 rowsを推定しない。実リクエスト相関を取れるpath-level traceが利用できない環境ではsource-derived fan-outとして明示する。

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
- 公開ヘッダー account summary は hydration 直後の private/no-store presence と、メニュー操作時の authoritative detail に分割する。presence は Cookie header 自体が空の場合に限り Auth.js 起動前に logged-out と判定し、Cookie が1つでもあれば必ず Auth.js で検証する。cookie 名を固定せず、role / management 権限を presence DTO に含めない。protected route の `getCurrentUserContext` と terms enforcement は変更しない。
- moderation 作成フォーム: 失敗を UI 表示
- rules broadcast: terms touch 失敗を `warning` で明示
- admin/slot/user/youtube/permissions/collab/cost-guard/api-endpoints/submitSlotVideo: `unstable_rethrow` + post-commit
- cost-guard: D1成功後の KV 失敗を保存失敗扱いしない
