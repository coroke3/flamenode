# Public / Discovery / Playback Function Ledger

> Status: Active / Function ledger
> Last updated: 2026-10-07
> Baseline commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Index: [`../FUNCTION_INVENTORY.md`](../FUNCTION_INVENTORY.md)

MIG-0002 / MIG-0010 で画面との対応を確定し、関連API/actionはMIG-0003/0004で追記する。

| ID | Existing function | Main surfaces | Critical contract | State |
| --- | --- | --- | --- | --- |
| FN-PUB-001 | トップで新着・注目・イベント等を発見 | `/` | publicのみ、棚/順序契約 | CURRENT_VERIFIED |
| FN-PUB-002 | 作品詳細を開く | `/[id]` | internal/YouTube alias、visibility | CURRENT_VERIFIED |
| FN-PUB-003 | YouTube作品を再生 | `/[id]` | embed/player状態 | CURRENT_VERIFIED |
| FN-PUB-004 | 作品metadata/説明/credit/music表示 | `/[id]` | public DTO、SEO | CURRENT_VERIFIED |
| FN-PUB-005 | 作品chapter表示 | `/[id]` | public/private境界 | CURRENT_VERIFIED |
| FN-PUB-006 | view計測 | `/[id]` | 重複、集計、非同期副作用 | CURRENT_VERIFIED |
| FN-PUB-007 | like/bookmark作品interaction | `/[id]` | TARGETはlike/bookmarkともActive X所有、auth/匿名状態、idempotency | CURRENT_DIVERGENCE |
| FN-PUB-008 | viewer utility/private overlay | `/[id]` | private data leak禁止 | CURRENT_VERIFIED |
| FN-PUB-009 | イベント一覧 | `/event` | public eventのみ | CURRENT_VERIFIED |
| FN-PUB-010 | イベント詳細/作品一覧 | `/event/[id]` | visibility/stage | CURRENT_VERIFIED |
| FN-PUB-011 | イベントrelease連続閲覧 | `/event/[id]/release` | release順/公開状態 | CURRENT_VERIFIED |
| FN-PUB-012 | 公開枠状況 | `/event/[id]/slots` | live/公開可能情報のみ | CURRENT_VERIFIED |
| FN-PUB-013 | イベントグループ一覧/詳細 | `/groups*` | group visibility | CURRENT_VERIFIED |
| FN-PUB-014 | 作品一覧・filter・search | `/list` | filter/query semantics | CURRENT_VERIFIED |
| FN-PUB-015 | recommend表示 | `/recommend` | algorithm/output contract | CURRENT_VERIFIED |
| FN-PUB-016 | trending表示 | `/trending` | analytics artifact/order | CURRENT_VERIFIED |
| FN-PUB-017 | creator一覧 | `/user` | public-listable X/userのみ | CURRENT_VERIFIED |
| FN-PUB-018 | creator profile/作品 | `/user/[id]` | visibility/profile contract | CURRENT_VERIFIED |
| FN-PUB-019 | creator portfolio | `/user/[id]/portfolio` | work ordering/navigation | CURRENT_VERIFIED |
| FN-PUB-020 | about | `/about` | static content | CURRENT_VERIFIED |
| FN-PUB-021 | rules public閲覧 | `/rules` | active terms/version | CURRENT_VERIFIED |
| FN-PUB-022 | SEO/canonical/OGP | public detail pages | URL/metadata parity | CURRENT_VERIFIED |
| FN-PUB-023 | 公開お知らせ表示 | `/` | publish対象だけ表示、本文/順序/空状態 | CURRENT_VERIFIED |
| FN-PUB-024 | 公開統計・募集中イベント/空き枠概要表示 | `/` | publicVideos/creators/activeEvents、primary event/slot summary | CURRENT_VERIFIED |
| FN-PUB-025 | 全体公開ナビゲーション/モバイルメニュー | public layout | active state、dismiss/focus、responsive navigation | CURRENT_VERIFIED |
| FN-PUB-026 | 公開ヘッダーから作品検索 | public layout → `/list?q=` | IME-safe GET、query/deep-link、mobile/desktop parity | CURRENT_VERIFIED |
| FN-PUB-027 | ライト/ダークテーマ切替 | public/global UI | localStorage永続化、system preference追従、accessible state | CURRENT_VERIFIED |

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
