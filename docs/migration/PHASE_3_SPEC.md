# FlameNode Phase 3 タスク仕様書（Domain Extraction Spec）

> 状態: Active / Phase 3 実行向け仕様書
> 最終検証: 2026-10-09（ファイルパス・export 名は実コードで確認済み。`npm run check:project-docs` が参照を機械検証する）
> 対象モデル: Claude / Codex / Antigravity / GPT-5.6-luna / Gemini Flash 等の全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`AGENT_PROTOCOL.md`](AGENT_PROTOCOL.md), [`CODE_QUALITY.md`](CODE_QUALITY.md), [`FEATURE_CATALOG.md`](FEATURE_CATALOG.md), [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md), [`server-actions/README.md`](server-actions/README.md)

この仕様書は、各タスクの目的・対象ソース・作成ファイル・禁止事項・検証コマンドを具体化したものである。
> **タスク正本:** 個別タスクの実行指示（読む・変える・試す・DONE条件）の正本は [`TASK_CARDS_2_3.md`](TASK_CARDS_2_3.md) です。`npm run migration:next` がその内容を自動抽出します。本仕様書はPhase 3全体のアーキテクチャ背景と設計意図を補足します。

**D-01は A（新規packages/dbへschema移設）と決定済み。** 実装は専用 `MIG-0308` で行い、完了まではTier2を開始しない。詳細は [`DB_PACKAGE_EXTRACTION_PLAN.md`](DB_PACKAGE_EXTRACTION_PLAN.md)。

> 表記規約: code span の repo パスは**実在するパス**でなければならない。これから作るファイルは `` `+path` `` と書く（`+` は新規作成の印）。
> 本タスクでは関連コードの実在を各PRで照合し、存在しないチェックコマンドを検証済みとは記載しない。リンクの自動検査は後続タスクで追加する。

---

# 1. Phase 3 の目的と基本原則

### 目的

`src/lib/` に散らばるビジネスロジック・権限判定を、フレームワーク非依存の `packages/domain` へ抽出する。
CURRENT の Next.js 側は、抽出後も同じ関数を呼ぶ**薄い互換ブリッジ**になる（legacy/新 API が同じ domain service を呼ぶ期間を作る。[`API_MATRIX.md`](API_MATRIX.md) の Migration rule）。

### 基本原則

1. **フレームワーク非依存**: `packages/domain` は `next/*`, `react`, `hono`, `astro`, `server-only`, `revalidatePath`, `redirect`, `cookies()` を import しない。
2. **既存契約の保持**: owner 不変条件、fail-closed な可視性、CAS、監査、post-commit の意味を変えない。
3. **薄い 1 行ラッパー禁止**: ドメインルール・権限・トランザクション境界を含む凝集した単位で抽出する。
4. **Server Action をコピーしない**: 抽出元は Server Action ではなく、その下にある core / plan / policy である（[`server-actions/README.md`](server-actions/README.md) の SA-* が正本）。

### 抽出の 2 階層（重要）

実コードを調べた結果、抽出対象は 2 種類に分かれる。

| 階層 | 条件 | 例 | 実行前提 |
| --- | --- | --- | --- |
| **Tier 1: 純粋 core** | `@/` import も DB も `server-only` も持たない | `src/lib/slots/slotReservationLimit.ts`, `src/lib/slots/limits.ts`, `src/lib/utils/softwareLabels.ts`, `src/lib/event/eventOwnershipCore.ts`, `src/lib/auth/ownershipCore.ts` | **不要**。先行して進める |
| **Tier 2: DB/framework 結合** | `@/lib/db/schema`・`next/navigation`・`server-only` を import する | `src/lib/video/videoVisibilityTransition.ts`, `src/lib/event/eventVisibilityTransition.ts`, `src/lib/xid/xUserVisibilityTransition.ts`, `src/lib/video/computeEditSections.ts` | **A決定、MIG-0308完了が必要**（[`DB_PACKAGE_EXTRACTION_PLAN.md`](DB_PACKAGE_EXTRACTION_PLAN.md)） |

Tier 2 は `packages/domain` が `src/lib/db/schema` を参照すると `packages/*` → `src/*` の依存になり、`src/*` → `packages/domain` のブリッジと**循環**する。
D-01の方針はAで決定済み。**MIG-0308による実際のschema移設・互換/ゼロDDLの検証を終えるまで**、Tier2は `BLOCKED(MIG-0308)` とする。

---

# 2. 現状の注意点（実コードで確認済み）

- `packages/domain/src/permissions.ts` の `canEditVideo({isOwner,isCollabEditor,isEventStaff})` は Phase 1 の**プレースホルダー**で、`||` で 3 値を OR するだけである。
  実際の `canEditVideo`（`src/lib/auth/ownership.ts`）は `normal / event / admin` の 3 モードを分離し、
  「owner/admin 権限は event モードへ暗黙にフォールバックしない」「dangerous key は常に deny」という契約を持つ（[`auth/README.md`](auth/README.md)）。
  プレースホルダーの OR 意味論を実装の土台にしてはいけない。MIG-0301 で削除または別名へ退避する。
- `packages/domain/package.json` は `main: ./dist/index.js` で、`test` script を持たない。依存は `@flamenode/contracts` のみ（`drizzle-orm` なし）。
- `npm run test:unit` は `node --test --experimental-strip-types` で `src/**` と `scripts/**` の `*.test.mjs` を実行する。
  `@flamenode/domain` を bare specifier で import すると、`tsconfig.base.json` の `paths` は node には効かず、`main` が指す未ビルドの `dist` に当たる。
  **ブリッジ方式は MIG-0301 の PoC で、`node --test` / `next build` / `tsc` の 3 経路すべてで解決できることを確認してから量産する。**
- `src/lib/db/software.ts` は「動画に紐づくソフトウェアの置換プラン」を作るもの（`buildReplaceVideoSoftwarePlan`）で、一覧取得・登録 API ではない。
  通知は `notification_outbox` の配信キューであり、「既読化」機能は存在しない。

---

# 3. タスク別仕様

### MIG-0301: extraction/DI pattern（抽出パターンの確立）
- **Model:** small
- **Readiness:** READY_FOR_SMALL_MODEL — 2026-10-16 に lead が `fcb68e3` の上でこの節の code block をそのまま使って U01〜U04 と F の STATUS 統合を実行し、各 commit の後の `check:migration-work-items`・`check:project-docs`・`MIGRATION_FILE_BASE_SHA` 付きの file 検査、F 後の `check:migration-docs`、`apps/api` build、`verify:fast` がすべて終了コード0。`test:unit` は変更前後とも 2510 件。Haiku の試走（同日）でも U01〜F まで通った
- **Recipe:** R-DOMAIN
- **Runtime:** N
- **Depends on:** MIG-0108 / **Decisions:** none
- **Verified against:** `fcb68e3` (2026-10-16)
#### Source snapshot
- `src/lib/slots/slotReservationLimit.ts`（17行、import 無し）: `:1` `MAX_SLOT_RESERVATIONS_PER_XID = 100`、`:3-10` `normalizeSlotReservationLimit`、`:12-17` `slotReservationLimitMessage`。
- 呼び出し元: `src/components/event/SlotGrid.tsx:40`、`src/lib/actions/slot.ts:56`（どちらも `@/lib/slots/slotReservationLimit`）、`src/lib/slots/slotReservationLimitGuard.ts:8`（`./slotReservationLimit`）。
- 既存テスト: `src/lib/slots/slotReservationLimit.contract.test.mjs`, `src/lib/slots/slotReservationLimitGuard.execution.test.mjs`, `src/lib/slots/limits.test.mjs`（3 file で 6 test）。
- `packages/domain/package.json`: `main` / `types` が `dist/` を指し、`scripts` は `build` と `typecheck` だけ。`packages/domain/tsconfig.json`: `outDir: ./dist`, `rootDir: ./src`。`packages/domain/src/index.ts` は `export * from "./permissions";` の1行。
- `packages/domain/src/slots/` は存在しない。
- `FILE_MIGRATION_MATRIX.md`: `packages/domain/{package.json,src/index.ts,src/permissions.ts,tsconfig.json}` の4行（owner MIG-0301, NOT_STARTED）、`src/lib/slots/slotReservationLimit.ts` の行、テスト2行（`slotReservationLimit.contract.test.mjs`, `slotReservationLimitGuard.execution.test.mjs`）、Future files 表の `packages/domain/src/slots/reservationLimit.ts` の行。
- `.github/workflows/migration-docs-check.yml` に `npm run build --workspace=@flamenode/domain` の行がある（test の行は無い）。
- `npm run test:unit` は `# pass 2510`（作業前に実行して数を控える。違っても STOP ではなく、その数を「変更前」とする）。
#### Owned paths
- 新規: `+packages/domain/src/slots/reservationLimit.ts`（`git mv` で移す）, `+packages/domain/test/reservationLimit.test.mjs`
- 変更: `packages/domain/src/index.ts`, `packages/domain/package.json`, `packages/domain/tsconfig.json`, `.github/workflows/migration-docs-check.yml`（1行追加のみ）, `src/lib/slots/slotReservationLimit.ts`（bridge 化のみ）, `docs/migration/FILE_MIGRATION_MATRIX.md`（下の Ledger updates の行だけ）, `docs/migration/work-items/MIG-0301.md`
- 触らない: `packages/domain/src/permissions.ts`（偽の `canEditVideo`。消すと台帳が RETIRED と承認を要するので、本物の権限判定を作る MIG-0306 へ owner を移すだけにする）、`src/lib/slots/slotReservationLimitGuard.ts`（`server-only` と DB を import する Tier 2）、上の呼び出し元3 file
#### Micro-units
各 unit は runbook C のとおり commit し、commit の後に `npm run check:migration-work-items`・`npm run check:project-docs`・`MIGRATION_FILE_BASE_SHA=$(git rev-parse origin/main) node scripts/check-migration-file-progress.mjs` が全部 0 であることを確かめる（file 検査は commit 済みの差分だけを見る）。台帳の行に書く `<sha>` は、その unit を始める前の `git rev-parse HEAD`。
- **U01 package を source 参照にし、permissions.ts の owner を移す**
  1. `packages/domain/package.json` を次の全文にする:
     ```json
     {
       "name": "@flamenode/domain",
       "version": "0.1.0",
       "private": true,
       "type": "module",
       "exports": {
         ".": "./src/index.ts"
       },
       "scripts": {
         "build": "tsc",
         "typecheck": "tsc --noEmit",
         "test": "node --test --experimental-strip-types \"test/**/*.test.mjs\""
       },
       "dependencies": {
         "@flamenode/contracts": "*"
       },
       "devDependencies": {
         "typescript": "^5.7.0"
       }
     }
     ```
  2. `packages/domain/tsconfig.json` を次の全文にする:
     ```json
     {
       "extends": "../../tsconfig.base.json",
       "compilerOptions": {
         "outDir": "./dist",
         "rootDir": "./src",
         "rewriteRelativeImportExtensions": true
       },
       "include": ["src/**/*"]
     }
     ```
  3. `packages/domain/src/index.ts` を `export * from "./permissions.ts";` の1行にする。
  4. `FILE_MIGRATION_MATRIX.md` の `packages/domain/src/permissions.ts` の行を次にする（owner を MIG-0306 へ）:
     ```text
     | `packages/domain/src/permissions.ts` | TARGET_SKELETON | placeholder `canEditVideo` (no caller); replace or retire with the real policy | MIG-0306 | SAME (extend in owner task) | NOT_STARTED | — |
     ```
  ```bash
  npm run build --workspace=@flamenode/domain && rm -rf packages/domain/dist
  npm run typecheck
  ```
  期待: どちらも終了コード0。
- **U02 実装を移し、旧 path を bridge にする**
  1. 移す（移動先の directory は無いので先に作る。中身は1文字も変えない）:
     ```bash
     mkdir -p packages/domain/src/slots
     git mv src/lib/slots/slotReservationLimit.ts packages/domain/src/slots/reservationLimit.ts
     ```
  2. `src/lib/slots/slotReservationLimit.ts` を新しく作り、中身を次の5行にする:
     ```ts
     export {
       MAX_SLOT_RESERVATIONS_PER_XID,
       normalizeSlotReservationLimit,
       slotReservationLimitMessage,
     } from "@flamenode/domain/slots/reservationLimit";
     ```
  3. `packages/domain/package.json` の `exports` を次にする:
     ```json
     "exports": {
       ".": "./src/index.ts",
       "./slots/reservationLimit": "./src/slots/reservationLimit.ts"
     },
     ```
  4. `packages/domain/src/index.ts` を次の2行にする:
     ```ts
     export * from "./permissions.ts";
     export * from "./slots/reservationLimit.ts";
     ```
  5. `FILE_MIGRATION_MATRIX.md`: `src/lib/slots/slotReservationLimit.ts` の行のすぐ下に次の1行を足し（`<n>` は PR 番号、`<sha>` は U02 を始める前の `git rev-parse HEAD`）、Future files 表の `packages/domain/src/slots/reservationLimit.ts` の行を消す（file ができたので、残すと file 検査が落ちる）:
     ```text
     | `packages/domain/src/slots/reservationLimit.ts` | HELPER | pure numeric policy (moved from `src/lib/slots/slotReservationLimit.ts`) | MIG-0301 | SAME | IN_PROGRESS | PR#<n> SHA=<sha> |
     ```
  ```bash
  node --test --experimental-strip-types src/lib/slots/slotReservationLimit.contract.test.mjs src/lib/slots/slotReservationLimitGuard.execution.test.mjs src/lib/slots/limits.test.mjs
  npm run typecheck
  MIGRATION_FILE_BASE_SHA=$(git rev-parse origin/main) node scripts/check-migration-file-progress.mjs
  ```
  期待: 出力の末尾近くに `# pass 6` と `# fail 0`。typecheck と file 検査は終了コード0。
- **U03 domain の test を足し、CI で回す**
  1. `packages/domain/test/reservationLimit.test.mjs` を次の全文で作る:
     ```js
     import assert from "node:assert/strict";
     import test from "node:test";
     import {
       MAX_SLOT_RESERVATIONS_PER_XID,
       normalizeSlotReservationLimit,
       slotReservationLimitMessage,
     } from "@flamenode/domain/slots/reservationLimit";

     test("T01 normalizeSlotReservationLimit clamps to 0..MAX and floors", () => {
       const inputs = [null, undefined, -1, 2.9, 150, Infinity, NaN];
       assert.deepEqual(inputs.map(normalizeSlotReservationLimit), [0, 0, 0, 2, MAX_SLOT_RESERVATIONS_PER_XID, 0, 0]);
     });

     test("T02 slotReservationLimitMessage names the limit", () => {
       assert.equal(
         slotReservationLimitMessage(3),
         "このイベントでは、1つのX IDにつき最大3件まで枠を確保できます。連続枠は1件として数えます。",
       );
     });

     test("T03 slotReservationLimitMessage is empty when unlimited", () => {
       assert.equal(slotReservationLimitMessage(0), "");
     });
     ```
  2. `.github/workflows/migration-docs-check.yml` の `npm run build --workspace=@flamenode/domain` の次の行に、同じ字下げで `npm run test --workspace=@flamenode/domain` を足す。
  3. `FILE_MIGRATION_MATRIX.md`: `packages/domain/src/slots/reservationLimit.ts` の行のすぐ下に次の1行を足す（新しい test file にも行が要る）:
     ```text
     | `packages/domain/test/reservationLimit.test.mjs` | TEST | domain reservation limit T01-T03 | MIG-0301 | SAME | IN_PROGRESS | PR#<n> SHA=<sha> |
     ```
  ```bash
  npm run test --workspace=@flamenode/domain
  npm run test:unit
  ```
  期待: domain の test の末尾が `# pass 3` と `# fail 0`。`test:unit` の末尾が `# fail 0` で、`# pass` は変更前と同じ数（domain の test は `test:unit` の対象外）。
- **U04 台帳を DONE 用に直す**（CI が green になった後、`REVIEW` にする直前）。下の Ledger updates を反映し、`MIGRATION_FILE_BASE_SHA=$(git rev-parse origin/main) node scripts/check-migration-file-progress.mjs` が終了コード0。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `normalizeSlotReservationLimit` に `null`, `undefined`, `-1`, `2.9`, `150`, `Infinity`, `NaN` | `0, 0, 0, 2, 100, 0, 0` |
| T02 | `slotReservationLimitMessage(3)` | 「このイベントでは、1つのX IDにつき最大3件まで枠を確保できます。連続枠は1件として数えます。」と完全一致 |
| T03 | `slotReservationLimitMessage(0)` | 空文字 |
| T04 | 旧 path から import する既存3 file | 無変更で `# pass 6` |
| T05 | `rg -n 'from "(next|react|server-only|@/)' packages/domain/src` | 0件（終了コード1） |
#### Commands
```bash
npm run test --workspace=@flamenode/domain
npm run build --workspace=@flamenode/domain && rm -rf packages/domain/dist
npm run build --workspace=@flamenode/contracts && npm run build --workspace=@flamenode/api
npm run typecheck
npm run test:unit
npm run verify:fast
npm run check:project-docs
```
期待: すべて終了コード0、`test:unit` の件数が変更前と同じ。
#### Ledger updates
U04 で `FILE_MIGRATION_MATRIX.md` の次の行を直す。`<n>` は PR 番号、`<sha>` は U04 を始める前の `git rev-parse HEAD`、`<url>` は green になった CI の run URL（実在しない値を書かない）。`<ev>` は `PR#<n> SHA=<sha> TEST=npm run test --workspace=@flamenode/domain CI=<url>`。
1. `packages/domain/package.json`, `packages/domain/src/index.ts`, `packages/domain/tsconfig.json` の3行: 3列目を `domain package entry/config (source-referenced, tested in CI)`、状態を `RETAINED`、証跡を `<ev>`。
2. `src/lib/slots/slotReservationLimit.ts` の行を次にする:
   ```text
   | `src/lib/slots/slotReservationLimit.ts` | HELPER | pure numeric policy | MIG-0301 | packages/domain/src/slots/reservationLimit.ts | BRIDGED | <ev> |
   ```
3. `packages/domain/src/slots/reservationLimit.ts` と `packages/domain/test/reservationLimit.test.mjs` の2行: 状態を `RETAINED`、証跡を `<ev>`。
4. `src/lib/slots/slotReservationLimit.contract.test.mjs` と `src/lib/slots/slotReservationLimitGuard.execution.test.mjs` の2行: 状態を `RETAINED`、証跡を `PR#<n> SHA=<sha> TEST=node --test --experimental-strip-types <その file の path> CI=<url>`（MIG-0301 が DONE になると、NOT_STARTED のままでは file 検査が落ちる）。
5. merge 統合（runbook F）で `STATUS.md` を直すときは、表の MIG-0301 を `DONE`、MIG-0302 を `READY` にし（MIG-0302 の Work Order は NEEDS_REFINEMENT のままなので、小型モデルの候補には出ない。lead が詰める）、冒頭の `Current Task:` が `MIG-0301` なら `Task State:` も `DONE` にする（表と冒頭が違うと `check:migration-docs` が落ちる）。
#### DONE checklist
- [ ] `src/lib/slots/slotReservationLimit.ts` が re-export の5行だけ
- [ ] `packages/domain/src/slots/reservationLimit.ts` の中身が移動前と同一（`git show origin/main:src/lib/slots/slotReservationLimit.ts | diff - packages/domain/src/slots/reservationLimit.ts` が終了コード0）
- [ ] `npm run test --workspace=@flamenode/domain` が CI の workspace job に入っている
- [ ] Commands がすべて終了コード0（出力の末尾をPRに貼った）
- [ ] PR 本文に「`permissions.ts` は消さず owner を MIG-0306 へ移した」と1行書いた
#### STOP
- Source snapshot の1行でも実物と違う（`test:unit` の件数を除く）。
- 既存3 file の test が `# pass 6` にならない（2回直しても）。
- `next build` や CI で `@flamenode/domain/slots/reservationLimit` が解決できないと出た。
- 手順に無い file を変える必要が出た。
#### Rollback
PR を revert。bridge は revert で元の実装に戻り、台帳の行も元に戻る。

### MIG-0302: low-risk read domain（低リスク参照系）
- **Model:** small
- **Readiness:** NEEDS_REFINEMENT — 形は `IMPLEMENTATION_RECIPES.md` の R-DOMAIN で決まった。MIG-0301 の merge 後、lead が実ファイルで Source snapshot を確かめて READY_FOR_SMALL_MODEL にする
- **Recipe:** R-DOMAIN
- **Runtime:** N
- **Depends on:** MIG-0301 / **Decisions:** none
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- `src/lib/utils/softwareLabels.ts:1-2` `SOFTWARE_LABEL_MAX_ITEMS = 20`, `SOFTWARE_LABEL_MAX_LENGTH = 80`。`:4` `normalizeSoftwareCatalogName`、`:12` `normalizeSoftwareKey`、`:16` `normalizeSoftwareLabels`。import 無し。
- `src/lib/slots/limits.ts:1-2` `MIN_SLOTS_PER_VIDEO = 1`, `MAX_SLOTS_PER_VIDEO = 20`。`:4` `normalizeMaxSlotsPerVideo(value: unknown): number`。import 無し。
- 利用側（2026-10-15時点）: `softwareLabels` を import するファイル 3件、`slots/limits` を import するファイル 7件（`rg -l 'softwareLabels"|slots/limits"' src app` で再確認）。
- DB を読む read（`src/lib/db/videoDetailQueries.ts` 等）は対象外（MIG-0308 の後）。
#### Owned paths
- 新規: `+packages/domain/src/software/labels.ts`, `+packages/domain/src/slots/limits.ts` と各テスト
- 変更（bridge化のみ）: `src/lib/utils/softwareLabels.ts`, `src/lib/slots/limits.ts`
- 変更: `packages/domain/src/index.ts`（export 追加のみ）
- 触らない: 利用側ファイル（import path を書き換えない。bridge で吸収する）
#### Micro-units
- **U01 software labels**: 実装を意味を変えず移し、旧pathを同名 export の bridge にする（書き方は `IMPLEMENTATION_RECIPES.md` の R-DOMAIN）。検証: 移動前後で `node --test --experimental-strip-types "src/**/*software*.test.mjs"` のPASS件数が同じ。
- **U02 slot limits**: 同様に移す。検証: `node --test --experimental-strip-types src/lib/slots/limits.test.mjs` が同数PASS。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `normalizeMaxSlotsPerVideo(0)` / `(21)` / `("x")` | 移動前と同じ戻り値 |
| T02 | 81文字のラベル、21個のラベル、重複ラベル | 移動前と同じ正規化結果 |
| T03 | 旧pathから import | 既存テストが無変更でPASS |
| T04 | `packages/domain/src/**` の import | `src/**` と `next/*` への参照が0件 |
#### Commands
```bash
npm run build --workspace=@flamenode/domain
npm run typecheck
npm run test:unit
npm run verify:fast
npm run check:project-docs
```
期待: すべて終了コード0、`test:unit` の件数が移動前と同じ。
#### Ledger updates
`FILE_MIGRATION_MATRIX.md`: `src/lib/utils/softwareLabels.ts`, `src/lib/slots/limits.ts` を `BRIDGED`（target は新パス、evidence に PR/テスト件数）。RH-029 の行は変えない（API は MIG-0601）。
#### DONE checklist
- [ ] 2ファイルが bridge になり、利用側の import は変わっていない
- [ ] `test:unit` の件数が移動前と同じ
- [ ] `packages/domain` から `src/**` を参照していない
#### STOP
- 移す対象が DB・`server-only`・`@/` alias を import していたら止める（Tier 2）。
- MIG-0301 が DONE でなければ止める（R-DOMAIN の形が main に無い）。
#### Rollback
PRをrevert。bridge は revert で元実装に戻る。

### MIG-0308: packages/db schema extraction（D-01 A / MIG-0302後）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — 高リスク（schema）。手順の正本は [`DB_PACKAGE_EXTRACTION_PLAN.md`](DB_PACKAGE_EXTRACTION_PLAN.md)。小型モデルには渡さない
- **Recipe:** R-DOMAIN
- **Runtime:** N
- **Depends on:** MIG-0302 / **Decisions:** D-01 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- `src/lib/db/schema.ts:8,34`: `schema.base.ts` と `schema.canonical.ts` を明示的に re-export する2ブロック。
- `schema.canonical.ts` は `schema.base.ts` から `eventGroups, softwareCatalog, users` を import（`DB_PACKAGE_EXTRACTION_PLAN.md` §1）。片方だけ移すと循環が壊れる。
- `drizzle.config.ts` の `schema` は `./src/lib/db/schema.ts`、`out` は `./migrations`。
- `scripts/check-db-schema.mjs` は旧3ファイルの存在と fragment import を検査する（2026-10-15 実行: 31 migrations, 46 tables, 474 columns, 114 indexes, 52 foreign keys, 43 checks）。
#### Owned paths
- 新規: `+packages/db/package.json`, `+packages/db/tsconfig.json`, `+packages/db/src/schema/base.ts`, `+packages/db/src/schema/canonical.ts`, `+packages/db/src/schema/index.ts`
- 変更: `src/lib/db/schema.ts`（re-export bridge）, `drizzle.config.ts`, `scripts/check-db-schema.mjs`, `package-lock.json`
- 削除しない: `src/lib/db/schema.base.ts`, `src/lib/db/schema.canonical.ts` は bridge として残すか、checker を新pathへ合わせた上で同PRで移す（どちらにするかPRに理由を書く）
- 触らない: `migrations/**`（既存SQLは不変）、`src/lib/db/client.ts` と query 群
#### Micro-units
- **U01 baseline**: 移設前に `npm run check:db-schema` の出力（件数）と `drizzle-kit generate` の dry-run 差分（空であること）を記録。
- **U02 move**: base/canonical を同時に `packages/db/src/schema/` へ移し、`index.ts` を唯一の公開 entry にする。旧 `schema.ts` は `@flamenode/db` からの re-export。検証: 全 named export の一覧が移設前と一致（スクリプトで比較しPRに貼る）。
- **U03 tooling**: `drizzle.config.ts` と `check-db-schema.mjs` を新pathに合わせる。検証: U01 と同じ件数、dry-run 差分ゼロ。
- **U04 builds**: Next / Workers / Hono の import 解決を確認。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | named export 一覧の比較 | 移設前後で完全一致 |
| T02 | `drizzle-kit generate` dry-run | 生成SQL差分ゼロ |
| T03 | `npm run check:db-schema` | U01 と同じ件数 |
| T04 | `packages/db` の import | `src/**` への参照0件、循環0件 |
#### Commands
```bash
npm ci
npm run check:db-schema
npm run typecheck
npm run test:unit
npm run test:integration
npm run verify:fast
npm run build --workspace=@flamenode/api
npm run cf:build
```
期待: すべて終了コード0。`cf:build` は非本番buildのみ（deployしない）。
#### Ledger updates
`FILE_MIGRATION_MATRIX.md`: `src/lib/db/schema*.ts` を `BRIDGED`、`packages/db/src/schema/*` 行を追加。
#### DONE checklist
- [ ] 生成SQL差分ゼロの証跡がPRにある
- [ ] named export が完全一致
- [ ] Remote D1 を操作していない
- [ ] schema の独立レビュー（他agentまたは人間）の APPROVE がある
#### STOP
- テーブル・列・index・FK・check・default のいずれかが変わる差分が出たら止める。
- `migrations/**` を変更する必要が出たら止める。
- Remote D1 / 本番deploy が必要に見えたら止める（明示承認事項）。
#### Rollback
PRをrevert（schema 定義は移設のみでDDLが無いため、D1 側の戻しは不要）。

### MIG-0303: low-risk mutation domain（低リスク更新系）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0308 の `@flamenode/db` と、監査付き mutation を domain/adapter のどこで分けるか（`mutateWithAudit` の置き場）を MIG-0301/0308 の結果で確定してから
- **Recipe:** R-DOMAIN
- **Runtime:** N
- **Depends on:** MIG-0308 / **Decisions:** D-01 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- SA-004〜006: `src/lib/actions/announcement.ts`（検証の契約テスト `src/lib/actions/announcement.validation.contract.test.mjs`）。
- SA-007〜008: `src/lib/actions/api-endpoints.ts`。
- SA-035〜037: `src/lib/actions/event-template-admin.ts`（`src/lib/actions/event-template-admin.execution.test.mjs`）。一次抽出は本MIG。MIG-0305/0604 は消費側として検証のみ。
- `src/lib/audit/mutate.ts:1-3` は `drizzle-orm` と `@/lib/db/client` を import する（Tier 2）。
#### Owned paths
- 新規: `+packages/domain/src/announcement/*.ts`, `+packages/domain/src/apiEndpoints/*.ts`, `+packages/domain/src/eventTemplate/*.ts`（入力検証・正規化・権限判定・結果型）
- 変更: 上記3つの action ファイル（domain を呼ぶ形へ。D1 session/binding、`revalidatePath`、redirect は action 側に残す）
- 触らない: `src/lib/audit/mutate.ts` の監査の意味（strict / expected-row CAS）
#### Micro-units
- **U01 announcements**: SA-004〜006 の入力検証と結果型を domain へ。DB 書き込みと監査は adapter 側。検証: `announcement.validation.contract.test.mjs` が同数PASS。
- **U02 api-endpoints**: SA-007〜008 を同様に。
- **U03 event templates**: SA-035〜037 を同様に。検証: `event-template-admin.execution.test.mjs` が同数PASS。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 未ログイン / 非admin で各SA | 移動前と同じエラー結果、DB書き込み0、監査0 |
| T02 | expected-row CAS 競合 | 移動前と同じ競合結果 |
| T03 | 成功 | 監査1件、公開反映の enqueue が移動前と同じ |
| T04 | 書き込み失敗 | 監査が残らない |
#### Commands
```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run verify:fast
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md`: 3 action ファイルを `IN_PROGRESS`（domain 抽出済み、API 移行は Phase 6）。`API_MATRIX.md` の該当 SA 行に domain 側の関数名を追記。
#### DONE checklist
- [ ] SA-004〜008, 035〜037 の各SAで、成功・拒否・競合の結果と監査・Queue が移動前と一致
- [ ] domain に `revalidatePath` / `redirect` / D1 binding が無い
- [ ] 対象外の admin mutation を変更していない
#### STOP
- 監査の strict / CAS の意味を変える必要が出たら止める。
- 対象外のSAに波及したら止める。
#### Rollback
PRをrevert。

### MIG-0304: video domain group（動画ドメイン）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — micro-unit の正本は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0304。Tier 2 は MIG-0308 後の DB adapter 方針が決まってから
- **Recipe:** R-DOMAIN
- **Runtime:** N
- **Depends on:** MIG-0303 / **Decisions:** D-03 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- Tier 1: `src/lib/auth/ownershipCore.ts`（`:43` `resolveAdminOrEventVideoPrivilegeMode`, `:76` `resolveVideoOwnershipSync`, `:94` `adminPolicyAllows`, `:109` `creatorOwnerCanManagePermissions`, `:120` `ownerPolicyAllows`, `:131` `decideCanEditVideoFromAccessContext`, `:152` `eventStaffCandidatePermissionKeys`）。`:6-11` で `./videoEditSections`, `./permissions/aliases.ts`, `../video/generalEditPermissionsCore.ts` を import。
- `src/lib/video/generalEditPermissionsCore.ts:1` は `@/lib/auth/videoEditSections` を `@/` alias で import する。Node の strip-types では解決できないため、移すときに相対 import へ直す。
- Tier 2: `src/lib/video/videoVisibilityTransition.ts:1,3` は `server-only` と `next/navigation` の `unstable_rethrow` を import。`src/lib/video/computeEditSections.ts:1-2` は `@/lib/db/client` と `@/lib/db/schema` を import。
- 不変条件: PR #265 で一本化した作品編集権限判定、creator owner だけが collaborator 権限を委譲できる、dangerous key は常に拒否、event モードは `eventStaffCandidatePermissionKeys` の和集合だけで判定（`optimize/loop-state.md` iteration 40 の P0 修正）。
#### Owned paths
- 新規: `+packages/domain/src/video/ownership.ts`, `+packages/domain/src/video/editSections.ts`, `+packages/domain/src/video/generalEditPermissions.ts`, `+packages/domain/src/video/visibility.ts`（Tier 2 は U02 以降）
- 変更（bridge化）: `src/lib/auth/ownershipCore.ts`, `src/lib/auth/videoEditSections.ts`, `src/lib/auth/permissions/aliases.ts`, `src/lib/video/generalEditPermissionsCore.ts`
- 変更: `src/lib/actions/admin.ts`（SA-001〜003）, `src/lib/actions/manage-video.ts`（SA-040〜042）, `src/lib/actions/chapter.ts`（SA-012〜015）— U02/U03 で domain 呼び出しへ
- 触らない: `src/lib/auth/ownership.ts` の DB 経路の判定結果（意味を変えない）
#### Micro-units
- U01〜U04 と Final audit は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0304 の定義に従う。各unitの検証は下の Commands を unit 範囲のテストで実行する。
- **U01** の検証: `node --test --experimental-strip-types src/lib/auth/ownershipCore.test.mjs src/lib/auth/ownershipAccessContext.test.mjs src/lib/auth/ownershipEventMode.sqlite.execution.test.mjs src/lib/auth/videoEditSections.test.mjs` が移動前と同数PASS。
- **U02** の検証: `src/lib/video/videoVisibilityTransition.test.mjs`, `videoVisibilityCompensation.execution.test.mjs`, `videoVisibilityNotificationsPostCommit.execution.test.mjs` が同数PASS。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | creator owner / collaborator / event staff / admin / banned × normal・event・admin モード | 許可・拒否が移動前と一致 |
| T02 | dangerous key を含む権限 | 常に拒否 |
| T03 | collaborator が権限を委譲 | 拒否 |
| T04 | 公開→非公開の遷移 | CAS・フェンス・通知・静的反映 enqueue が移動前と一致 |
| T05 | チャプター削除 | コメントが論理保持される |
#### Commands
```bash
npm run test:critical
npm run typecheck
npm run test:unit
npm run test:integration
npm run verify:fast
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md`: 移したファイルを `BRIDGED`。`API_MATRIX.md` の SA-001〜003, 012〜015, 040〜042, 082〜089 に domain 側の関数名を追記。
#### DONE checklist
- [ ] `TASK_MICRO_UNITS.md` の U01〜U04 と Final audit が全部 DONE
- [ ] `test:critical` の件数とPASSが移動前と同じ
- [ ] 対象SAの許可・拒否と副作用が移動前と一致
#### STOP
- 権限判定の結果が1件でも変わったら止める。
- owner/admin を event モードへ暗黙に fallback させる変更が必要に見えたら止める。
- Active X の過去履歴移行（D-03 fan-out）と新規操作を同じコードにまとめる必要が出たら止める。
#### Rollback
PRをrevert。bridge により利用側の import は不変。

### MIG-0305: event/slot domain group（イベント・枠）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — micro-unit の正本は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0305。Tier 2 は MIG-0308 後
- **Recipe:** R-DOMAIN
- **Runtime:** N
- **Depends on:** MIG-0303 / **Decisions:** none
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- Tier 1: `src/lib/event/eventOwnershipCore.ts`（`:22` `LAST_OWNER_ERROR`, `:25` `isEventOwner`, `:31` `validateEventStaffSubject`, `:39` `validateEventStaffUniqueness`, `:54` `assertEventWillRetainOwner`, `:69` `planXIdMergeEventStaffOwnerProtection`, `:103` `assertSelfChangeConfirmation`）。`:3` で `../utils/xid.ts` を import（一緒に移すか、`packages/domain` 側に同等の純粋関数を置く）。テスト `src/lib/event/eventOwnershipCore.test.mjs`。
- Tier 2: `src/lib/event/eventVisibilityTransition.ts:1,3-5`（`server-only`, `drizzle-orm`, `@/lib/db/client`）、`src/lib/event/eventGroupVisibilityTransition.ts:1,3-4`。
- slot: `src/lib/actions/slot.ts`, `src/lib/actions/slot-admin.ts`, `src/lib/actions/slot-admin-danger.ts`。原子性テスト `src/lib/actions/slot.atomicity.execution.test.mjs`。
- 不変条件 `FN-X-001`: event は常に操作可能な owner を1人以上持つ（条件付きSQL/CAS。UIの検証だけにしない）。
#### Owned paths
- 新規: `+packages/domain/src/event/ownership.ts`, `+packages/domain/src/event/visibility.ts`, `+packages/domain/src/slots/*.ts`
- 変更（bridge化）: `src/lib/event/eventOwnershipCore.ts`
- 変更: `src/lib/actions/event-*.ts`, `src/lib/actions/slot*.ts`（domain 呼び出しへ。transaction 境界は action/adapter 側に残す）
- 触らない: SA-021 `renameEventId`、SA-056/057 の破壊的 release（汎用CRUDに吸収しない）、SA-035〜037（MIG-0303 の所有）
#### Micro-units
- U01〜U04 と Final audit は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0305 の定義に従う。
- **U01** の検証: `node --test --experimental-strip-types src/lib/event/eventOwnershipCore.test.mjs` が同数PASS、`npm run check:event-owners` が終了コード0。
- **U03** の検証: `src/lib/actions/slot.atomicity.execution.test.mjs`, `slotIntegrity.execution.test.mjs`, `slotNotificationsPostCommit.execution.test.mjs` が同数PASS。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 最後の owner を解任 | 拒否（`LAST_OWNER_ERROR`） |
| T02 | 2つの解任を同時実行 | owner が0にならない |
| T03 | 同じ枠を同時予約 | 1件だけ成功 |
| T04 | 連続枠の上限超過 | 移動前と同じ拒否メッセージ |
| T05 | DM 送信失敗 | outbox の再試行と監査が移動前と一致 |
#### Commands
```bash
npm run test:critical
npm run check:event-owners
npm run typecheck
npm run test:unit
npm run test:integration
npm run verify:fast
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md`: 移したファイルを `BRIDGED`。`API_MATRIX.md` の SA-021〜034, 038〜039, 056〜068 に domain 側の関数名を追記。
#### DONE checklist
- [ ] U01〜U04 と Final audit が全部 DONE
- [ ] owner 0 防止が DB transaction を含むテストで実証されている
- [ ] SA-021 と SA-056/057 が個別実装のまま
#### STOP
- owner 0 防止を UI 検証だけで済ませる変更が必要に見えたら止める。
- 予約の transaction 境界を変える必要が出たら止める。
#### Rollback
PRをrevert。

### MIG-0306: user/X/admin domain group（ユーザー・X・管理）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — micro-unit の正本は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0306。`src/lib/xid/mergeBudget.ts` が audit core に依存するため、MIG-0303 で audit の分け方が決まってから
- **Recipe:** R-DOMAIN
- **Runtime:** N
- **Depends on:** MIG-0303 / **Decisions:** D-03 DECIDED, D-04 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- `src/lib/xid/mergeBudget.ts:1-4` は `@/lib/audit/mutate` から `planAtomicAuditMutationBudget` を import。単独では Tier 1 にならない。
- Tier 2: `src/lib/xid/merge.ts:1,3-4`（`server-only`, `drizzle-orm`, `@/lib/db/client`、1328行）、`src/lib/xid/mergeSafety.ts:1`（`drizzle-orm`）、`src/lib/xid/xUserVisibilityTransition.ts:1,3-4`。
- テスト: `src/lib/xid/merge*.test.mjs`（7件）, `src/lib/xid/xUserVisibilityTransition.contract.test.mjs`。
- Auth User と Active X: `approved_by_auth_user_id`, `edit_granted_by_auth_user_id`, 監査の `actor_user_id`, session 識別子は Auth User のまま（`PRODUCT_REQUIREMENTS.md`）。
#### Owned paths
- 新規: `+packages/domain/src/xid/*.ts`, `+packages/domain/src/admin/*.ts`, `+packages/domain/src/user/*.ts`
- 置換または削除: `packages/domain/src/permissions.ts`（MIG-0301 から owner を引き継いだ偽の `canEditVideo`。本物の判定に置き換えるか、呼び出し元0件を示して `RETIRED`（`APPROVAL=` が要る）にする）
- 変更: `src/lib/actions/cost-guard.ts`, `moderation-admin.ts`, `notification-admin.ts`, `terms.ts`, `static-rebuild-admin.ts`, `user-admin.ts`（domain 呼び出しへ）
- 触らない: SA-092〜097 X-ID merge/revert の本体（安全な primitive だけ共有）、SA-011 audit restore、SA-050 public visibility repair（個別実装として残す）
#### Micro-units
- U01〜U04 と Final audit は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0306 の定義に従う。
- **U02** の検証: `node --test --experimental-strip-types "src/lib/xid/merge*.test.mjs"` が同数PASS、`npm run check:x-link-dependencies` と `npm run check:audit-actor-x` が終了コード0。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | owner が重なる X ID の merge と revert | 帰属が元に戻り、再実行しても同じ結果 |
| T02 | 1つの X に複数の Auth User | 重複拒否が移動前と一致 |
| T03 | BAN した利用者の操作 | 拒否 |
| T04 | 監査の actor | Auth User のまま |
#### Commands
```bash
npm run check:x-link-dependencies
npm run check:audit-actor-x
npm run typecheck
npm run test:unit
npm run test:integration
npm run verify:fast
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md`: 変更した action ファイルを `IN_PROGRESS` または `BRIDGED`。`API_MATRIX.md` の SA-016〜020, 043〜055, 069〜081, 090〜106 に domain 側の関数名を追記。
#### DONE checklist
- [ ] U01〜U04 と Final audit が全部 DONE
- [ ] X merge の rollback と再実行の結果が移動前と一致
- [ ] Auth User を Active X へ置き換えた箇所が0件
#### STOP
- Auth User 識別子を Active X へ置き換える変更が必要に見えたら止める。
- D-03 の過去履歴 fan-out を live mutation と同じ経路にする必要が出たら止める。
#### Rollback
PRをrevert。

### MIG-0307: Phase 3 Gate（完了判定）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — Phase Gate はエージェントが自動承認しない
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0304, MIG-0305, MIG-0306, MIG-0308 / **Decisions:** D-01 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- MIG-0301〜0306, 0308 の merge 済みPRと、`IMPLEMENTATION_RECIPES.md` の R-DOMAIN。
- `packages/domain/src/permissions.ts` の偽権限実装が MIG-0301 で無効化済みであること。
#### Owned paths
- 新規: `+scripts/check-domain-imports.mjs`（`packages/domain` と `packages/db` から `next/*`, `react`, `hono`, `astro`, `server-only`, `src/**` への import を禁止）
- 変更: `scripts/check-project-docs.mjs`（上の checker を接続）, `docs/migration/STATUS.md`（承認後の merge 統合時だけ）
#### Micro-units
- **U01 checker**: 禁止 import の checker を追加し `check:project-docs` へ接続。違反を1件含む fixture で失敗することをテストする。
- **U02 evidence**: Tier 1 の移動先一覧、Tier 2 の完了状況、テスト件数の移動前後比較をPRにまとめ、独立レビューと人間の Gate 承認を依頼。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `packages/domain` に `import "next/navigation"` を足す | checker が失敗 |
| T02 | `test:unit` / `test:integration` の件数 | Phase 3 開始前と同じかそれ以上、テストの削除0件 |
| T03 | Tier 2 を BLOCKED/SKIPPED のまま Gate | 不可（例外はユーザー承認と代替task が必要） |
#### Commands
```bash
npm ci
npm run typecheck
npm run test:unit
npm run test:integration
npm run verify:fast
npm run check:db-schema
npm run check:project-docs
```
#### Ledger updates
承認後に `STATUS.md` の MIG-0307 を DONE、MIG-0601 の依存解消を反映。
#### DONE checklist
- [ ] 禁止 import の checker が CI で動く
- [ ] MIG-0308 が DONE
- [ ] 独立レビューの APPROVE と人間の Phase Gate 承認がPRにある
#### STOP
- 人間の承認なしに STATUS を DONE にしない。
#### Rollback
checker 追加のPRをrevert。

---

# 4. 抽出規約

形の正本は [`IMPLEMENTATION_RECIPES.md`](IMPLEMENTATION_RECIPES.md) の R-DOMAIN（MIG-0301 の手順を実コードで試して決めた）。この節には書かない。
