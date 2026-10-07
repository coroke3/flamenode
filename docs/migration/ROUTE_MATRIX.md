# FlameNode Route Migration Matrix

> Status: Active / Route progress source of truth
> Last updated: 2026-10-07
> Architecture: [`README.md`](README.md)
> Progress: [`STATUS.md`](STATUS.md)
> CURRENT route source: [`CURRENT_ROUTES.md`](CURRENT_ROUTES.md)
> Frontend capabilities: [`FRONTEND_FEATURES.md`](FRONTEND_FEATURES.md)
> CURRENT resolved mapping: [`screen-mapping/README.md`](screen-mapping/README.md)
>
> 画面・URL単位の移行契約を管理する。
> CURRENTの全 `app/**/page.tsx` と `VISUAL_SCREEN / COMPAT_REDIRECT / DEV_ONLY / SYSTEM_SURFACE` 分類は `CURRENT_ROUTES.md` を正本とし、この文書では移行先・URL互換・technical route・安全境界・UX/FN mappingを管理する。

## Route inventory classes

CURRENT page routeは以下を区別する。

1. **VISUAL_SCREEN** — 独立visual UIをrenderするCURRENT画面。
2. **COMPAT_REDIRECT** — 旧URL/deep-linkを現在のowner surfaceへ接続するcompatibility route。独立screenではない。
3. **DEV_ONLY** — development/inspection/mock surface。production capabilityやTARGET visual authorityではない。
4. **SYSTEM_SURFACE** — auth completion、maintenance、technical query renderer等のsystem/implementation surface。
5. **API_AUTH** — Route Handler/Auth endpoint。MIG-0004/0008で監査。
6. **GLOBAL_SURFACE** — `error.tsx`, `global-error.tsx`, `not-found.tsx`, robots/sitemap等。

## CURRENT page classification

2026-10-07のCURRENT route treeをMIG-0011 Frontendで全件分類した。件数はsnapshot結果であり、checkerは `app/**/page.tsx` からcoverageを導出する。

| Class | Current count | Canonical source |
| --- | ---: | --- |
| VISUAL_SCREEN | 74 | `CURRENT_ROUTES.md` |
| COMPAT_REDIRECT | 9 | `CURRENT_ROUTES.md` + `gap-scan/FRONTEND_REQUIREMENTS.md` |
| DEV_ONLY | 3 | `CURRENT_ROUTES.md` |
| SYSTEM_SURFACE | 6 | `CURRENT_ROUTES.md` |
| **page.tsx total** | **92** | source tree |

432 UX capabilityとは1:1ではない。visual screenだけでなくcompat/system/shellもUX ownerになりうる。

### Redirect compatibility contract

- `/groups` → `/event`
- `/groups/[slug]` → `/event#event-group-{slug}`
- `/admin/history` → `/admin/audit`
- `/admin/events/[id]` → `/manage/events/[id]`
- `/admin/events/[id]/edit` → `/manage/events/[id]/edit`
- `/admin/events/[id]/slots` → `/manage/events/[id]/slots`
- `/admin/events/[id]/staff` → `/manage/events/[id]/staff`
- `/manage/events/[id]/review` → `/manage/events/[id]/videos?status=pending`
- `/dashboard/youtube-playlists` → adminは `/admin/youtube-sync/playlists`、その他authenticated userは `/dashboard`

source URLをmigrationで無断削除しない。query/hash/role分岐の詳細は `gap-scan/FRONTEND_REQUIREMENTS.md`。

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

これらはMIG-0010でscreen-local mappingとは別にcross-cutting UX acceptanceへ紐付ける。

---

# Target route groups

| Route group | CURRENT | TARGET | Render | Data | Visibility/Auth | State | Task |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/about` | Next/OpenNext | Astro/site | SSG | build snapshot | public | BASELINED | MIG-0501 |
| `/rules*` | Next/OpenNext | Astro/site | SSG | build snapshot | public | BASELINED | MIG-0501 |
| `/event/*` | Next/OpenNext | Astro/site | SSG + Islands | public R2 + live API | visibility fence | BASELINED | MIG-0502 |
| `/groups`, `/groups/[slug]` | Next redirect | compatibility alias to `/event` | redirect | none | public | COMPAT_BASELINED | MIG-0503 |
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
| `/dev/ui-surfaces` | CURRENT UI inspection surface | migration/dev support | dev | local UI | dev-only | BASELINED | MIG-0201..0205 |
| `/dev/redesign/*` | legacy fixture/mock implementation | no TARGET authority | dev | fixture | none | LEGACY_ONLY | remove/dispose only after replacement/reference decision |

## Route-level acceptance template

```text
Route:
Class: VISUAL_SCREEN | COMPAT_REDIRECT | DEV_ONLY | SYSTEM_SURFACE | API_AUTH | GLOBAL_SURFACE
Current file:
Current owner:
Required UX IDs:
Required FN IDs:
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
Current tests/evidence:
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

## CURRENT screen → UX/FN mapping

MIG-0010 baselineをMIG-0011 Frontendでroute class別にreconcileした。正本は [`screen-mapping/README.md`](screen-mapping/README.md)。

固定済み:

- all CURRENT page routes classified and owned;
- 16 cross-route shells;
- 432 UX capabilities with final disposition;
- every distinct UX Surface token resolved without hard-coding the token count as a migration target;
- screen-local Required UX/FN;
- permission/state/query/history/responsive-a11y profiles;
- technical twin routeのlogical URL contract;
- global error/404/robots/sitemap surfaces.

`UI_REFERENCE.md` が `PENDING_HTML` の間はTarget layout/componentsを確定しない。
旧`app/(redesign)`や削除済み`docs/design-redesign`を新UIの根拠にしない。
