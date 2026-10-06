# Manage / Admin Function Ledger

> Status: Active / Function ledger
> Last updated: 2026-10-06
> Baseline commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Index: [`../FUNCTION_INVENTORY.md`](../FUNCTION_INVENTORY.md)

Manage/Adminは画面数・権限・危険操作が多いため、リデザイン完了とfunctional parityを別々に追跡する。

## Manage

| ID | Existing function | Main surfaces | Critical contract | State |
| --- | --- | --- | --- | --- |
| FN-MNG-001 | 担当イベント一覧/要対応把握 | `/manage` | staff scope | DETAIL_AUDIT_REQUIRED |
| FN-MNG-002 | event workspace overview | `/manage/events/[id]` | event permission | DETAIL_AUDIT_REQUIRED |
| FN-MNG-003 | audience情報確認 | `.../audience` | permission/privacy | DETAIL_AUDIT_REQUIRED |
| FN-MNG-004 | event settings編集 | `.../edit`, event actions | permission/stage/validation | DETAIL_AUDIT_REQUIRED |
| FN-MNG-005 | review queue/審査 | `.../review` | reviewer permission/status transition | DETAIL_AUDIT_REQUIRED |
| FN-MNG-006 | slot運用 | `.../slots`, slot admin | slot state/notification | DETAIL_AUDIT_REQUIRED |
| FN-MNG-007 | staff管理 | `.../staff`, event-staff | owner最低1人/permission preset | DETAIL_AUDIT_REQUIRED |
| FN-MNG-008 | event作品一覧管理 | `.../videos` | event privilege/filters | DETAIL_AUDIT_REQUIRED |
| FN-MNG-009 | event作品1件処理 | `.../videos/[videoId]` | status/edit permission/audit | DETAIL_AUDIT_REQUIRED |
| FN-MNG-010 | event YouTube playlist同期管理 | `.../youtube-playlist` | quota/sync state | DETAIL_AUDIT_REQUIRED |
| FN-MNG-011 | 通知失敗/状態管理 | `/manage/notifications` | event scope/retry | DETAIL_AUDIT_REQUIRED |
| FN-MNG-012 | X link request処理 | `/manage/x-link-requests` | delegated permission/audit | DETAIL_AUDIT_REQUIRED |

## Admin

| ID | Existing function | Main surfaces | Critical contract | State |
| --- | --- | --- | --- | --- |
| FN-ADM-001 | admin dashboard/対応待ち | `/admin` | admin only | DETAIL_AUDIT_REQUIRED |
| FN-ADM-002 | announcements CRUD | `/admin/announcements*`, announcement action | publish state/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-003 | API endpoint設定/管理 | `/admin/api-endpoints`, api-endpoints action | admin/security | DETAIL_AUDIT_REQUIRED |
| FN-ADM-004 | audit検索/詳細 | `/admin/audit*` | immutable/auditable access | DETAIL_AUDIT_REQUIRED |
| FN-ADM-005 | audit restore | `/admin/audit/restore` | dangerous action/strict audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-006 | audit settings | `/admin/audit/settings` | admin write/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-007 | cost guard | `/admin/cost-guard` | operation mode/full-row CAS/KV mirror | DETAIL_AUDIT_REQUIRED |
| FN-ADM-008 | event groups CRUD | `/admin/event-groups*` | slug/relation/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-009 | events CRUD/admin detail | `/admin/events*` | owner invariant/stage/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-010 | event template管理 | `/admin/events/templates` | template integrity | DETAIL_AUDIT_REQUIRED |
| FN-ADM-011 | event staff admin | admin/manage staff | owner/permission invariant | DETAIL_AUDIT_REQUIRED |
| FN-ADM-012 | dangerous event operations | event-admin-danger | explicit admin/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-013 | health dashboard | `/admin/health` | diagnostic/read-only semantics | DETAIL_AUDIT_REQUIRED |
| FN-ADM-014 | integrity checks | `/admin/health/integrity` | data health/no mutation by default | DETAIL_AUDIT_REQUIRED |
| FN-ADM-015 | history閲覧 | `/admin/history` | audit/history distinction | DETAIL_AUDIT_REQUIRED |
| FN-ADM-016 | legacy import | `/admin/import` | dedicated legacy boundary/preview | DETAIL_AUDIT_REQUIRED |
| FN-ADM-017 | moderation cases | `/admin/moderation` | state transition/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-018 | notification admin/retry | `/admin/notifications` | retry/idempotency/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-019 | permission simulator | `/admin/permissions/simulator` | must match real permission core | DETAIL_AUDIT_REQUIRED |
| FN-ADM-020 | rules/terms CRUD | `/admin/rules*` | versioning/acceptance effect | DETAIL_AUDIT_REQUIRED |
| FN-ADM-021 | security diagnostics | `/admin/security` | admin-only/no secret leak | DETAIL_AUDIT_REQUIRED |
| FN-ADM-022 | spreadsheet/DB browser | `/admin/spreadsheet` | admin/read-write boundary | DETAIL_AUDIT_REQUIRED |
| FN-ADM-023 | static build/rebuild管理 | `/admin/static-builds`, static-rebuild-admin | queue/job state/idempotency | DETAIL_AUDIT_REQUIRED |
| FN-ADM-024 | users search/detail/edit | `/admin/users*`, user-admin | auth state/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-025 | videos search/detail/admin | `/admin/videos*`, admin/manage actions | status/permission/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-026 | video members admin | `/admin/videos/[id]/members`, adminMembers | membership/permission | DETAIL_AUDIT_REQUIRED |
| FN-ADM-027 | workers monitoring | `/admin/workers` | worker/job health | DETAIL_AUDIT_REQUIRED |
| FN-ADM-028 | X ID merge | `/admin/x-id-merges`, xid-merge-admin | destructive merge/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-029 | X link requests | `/admin/x-link-requests`, xid-admin | approval/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-030 | YouTube quota | `/admin/youtube-quota` | quota counters/thresholds | DETAIL_AUDIT_REQUIRED |
| FN-ADM-031 | YouTube sync管理 | `/admin/youtube-sync*`, youtube-sync-admin | retry/quota/idempotency | DETAIL_AUDIT_REQUIRED |

## Audit expansion template

```text
Users/Roles:
Current UI routes:
Current API/actions:
Inputs/Outputs:
Auth/Permissions:
DB reads/writes:
Audit/Queue/R2/KV/Notification/External effects:
Visibility/privacy:
Loading/error/empty/permission states:
Destructive confirmation:
Current tests:
Known edge cases:
Target owner/UI/API:
Bridge/Rollback:
Acceptance/Evidence:
```
