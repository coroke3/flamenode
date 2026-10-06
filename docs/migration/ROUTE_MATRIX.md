# FlameNode Route Migration Matrix

> Status: Active / Route migration disposition source of truth
> Last updated: 2026-10-06
> Architecture: [`README.md`](README.md)
> Progress: [`STATUS.md`](STATUS.md)
> Exact CURRENT screen list: `docs/design-redesign/ROUTE_INVENTORY.md` + `app/(redesign)/dev/redesign/_catalog.ts`
> Frontend behavior contract: [`FRONTEND_FEATURE_INVENTORY.md`](FRONTEND_FEATURE_INVENTORY.md)
>
> 画面・URL単位の**移行先/方式**を管理する。
> CURRENTの86画面一覧は`docs/design-redesign/ROUTE_INVENTORY.md`を正本とし、同じ86行をここへ複製しない。

## MIG-0002 baseline

CURRENT redesign inventoryで以下を固定済み:

- Public: 16
- Personal: 6
- Entry: 3
- Manage: 12
- Admin: 45
- System: 4
- Total: 86 screens

各screenには既に CURRENT URL / page file / user / purpose / primary action / Mock ID がある。
MIG-0002ではこれをscreen baselineとして扱い、frontend-visible capabilityは`FRONTEND_FEATURE_INVENTORY.md`へ分離する。

MIG-0010で各screenをfunction IDsへ完全mapする。

### Route-specific implementation quirks that must not be lost silently

CURRENT publicにはFree CPU対策のため、query-bearing URLを別dynamic twin routeへrewriteする実装がある。
例: list/user/eventのquery variant、user detail pagination等。

これはTARGETで同じ内部routeを再現する必要はないが、**ユーザーから見えるquery/filter/pagination semanticsは維持契約**。

---

## Columns

- `CURRENT`: 現行owner/framework
- `TARGET`: 移行後owner
- `Render`: SSG / Island / SPA / API
- `Data`: public R2 / Hono→D1 / mixed
- `Visibility/Auth`: server-side safety boundary
- `Frontend contract`: `FRONTEND_FEATURE_INVENTORY.md`のID/section
- `State`: BASELINE_KNOWN / READY / IN_PROGRESS / REVIEW / DONE / BLOCKED
- `Task`: `STATUS.md`のMIG task

## Migration disposition groups

| Route group | CURRENT | TARGET | Render | Data | Visibility/Auth | Frontend contract | State | Task |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/about` | Next/OpenNext | Astro/site | SSG | build snapshot | public | `FN-PUB-020` | BASELINE_KNOWN | MIG-0501 |
| `/rules*` | Next/OpenNext | Astro/site | SSG | build snapshot | public | `FN-PUB-021` | BASELINE_KNOWN | MIG-0501 |
| `/event/*` | Next/OpenNext | Astro/site | SSG + Islands | public R2 + live API | visibility fence | `FN-PUB-009..012` | BASELINE_KNOWN | MIG-0502 |
| `/groups/*` | Next/OpenNext | Astro/site | SSG | public R2 | visibility fence | `FN-PUB-013` | BASELINE_KNOWN | MIG-0503 |
| `/user/*` | Next/OpenNext | Astro/site | SSG + Islands | public R2 | visibility fence | `FN-PUB-017..019` | BASELINE_KNOWN | MIG-0504 |
| `/list*` | Next/OpenNext | Astro/site | SSG shell + Island | public R2/API | public DTO | `FN-PUB-014` | BASELINE_KNOWN | MIG-0505 |
| `/recommend*` | Next/OpenNext | Astro/site | SSG shell + Island | public R2/API | public DTO | `FN-PUB-015` | BASELINE_KNOWN | MIG-0505 |
| `/trending*` | Next/OpenNext | Astro/site | SSG shell + Island | public R2/API | public DTO | `FN-PUB-016` | BASELINE_KNOWN | MIG-0505 |
| `/` | Next/OpenNext | Astro/site | SSG + Islands | public R2 | public DTO | `FN-PUB-001` | BASELINE_KNOWN | MIG-0506 |
| `/:id` | Next/OpenNext | Astro/site | SSG + Islands | public R2 + overlay API | visibility fence + alias map | `FN-PUB-002..008,022` | BASELINE_KNOWN | MIG-0507 |
| `/dashboard/*` | Next/OpenNext | React/Vite app | SPA | Hono→D1 | auth + permission | `FN-PER-001..007` | BASELINE_KNOWN | MIG-0701/0702 |
| `/entry/*` | Next/OpenNext | React/Vite app | SPA | Hono→D1 | auth + permission | `FN-ENT-001..006` | BASELINE_KNOWN | MIG-0703 |
| `/onboarding`, `/auth/complete` | Next/Auth.js | React app + auth bridge | SPA/API bridge | Hono/Auth bridge→D1 | auth/session | `FN-AUTH-005..007` | BASELINE_KNOWN | MIG-0801..0806 |
| `/manage/*` | Next/OpenNext | React/Vite app | SPA | Hono→D1 | auth + event permission | `FN-MNG-001..012` | BASELINE_KNOWN | MIG-0704 |
| `/admin/*` | Next/OpenNext | React/Vite app | SPA | Hono→D1 | admin permission | `FN-ADM-001..031` | BASELINE_KNOWN | MIG-0705 |
| system `/maintenance`, errors, not-found | Next/OpenNext | site/app system surfaces | Static/SPA boundary | none/minimal | safe disclosure | §8 system UX | BASELINE_KNOWN | MIG-0501/0701 |
| `/api/*` | Next Route Handler | Hono/api | API | D1/R2/Queue | endpoint contract | indirect frontend contracts | BASELINE_KNOWN | MIG-0601..0605 |
| Auth.js routes | NextAuth/Auth.js | later auth target | API | session DB | auth compatibility | `FN-AUTH-001..009` | BASELINE_KNOWN | MIG-0801..0806 |
| `/dev/redesign/*`, `/dev/ui-surfaces` | fixture/dev Next | migration support only | dev | fixture | none | dev-only | BASELINE_KNOWN | MIG-0201..0205 |

---

## Route-level acceptance template

Migration taskが個別routeを触る時に最低限以下を記録する。

```text
Route / Mock ID:
Current file:
Current owner:
Target owner:
Function IDs:
Frontend-visible contract:
Primary / secondary / destructive actions:
Render mode:
Public/private:
Data source:
Mutation endpoints:
Auth/permission:
Visibility fence:
SEO/canonical/OGP:
Happy path:
Loading:
Empty:
Validation error:
Server/external error:
Forbidden:
Partial failure/retry:
Success feedback:
Responsive / keyboard:
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
- query/filter/paginationの内部実装を変えてもfrontend semanticsは維持する。
- `/:id` catch-allはpublic migrationの最後。

## Private route rules

- SPA shellをStatic Assetsで配信する。
- data/mutationはHono APIへ。
- UI上のpermission表示だけで認可しない。
- direct URL / reload / browser back-forwardをacceptanceに含める。
- private dataをpublic R2/build snapshotへ流さない。
- mutationのbackend構造を改善しても保存/validation/conflict/success/error UXを落とさない。

## Design migration mapping

MIG-0010で `app/(redesign)/dev/redesign/_catalog.ts` の86 screenとfunction IDsを完全に紐付ける。

最低限:

```text
Mock ID
Current route
Target route
Function IDs
Frontend-visible contract
Target layout
Shared components
Primary/secondary/destructive actions
Responsive states
Loading/error/empty/permission/partial-failure states
MIG task
State
```
