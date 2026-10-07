# Platform / API / Jobs / Cross-cutting Function Ledger

> Status: Active / Function ledger
> Last updated: 2026-10-06
> Baseline commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Index: [`../FUNCTION_INVENTORY.md`](../FUNCTION_INVENTORY.md)

Platform保証は画面に現れにくいが、移行時の欠落が最も危険な領域。特にvisibility、audit、retry/idempotency、public DTO、rollbackをUI機能とは別に追跡する。MIG-0007で static/public delivery の FN-PLAT-002..008（001/009/010は別scope）および FN-X-004/FN-X-010 を `static-delivery/README.md` の証拠でCURRENT_VERIFIED化した。MIG-0008で event owner invariant と server-side authorization boundary（FN-X-001/FN-X-002）を `auth/README.md` の証拠でCURRENT_VERIFIED化した。MIG-0009で background execution の FN-JOB-001..008、Queue retry/idempotency（FN-X-006）、content build/rebuild admin visibility（FN-PLAT-010）を `background-jobs/README.md` の証拠でCURRENT_VERIFIED化した。

## Platform / static delivery

| ID | Existing function | Main surfaces | Critical contract | State |
| --- | --- | --- | --- | --- |
| FN-PLAT-001 | D1をcanonical sourceにする | DB/domain | R2/KVをcanonicalにしない | DETAIL_AUDIT_REQUIRED |
| FN-PLAT-002 | public DTO projection | public API/static generator | explicit safe DTO only | CURRENT_VERIFIED |
| FN-PLAT-003 | static artifact generation | content-jobs/static rebuild | coalesce/retry/dedupe | CURRENT_VERIFIED |
| FN-PLAT-004 | visibility fence | public loader/manifest | public→private即fail-closed | CURRENT_VERIFIED |
| FN-PLAT-005 | visibility repair | public-visibility-repair | safe repair/audit | CURRENT_VERIFIED |
| FN-PLAT-006 | R2 artifact hash/dedupe | content/static artifact | unnecessary PUT回避/integrity | CURRENT_VERIFIED |
| FN-PLAT-007 | degraded D1/public fallback policy | static delivery | fail-open禁止対象を維持 | CURRENT_VERIFIED |
| FN-PLAT-008 | search index/shards | content-jobs/public search | bounded generation/query contract | CURRENT_VERIFIED |
| FN-PLAT-009 | score/trending analytics | jobs/R2 analytics | scoring/order contract | DETAIL_AUDIT_REQUIRED |
| FN-PLAT-010 | content build/rebuild admin visibility | admin static builds | state/retry visibility | CURRENT_VERIFIED |
| FN-PLAT-011 | maintenance状態を全ユーザーへ案内 | `/maintenance` | operation modeに応じた正確な状態/次行動、admin例外 | DETAIL_AUDIT_REQUIRED |
| FN-PLAT-012 | 既存UI surfaceを開発者が確認 | `/dev/ui-surfaces` | dev-only surface、production機能と混同しない | DETAIL_AUDIT_REQUIRED |

## API / media / external

| ID | Existing function | Current API area | Critical contract | State |
| --- | --- | --- | --- | --- |
| FN-API-001 | event endpoint API | `app/api/event-endpoints` | configured/public endpoint contract | DETAIL_AUDIT_REQUIRED |
| FN-API-002 | events API | `app/api/events` | auth/public DTO boundaries | DETAIL_AUDIT_REQUIRED |
| FN-API-003 | videos API | `app/api/videos` | interaction/private overlay/public DTO | DETAIL_AUDIT_REQUIRED |
| FN-API-004 | public API | `app/api/public` | explicit DTO/no leak | DETAIL_AUDIT_REQUIRED |
| FN-API-005 | internal API | `app/api/internal` | internal authentication/bounded use | DETAIL_AUDIT_REQUIRED |
| FN-API-006 | live API | `app/api/live` | realtime/current state | DETAIL_AUDIT_REQUIRED |
| FN-API-007 | software catalog API | `app/api/software` | normalized catalog/search | DETAIL_AUDIT_REQUIRED |
| FN-API-008 | health API | `app/api/health` | diagnostic semantics | DETAIL_AUDIT_REQUIRED |
| FN-API-009 | YouTube thumbnail proxy | `app/api/youtube-thumbnail` | URL safety/cache/CPU | DETAIL_AUDIT_REQUIRED |
| FN-API-010 | Google Drive image proxy | `app/api/google-drive-image` | URL safety/cache/CPU | DETAIL_AUDIT_REQUIRED |
| FN-API-011 | media APIs | `app/api/media` | R2/media visibility/streaming | DETAIL_AUDIT_REQUIRED |

## Background jobs / integrations

| ID | Existing function | Current owner | Critical contract | State |
| --- | --- | --- | --- | --- |
| FN-JOB-001 | fast job scheduling/processing | `flamenode-fast-jobs` | bounded work/retry | CURRENT_VERIFIED |
| FN-JOB-002 | content/static generation | `flamenode-content-jobs` | target/coalesce/retry | CURRENT_VERIFIED |
| FN-JOB-003 | sync jobs | `flamenode-sync-jobs` | external sync/quota/retry | CURRENT_VERIFIED |
| FN-JOB-004 | Queue wake/DLQ/recovery | workers/queues | idempotency/redelivery/recovery | CURRENT_VERIFIED |
| FN-JOB-005 | YouTube metadata/playlist sync | sync/actions | quota/dedupe/failure state | CURRENT_VERIFIED |
| FN-JOB-006 | notifications/Discord | notification subsystem | delivery/retry/no duplicate | CURRENT_VERIFIED |
| FN-JOB-007 | cleanup jobs | workers | bounded deletion/no data loss | CURRENT_VERIFIED |
| FN-JOB-008 | static rebuild follow-up fanout | content-jobs | dependency/dedupe/no storm | CURRENT_VERIFIED |

## Cross-cutting invariants

| ID | Invariant | Evidence area | State |
| --- | --- | --- | --- |
| FN-X-001 | event ownerを0人にしない | permission/event staff | CURRENT_VERIFIED |
| FN-X-002 | UIだけで認可しない | auth/write guards | CURRENT_VERIFIED |
| FN-X-003 | public APIは明示DTOのみ | publicDto/routes | DETAIL_AUDIT_REQUIRED |
| FN-X-004 | private dataをpublic artifactへ出さない | projection/visibility | CURRENT_VERIFIED |
| FN-X-005 | mutation auditを維持 | audit helpers/actions | DETAIL_AUDIT_REQUIRED |
| FN-X-006 | Queue retry/idempotencyを維持 | queue consumers | CURRENT_VERIFIED |
| FN-X-007 | existing migration SQLを改変しない | migrations | CURRENT_VERIFIED |
| FN-X-008 | Remote D1 migrationを自動適用しない | deploy docs/scripts | CURRENT_VERIFIED |
| FN-X-009 | legacy importを専用境界外へ広げない | admin import | DETAIL_AUDIT_REQUIRED |
| FN-X-010 | public visibilityはfail-closed対象を維持 | static delivery | CURRENT_VERIFIED |
| FN-X-011 | URL/canonical互換を維持 | public routes | DETAIL_AUDIT_REQUIRED |
| FN-X-012 | production changeはrollback可能にする | routing/deploy | DETAIL_AUDIT_REQUIRED |

## Audit expansion template

```text
Users/Roles:
Current UI routes:
Current API/actions/jobs:
Inputs/Outputs:
Auth/Permissions:
DB reads/writes:
Audit/Queue/R2/KV/Notification/External effects:
Visibility/privacy:
Retry/idempotency/partial-failure behavior:
Current tests/checks:
Known edge cases:
Target owner/API/job:
Bridge/Rollback:
Acceptance/Evidence:
```
