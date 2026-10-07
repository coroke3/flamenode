# FlameNode Frontend-Exposed Feature Inventory

> Status: Active / frontend capability source of truth
> Last updated: 2026-10-07
> Scope: CURRENTでユーザー/運営者/管理者/開発者が画面・操作・状態変化として認識できる機能
> Route source: [`CURRENT_ROUTES.md`](CURRENT_ROUTES.md)
> Backend/function source: [`FUNCTION_INVENTORY.md`](FUNCTION_INVENTORY.md)
> Resolved screen/shell ownership: [`screen-mapping/README.md`](screen-mapping/README.md)
> 全件を一か所で読む: [`FEATURE_CATALOG.md`](FEATURE_CATALOG.md)

リデザイン + framework移行で「画面はあるが機能が消えた」を防ぐための**frontend observable behaviorの正本**。

従来の`FN-*`をfrontend capabilityと兼用する方式は粒度不足になるため廃止する。

```text
UX-* = ユーザーが別の機能/操作/状態として観測する契約
FN-* = backend/domain/platform側の機能・安全保証
```

1つの`UX-*`が複数`FN-*`を利用してよい。
1つの`FN-*`が複数`UX-*`を支えてよい。

## Baseline size

2026-10-07のCURRENT code/route/active operation docsから**432 UX capabilities**を列挙し、MIG-0011 Frontend監査で全件をfinal dispositionした。今回の正本件数は432で、追加・削除する場合は同時にledger、screen mapping、checkerを更新する。

| Ledger | IDs | Count |
| --- | --- | ---: |
| [`frontend/CROSS_CUTTING.md`](frontend/CROSS_CUTTING.md) | `UX-GLOBAL-*`, `UX-SYS-*` | 38 |
| [`frontend/PUBLIC.md`](frontend/PUBLIC.md) | `UX-PUB-*`, `UX-VID-*`, `UX-DISC-*`, `UX-USER-*`, `UX-EVENT-*` | 123 |
| [`frontend/AUTH_PERSONAL_ENTRY.md`](frontend/AUTH_PERSONAL_ENTRY.md) | `UX-AUTH-*`, `UX-DASH-*`, `UX-LIB-*`, `UX-SET-*`, `UX-ENTRY-*`, `UX-SLOT-*`, `UX-SUB-*` | 104 |
| [`frontend/MANAGE_ADMIN.md`](frontend/MANAGE_ADMIN.md) | `UX-MNG-*`, `UX-ADM-*` | 167 |
| **Total baseline** |  | **432** |

毎taskで全432件を読む必要はない。対象route/domainに対応するledgerのみ読む。MIG-0011 Frontend監査ではrouteを `VISUAL_SCREEN / COMPAT_REDIRECT / DEV_ONLY / SYSTEM_SURFACE` に再分類し、全432 UXのownerをscreen / compat / system / shellへ解決した。

Final disposition:

| State | Count |
| --- | ---: |
| `CURRENT_VERIFIED` | 405 |
| `CURRENT_DIVERGENCE` | 6 |
| `MERGED_INTO_OTHER` | 17 |
| `OBSOLETE` | 4 |
| `REQUIREMENT_ONLY` | 0 |
| **Total** | **432** |

根拠と例外一覧は [`gap-scan/FRONTEND_REQUIREMENTS.md`](gap-scan/FRONTEND_REQUIREMENTS.md) を正本とする。

## Completion invariant

Phase 0完了時:

```text
UX IDs without CURRENT disposition = 0
UX IDs without route/surface mapping = 0
UX IDs without permission disposition = 0
UX IDs without backend/FN disposition = 0
UX IDs without loading/error/empty/pending disposition where applicable = 0
UX IDs without responsive/accessibility disposition where applicable = 0
CURRENT route classes without mapping = 0
Cross-route shells without UX mapping = 0
Intentional removals without explicit approval = 0
Visual-only DONE screens = 0
```

## Final disposition states

MIG-0011 Frontend完了時、詳細ledgerのEvidence列は以下の終端stateだけを使用する。

- `CURRENT_VERIFIED`: current code/test/route/action/APIまたはactive operational contractで確認済み。
- `CURRENT_DIVERGENCE`: current実装は確認済みだがTARGET requirementと不一致。勝手にCURRENT維持しない。
- `REQUIREMENT_ONLY`: TARGET requirementは確定しているがCURRENT実装なし。
- `OBSOLETE`: CURRENT productとして独立capabilityを提供しておらずTARGETへ復活させない。
- `MERGED_INTO_OTHER`: capabilityは別owner surfaceへ統合済み。互換URLは別contractとして維持できる。

`CURRENT_OBSERVED` と `AUDIT_REQUIRED` は途中stateであり、MIG-0011 Frontendでは残さない。

## What counts as frontend-exposed

以下はすべてfrontend capabilityとして棚卸し対象。

- 表示情報
- button/link/menu/tab
- search/filter/sort/pagination/view switch
- create/edit/delete/approve/reject/retry/restore
- login/logout/session/account identity
- permission-dependent controls
- validation
- loading/empty/error/forbidden/degraded/pending/success
- toast/banner/notice
- destructive confirmation
- URL/deep link/query/reload/back-forward
- responsive/mobile/tablet/desktop操作
- keyboard/focus/accessibility state
- external integration progress/failure/quota
- async side effectの待ち時間/完了/再試行
- public/private visibility
- SEO/canonical/OGP/crawlerから観測される挙動

backend-onlyに見えても、利用者が状態・制限・遅延・error・表示更新として観測するものは対象。

## Required detailed UX contract

`CURRENT_VERIFIED`へ上げる際は最低限以下を記録/テストする。MIG-0011ではfrontend ledgerのSurface/Related FNと `gap-scan/FRONTEND_REQUIREMENTS.md` のevidence indexを組み合わせて根拠を追跡する。

```text
UX ID:
Users / roles:
Current screen / surface:
Entry point:
Inputs:
Success result:
Loading state:
Empty state:
Validation state:
Error state:
Forbidden/permission state:
Pending/async state:
Degraded state:
Destructive confirmation:
Responsive/mobile behavior:
Keyboard/focus/a11y behavior:
Deep-link/reload/history behavior:
CURRENT backend dependency / FN IDs:
User-visible side effects:
Current tests/evidence:
Target screen/component:
Target API/domain:
Parity acceptance:
Migration state:
```

適用不要な項目は`N/A + reason`でよい。無言で省略しない。

## Preservation priority

```text
1. user-visible behavior / usability
2. permission/privacy/safety
3. data/audit/notification/async outcome
4. URL/history/external integration compatibility
5. implementation elegance/performance
6. code volume
```

バックエンドを全面的に再設計しても、1〜4を意図せず変えない。

## Screen/UX mapping rule

移行するscreenごとに:

1. `CURRENT_ROUTES.md` でCURRENT routeを確認する。
2. 関連frontend ledgerから全`UX-*`を列挙する。
3. page-local actionだけでなくglobal header/sidebar/account/theme/error stateを含める。
4. primary/secondary/destructive actionを含める。
5. permission-dependent controlを含める。
6. loading/empty/error/forbidden/pending/degradedを含める。
7. URL/query/history/reloadを含める。
8. backend side effectsを`FN-*`/API/action/jobへ結びつける。
9. target UIに見当たらないCURRENT UXも「不要」と推測せず配置方針を決める。

Screen DONE条件:

```text
visual target implemented (HTML mock受領後)
AND required UX IDs have disposition
AND associated FN/backend contracts have parity evidence
AND permission/privacy/side effects verified
AND responsive/accessibility verified
AND URL/history behavior verified
```

visualだけ完成した場合は`UI_DONE_FUNCTIONS_PENDING`相当でありDONEではない。

## UI design source

旧`docs/design-redesign/`は使用しない。
新UIは後日ユーザーから提供されるHTML mockを`UI_REFERENCE.md`へ登録してから扱う。

HTML mockはvisual/information architectureの入力であり、CURRENT capabilityを暗黙削除する権限を持たない。

## Backend relationship

- backend詳細は`FUNCTION_INVENTORY.md` / `functions/*.md`
- API/action dispositionは`API_MATRIX.md`
- backend再設計候補は`BACKEND_OPTIMIZATION.md`
- requirements conflictは`PRODUCT_REQUIREMENTS.md`
- current routesは`CURRENT_ROUTES.md`

## Audit progression

- `MIG-0002`: CURRENT 86 USER_SCREEN + 432 UX capability baselineを固定
- `MIG-0003`: Server Actions/inline actions → affected UX/FNへmapping
- `MIG-0004`: Route Handlers/API → affected UX/FNへmapping
- `MIG-0005/0009`: Worker/Queue/Cron → observable async behaviorへmapping
- `MIG-0007`: static/visibility → public UXへmapping
- `MIG-0008`: auth/session/permission → gated UXへmapping
- `MIG-0010`: DONE — 当時の86 route baseline + 16 cross-route shell + 170 UX Surface tokensをrequired UX/FN・permission/state/query/RA contractへmapping
- `MIG-0011`: Frontend側は92 page route再分類 + 432 UX final disposition + requirement reconciliation。Backend側と統合してtaskを閉じる

**MIG-0011完了までは「全機能棚卸し完了」と宣言しない。**