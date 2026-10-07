# Frontend UX Ledger — Manage / Admin

> Status: Active baseline
> Final disposition: `CURRENT_VERIFIED` / `CURRENT_DIVERGENCE` / `REQUIREMENT_ONLY` / `OBSOLETE` / `MERGED_INTO_OTHER`. 根拠索引は `../gap-scan/FRONTEND_REQUIREMENTS.md`。

## Manage shell / overview

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-MNG-001 | 担当event一覧を見る | `/manage` | FN-MNG-001 | CURRENT_VERIFIED |
| UX-MNG-002 | eventごとの要対応/状態を把握する | `/manage` | FN-MNG-001 | CURRENT_VERIFIED |
| UX-MNG-003 | staff scope外eventが表示されない | `/manage` | FN-MNG-001,FN-X-002 | CURRENT_VERIFIED |
| UX-MNG-004 | event workspaceへ移動する | `/manage` | FN-MNG-002 | CURRENT_VERIFIED |
| UX-MNG-005 | manage/admin mode差をbannerで理解する | manage shell | FN-MNG-002 | CURRENT_VERIFIED |
| UX-MNG-006 | 担当event navigationをsidebarで使う | manage shell | FN-MNG-001 | CURRENT_VERIFIED |
| UX-MNG-007 | Active X mismatch warningを見る | manage shell | FN-MNG-001,FN-AUTH-010 | CURRENT_VERIFIED |
| UX-MNG-008 | manage accessがないuserは安全にdashboardへ戻される | manage layout | FN-MNG-001,FN-X-002 | CURRENT_VERIFIED |

## Manage event workspace / settings / audience

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-MNG-009 | event workspace overview/statusを見る | `/manage/events/[id]` | FN-MNG-002 | CURRENT_VERIFIED |
| UX-MNG-010 | workspace tab/section間をevent context維持して移動する | manage event routes | FN-MNG-002 | CURRENT_VERIFIED |
| UX-MNG-011 | event audience情報を閲覧する | `.../audience` | FN-MNG-003 | CURRENT_VERIFIED |
| UX-MNG-012 | audience privacy/permission範囲に応じて情報が制限される | `.../audience` | FN-MNG-003,FN-X-002 | CURRENT_VERIFIED |
| UX-MNG-013 | event settingsを表示する | `.../edit` | FN-MNG-004 | CURRENT_VERIFIED |
| UX-MNG-014 | event title/description/icon/accent等を編集する | `.../edit` | FN-MNG-004 | CURRENT_VERIFIED |
| UX-MNG-015 | recruitment/stage/date等を編集する | `.../edit` | FN-MNG-004 | CURRENT_VERIFIED |
| UX-MNG-016 | slot有無/関連event設定を編集する | `.../edit` | FN-MNG-004 | CURRENT_VERIFIED |
| UX-MNG-017 | custom question等entry設定を編集する | `.../edit` | FN-MNG-004,FN-ENT-006 | CURRENT_VERIFIED |
| UX-MNG-018 | event settings validation/pending/success/errorを見る | `.../edit` | FN-MNG-004 | CURRENT_VERIFIED |
| UX-MNG-019 | permissionのないevent setting変更を拒否される | `.../edit` | FN-MNG-004,FN-X-002 | CURRENT_VERIFIED |

## Manage review

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-MNG-020 | review queueを見る | `.../review` | FN-MNG-005 | MERGED_INTO_OTHER |
| UX-MNG-021 | review対象作品の必要情報を見る | `.../review` | FN-MNG-005 | MERGED_INTO_OTHER |
| UX-MNG-022 | review判定/status transitionを実行する | `.../review` | FN-MNG-005 | MERGED_INTO_OTHER |
| UX-MNG-023 | review理由/validation等を入力する | `.../review` | FN-MNG-005 | MERGED_INTO_OTHER |
| UX-MNG-024 | review処理後に次の対象へ連続して進む | `.../review` | FN-MNG-005 | MERGED_INTO_OTHER |
| UX-MNG-025 | review対象なしempty stateを見る | `.../review` | FN-MNG-005 | MERGED_INTO_OTHER |
| UX-MNG-026 | reviewer権限がない操作を拒否される | `.../review` | FN-MNG-005,FN-X-002 | MERGED_INTO_OTHER |

## Manage slots

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-MNG-027 | event slot一覧とstateを見る | `.../slots` | FN-MNG-006 | CURRENT_VERIFIED |
| UX-MNG-028 | slotの予約者/作品/時間等の管理情報を見る | `.../slots` | FN-MNG-006 | CURRENT_VERIFIED |
| UX-MNG-029 | slotを作成/追加する | `.../slots` | FN-MNG-006 | CURRENT_VERIFIED |
| UX-MNG-030 | slotをbulk生成/調整する | `.../slots` | FN-MNG-006 | CURRENT_VERIFIED |
| UX-MNG-031 | slotを編集する | `.../slots` | FN-MNG-006 | CURRENT_VERIFIED |
| UX-MNG-032 | slot reservationをrelease/cancelする | `.../slots` | FN-MNG-006 | CURRENT_VERIFIED |
| UX-MNG-033 | slot reservationを延長する | `.../slots` | FN-MNG-006 | CURRENT_VERIFIED |
| UX-MNG-034 | capacity/連続slot/part等のrule違反を拒否される | `.../slots` | FN-MNG-006 | CURRENT_VERIFIED |
| UX-MNG-035 | slot操作に伴うnotification結果/失敗を認識する | `.../slots` | FN-MNG-006,FN-JOB-006 | CURRENT_VERIFIED |
| UX-MNG-036 | slot destructive operationの確認を受ける | `.../slots` | FN-MNG-006 | CURRENT_VERIFIED |

## Manage staff / permissions

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-MNG-037 | event staff一覧/roleを見る | `.../staff` | FN-MNG-007 | CURRENT_VERIFIED |
| UX-MNG-038 | staffを追加する | `.../staff` | FN-MNG-007 | CURRENT_VERIFIED |
| UX-MNG-039 | staff role/permission presetを変更する | `.../staff` | FN-MNG-007 | CURRENT_VERIFIED |
| UX-MNG-040 | staffを削除する | `.../staff` | FN-MNG-007 | CURRENT_VERIFIED |
| UX-MNG-041 | 最後のownerを削除/降格できない | `.../staff` | FN-MNG-007,FN-X-001 | CURRENT_VERIFIED |
| UX-MNG-042 | roleごとの権限差をUIで確認する | `.../staff` | FN-MNG-007 | CURRENT_VERIFIED |
| UX-MNG-043 | permission不足操作をserver側でも拒否される | `.../staff` | FN-MNG-007,FN-X-002 | CURRENT_VERIFIED |

## Manage videos

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-MNG-044 | event作品一覧を見る | `.../videos` | FN-MNG-008 | CURRENT_VERIFIED |
| UX-MNG-045 | status/filter/searchで要対応作品を絞る | `.../videos` | FN-MNG-008 | CURRENT_VERIFIED |
| UX-MNG-046 | event作品1件の管理詳細を開く | `.../videos/[videoId]` | FN-MNG-009 | CURRENT_VERIFIED |
| UX-MNG-047 | video metadata/member/entry回答等の運営情報を見る | video detail | FN-MNG-009 | CURRENT_VERIFIED |
| UX-MNG-048 | allowed fields/statusを更新する | video detail | FN-MNG-009 | CURRENT_VERIFIED |
| UX-MNG-049 | visibility/status transition結果を確認する | video detail | FN-MNG-009,FN-PLAT-004 | CURRENT_VERIFIED |
| UX-MNG-050 | video処理のaudit/conflict/error結果を見る | video detail | FN-MNG-009,FN-X-005 | CURRENT_VERIFIED |

## Manage playlist / notifications / X request

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-MNG-051 | event YouTube playlist sync状態を見る | `.../youtube-playlist` | FN-MNG-010,FN-JOB-005 | CURRENT_VERIFIED |
| UX-MNG-052 | playlist syncを開始/再試行する | `.../youtube-playlist` | FN-MNG-010,FN-JOB-005 | CURRENT_VERIFIED |
| UX-MNG-053 | quota/error/pending/successを見る | `.../youtube-playlist` | FN-MNG-010 | CURRENT_VERIFIED |
| UX-MNG-054 | 自分のscopeにあるnotification failure一覧を見る | `/manage/notifications` | FN-MNG-011 | CURRENT_VERIFIED |
| UX-MNG-055 | notification failureをfilterする | `/manage/notifications` | FN-MNG-011 | CURRENT_VERIFIED |
| UX-MNG-056 | retry可能なnotificationを再試行する | `/manage/notifications` | FN-MNG-011,FN-JOB-006 | CURRENT_VERIFIED |
| UX-MNG-057 | notification retryの重複/結果を確認する | `/manage/notifications` | FN-MNG-011,FN-JOB-006 | CURRENT_VERIFIED |
| UX-MNG-058 | delegated X link request queueを見る | `/manage/x-link-requests` | FN-MNG-012 | CURRENT_VERIFIED |
| UX-MNG-059 | X link requestをapprove/reject等処理する | `/manage/x-link-requests` | FN-MNG-012 | CURRENT_VERIFIED |
| UX-MNG-060 | X request処理のpermission/audit結果を見る | `/manage/x-link-requests` | FN-MNG-012,FN-X-005 | CURRENT_VERIFIED |

# Admin

## Admin dashboard / announcements / API endpoints

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-ADM-001 | admin dashboardで対応待ち/異常を把握する | `/admin` | FN-ADM-001 | CURRENT_VERIFIED |
| UX-ADM-002 | admin-only accessがserverで強制される | admin shell | FN-ADM-001,FN-X-002 | CURRENT_VERIFIED |
| UX-ADM-003 | announcement一覧を見る | `/admin/announcements` | FN-ADM-002 | CURRENT_VERIFIED |
| UX-ADM-004 | announcementを新規作成する | `/admin/announcements/new` | FN-ADM-002 | CURRENT_VERIFIED |
| UX-ADM-005 | announcementを編集する | `/admin/announcements/[id]/edit` | FN-ADM-002 | CURRENT_VERIFIED |
| UX-ADM-006 | publish/unpublish等の公開状態を変更する | announcements | FN-ADM-002 | CURRENT_VERIFIED |
| UX-ADM-007 | announcement validation/pending/audit結果を見る | announcements | FN-ADM-002,FN-X-005 | CURRENT_VERIFIED |
| UX-ADM-008 | API endpoint設定/一覧を見る | `/admin/api-endpoints` | FN-ADM-003 | CURRENT_VERIFIED |
| UX-ADM-009 | API endpointを作成/編集/有効化等する | `/admin/api-endpoints` | FN-ADM-003 | CURRENT_VERIFIED |
| UX-ADM-010 | endpoint security/validation/resultを確認する | `/admin/api-endpoints` | FN-ADM-003 | CURRENT_VERIFIED |

## Audit / history / restore

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-ADM-011 | audit logsを検索/filterする | `/admin/audit` | FN-ADM-004 | CURRENT_VERIFIED |
| UX-ADM-012 | audit detailを開く | `/admin/audit/[id]` | FN-ADM-004 | CURRENT_VERIFIED |
| UX-ADM-013 | before/after等の変更差分を見る | audit detail | FN-ADM-004 | CURRENT_VERIFIED |
| UX-ADM-014 | actor/対象/関連entityへ辿る | audit detail | FN-ADM-004 | CURRENT_VERIFIED |
| UX-ADM-015 | restore対象をpreviewする | `/admin/audit/restore` | FN-ADM-005 | CURRENT_VERIFIED |
| UX-ADM-016 | restoreを明示確認して実行する | `/admin/audit/restore` | FN-ADM-005 | CURRENT_VERIFIED |
| UX-ADM-017 | restore conflict/error/resultを見る | `/admin/audit/restore` | FN-ADM-005 | CURRENT_VERIFIED |
| UX-ADM-018 | audit settingsを見る/変更する | `/admin/audit/settings` | FN-ADM-006 | CURRENT_VERIFIED |
| UX-ADM-019 | history viewを検索/閲覧する | `/admin/history` | FN-ADM-015 | MERGED_INTO_OTHER |
| UX-ADM-020 | audit/historyの意味差を維持する | audit/history | FN-ADM-004,FN-ADM-015 | OBSOLETE |

## Cost guard / operations

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-ADM-021 | current cost/operation modeを見る | `/admin/cost-guard` | FN-ADM-007 | CURRENT_VERIFIED |
| UX-ADM-022 | cost/operation modeを変更する | `/admin/cost-guard` | FN-ADM-007 | CURRENT_VERIFIED |
| UX-ADM-023 | concurrent/CAS conflict時に再読込判断できる | `/admin/cost-guard` | FN-ADM-007 | CURRENT_VERIFIED |
| UX-ADM-024 | mode変更がbanner/関連surfaceへ反映される | admin/manage/maintenance | FN-ADM-007,FN-PLAT-011 | CURRENT_VERIFIED |

## Event groups / events / templates

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-ADM-025 | event group一覧/検索を見る | `/admin/event-groups` | FN-ADM-008 | CURRENT_VERIFIED |
| UX-ADM-026 | event groupを作成する | `/admin/event-groups/new` | FN-ADM-008 | CURRENT_VERIFIED |
| UX-ADM-027 | event groupを編集する | `/admin/event-groups/[id]/edit` | FN-ADM-008 | CURRENT_VERIFIED |
| UX-ADM-028 | group slug/relation validation/audit結果を見る | event groups | FN-ADM-008 | CURRENT_VERIFIED |
| UX-ADM-029 | all event一覧/検索を見る | `/admin/events` | FN-ADM-009 | CURRENT_VERIFIED |
| UX-ADM-030 | event admin detailを見る | `/admin/events/[id]` | FN-ADM-009 | MERGED_INTO_OTHER |
| UX-ADM-031 | eventを新規作成する | `/admin/events/new` | FN-ADM-009 | CURRENT_VERIFIED |
| UX-ADM-032 | eventを編集する | `/admin/events/[id]/edit` | FN-ADM-009 | MERGED_INTO_OTHER |
| UX-ADM-033 | event owner/stage/visibility invariantを守って変更する | admin events | FN-ADM-009,FN-X-001 | CURRENT_VERIFIED |
| UX-ADM-034 | admin event slotsを確認/管理する | `/admin/events/[id]/slots` | FN-ADM-009,FN-MNG-006 | MERGED_INTO_OTHER |
| UX-ADM-035 | admin event staffを確認/管理する | `/admin/events/[id]/staff` | FN-ADM-011 | MERGED_INTO_OTHER |
| UX-ADM-036 | dangerous event operation前に明示確認を受ける | event admin | FN-ADM-012 | CURRENT_VERIFIED |
| UX-ADM-037 | dangerous event operationのaudit/resultを見る | event admin | FN-ADM-012,FN-X-005 | CURRENT_VERIFIED |
| UX-ADM-038 | event templates一覧を見る | `/admin/events/templates` | FN-ADM-010 | CURRENT_VERIFIED |
| UX-ADM-039 | event templateを作成/編集/適用する | templates | FN-ADM-010 | CURRENT_VERIFIED |
| UX-ADM-040 | template integrity/errorを見る | templates | FN-ADM-010 | CURRENT_VERIFIED |

## Health / integrity / security / workers

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-ADM-041 | service health summaryを見る | `/admin/health` | FN-ADM-013 | CURRENT_VERIFIED |
| UX-ADM-042 | abnormal health itemを特定する | `/admin/health` | FN-ADM-013 | CURRENT_VERIFIED |
| UX-ADM-043 | integrity checksを実行/閲覧する | `/admin/health/integrity` | FN-ADM-014 | CURRENT_VERIFIED |
| UX-ADM-044 | integrity checkをdefault read-onlyとして扱う | integrity | FN-ADM-014 | CURRENT_VERIFIED |
| UX-ADM-045 | security diagnosticsを見る | `/admin/security` | FN-ADM-021 | CURRENT_VERIFIED |
| UX-ADM-046 | secret/private dataをsecurity UIへ露出させない | security | FN-ADM-021,FN-X-004 | CURRENT_VERIFIED |
| UX-ADM-047 | Worker/job healthを見る | `/admin/workers` | FN-ADM-027 | CURRENT_VERIFIED |
| UX-ADM-048 | failed/degraded Worker/jobを識別する | `/admin/workers` | FN-ADM-027 | CURRENT_VERIFIED |

## Legacy import / moderation / notifications

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-ADM-049 | legacy import入力/対象を選ぶ | `/admin/import` | FN-ADM-016 | CURRENT_VERIFIED |
| UX-ADM-050 | import前preview/validationを見る | `/admin/import` | FN-ADM-016 | CURRENT_VERIFIED |
| UX-ADM-051 | importを明示実行する | `/admin/import` | FN-ADM-016 | CURRENT_VERIFIED |
| UX-ADM-052 | import partial failure/result/recovery情報を見る | `/admin/import` | FN-ADM-016 | CURRENT_VERIFIED |
| UX-ADM-053 | moderation case queueを見る | `/admin/moderation` | FN-ADM-017 | CURRENT_VERIFIED |
| UX-ADM-054 | moderation case詳細/理由を見る | `/admin/moderation` | FN-ADM-017 | CURRENT_VERIFIED |
| UX-ADM-055 | moderation transition/判断を実行する | `/admin/moderation` | FN-ADM-017 | CURRENT_VERIFIED |
| UX-ADM-056 | moderation audit/resultを見る | `/admin/moderation` | FN-ADM-017,FN-X-005 | CURRENT_VERIFIED |
| UX-ADM-057 | all notification状態/failureを見る | `/admin/notifications` | FN-ADM-018 | CURRENT_VERIFIED |
| UX-ADM-058 | notificationをfilter/searchする | `/admin/notifications` | FN-ADM-018 | CURRENT_VERIFIED |
| UX-ADM-059 | retry可能notificationを再試行する | `/admin/notifications` | FN-ADM-018,FN-JOB-006 | CURRENT_VERIFIED |
| UX-ADM-060 | retry idempotency/resultを確認する | `/admin/notifications` | FN-ADM-018,FN-JOB-006 | CURRENT_VERIFIED |

## Permissions / rules

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-ADM-061 | permission simulatorへ条件を入力する | `/admin/permissions/simulator` | FN-ADM-019 | CURRENT_VERIFIED |
| UX-ADM-062 | simulator resultを見る | permission simulator | FN-ADM-019 | CURRENT_VERIFIED |
| UX-ADM-063 | simulatorがproduction permission coreと同じ結果を返す | permission simulator | FN-ADM-019,FN-X-002 | CURRENT_VERIFIED |
| UX-ADM-064 | rules/terms versions一覧を見る | `/admin/rules` | FN-ADM-020 | CURRENT_VERIFIED |
| UX-ADM-065 | rules/termsを新規作成する | `/admin/rules/new` | FN-ADM-020 | CURRENT_VERIFIED |
| UX-ADM-066 | rules/termsを編集する | `/admin/rules/[id]/edit` | FN-ADM-020 | CURRENT_VERIFIED |
| UX-ADM-067 | active/version/publish stateを管理する | rules | FN-ADM-020 | CURRENT_VERIFIED |
| UX-ADM-068 | terms更新がreaccept requirementへ反映される | rules/auth | FN-ADM-020,FN-AUTH-006 | CURRENT_VERIFIED |

## Spreadsheet / static builds

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-ADM-069 | DB/table browserで対象dataを検索/閲覧する | `/admin/spreadsheet` | FN-ADM-022 | CURRENT_VERIFIED |
| UX-ADM-070 | permitted data edit/write operationを行う | `/admin/spreadsheet` | FN-ADM-022 | CURRENT_VERIFIED |
| UX-ADM-071 | dangerous/unsupported DB operationが明示的に抑止される | spreadsheet | FN-ADM-022 | CURRENT_VERIFIED |
| UX-ADM-072 | DB operationのvalidation/audit/resultを見る | spreadsheet | FN-ADM-022,FN-X-005 | CURRENT_VERIFIED |
| UX-ADM-073 | static build/rebuild job一覧とstateを見る | `/admin/static-builds` | FN-ADM-023,FN-PLAT-010 | CURRENT_VERIFIED |
| UX-ADM-074 | failed rebuildをretryする | static builds | FN-ADM-023 | CURRENT_VERIFIED |
| UX-ADM-075 | build queue/coalescing/pending/success/failureを確認する | static builds | FN-ADM-023,FN-PLAT-003 | CURRENT_VERIFIED |

## Users

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-ADM-076 | user一覧/検索/filterを見る | `/admin/users` | FN-ADM-024 | CURRENT_VERIFIED |
| UX-ADM-077 | user詳細を開く | `/admin/users/[id]` | FN-ADM-024 | CURRENT_VERIFIED |
| UX-ADM-078 | user account/X/role/ban等の管理情報を見る | user detail | FN-ADM-024 | CURRENT_VERIFIED |
| UX-ADM-079 | user編集画面を開く | `/admin/users/[id]/edit` | FN-ADM-024 | CURRENT_VERIFIED |
| UX-ADM-080 | permitted user fields/role/stateを編集する | user edit | FN-ADM-024 | CURRENT_VERIFIED |
| UX-ADM-081 | ban/unban等のsecurity-sensitive state変更を確認付きで行う | user admin | FN-ADM-024 | CURRENT_VERIFIED |
| UX-ADM-082 | user変更のvalidation/conflict/audit/resultを見る | user admin | FN-ADM-024,FN-X-005 | CURRENT_VERIFIED |

## Videos / members

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-ADM-083 | all video一覧/検索/filterを見る | `/admin/videos` | FN-ADM-025 | CURRENT_VERIFIED |
| UX-ADM-084 | video admin detailを開く | `/admin/videos/[id]` | FN-ADM-025 | CURRENT_VERIFIED |
| UX-ADM-085 | video metadata/status/visibility/event等の管理情報を見る | video admin | FN-ADM-025 | CURRENT_VERIFIED |
| UX-ADM-086 | permitted video state/metadataを変更する | video admin | FN-ADM-025 | CURRENT_VERIFIED |
| UX-ADM-087 | video visibility changeのpublic reflection状態を見る | video admin | FN-ADM-025,FN-PLAT-004 | CURRENT_VERIFIED |
| UX-ADM-088 | video member管理画面を開く | `/admin/videos/[id]/members` | FN-ADM-026 | CURRENT_VERIFIED |
| UX-ADM-089 | member追加/編集/削除を行う | video members | FN-ADM-026 | CURRENT_VERIFIED |
| UX-ADM-090 | member permission/public/chapter関連状態を管理する | video members | FN-ADM-026 | CURRENT_VERIFIED |
| UX-ADM-091 | video/member変更のaudit/conflict/resultを見る | video admin | FN-ADM-025,FN-ADM-026,FN-X-005 | CURRENT_VERIFIED |

## X identity admin

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-ADM-092 | X ID merge queue/候補を見る | `/admin/x-id-merges` | FN-ADM-028 | CURRENT_VERIFIED |
| UX-ADM-093 | merge前に影響対象をpreviewする | X merges | FN-ADM-028 | CURRENT_VERIFIED |
| UX-ADM-094 | X ID mergeを明示確認して実行する | X merges | FN-ADM-028 | CURRENT_VERIFIED |
| UX-ADM-095 | merge conflict/audit/resultを見る | X merges | FN-ADM-028,FN-X-005 | CURRENT_VERIFIED |
| UX-ADM-096 | X link request queueを見る | `/admin/x-link-requests` | FN-ADM-029 | CURRENT_VERIFIED |
| UX-ADM-097 | X link request detail/evidenceを見る | X link requests | FN-ADM-029 | CURRENT_VERIFIED |
| UX-ADM-098 | X link requestをapprove/rejectする | X link requests | FN-ADM-029 | CURRENT_VERIFIED |
| UX-ADM-099 | X link decisionのaudit/resultを見る | X link requests | FN-ADM-029,FN-X-005 | CURRENT_VERIFIED |

## YouTube quota / sync

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-ADM-100 | YouTube quota usage/thresholdを見る | `/admin/youtube-quota` | FN-ADM-030 | CURRENT_VERIFIED |
| UX-ADM-101 | quota warning/degraded stateを見る | YouTube quota | FN-ADM-030 | CURRENT_VERIFIED |
| UX-ADM-102 | sync job一覧/stateを見る | `/admin/youtube-sync` | FN-ADM-031 | CURRENT_VERIFIED |
| UX-ADM-103 | failed syncをretryする | YouTube sync | FN-ADM-031,FN-JOB-005 | CURRENT_VERIFIED |
| UX-ADM-104 | sync pending/progress/error/resultを見る | YouTube sync | FN-ADM-031 | CURRENT_VERIFIED |
| UX-ADM-105 | playlist sync一覧/stateを見る | `/admin/youtube-sync/playlists` | FN-ADM-031 | CURRENT_VERIFIED |
| UX-ADM-106 | playlist syncを開始/retryする | playlist sync | FN-ADM-031,FN-JOB-005 | CURRENT_VERIFIED |
| UX-ADM-107 | quota/idempotency/failure状態をplaylist単位で確認する | playlist sync | FN-ADM-031 | CURRENT_VERIFIED |

## Notes

- page単位の大項目だけでなく、CRUD/action/state/permission/retry/destructive confirmationを別UXとして追跡する。
- MIG-0003/0004/0008/0009で実action/API/jobと結びつけ、存在しない候補は`REQUIREMENT_ONLY`または削除提案へ明示的にdispositionする。
- backend共通化の都合でこれらを一括機能へ潰さない。