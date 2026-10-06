# Auth / Personal / Entry Function Ledger

> Status: Active / Function ledger
> Last updated: 2026-10-07
> Baseline commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Index: [`../FUNCTION_INVENTORY.md`](../FUNCTION_INVENTORY.md)

AuthはPhase 8までproduction source of truthをCURRENT Auth.jsへ残す。Personal/Entryはリデザイン時も機能・権限・副作用を維持する。

## Authentication / account

| ID | Existing function | Main surfaces | Critical contract | State |
| --- | --- | --- | --- | --- |
| FN-AUTH-001 | Discord OAuth login | Auth.js/API | callback/origin/session | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-002 | session復元 | auth/current user | existing sessions compatibility | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-003 | Discord account linking | auth adapter/config | duplicate/link safety | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-004 | banned/role state反映 | auth/session | authorization safety | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-005 | onboarding | `/onboarding` | required initial steps | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-006 | terms同意 | onboarding/terms action | version/user acceptance | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-007 | auth complete redirect | `/auth/complete` | safe redirect/canonical host | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-008 | logout/session終了 | Auth.js | cookie/session invalidation | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-009 | account summary/private account API | public header/account UI, `app/api/account` | presence/details degraded state、authenticated private data、privileged link fail-closed | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-010 | Active X ID切替 | account menu / `useActiveXSwitcher` | approvedのみ切替、pending/error state、切替後summary再取得 | DETAIL_AUDIT_REQUIRED |

## Personal dashboard / owned videos

| ID | Existing function | Main surfaces | Critical contract | State |
| --- | --- | --- | --- | --- |
| FN-PER-001 | dashboardで必要作業/作品状態を見る | `/dashboard` | own/related data only | DETAIL_AUDIT_REQUIRED |
| FN-PER-002 | 作品編集 | `/dashboard/edit/[id]`, manage-video/updateVideo | ownership/collab/event privilege | DETAIL_AUDIT_REQUIRED |
| FN-PER-003 | 共同編集権限管理 | permissions page, video-collab-perms | owner/permission parity | DETAIL_AUDIT_REQUIRED |
| FN-PER-004 | library閲覧 | `/dashboard/library` | authenticated data | DETAIL_AUDIT_REQUIRED |
| FN-PER-005 | user settings | `/dashboard/settings` | profile/X/session interactions | DETAIL_AUDIT_REQUIRED |
| FN-PER-006 | personal YouTube playlist確認 | `/dashboard/youtube-playlists` | quota/external state | DETAIL_AUDIT_REQUIRED |
| FN-PER-007 | X ID登録/変更/申請 | settings/xid actions | approval/link constraints | DETAIL_AUDIT_REQUIRED |

## Entry / submission / slot

| ID | Existing function | Main surfaces | Critical contract | State |
| --- | --- | --- | --- | --- |
| FN-ENT-001 | entry入口で参加/投稿方法を判断 | `/entry` | auth/event/slot state | DETAIL_AUDIT_REQUIRED |
| FN-ENT-002 | slot確保/状態管理 | slot actions | capacity/duplicate/auth | DETAIL_AUDIT_REQUIRED |
| FN-ENT-003 | slot付き作品提出 | `/entry/slotted`, submitSlotVideo | deadline/slot ownership | DETAIL_AUDIT_REQUIRED |
| FN-ENT-004 | 通常作品投稿 | `/entry/unslotted`, createFreeVideo | duplicate/input/visibility defaults | DETAIL_AUDIT_REQUIRED |
| FN-ENT-005 | YouTube quick input/metadata取得 | entry/video | duplicate detection/quota | DETAIL_AUDIT_REQUIRED |
| FN-ENT-006 | custom question回答 | entry/event | event schema/validation | DETAIL_AUDIT_REQUIRED |

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
Current tests:
Known edge cases:
Target owner/UI/API:
Bridge/Rollback:
Acceptance/Evidence:
```
