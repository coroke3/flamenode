# MIG-0011 Frontend Requirements Reconciliation

> Status: REVIEW_READY_FRONTEND / MIG-0011全体は未完了
> Verified: 2026-10-07
> Scope: Frontend / UX / route / requirement reconciliation only
> Branch: `migration/mig-0011-frontend-requirements`
> UI visual authority: [`../UI_REFERENCE.md`](../UI_REFERENCE.md) = `PENDING_HTML`
> Backend FN detailed audit / backend optimization / Queue・API・Server Action最終最適化判断: **out of scope**

この文書をMIG-0011のFrontend側正本とする。CURRENTの観測事実とTARGET要件を分離し、旧`docs/design-redesign`および`app/(redesign)`をTARGET visual evidenceとして使用しない。

## 1. Final result

```text
app/**/page.tsx = 92
CURRENT VISUAL_SCREEN = 74
COMPAT_REDIRECT = 9
DEV_ONLY = 3
SYSTEM_SURFACE = 6

UX capabilities = 432
CURRENT_VERIFIED = 405
CURRENT_DIVERGENCE = 6
MERGED_INTO_OTHER = 17
OBSOLETE = 4
REQUIREMENT_ONLY = 0
AUDIT_REQUIRED = 0
CURRENT_OBSERVED = 0
```

Frontend側では、route classification未分類、UX未確定、surface owner不明、query/deep-link contract不明を残さない。

## 2. Evidence policy

UXの最終判断は次を根拠にした。

| Domain | Primary CURRENT evidence |
| --- | --- |
| public/navigation/discovery | `app/(public)/**`, `src/components/layout/**`, `src/lib/publicData/**` |
| video/player/chapter | `app/(public)/[id]/page.tsx`, `src/components/video/**`, `src/lib/actions/chapter.ts`, chapter/player tests |
| interaction/library | `src/lib/actions/video/interaction.ts`, `src/lib/video/videoViewerOverlay.ts`, `app/(auth)/dashboard/library/page.tsx`, interaction execution tests |
| auth/Active X | `docs/migration/auth/README.md`, `src/lib/auth/**`, `src/lib/actions/xid.ts`, Active X contract tests |
| submission/slot | `app/(auth)/entry/**`, `src/components/forms/VideoForm.tsx`, `src/lib/actions/slot.ts`, submission actions/tests |
| manage/admin | `app/(manage)/**`, `app/(admin)/**`, corresponding Server Actions and current action/API ledgers |
| audit/notification | `src/lib/audit/**`, `src/lib/notifications/**`, manage/admin notification surfaces |
| responsive/a11y | `docs/operations/ui-acceptance.md`, `scripts/check-ui-acceptance.mjs`, current components/styles/tests |
| route/query/deep-link | all `app/**/page.tsx`, `CURRENT_ROUTES.md`, `screen-mapping/README.md`, route/query helpers/tests |

各UX行はfrontend ledgerの `Surface` と `Related FN` を保持し、このevidence indexとscreen mappingでownerを解決する。Backend FNのstate自体はこのPRで変更しない。

## 3. CURRENT page classification

92個の `app/**/page.tsx` を4分類する。完全一覧は `../CURRENT_ROUTES.md` が正本。

### CURRENT VISUAL_SCREEN

ユーザーが独立したvisual surfaceとして操作・閲覧するroute。redirect条件を一部持つ画面でも、通常時にvisual UIをrenderするならここに含める。

### COMPAT_REDIRECT

独立visual screenではなく、旧URL/deep-linkを現在のowner surfaceへ接続するroute。

| Source URL | Destination | Query / hash transformation | Role branch | Deep-link / TARGET URL contract |
| --- | --- | --- | --- | --- |
| `/groups` | `/event` | source query/hashは引き継がない | none | source URLを互換aliasとして維持 |
| `/groups/[slug]` | `/event#event-group-{slug}` | slugをevent group anchor hashへ変換 | none | group deep-linkを互換aliasとして維持 |
| `/admin/history` | `/admin/audit` | source query/hashは引き継がない | admin shellで認可後 | source URLをaudit aliasとして維持 |
| `/admin/events/[id]` | `/manage/events/[id]` | path idをencodeして引継ぎ | admin shellで認可後 | admin旧detail URLを維持 |
| `/admin/events/[id]/edit` | `/manage/events/[id]/edit` | path idをencodeして引継ぎ | admin shellで認可後 | admin旧edit URLを維持 |
| `/admin/events/[id]/slots` | `/manage/events/[id]/slots` | path idをencodeして引継ぎ | admin shellで認可後 | admin旧slots URLを維持 |
| `/admin/events/[id]/staff` | `/manage/events/[id]/staff` | path idをencodeして引継ぎ | admin shellで認可後 | admin旧staff URLを維持 |
| `/manage/events/[id]/review` | `/manage/events/[id]/videos?status=pending` | source queryを捨て、review filterをdestination queryへ固定 | manage authorization | 旧review URLを審査queue aliasとして維持 |
| `/dashboard/youtube-playlists` | admin: `/admin/youtube-sync/playlists`; other authenticated: `/dashboard` | source query/hashは引き継がない | **あり**。未認証はauth guard、adminのみ管理playlistへ | URLは互換維持。一般ユーザー向け独立playlist screenはTARGETへ復活させない |

根拠:
- `app/(public)/groups/**/page.tsx`
- `src/lib/eventGroupRoutes.ts`
- `app/(admin)/admin/history/page.tsx`
- `app/(admin)/admin/events/[id]/**/page.tsx`
- `app/(manage)/manage/events/[id]/review/page.tsx`
- `app/(auth)/dashboard/youtube-playlists/page.tsx`

### DEV_ONLY

| URL | CURRENT behavior | TARGET treatment |
| --- | --- | --- |
| `/dev/ui-surfaces` | productionでは404、CURRENT UI検証用 | dev-onlyのまま。production capabilityへ昇格しない |
| `/dev/redesign` | fixture-only mock gallery、noindex | 旧mock。TARGET visual evidenceとして使用禁止 |
| `/dev/redesign/mock/[id]` | fixture-only mock detail、noindex | 旧mock。TARGET visual evidenceとして使用禁止 |

### SYSTEM_SURFACE

| URL | Role |
| --- | --- |
| `/maintenance` | user-facing maintenance / operation-mode status |
| `/auth/complete` | OAuth/session completion transition |
| `/event/~query` | public event logical query routeのtechnical renderer |
| `/list/~query` | public list logical query routeのtechnical renderer |
| `/user/~query` | public user logical query routeのtechnical renderer |
| `/user/[id]/paged` | profile paginationのtechnical renderer |

technical rendererは独立ユーザー機能ではない。論理URLのquery/reload/back-forward契約を守るための実装surfaceとして保持する。

## 4. UX final disposition

432 UXは `frontend/*.md` を正本とし、途中stateを残さない。

| State | Count | Meaning |
| --- | ---: | --- |
| `CURRENT_VERIFIED` | 405 | CURRENT code/test/route/action/APIまたはactive operational contractで確認済み |
| `CURRENT_DIVERGENCE` | 6 | CURRENT実装は確認済みだが、今回確定したTARGET requirementと不一致 |
| `MERGED_INTO_OTHER` | 17 | capabilityは別owner surfaceへ統合済み。互換URLは必要に応じて維持 |
| `OBSOLETE` | 4 | CURRENT productとして独立機能を提供しておらず、TARGETへ復活させない |
| `REQUIREMENT_ONLY` | 0 | 今回はなし |

### CURRENT_DIVERGENCE — Active X interaction ownership

以下はCURRENTでAuth User単位だが、TARGETではActive X単位であるため divergence。

- `UX-VID-025` like toggle
- `UX-VID-026` bookmark/save toggle
- `UX-VID-027` interaction active/pending state
- `UX-LIB-001` like library
- `UX-LIB-002` bookmark library
- `UX-LIB-008` like/bookmark playlist context

CURRENT evidence:
- `src/lib/actions/video/interaction.ts` が `video_interactions_auth.auth_user_id` をread/writeする。
- `src/lib/video/videoViewerOverlay.ts` がviewer interactionを `videoInteractionsAuth` からAuth User単位で解決する。
- `app/(auth)/dashboard/library/page.tsx` がlike/bookmark tabを `videoInteractionsAuth.auth_user_id = user.id` で取得する。
- current contract testにもAuth User単位を固定するassertionがある。

TARGETではこれを「CURRENTだから維持」と扱わない。migration実装時にActive X ownershipへreconcileする。production schema/code変更はこのPRでは行わない。

`UX-VID-028` は未ログイン時のlogin prerequisite自体はTARGETでも維持されるため `CURRENT_VERIFIED`。login後のacting identity divergenceは `UX-VID-025..027` 側で扱う。

### MERGED_INTO_OTHER

- `UX-EVENT-020..024`: `/groups*` 独立画面から `/event` のevent-group sectionsへ統合。slug deep-linkはhashへ変換。
- `UX-MNG-020..026`: `.../review` から `.../videos?status=pending` の審査queueへ統合。
- `UX-ADM-019`: `/admin/history` から `/admin/audit` へ統合。
- `UX-ADM-030`, `UX-ADM-032`, `UX-ADM-034`, `UX-ADM-035`: admin event aliasからmanage workspaceへ統合。

review統合の根拠は `app/(manage)/manage/events/[id]/videos/page.tsx` がreview filter、empty state、`VideoReviewQueueTable`、quick approve、detail/edit導線を持つこと。

### OBSOLETE

- `UX-SET-006..008`: 一般ユーザー向けpersonal YouTube playlist screen。CURRENT route自身が「一般ユーザー向けの同期状況画面は提供しない」と明示し、adminのみ全体管理画面、その他はdashboardへredirectする。
- `UX-ADM-020`: audit/historyを独立概念として維持するcapability。CURRENT `/admin/history` は `/admin/audit` へのaliasで、独立意味差は存在しない。

これはmigration中の新規feature removalではなく、CURRENTですでに成立している統合/廃止の記録。

## 5. Identity TARGET requirement

### Canonical split

```text
authentication principal = Auth User
acting/content/interaction identity = Active X
```

Auth Userを廃止しない。Discord/Auth Userはlogin、session、account security、ban、role、security provenance、delivery account等の正本。
Active XはFlameNode上で「どのX名義として行動・投稿・interactionするか」の主体。

### Domain reconciliation

| Domain | CURRENT basis | TARGET | Disposition |
| --- | --- | --- | --- |
| login/session/account security | Auth User | Auth User | aligned |
| like/bookmark | `video_interactions_auth.auth_user_id` | **Active X** | **CURRENT_DIVERGENCE** |
| chapter/comment | approved Active X → `video_chapters.x_user_id` | Active X | aligned |
| submission | Auth Userでsession/security、approved Active Xを投稿identity/snapshotへ利用 | dual principal | aligned |
| creator ownership | `videos.creator_x_user_id` | X identity ownership | aligned |
| collaboration | member identity=`video_members.x_user_id`; grant provenance=`edit_granted_by_auth_user_id` | X identity + Auth User security provenance | aligned |
| event staff | staff identity=`event_staff.x_user_id`; approval provenance=`approved_by_auth_user_id` | X identity + Auth User security provenance | aligned |
| notifications | delivery先はAuth User/account、関連entity/actorはX identityを保持可能 | delivery=Auth User、acting/content=X | aligned |
| audit actor | `actor_user_id` + `actor_x_user_id` | dual attribution | aligned |
| video edit | creator/member/event permissionをserver解決。Active Xはacting contextであり唯一のauthz根拠ではない | authorizationとacting identityを分離 | aligned |
| slot | reservationはterms同意済みAuth Userでも可、X snapshotは可能時保持。submissionはapproved Active X必須 | reservation security=Auth User、submission identity=Active X | aligned |
| playlist | event/admin operational resource。一般personal screenなし | event/admin scope; actor attributionはdual | aligned |
| public profile | X identity | X identity | aligned |
| dashboard/library | mine=Active X、collab/chapter=approved X、like/bookmark=Auth User | like/bookmarkもActive Xへ | partial divergence |

### Security boundary

次をActive Xへ機械的に置換してはいけない。

- session/auth adapter identifiers
- ban/role/account-security ownership
- `approved_by_auth_user_id`
- `edit_granted_by_auth_user_id`
- notification delivery recipient account
- auditの `actor_user_id`
- slotのaccount-level reservation ownership/provenance
- server-side permission checksで必要なAuth User principal

event authorizationはCURRENT同様、Auth Userに紐づくapproved X群とconcrete event permissionをserverで解決できる。**Active Xだけを唯一のsecurity authorization sourceにしない**。一方、interaction/contentのuser-visible actorはTARGETでActive Xとする。

## 6. Chapter / comment reconciliation

結論: **CURRENTの時間付きchapter/comment modelをTARGET requirementとして維持し、独立した自由comment modelは復元しない。**

CURRENT evidence:
- `video_chapters`
- `src/lib/actions/chapter.ts`
- `ChapterComposer`, `ChapterCommentPanel`, `ChapterCommentItem`
- player seek / active chapter tests
- public/private chapter overlay / reflection tests

CURRENTはchapter time、label、note、public/private、player seek、Active X author、public reflection待ちを一体のproduct behaviorとして実装している。active requirement側に独立free-comment復元を要求する根拠はない。historical free-comment記述はrequirementとして **OBSOLETE** とする。

## 7. Requirement reconciliation

### Owner minimum / event staff

- eventはownerを最低1名維持する。
- last ownerの削除/降格を拒否する。
- event staffの表示identityはX、permission/security resolutionはserver authoritative。
- UIで見えるrole/presetだけを認可根拠にしない。
- Active X mismatchは警告対象だが、別のapproved linked Xに正当なstaff permissionがある場合に権限を勝手に消さない。

### Notification UX

- sent / pending / failed / retryable / retry resultをtext/semantic stateとして示す。
- manageは担当scope、adminは全体scope。
- delivery identityはAuth User/accountを維持し、acting/content Xとの役割を混同しない。
- dead-letter/deferred/quota等の運用状態は該当surfaceで隠さない。

### Public reflection / degraded / unavailable

- public mutation後のstatic projection反映待ちは、成功と「公開反映待ち」を分離する。
- stale/degraded/unavailableを404やprivate D1 fallbackと混同しない。
- public/private visibilityはfail-closed。
- recoverable unavailableは再試行/再行動可能な表示を維持する。

### Query / direct URL / history

- logical public URLs: `/list`, `/event`, `/user`, `/user/[id]`。
- query/filter/sort/page/tabはreloadとbrowser back/forwardで再現できる。
- technical `~query` / `paged` routesは独立visual screenではない。
- compat redirect source URLはmigration後も破壊しない。
- redirect sourceがCURRENTでqueryを転送しない場合、その挙動を勝手に新しいquery contractとして拡張しない。

### Unsaved / destructive

- `VideoForm`等のdirty formはnavigation/Active X切替で入力喪失を防ぐ。
- recoverable submit failureでは入力を保持し再試行できる。
- destructive operationは対象・結果が分かる確認を要求する。
- pending中は二重送信/多重mutationを抑止する。

### Onboarding / terms / X linking

- login/session、terms、approved Xを別 prerequisiteとして扱う。
- slot reservationはterms同意後に可能で、approved Xを必須にしない。
- submission/content actionはapproved Active Xを要求する。
- X link conflict/reject/pendingを誤統合せず表示する。
- safe `next` contractを維持し、open redirectを許可しない。

## 8. Responsive / accessibility CURRENT behavior contract

見た目のTARGET設計は行わない。CURRENT behavior requirementだけを固定する。

### Required behavior

- mobile / tablet / desktopでprimary actionへ到達可能
- keyboard onlyで主要controlを操作可能
- visible `:focus-visible`
- button/link/inputのsemantic role一致
- form label とhelp/errorの関連付け
- validation errorを位置/意味付きで把握でき、主要formではerror summary/focus recoveryを維持
- pending時のdisabled/loading semantics一致
- mobile fixed actionはsafe-areaと本文escape spaceを確保
- table/slot/member batch等のdense UIは局所横scrollで、page全体を押し広げない
- player/chapter controlはkeyboard reachable
- active/status/pending/degraded/quota/failed/dead-letterを色だけで伝えない
- dialog/destructive confirmationはkeyboard/focusで操作可能
- responsive overflowでprimary/destructive actionを隠さない
- reduced motion preferenceを尊重

### CURRENT evidence

`docs/operations/ui-acceptance.md` は 360 / 390 / 430 / 640 / 768 / 1024 / 1280 / 1440 / 1920px のacceptance、drawer focus、Escape、fixed player、dense table、release view keyboard/hash semantics、reduced motionを明示する。

実装側には:
- shared `:focus-visible` styles
- `aria-*` / `aria-current` / `aria-pressed`
- `role="alert"`
- `aria-describedby`
- `ConfirmDialog`
- local `overflow-x`
- pending/disabled controls
が存在し、`scripts/check-ui-acceptance.mjs` とcomponent/contract testsで一部を機械検査している。

このPRはvisual redesignまたは実ブラウザの独立アクセシビリティ認証を行ったものではない。migration acceptance時に同contractを再検証する。

## 9. Screen / shell / surface ownership

`screen-mapping/README.md` のowner modelは次へ変更する。

```text
VISUAL_SCREEN owner
COMPAT_REDIRECT owner
DEV_ONLY owner
SYSTEM_SURFACE owner
CROSS_ROUTE_SHELL owner
```

要件:

- 432 UXすべてownerあり
- orphan UX = 0
- unknown owner = 0
- unresolved surface = 0
- query/deep-link contract missing = 0
- shell inheritance missing = 0
- visual routeとcompat redirectの重複 = 0
- redirect destination unknown = 0

`MERGED_INTO_OTHER` / `OBSOLETE` UXもownerを失わない。前者はdestination visual surface、後者はcompat/system contractへ解決する。

## 10. UI target boundary

`UI_REFERENCE.md` が `PENDING_HTML` の間:

Allowed:
- CURRENT behavior contract固定
- route/screen/shell ownership固定
- responsive/a11y requirement固定
- capability/requirement reconciliation

Forbidden:
- TARGET layout/component hierarchyの捏造
- 旧`docs/design-redesign`や`app/(redesign)`からTARGET visualを推測
- visual都合でcapabilityを削除/統合
- visual redesignをDONE扱い

## 11. Frontend checker gates

`scripts/check-migration-docs.mjs` は少なくとも以下をfail条件にする。

- frontend UX ID total/unique整合
- final disposition以外のstate残存
- `AUDIT_REQUIRED = 0`
- `CURRENT_OBSERVED = 0`
- 全 `app/**/page.tsx` のroute classification coverage
- class間重複なし
- compat redirect destination不明0
- UX surface owner unresolved 0
- unknown shell/route 0
- query contract欠落0
- Active X TARGET requirementとCURRENT interaction divergenceが明記
- `UI_REFERENCE = PENDING_HTML` 中にTARGET visual hierarchy/componentを確定していない

92/74/9等の値はこの棚卸し結果としてdocumentへ記録するが、checkerは可能な箇所でsourceから導出し、将来のroute追加を「古い固定値に合わせる」目的では使わない。

## 12. Validation snapshot

2026-10-07 branch上で再検証:

- source tree `app/**/page.tsx`: 92 / classification rows: 92 / missing: 0 / stale: 0
- route classes: VISUAL_SCREEN 74 / COMPAT_REDIRECT 9 / DEV_ONLY 3 / SYSTEM_SURFACE 6
- UX: 432 unique 432 / CURRENT_VERIFIED 405 / CURRENT_DIVERGENCE 6 / MERGED_INTO_OTHER 17 / OBSOLETE 4
- `AUDIT_REQUIRED`: 0 / `CURRENT_OBSERVED`: 0
- distinct UX Surface token: 170 / resolution rows: 170 / unresolved: 0 / unknown route/shell owner: 0
- compat redirect destination unknown: 0
- Active X required divergence IDs missing: 0
- `scripts/check-migration-docs.mjs` syntax parse: pass
- branch vs latest main: behind 0 at validation time
- branch diff: docs + migration checker only; runtime/production code changes 0

Full Backend FN closure and MIG-0011 task closure are intentionally not performed by this PR.

## 13. Self review


実施:
- `CHECKPOINT.md` を最初に確認
- 92 page source tree coverage確認
- redirect-only source code確認
- 432 UX ID uniqueness/final state確認
- Active X/Auth User二主体モデルのCURRENT evidence照合
- chapter/comment active/historical requirement照合
- responsive/a11y active acceptanceと実装pattern照合
- old redesignをTARGET evidenceから除外
- checker構文: V8 parseで `OK`
- cross-document機械再照合: 92/92 route分類、432/432 UX final disposition、170/170 Surface owner解決、redirect destination未解決0

未実施:
- 独立した別エージェント/別レビュアーによるレビュー
- production browserでのmanual accessibility audit
- Backend FN detailed audit
- backend optimization最終判断
- production code/settings変更

したがって、このPRについて「独立レビュー済み」とは扱わない。
