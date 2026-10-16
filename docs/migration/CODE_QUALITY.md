# FlameNode Migration Code Quality Standard

> Status: Active / mandatory implementation standard
> Last updated: 2026-10-07
> Applies to: Claude / Codex / Antigravity / human contributors

移行後のコードは「動く」だけでは不十分。experienced production engineerがreviewしても、責務・命名・依存方向・例外処理・安全境界に違和感がない状態を目標とする。

**コード行数削減はKPIではない。**
美しさは短さではなく、意味の明確さ、局所的に理解できる構造、正しい抽象化、明示的な副作用、変更容易性で評価する。

## Priority

```text
1. correctness / product behavior parity
2. permission / privacy / data integrity / auditability
3. operational reliability / 1102 resistance
4. clarity / maintainability / testability
5. reuse / reduction of accidental duplication
6. code volume
```

## 移行で守る簡潔さ（diff で判定できる規則）

小型モデルを含む全 agent が、レビューを待たずに自分で判定できる規則。違反しないと書けない場合は書かずに STOP する。形の例は [`IMPLEMENTATION_RECIPES.md`](IMPLEMENTATION_RECIPES.md)。

1. **呼び出し元が1つの抽象を作らない。** interface、factory、registry、汎用関数、option 引数、設定項目は、同じ意味で使う呼び出し元が2つ以上になってから作る。
2. **CURRENT で使われていないものを移植しない。** 移す file ごとに `node scripts/find-unused-exports.mjs <file>...` を実行し、結果を PR に貼る。
   - `UNUSED`（どこからも参照なし）と `TEST_ONLY`（test からだけ参照）は移さない。例外は、移す test が使う test 用の関数（名前が `ForTest` / `ForTests` で終わる）。
   - `LOCAL_ONLY`（同じ file の中だけで使う）は移すが export しない。
   - 識別子の一致だけを見る粗い走査なので、文字列で参照される可能性がある場合は `rg` で確かめ、移さなかったものを PR 本文に列挙する。
   - export されていない引数・分岐・feature flag は、呼び出し元の渡す値を `rg` で確かめ、常に同じ値なら分岐ごと移さない。
3. **移行先で起きない問題への対策を持ち込まない。** CURRENT には、Next/OpenNext の request 時描画や Free 枠を避けるための仕組みがある。移行先の設計（[`ZERO_1102.md`](ZERO_1102.md)）で同じ問題が起きないなら移さない。移す場合は、移行先でも必要な理由を PR に書く。
4. **型をごまかさない。** 手書きの型 shim、`any`、`as unknown as`、`@ts-ignore` を足さない。
5. **関数は1つのことをする。** 40行、ネスト3段、引数3個のどれかを超えたら、分けるか、超える理由を1行のコメントで書く（レビューで確認する）。
6. **diff は Work Order の Owned paths の中だけ。** 気付いた別の問題は直さず、PR 本文に書く。
7. **似ているが意味が違うコードは分けたままにする。** 共通化の条件は下の「Commonization」。

## 機能維持とブラッシュアップの線引き

移行中は「CURRENT と同じに動く」ことで正しさを判定する。挙動を同時に変えると、その判定ができなくなる。そのため変更を3種類に分ける。

| 種類 | 例 | 移行 task の中で |
| --- | --- | --- |
| コードの改善（挙動は同じ） | 未使用コードを移さない、名前を domain 用語にする、同じ意味の重複を1つにする、[`ZERO_1102.md`](ZERO_1102.md) の予算に収める | **行う**（上の規則と Work Order の範囲で） |
| 見た目の改善 | 登録済み mock（D-08）に合わせた公開画面 | **行う**（[`UI_REFERENCE.md`](UI_REFERENCE.md) が公開 mock とした画面だけ） |
| 挙動の変更 | 機能の追加・削除、仕様・文言・URL・権限の変更、CURRENT の不具合の修正 | **行わない。** PR 本文の「ブラッシュアップ提案」に書き、ユーザーが承認したら別 task にする |

- 維持の確認: 影響する FN / UX ID（[`FUNCTION_INVENTORY.md`](FUNCTION_INVENTORY.md)）ごとに、CURRENT と TARGET の両方で通る test か、同じ入力で同じ結果になる証跡を PR に付ける。
- 例外: CURRENT に security・privacy・データ破損の不具合を見つけたら、移行を止めてユーザーに報告する（提案に回さない）。

## 既知の過剰設計（2026-10-15 時点）

| 対象 | 根拠 | 扱い |
| --- | --- | --- |
| `apps/api/src/types/hono.d.ts` | hono の `Context` / `Hono` を `any` 付きで手書きした型 shim。本物の hono（4.13.13）の型を隠す（2026-10-15、`apps/api` で `new Hono().route(...)` が `TS2339: Property 'route' does not exist` になることを確認） | MIG-0601 U00 で削除 |
| `packages/domain/src/permissions.ts` の `canEditVideo` | 3値の OR だけの偽の権限判定。呼び出し元 0件 | MIG-0301 U01 で削除 |
| 旧計画の `IA_MAPPING.md` | `UI_REFERENCE.md` の「CURRENT route と mock の対応」と同じ表を作る計画だった | MIG-0201 から外した |
| `src/**`, `app/**` の未使用 export | `scripts/find-unused-exports.mjs` 相当の走査で、export 2,115件のうち参照0件が43件、test からだけが63件（DB schema の table 定義や test 用 reset 関数を含む粗い値）。例: `src/lib/db/queries.ts` の `fetchLatestVideos` ほか4件、`src/lib/db/videoDetailQueries.ts` の `fetchVideoDetail` / `fetchRelatedVideos`、`src/lib/actions/mutationResult.ts` の3件 | 各 file を移す task が規則2で判定する（移行前に CURRENT から消す task は作らない） |

## Professional-quality requirements

### Naming

- domain用語をそのまま使う。
- `handler`, `manager`, `helper`, `process`, `data`だけで意味を隠さない。
- booleanは状態/能力が読み取れる名前にする。
- permissionとvisibilityを曖昧な`allowed`へ潰さない。
- external ID / internal ID / auth user / X userを型・名前で区別する。

### Module responsibility

- 1 moduleは1つのcoherent responsibilityを持つ。
- framework adapterとdomain logicを混ぜない。
- database query、permission decision、transaction、post-commit effectの境界を読める形にする。
- gigantic utility / god serviceを作らない。
- 循環依存を作らない。
- dependency directionを明確にする。

Target direction:

```text
UI
 -> transport adapter
 -> contracts
 -> domain command/query
 -> repository/data access
 -> D1

mutation commit
 -> explicit post-commit effects
    -> Queue / R2 projection / notification / telemetry
```

### Domain layer

`packages/domain`相当では原則禁止:

- Next/Astro/Hono imports
- Request/Response/Context依存
- React/browser APIs
- `revalidatePath`, `redirect`
- Cloudflare bindingを暗黙globalとして読むこと

必要resourceは明示dependencyとして渡す。

### Contracts and types

- untrusted boundaryはschema validationする。
- shared DTOをDB rowのaliasとして使わない。
- public DTO/private DTO/admin DTOを必要に応じて分離する。
- stringly-typed stateを増やさない。
- exhaustive handlingが有効なstateはunionで表現する。
- `any`やunsafe castでmigration errorを隠さない。

### Permissions / visibility

- UI visibilityはauthorizationではない。
- write/read boundaryでserver-side permissionを再確認する。
- owner invariant、event permission、admin permissionをgeneric CRUDへ埋没させない。
- public projectionはexplicit allowlist DTOを使う。
- public→private transitionはfail-closed guaranteeを弱めない。

### Transactions and side effects

- transaction boundaryを明示する。
- DB commit前後の処理を混同しない。
- notification/Queue/R2/auditを「なんとなくbest effort」にまとめない。
- side effectごとに失敗時の意味、retry/idempotencyを定義する。
- partial failureを隠してsuccessを返さない。

### Error handling

- expected domain errorとunexpected infrastructure errorを分ける。
- userが再試行可能か判断できるcontractを保つ。
- validation errorを500へ変換しない。
- permission errorをnot-foundに見せる必要がある箇所はprivacy理由を明示する。
- catch-allで例外を握りつぶさない。

### Commonization

共通化は「似て見える」ではなく、以下が同じ場合に行う。

- semantic input
- permission rule
- transaction boundary
- failure/retry behavior
- audit requirement
- public/private impact
- frontend result

flagだらけのgeneric関数になるならdomain別実装の方を選ぶ。

### Control flow

- cleverなmetaprogrammingよりboring/predictableなcontrol flowを優先する。
- implicit magic registryやhidden global hookを増やさない。
- early return等を使い、正常系/例外系を読みやすくする。
- nested conditionがdomain state machineを表しているなら明示state/modelへ昇格する。

### Comments / documentation

コメントは主に以下を書く。

- なぜ必要か
- invariant
- platform constraint
- unusual compatibility reason
- rollback/removal condition

コードを日本語/英語で逐語説明するコメントは増やさない。
temporary workaroundには必ずremoval conditionまたはMIG taskを付ける。

### Performance

- Cloudflare FreeのCPU budgetを意識する。
- request pathからheavy generation/aggregationを外す。
- CPU/I/O最適化は計測可能にする。
- premature micro-optimizationで可読性を壊さない。
- D1 rows read/write、serialization、R2/KV/Queue回数を意識する。
- publicはstatic-first、APIはbounded synchronous workを基本にする。

### Tests

- testsはimplementation detailではなくbehavior/invariantを固定する。
- permission、visibility、idempotency、retry、conflict、partial failureを重要contractとして扱う。
- bug fixには可能ならregression testを付ける。
- migration bridgeはCURRENTとTARGET双方へ同じfixture/contract testを適用できる形を優先する。

## Anti-patterns

禁止/原則避ける:

- LOC削減のためのmega abstraction
- `utils.ts`への無秩序な集約
- 何でも受け取る万能repository
- domain差をboolean flagsで吸収する巨大CRUD
- transport層へのbusiness rule流出
- UI componentから直接D1/R2へ到達
- hidden side effect
- silent fallbackでprivacy/security failureを隠す
- TODOだけのtemporary compatibility code
- migrationのためだけの独自framework/SSG/router/cache runtime
- current framework idiomを理解せず自作すること
- old codeをそのまま新framework syntaxへ機械翻訳すること

## Review standard

PR reviewerは最低限以下を確認する。

```text
[ ] Feature/UX parity is explicit
[ ] Permission/privacy boundaries are explicit
[ ] Domain vocabulary is precise
[ ] Module responsibilities are coherent
[ ] Side effects and transaction boundaries are visible
[ ] Errors are typed/intentional where appropriate
[ ] No unnecessary framework coupling in domain code
[ ] No abstraction exists only to reduce line count
[ ] Commonization makes semantics clearer, not merely shorter
[ ] Tests cover important behavior/invariants
[ ] CPU/I/O implications are considered
[ ] Runtime class and max CPU are recorded against ZERO_1102.md (or "未計測" before MIG-0606)
[ ] No abstraction with a single caller; no CURRENT code with zero callers was ported
[ ] No behavior change hidden in the migration (proposals are listed, not implemented)
[ ] Rollback/compatibility path is understandable
[ ] An experienced engineer can reason locally about the changed code
```

## Required PR note

Implementation PRは必要に応じて以下を記録する。

```text
Code quality review:
- domain boundary:
- commonization introduced:
- commonization intentionally rejected:
- side effects / transaction boundary:
- readability risks:
- framework coupling:
- tests/invariants:
- performance implications:
- runtime class / max CPU (ZERO_1102.md):
- not ported (zero callers):
- ブラッシュアップ提案（未実装）:
```

`特になし`は許可する。形だけの抽象化を追加しない。