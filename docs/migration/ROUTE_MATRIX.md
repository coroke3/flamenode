# FlameNode Route Migration Matrix

> Status: Active / Route progress source of truth
> Last updated: 2026-10-06
> Architecture: [`README.md`](README.md)
> Progress: [`STATUS.md`](STATUS.md)
> Frontend capabilities: [`FRONTEND_FEATURES.md`](FRONTEND_FEATURES.md)
>
> 画面・URL単位の移行契約を管理する。
> ユーザー向け86 screenのURL/目的/primary actionは `docs/design-redesign/ROUTE_INVENTORY.md` を正本とし、この文書では移行先・technical compatibility route・安全境界を管理する。

## Route inventory classes

CURRENT routeは以下を区別する。

1. **USER_SCREEN** — ユーザー/運営者/管理者/開発者が直接見る画面。86 redesign screensが正本。
2. **TECH_COMPAT** — Next/OpenNext/Free CPU制約等を成立させる内部route。独立したユーザー機能ではないが、置換前に消してはいけない。
3. **API_AUTH** — Route Handler/Auth endpoint。MIG-0004/0008で監査。
4. **GLOBAL_SURFACE** — `error.tsx`, `global-error.tsx`, `not-found.tsx`, robots/sitemap等。機能IDというより全画面横断契約として扱う。
5. **DEV_MOCK** — `/dev/redesign/*` 等のfixture/mock。production capabilityと混同しない。

## USER_SCREEN baseline

2026-10-06 current treeと既存inventoryを照合するbaseline:

| Group | Screens | Canonical source | Initial frontend capabilities |
| --- | ---: | --- | ---: |
| Public | 16 | `docs/design-redesign/ROUTE_INVENTORY.md` | 22 + System public surfaces |
| Personal | 6 | same | 7 |
| Entry | 3 | same | 6 |
| Manage | 12 | same | 12 |
| Admin | 45 | same | 31 |
| System | 4 | same | Auth/System capabilitiesへmapping |
| **Total** | **86** |  | **89 capabilities total across all groups** |

System routes:

- `/dev/ui-surfaces` → `FN-PLAT-012`
- `/maintenance` → `FN-PLAT-011`
- `/onboarding` → `FN-AUTH-005`
- `/auth/complete` → `FN-AUTH-007`

86 screenと89 capabilityは1:1ではない。

## CURRENT technical compatibility routes

これらはCURRENTのFree 10ms/OpenNext対策であり、ブラウザが見るlogical URLの意味を支える内部実装。

| Logical user URL | CURRENT technical route | Trigger / purpose | User contract that must survive | TARGET disposition | State |
| --- | --- | --- | --- | --- | --- |
| `/list?...` | `/list/~query` | `q`, `sort`, `page`, `event`, `view`付きURLをdynamic twinへrewrite | filter/sort/page/query結果、browser URL semantics | Astro/Island側で同query contractを再現後に内部twinを削除 | CURRENT_VERIFIED |
| `/user?...` | `/user/~query` | `q`, `sort`, `page`付きURLをdynamic twinへrewrite | creator検索/filter/pageとURL semantics | 新list implementationで置換後削除 | CURRENT_VERIFIED |
| `/event?...` | `/event/~query` | `q`, `status`, `sort`付きURLをdynamic twinへrewrite | event検索/filter/sortとURL semantics | 新event indexで置換後削除 | CURRENT_VERIFIED |
| `/user/[id]?worksPage=...` / `?collabPage=...` | `/user/[id]/paged` | profile pagination queryをdynamic twinへrewrite | works/collab pagination、deep link/back-forward | Astro/Island paginationで置換後削除 | CURRENT_VERIFIED |

Evidence: `next.config.mjs` の `QUERY_RENDERED_PUBLIC_PAGES` と各shared view / publicHotpathCpu contract test。

ルール:

- technical route自体をfrontend capabilityとして二重計上しない。
- ただしlogical URLのquery semanticsはfrontend capabilityの一部。
- TARGETで内部routeが不要になってもreplacement testなしに削除しない。

## GLOBAL_SURFACE baseline

| Surface | CURRENT | Migration requirement |
| --- | --- | --- |
| root `error.tsx` | global route error UI | 新Public/SPA双方でrecoverable error UXを持つ |
| `global-error.tsx` | root catastrophic error UI | blank screenへ退化させない |
| route-group `error.tsx` | authenticated/group-specific error UI | permission/session stateと混同しないerror UXを維持 |
| `not-found.tsx` | 404 UI | non-public/unknown entityと安全に整合 |
| `robots.ts` | crawler policy | migration/canary/dev URLを意図せずindexさせない |
| `sitemap.ts` | public URL discovery | canonical public entity coverageを維持 |

これらはMIG-0010でscreen capability mappingとは別にcross-cutting acceptanceへ紐付ける。

---

# Target route groups

| Route group | CURRENT | TARGET | Render | Data | Visibility/Auth | State | Task |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/about` | Next/OpenNext | Astro/site | SSG | build snapshot | public | BASELINED | MIG-0501 |
| `/rules*` | Next/OpenNext | Astro/site | SSG | build snapshot | public | BASELINED | MIG-0501 |
| `/event/*` | Next/OpenNext | Astro/site | SSG + Islands | public R2 + live API | visibility fence | BASELINED | MIG-0502 |
| `/groups/*` | Next/OpenNext | Astro/site | SSG | public R2 | visibility fence | BASELINED | MIG-0503 |
| `/user/*` | Next/OpenNext | Astro/site | SSG + Islands | public R2 | visibility fence | BASELINED | MIG-0504 |
| `/list*` | Next/OpenNext | Astro/site | SSG shell + Island | public R2/API | public DTO | BASELINED | MIG-0505 |
| `/recommend*` | Next/OpenNext | Astro/site | SSG shell + Island | public R2/API | public DTO | BASELINED | MIG-0505 |
| `/trending*` | Next/OpenNext | Astro/site | SSG shell + Island | public R2/API | public DTO | BASELINED | MIG-0505 |
| `/maintenance` | Next/OpenNext | site/system | static/system state | operation mode | public/admin exception | BASELINED | MIG-0501 or system cutover task |
| `/` | Next/OpenNext | Astro/site | SSG + Islands | public R2 | public DTO | BASELINED | MIG-0506 |
| `/:id` | Next/OpenNext | Astro/site | SSG + Islands | public R2 + overlay API | visibility fence + alias map | BASELINED | MIG-0507 |
| `/dashboard/*` | Next/OpenNext | React/Vite app | SPA | Hono→D1 | auth + permission | BASELINED | MIG-0701/0702 |
| `/entry/*` | Next/OpenNext | React/Vite app | SPA | Hono→D1 | auth + permission | BASELINED | MIG-0703 |
| `/manage/*` | Next/OpenNext | React/Vite app | SPA | Hono→D1 | auth + event permission | BASELINED | MIG-0704 |
| `/admin/*` | Next/OpenNext | React/Vite app | SPA | Hono→D1 | admin permission | BASELINED | MIG-0705 |
| `/api/*` | Next Route Handler | Hono/api | API | D1/R2/Queue | endpoint contract | API_AUDIT_PENDING | MIG-0004/0601..0605 |
| auth routes | NextAuth/Auth.js | later auth target | API | session DB | auth compatibility | AUTH_AUDIT_PENDING | MIG-0008/0801..0806 |
| `/dev/ui-surfaces` | dev CURRENT UI catalog | migration/dev support | dev | local UI | dev-only | BASELINED | MIG-0201..0205 |
| `/dev/redesign/*` | fixture-only Next mock | migration support only | dev | fixture | none | BASELINED | MIG-0201..0205 |

## Route-level acceptance template

```text
Route:
Class: USER_SCREEN | TECH_COMPAT | API_AUTH | GLOBAL_SURFACE | DEV_MOCK
Current file:
Current owner:
Frontend capability IDs:
Target owner:
Render mode:
Public/private:
Data source:
Mutation endpoints:
Auth/permission:
Visibility fence:
SEO/canonical/OGP:
Dynamic states:
Query/deep-link/history semantics:
Current tests:
Target tests:
Rollback:
Migration task:
State:
```

## Public route rules

- SEOに必要なstable contentはSSGへ。
- login/like/view/private overlay/live slot等はIsland/APIへ。
- public→privateがあり得るentity routeはvisibility gatewayを通す。
- YouTube ID/internal ID等のaliasはroute mapから同一entityへ正規化する。
- Static Assetが古くてもvisibility fenceがblockedなら返さない。
- query semanticsをtechnical twin routeの削除と同時に失わない。
- `/:id` catch-allはpublic migrationの最後。

## Private route rules

- SPA shellをStatic Assetsで配信する。
- data/mutationはHono APIへ。
- UI上のpermission表示だけで認可しない。
- direct URL/reload/browser back-forward/queryをacceptanceに含める。
- private dataをpublic R2/build snapshotへ流さない。

## Design migration mapping

MIG-0010で `app/(redesign)/dev/redesign/_catalog.ts` の86 screenと89 frontend capabilitiesを完全に紐付ける。

```text
Mock ID
Current route
Frontend capability IDs
Target route
Target layout
Shared components
Responsive states
Loading/error/empty/permission/pending states
MIG task
State
```
