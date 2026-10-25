# Large MIG task micro-units — scoped resumable packets

> Status: Active / mandatory subdivision for broad tasks
> Merged task/dependency state: [STATUS.md](STATUS.md); live work-item: [work-items/README.md](work-items/README.md)
> Execution: [IMPLEMENTATION_RUNBOOK.md](IMPLEMENTATION_RUNBOOK.md) + [GIT_WORKFLOW.md](GIT_WORKFLOW.md)
> Per-file checkpoint: [FILE_PROGRESS_PROTOCOL.md](FILE_PROGRESS_PROTOCOL.md), [FILE_MIGRATION_MATRIX.md](FILE_MIGRATION_MATRIX.md)
> Rule: **one wake processes at most one micro-unit of one MIG**. For a task with multiple units keep its single Draft PR/branch and checkpoint on that branch. Do not mark the parent REVIEW until every unit passed.

## Required micro-unit section in the task PR branch `work-items/MIG-XXXX.md`

メタデータは[work-items/README.md](work-items/README.md)のCheckpoint formatを使い、`Task / State / Owner / Branch / PR / Head / Owned paths / Current unit / Validation / Evidence / Rollback / Next`を各1行だけ記録する。`Head`はcheckpoint前に実在するsource commit。以下はその本文へ追加するunit内訳であり、必須メタデータを置き換えない。

```markdown
## Micro-units

| Unit | State | Actual validation/evidence | Next / recovery condition |
| --- | --- | --- | --- |
| U01 | DONE / IN_PROGRESS / BLOCKED / NOT_STARTED | command/result/link | exact next action |
| U02 | NOT_STARTED | not run | dependency / next action |

Changed files: [exact paths]
File rows updated: [FILE_MIGRATION_MATRIX.md exact paths and states]
Provider/consumer wiring: [actual exports/importers and routes]
CURRENT UX/FN/RH/SA IDs: [exact IDs or NONE + evidence]
Tests DONE: [command + result/link]
File progress checker: [node scripts/check-migration-file-progress.mjs result]
Tests NOT DONE: [command + reason]
Next wake: repeat latest PR HEAD read; continue at UXX/UYY
Merge eligibility: NO until all micro-units DONE and independent review/CI
```

- mainの`STATUS.md`は最後にmergeされたtask依存checkpointのまま。`IN_PROGRESS`は**同一Draft PRのtask固有work-itemファイルで、有効ownerと再開手順を伴って**保持してよい（次wakeで同じbranchを再開する）。PR owner不明/引継ぎ不能になったら`BLOCKED`にしてowner調整し、重複task branchを開かない。
- **One task = one PR**は維持。micro-unitごとに別MIGを作る必要が判明した場合は、lead reviewで新MIG ID/STATUS dependency/cardを追加してから切り分ける。
- 「DONE」とできるのは**micro-unit**の完了だけ。Taskの`REVIEW`はmicro-unit全DONE + overall parity。Taskの`DONE`は別レビュアー+CI+必要Gate許可後。
- WIPを`REVIEW`と誤ラベル付けして次taskへ進まない。カードにない既存機能を発見したらcard/ledgerに追加してから着手する。

## MIG-0304 — Video domain

- **U01 ownership policy**: `src/lib/auth/ownershipCore.ts`, `videoEditSections.ts`, `generalEditPermissionsCore.ts` と tests。mode別allow/deny,dangerous keyでpolicy抽出/bridge。
- **U02 video visibility**: `src/lib/actions/admin.ts`のSA-001..003、`src/lib/video/videoVisibilityTransition.ts`とevent roleのSA-040..042。publish→private即時フェンス、CAS+通知+静的Queue。
- **U03 edit/member/chapter**: `computeEditSections.ts`, SA-012..015/082..085。chapter削除でもcomment保持、collab editor権限はCreatorOwnerだけ委譲。
- **U04 submission/interactions**: SA-086..089 と fan-out移行の契約を分離。new interactionは選択Active Xのみ、old Auth history migrationは全approved owner X。再実行性/Queue。CURRENTの新規interactionはAuth User単位（`video_interactions_auth`）で、選択Active Xへの切替はD-04 cutover（MIG-0702）、fan-outはMIG-0605 U05。本unitは両者をdomainへ混ぜない。
- **Final audit**: SA-001..003/012..015/040..042/082..089, affected UX/FNを漏れなく列挙。

## MIG-0305 — Event / Slot domain

- **U01 owner/policy**: `eventOwnershipCore.ts`, event ownership mode、operable owner>=1のDB raceテスト。
- **U02 event transitions**: `eventVisibilityTransition.ts`, `eventGroupVisibilityTransition.ts`、admin/manage権限区別。可視性とpost-commit反映。
- **U03 slot reservation**: SA-056..068、予約上限/CAS/重複・期限・owner/local bind条件。既存D1 transactionを保持。
- **U04 bulk/playlist**: SA-021..034およびSA-038..039（U01/U02対象分除く）。SA-035..037はMIG-0303で抽出したserviceのconsumer/監査互換検証のみを列挙し、event-group/rename/staff/playlist/notificationの隠れた副作用を比較。
- **Final audit**: event/slot all SA affected FN, concurrent owner0, requeue/retry。

## MIG-0306 — User / X / Admin domain

- **U01 X link policies**: X approved/manager/owner、Auth identity、duplicate/account-link CAS、ban/terms。
- **U02 X merge/revert**: `src/lib/xid/merge.ts`, `mergeSafety.ts`, matching tests; mapping/restore/overlapping owner/replay/delta audit。
- **U03 admin moderation**: SA-016..020,043..055の一つずつをexact-ID matrixへ。strict audit, notifications, cost guard。
- **U04 data/operations & outstanding SA**: SA-069..081,090..106の未処理を個別照合し、static rebuild/terms/UserAdmin/Synchronization。
- **Final audit**: Auth Userは認証主体、Xは活動主体、共有Xのlike duplicates、全側効果と可逆性。

## MIG-0502 — Public event routes

- **U01**: `/event` event index/list/query/SEO。
- **U02**: `/event/[id]` metadata/status/visibility。
- **U03**: `/event/[id]/slots` live count, overlay, pending/retry/static fences。
- **U04**: `/event/[id]/release` release playback order, aliases, schema invalid, degrade。`/event/~query`は内部technical twinで、同名Astroページを必ず作るのではなく、logical `/event?...`のfilter/reload/history parityを証明する。

## MIG-0504 — Public user routes

- **U01**: `/user` index/search/pagination。
- **U02**: `/user/[id]` profile, X-id alias/merge, approval/visibility。
- **U03**: `/user/[id]/portfolio` portfolio/thumbnail/404/hidden-video filters。

## MIG-0507 — Video root path final migration

- **U01**: canonical/alias/root namespace vs all static routes and assets, route-map, 404。
- **U02**: static video content/title/thumbnail/OGP and private→public/privacy fence。
- **U03**: chapters/player/comment and video state controls; iframe/YouTube errors/reload。
- **U04**: like/bookmark overlay, 0X/multiX, auth/session, callback/modal and fallback semantics。
- **Final audit**: no `/:id` literal Cloudflare glob; collision and CPU p99 tests.

## MIG-0604 — Event/slot APIs

- **U01**: RH-014; viewer overlay split, public/private guards。RH-015 moved to MIG-0631 (2026-10-24)。
- **U02**: RH-020..022 live/event slot status; 5s isolate cache/SWR and errors。
- **U03**: moved out (2026-10-24): RH-012 to MIG-0631, RH-013 (export, legacy format/v5, CORS) to MIG-0632。
- **U04**: SA-021..039 and SA-056..068 mutation equivalence; owner0 guard, reservation, Playlist + postcommit。
- **Final audit**: no remaining event/slot methods without contract/test evidence.

## MIG-0605 — X / Admin / remaining Route Handlers（2026-10-25 分割、D-13-56）

- **済み**: U01 RH-001（#335）、U02 read RH-003/007/009（#392）、U03 の一部 RH-016/033（#335）。
- **MIG-0636 へ**: SA-074..076, SA-098..105、G21 の body 上限。
- **MIG-0637 へ**: SA-016..020, SA-045..055, SA-069..073, SA-077..081, SA-092..097, SA-106, SA-110。
- **MIG-0638 へ**: RH-002, RH-004..008（F-1 を含む）, RH-019, RH-023..025, RH-027, RH-028。
- **MIG-0603 へ**: SA-043/044（可視性遷移の host を共有）。
- **本 task U05x**: SA-090/091（MIG-0633 の後）。**U05d** D-03 fan-out dry-run（Remote D1 に触れない）。**U05e** D-04 checkpoint。
- **U07 remaining method coverage**: RH-001..033 の担当表。RH-010/011 は旧 Auth。
- **Final audit**: MIG-0602/0603/0604/0636〜0638 との SA の二重所有が無いこと。

## MIG-0704 — Ops SPA creation + Manage

- **U01 scaffold**: `+apps/ops` package/tsconfig/entry/Vite/bundle, distinct `/_ops_assets/*` + CI build. No production routing。
- **U02 Manage index/event overview**: `/manage`, `/manage/events/[id]`, `.../edit`, `.../audience`。
- **U03 slots/staff**: `.../slots`, `.../staff`, event0-owner CAS/privilege。
- **U04 videos/playlist**: `.../videos`, video detail, `.../youtube-playlist`, edit permission。`/manage/events/[id]/review`はCURRENT `/manage/events/[id]/videos?status=pending` への互換redirectとして扱い、同unitでdeep-linkを試験する。
- **U05 notifications/X-link**: `/manage/notifications`, `/manage/x-link-requests` and any remaining Manage route in CURRENT_ROUTES。
- **Final audit**: count Manage12 incl compatibility, deny wrong scope, independent Ops build/deep URL.

## MIG-0705 — Admin 45 screens in Ops SPA

- **U01 shell/security**: admin layout, 401/403, top dashboard, permission simulation, no-store, error/empty states。
- **U02 content rules**: announcements, API endpoints, ToS/rules, event groups and list navigation。
- **U03 events/workflows**: event CRUD/owner/staff/slot/publish/playlist, audit/permission side effects。
- **U04 media/video**: videos/chapter/collab/member/editor, asset signing, visibility and static reflection。
- **U05 identity+moderation**: users/roles/BAN/X-link requests/X ID merge/revert. CAS/audit/high-risk reviewer。
- **U06 spreadsheet/import**: table explorer safe write/export/import, preview token, atomicity, no arbitrary SQL。
- **U07 operations/queues**: workers/health/security/cost-guard/notifications/static-builds/youtube-quota/sync, retry and D1 quota.
- **U08 audit+cross-route sweep**: audit logs/restore and **all 45 actual Admin routes** from `CURRENT_ROUTES.md` with URL/UX/FN/RH/SA/state test mapping. Any missing route or function means parent not REVIEW-ready.
- **Final audit**: Personal chunks must not embed Ops code; user/moderator/owner/admin permission matrix and cross-app transitions.

## Smaller MIGs

Any other task can still need multiple wakes if actual code diff is larger than one bounded reasoning step. Before splitting, enumerate at most 4 explicit micro-units and track them using this format in the **same existing task PR**. For different responsibilities requiring independent acceptance, propose new MIG tasks with dependencies/cards first.

## Forbidden shortcuts

- Claim multiple units DONE because a single `npm test` passed.
- Invent a mock, production test results, Live Cloudflare data or Github reviewer approval.
- Bypass current code/ledger or write all admin screens in one unreviewable change.
- Advance next MIG while this task PR still has unreviewed/incomplete units.
- Auto-merge or edit production just to keep host's loop active.
