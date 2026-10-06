# Public / Discovery / Playback Function Ledger

> Status: Active / Function ledger
> Last updated: 2026-10-06
> Baseline commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Index: [`../FUNCTION_INVENTORY.md`](../FUNCTION_INVENTORY.md)

MIG-0002 / MIG-0010 で画面との対応を確定し、関連API/actionはMIG-0003/0004で追記する。

| ID | Existing function | Main surfaces | Critical contract | State |
| --- | --- | --- | --- | --- |
| FN-PUB-001 | トップで新着・注目・イベント等を発見 | `/` | publicのみ、棚/順序契約 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-002 | 作品詳細を開く | `/[id]` | internal/YouTube alias、visibility | DETAIL_AUDIT_REQUIRED |
| FN-PUB-003 | YouTube作品を再生 | `/[id]` | embed/player状態 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-004 | 作品metadata/説明/credit/music表示 | `/[id]` | public DTO、SEO | DETAIL_AUDIT_REQUIRED |
| FN-PUB-005 | 作品chapter表示 | `/[id]` | public/private境界 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-006 | view計測 | `/[id]` | 重複、集計、非同期副作用 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-007 | like等の作品interaction | `/[id]` | auth/匿名状態、idempotency | DETAIL_AUDIT_REQUIRED |
| FN-PUB-008 | viewer utility/private overlay | `/[id]` | private data leak禁止 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-009 | イベント一覧 | `/event` | public eventのみ | DETAIL_AUDIT_REQUIRED |
| FN-PUB-010 | イベント詳細/作品一覧 | `/event/[id]` | visibility/stage | DETAIL_AUDIT_REQUIRED |
| FN-PUB-011 | イベントrelease連続閲覧 | `/event/[id]/release` | release順/公開状態 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-012 | 公開枠状況 | `/event/[id]/slots` | live/公開可能情報のみ | DETAIL_AUDIT_REQUIRED |
| FN-PUB-013 | イベントグループ一覧/詳細 | `/groups*` | group visibility | DETAIL_AUDIT_REQUIRED |
| FN-PUB-014 | 作品一覧・filter・search | `/list` | filter/query semantics | DETAIL_AUDIT_REQUIRED |
| FN-PUB-015 | recommend表示 | `/recommend` | algorithm/output contract | DETAIL_AUDIT_REQUIRED |
| FN-PUB-016 | trending表示 | `/trending` | analytics artifact/order | DETAIL_AUDIT_REQUIRED |
| FN-PUB-017 | creator一覧 | `/user` | public-listable X/userのみ | DETAIL_AUDIT_REQUIRED |
| FN-PUB-018 | creator profile/作品 | `/user/[id]` | visibility/profile contract | DETAIL_AUDIT_REQUIRED |
| FN-PUB-019 | creator portfolio | `/user/[id]/portfolio` | work ordering/navigation | DETAIL_AUDIT_REQUIRED |
| FN-PUB-020 | about | `/about` | static content | DETAIL_AUDIT_REQUIRED |
| FN-PUB-021 | rules public閲覧 | `/rules` | active terms/version | DETAIL_AUDIT_REQUIRED |
| FN-PUB-022 | SEO/canonical/OGP | public detail pages | URL/metadata parity | DETAIL_AUDIT_REQUIRED |

## Audit expansion template

各行を`CURRENT_VERIFIED`へ上げる際は最低限以下を追記する。

```text
Users/Roles:
Current UI routes:
Current API/actions:
Inputs/Outputs:
Auth/Permissions:
DB reads/writes:
Audit/Queue/R2/KV/External effects:
Visibility/privacy:
Loading/error/empty states:
Current tests:
Known edge cases:
Target owner/UI/API:
Bridge/Rollback:
Acceptance/Evidence:
```
