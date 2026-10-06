# FlameNode Route Migration Matrix

> Status: Active / Route progress source of truth
> Last updated: 2026-10-06
> Architecture: [`README.md`](README.md)
> Progress: [`STATUS.md`](STATUS.md)
>
> 画面・URL単位の移行契約を管理する。exact inventoryは現行route codeと`app/(redesign)/dev/redesign/_catalog.ts`を確認して更新する。

## Columns

- `CURRENT`: 現行owner/framework
- `TARGET`: 移行後owner
- `Render`: SSG / Island / SPA / API
- `Data`: public R2 / Hono→D1 / mixed
- `Visibility/Auth`: server-side safety boundary
- `State`: NOT_INVENTORIED / READY / IN_PROGRESS / REVIEW / DONE / BLOCKED
- `Task`: `STATUS.md`のMIG task

## Baseline groups

> MIG-0002で現行routeをコードから完全棚卸しし、この表をroute単位へ展開する。ここでは移行方針だけを固定する。

| Route group | CURRENT | TARGET | Render | Data | Visibility/Auth | State | Task |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/about` | Next/OpenNext | Astro/site | SSG | build snapshot | public | NOT_INVENTORIED | MIG-0501 |
| `/rules*` | Next/OpenNext | Astro/site | SSG | build snapshot | public | NOT_INVENTORIED | MIG-0501 |
| `/event/*` | Next/OpenNext | Astro/site | SSG + Islands | public R2 + live API | visibility fence | NOT_INVENTORIED | MIG-0502 |
| `/groups/*` | Next/OpenNext | Astro/site | SSG | public R2 | visibility fence | NOT_INVENTORIED | MIG-0503 |
| `/user/*` | Next/OpenNext | Astro/site | SSG + Islands | public R2 | visibility fence | NOT_INVENTORIED | MIG-0504 |
| `/list*` | Next/OpenNext | Astro/site | SSG shell + Island | public R2/API | public DTO | NOT_INVENTORIED | MIG-0505 |
| `/recommend*` | Next/OpenNext | Astro/site | SSG shell + Island | public R2/API | public DTO | NOT_INVENTORIED | MIG-0505 |
| `/trending*` | Next/OpenNext | Astro/site | SSG shell + Island | public R2/API | public DTO | NOT_INVENTORIED | MIG-0505 |
| `/` | Next/OpenNext | Astro/site | SSG + Islands | public R2 | public DTO | NOT_INVENTORIED | MIG-0506 |
| `/:id` | Next/OpenNext | Astro/site | SSG + Islands | public R2 + overlay API | visibility fence + alias map | NOT_INVENTORIED | MIG-0507 |
| `/dashboard/*` | Next/OpenNext | React/Vite app | SPA | Hono→D1 | auth + permission | NOT_INVENTORIED | MIG-0701/0702 |
| `/entry/*` | Next/OpenNext | React/Vite app | SPA | Hono→D1 | auth + permission | NOT_INVENTORIED | MIG-0703 |
| `/manage/*` | Next/OpenNext | React/Vite app | SPA | Hono→D1 | auth + event permission | NOT_INVENTORIED | MIG-0704 |
| `/admin/*` | Next/OpenNext | React/Vite app | SPA | Hono→D1 | admin permission | NOT_INVENTORIED | MIG-0705 |
| `/api/*` | Next Route Handler | Hono/api | API | D1/R2/Queue | endpoint contract | NOT_INVENTORIED | MIG-0601..0605 |
| auth routes | NextAuth/Auth.js | later auth target | API | session DB | auth compatibility | NOT_INVENTORIED | MIG-0801..0806 |
| `/dev/redesign/*` | fixture-only Next mock | migration support only | dev | fixture | none | NOT_INVENTORIED | MIG-0201..0205 |

## Route-level acceptance template

MIG-0002以降、各routeには最低限以下を記録する。

```text
Route:
Current file:
Current owner:
Target owner:
Render mode:
Public/private:
Data source:
Mutation endpoints:
Auth/permission:
Visibility fence:
SEO/canonical/OGP:
Dynamic states:
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
- `/:id` catch-allはpublic migrationの最後。

## Private route rules

- SPA shellをStatic Assetsで配信する。
- data/mutationはHono APIへ。
- UI上のpermission表示だけで認可しない。
- direct URL / reload / browser back-forwardをacceptanceに含める。
- private dataをpublic R2/build snapshotへ流さない。

## Design migration mapping

MIG-0007で `app/(redesign)/dev/redesign/_catalog.ts` の86 screenとこのmatrixを紐付ける。

最低限:

```text
Mock ID
Current route
Target route
Target layout
Shared components
Responsive states
Loading/error/empty/permission states
MIG task
State
```
