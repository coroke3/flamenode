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
```

`特になし`は許可する。形だけの抽象化を追加しない。