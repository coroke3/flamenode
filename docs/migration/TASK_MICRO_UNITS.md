# Large MIG task micro-units — scoped resumable packets

> Status: Active / mandatory subdivision for broad tasks
> Parent task state: [STATUS.md](STATUS.md)
> Execution: [IMPLEMENTATION_RUNBOOK.md](IMPLEMENTATION_RUNBOOK.md) + [GIT_WORKFLOW.md](GIT_WORKFLOW.md)
> Rule: **one wake processes at most one micro-unit of one MIG**. For a task with multiple units keep its single Draft PR/branch and checkpoint on that branch. Do not mark the parent REVIEW until every unit passed.

## Required per-wake checkpoint in the task PR branch STATUS

```text
Parent MIG: MIG-XXXX
Active PR: #NNN
Owner: claude|codex|antigravity|human
HEAD commit SHA: ...
Micro-units:
  U01: DONE | IN_PROGRESS | BLOCKED | NOT_STARTED
  U02: ...
Current micro-unit: UXX
Changed files: [exact paths]
CURRENT UX/FN/RH/SA IDs: [exact IDs or NONE + evidence]
Tests DONE: [command + result/link]
Tests NOT DONE: [command + reason]
Next wake: repeat latest PR HEAD read; continue at UXX/UYY
Merge eligibility: NO until all micro-units DONE and independent review/CI
```

- `STATUS.md` mainは最後にmergeされたcheckpointのまま。`IN_PROGRESS`を**open Draft PR上で有効なownerと再開手順を伴う状態**として保持してよい（次wakeで同じbranchを再開する）。PR owner不明/引継ぎ不能になったら`BLOCKED`にしてowner調整し、重複task branchを開かない。
- **One task = one PR**は維持。micro-unitごとに別MIGを作る必要が判明した場合は、lead reviewで新MIG ID/STATUS dependency/cardを追加してから切り分ける。
- 「DONE」とできるのは**micro-unit**の完了だけ。Taskの`REVIEW`はmicro-unit全DONE + overall parity。Taskの`DONE`は別レビュアー+CI+必要Gate許可後。
- WIPを`REVIEW`と誤ラベル付けして次taskへ進まない。カードにない既存機能を発見したらcard/ledgerに追加してから着手する。

## MIG-0304 — Video domain

- **U01 ownership policy**: `src/lib/auth/ownershipCore.ts`, `videoEditSections.ts`, `generalEditPermissionsCore.ts` と tests。mode別allow/deny,dangerous keyでpolicy抽出/bridge。
- **U02 video visibility**: `src/lib/video/videoVisibilityTransition.ts` と event roleのSA-001..003/040..042。publish→private即時フェンス、CAS+通知+静的Queue。
- **U03 edit/member/chapter**: `computeEditSections.ts`, SA-012..015/082..085。chapter削除でもcomment保持、collab editor権限はCreatorOwnerだけ委譲。
- **U04 submission/interactions**: SA-086..089 と fan-out移行の契約を分離。new interactionは選択Active Xのみ、old Auth history migrationは全approved owner X。再実行性/Queue。
- **Final audit**: SA-001..003/012..015/040..042/082..089, affected UX/FNを漏れなく列挙。

## MIG-0305 — Event / Slot domain

- **U01 owner/policy**: `eventOwnershipCore.ts`, event ownership mode、operable owner>=1のDB raceテスト。
- **U02 event transitions**: `eventVisibilityTransition.ts`, `eventGroupVisibilityTransition.ts`、admin/manage権限区別。可視性とpost-commit反映。
- **U03 slot reservation**: SA-056..068、予約上限/CAS/重複・期限・owner/local bind条件。既存D1 transactionを保持。
- **U04 bulk/playlist**: SA-021..039（U01/U02対象分除く）を列挙し、event-group/rename/staff/playlist/notificationの隠れた副作用を比較。
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
- **U04**: `/event/[id]/release` release playback order, aliases, schema invalid, degrade。

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

- **U01**: RH-015 and RH-014; viewer overlay split, public/private guards。
- **U02**: RH-020..022 live/event slot status; 5s isolate cache/SWR and errors。
- **U03**: RH-012..013 public export and legacy format/v5; authorization + limits + CORS。
- **U04**: SA-021..039 and SA-056..068 mutation equivalence; owner0 guard, reservation, Playlist + postcommit。
- **Final audit**: no remaining event/slot methods without contract/test evidence.

## MIG-0605 — X / Admin / remaining Route Handlers

- **U01 account + suggestion**: RH-001 and RH-019. Session/ban/approved X DTO/no-store/invalid params。
- **U02 spreadsheet**: RH-003..009. Read/update/insert/delete/export/import/table list, audit and owner protection。
- **U03 external media proxies**: RH-016, RH-023..025, RH-033. Signed-private/public ACL/cache/SSRF/size bounds。
- **U04 public staff**: RH-027 OPTIONS and RH-028 GET. CORS allowlist/visibility double-check/ETag。
- **U05 X link + interactions**: SA-090..106, `ACTIVE_X_MIGRATION_PLAN.md`, D-03 approved owner fan-out dry-run and D-04 cutover checkpoint. Never run remote write。
- **U06 admin ops**: SA-016..020/043..055/069..081. Compare audit+cost-guard/notifications/terms/admin user operations。
- **U07 remaining method coverage**: compare all RH-001..033 ledger, RH-010/011 remains legacy Auth. Any RH not explicitly assigned in 0601-0605 gets a named owner + E2E test; no silent omission。
- **Final audit**: overlapping SA ownership with MIG-0602/0603/0604 identified and not double-counted.

## MIG-0704 — Ops SPA creation + Manage

- **U01 scaffold**: `+apps/ops` package/tsconfig/entry/Vite/bundle, distinct `/_ops_assets/*` + CI build. No production routing。
- **U02 Manage index/event overview**: `/manage`, `/manage/events/[id]`, `.../edit`, `.../audience`。
- **U03 slots/staff**: `.../slots`, `.../staff`, event0-owner CAS/privilege。
- **U04 videos/playlist**: `.../videos`, video detail, `.../youtube-playlist`, edit permission。
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
