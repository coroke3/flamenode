# FlameNode Phase 3 タスク仕様書（Domain Extraction Spec）

> 状態: Active / Phase 3 実行向け仕様書
> 最終検証: 2026-10-09（ファイルパス・export 名は実コードで確認済み。`npm run check:project-docs` が参照を機械検証する）
> 対象モデル: Claude / Codex / Antigravity / GPT-5.6-luna / Gemini Flash 等の全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`AGENT_PROTOCOL.md`](AGENT_PROTOCOL.md), [`CODE_QUALITY.md`](CODE_QUALITY.md), [`FEATURE_CATALOG.md`](FEATURE_CATALOG.md), [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md), [`server-actions/README.md`](server-actions/README.md)

この仕様書は、各タスクの目的・対象ソース・作成ファイル・禁止事項・検証コマンドを具体化したものである。
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

- **目的**: Tier 1 の抽出方式（ファイル配置・import 規約・ブリッジ・テスト）を、1 モジュールで実証して固定する。
- **PoC 対象**: `src/lib/slots/slotReservationLimit.ts`（`MAX_SLOT_RESERVATIONS_PER_XID`, `normalizeSlotReservationLimit`, `slotReservationLimitMessage`。import なし）
- **作業**:
  1. `packages/domain` に実行可能なテスト経路を作る（`test` script と、`node --test --experimental-strip-types` で `.ts` を解決できる `exports` 設計）。
  2. `` `+packages/domain/src/slots/reservationLimit.ts` `` へ実装を移し、`src/lib/slots/slotReservationLimit.ts` を同じ export 名の再 export ブリッジにする。
  3. 既存テスト（`src/lib/slots/` 配下の既存 `*.test.mjs`）が無変更で通ることを確認する。
  4. `packages/domain/src/permissions.ts` のプレースホルダーを削除し、`packages/domain/src/index.ts` の export を整理する（上記注意点）。
  5. 決定した方式を本書 §4（抽出規約）へ追記する。
- **やらないこと**: MIG-0308の前にDB package移設を先走ること。新domainから旧`src/`のdrizzle schemaへ相対importすること。
- **受け入れ条件**:
  - ブリッジ越しに `npm run test:unit`・`npm run typecheck`・Next の build 経路（`npm run cf:cloud-build` が使う経路）で解決できる。
  - `packages/domain` に禁止 import がない（MIG-0307 で自動チェックを追加するまで、grep で確認する）。
- **検証**:
  ```bash
  npm run typecheck
  npm run test:unit
  npm run verify:fast
  npm run check:project-docs
  ```

### MIG-0302: low-risk read domain（低リスク参照系）

- **対象（Tier 1 のみ）**: 副作用・DB アクセスのない純粋ロジック。
  - `src/lib/utils/softwareLabels.ts`（`normalizeSoftwareLabels`, `normalizeSoftwareKey`, `normalizeSoftwareCatalogName`, `SOFTWARE_LABEL_MAX_ITEMS`, `SOFTWARE_LABEL_MAX_LENGTH`）
  - `src/lib/slots/limits.ts`（`normalizeMaxSlotsPerVideo`, `MIN_SLOTS_PER_VIDEO`, `MAX_SLOTS_PER_VIDEO`）
  - 公開 read の DTO 整形のうち `@/` import を持たないもの（候補選定は `route-handlers/README.md` の RH-029 `/api/software/suggestions` を起点にする）
- **作成**: `` `+packages/domain/src/software/labels.ts` ``, `` `+packages/domain/src/slots/limits.ts` `` と対応するテスト。ブリッジは MIG-0301 の方式。
- **MIG-0308 待ち**: DB を読むread（`videoDetailQueries.ts` 等）は別のTier2。
- **検証**: MIG-0301 と同じ。

### MIG-0308: packages/db schema extraction（D-01 A / MIG-0302後）

- **専用PR**: [`DB_PACKAGE_EXTRACTION_PLAN.md`](DB_PACKAGE_EXTRACTION_PLAN.md)に従って`+packages/db`へbase/canonical/schemaを一括移設、旧schemaを再exportブリッジにする。
- **必須**: `drizzle.config.ts` / DB checker / TS path / package-lock / Next・Hono・Workers build importを整合させる。
- **禁止**: 既存SQL migration改変、Remote D1操作、schema変更を伴うコード整理、本番deploy。
- **Gate**: named exportの同一性・生成SQL差分ゼロ・型/各build/test/独立reviewが証明されるまでDONEにしない。

### MIG-0303: low-risk mutation domain（低リスク更新系）

- **対象**: [`server-actions/README.md`](server-actions/README.md) のうち、単一テーブル・admin write・監査あり・外部副作用が小さいもの。
  - SA-004〜006 announcements（`src/lib/actions/announcement.ts`）
  - SA-007〜008 api-endpoints（`src/lib/actions/api-endpoints.ts`）
  - SA-035〜037 event templates（`src/lib/actions/event-template-admin.ts`）
- **前提**: これらは `mutateWithAudit` と DB を使うため **Tier 2 に該当し、MIG-0308のpackages/db移設待ち**（`BLOCKED(MIG-0308)`）。
  回答前にできるのは「入力検証・正規化・error 契約」だけを純粋関数として切り出す作業である。
- **作成**: MIG-0308完成後に確定。それまでは `` `+packages/domain/src/announcement/validation.ts` `` のような**検証のみ**を対象にする。
- **不変条件**: 監査（`strict`）、expected-row CAS、public rebuild の enqueue、`revalidatePath` の意味分解（API_MATRIX.md の Side-effect parity）。

### MIG-0304: video domain group（動画ドメイン）

- **対象**（[`server-actions/README.md`](server-actions/README.md) の SA-*）:
  - 可視性遷移: SA-001〜003（admin）、SA-040〜042（manage）— 共通 core を共有し、adapter は role 別に残す
  - chapter: SA-012〜015
  - collab/member: SA-082〜085
  - 提出・更新: SA-086, SA-088, SA-089
  - interaction: SA-087（**Active X 移行の対象**。[`ACTIVE_X_MIGRATION_PLAN.md`](ACTIVE_X_MIGRATION_PLAN.md) を先に読むこと）
- **Tier 1（先行可）**: `src/lib/auth/ownershipCore.ts`（`resolveVideoOwnershipSync`, `decideCanEditVideoFromAccessContext`, `adminPolicyAllows`, `ownerPolicyAllows`, `creatorOwnerCanManagePermissions`, `resolveAdminOrEventVideoPrivilegeMode`）。
  推移的 import（`src/lib/auth/videoEditSections.ts`, `src/lib/auth/permissions/aliases.ts`, `src/lib/video/generalEditPermissionsCore.ts`）も同時に移す。
- **Tier 2（MIG-0308 待ち）**: `src/lib/video/videoVisibilityTransition.ts`（`server-only`、`next/navigation`、`@/lib/db/*` を import）、`src/lib/video/computeEditSections.ts`（`@/lib/db/*` を import）、`src/lib/auth/ownership.ts` の `canEditVideo`（DB 経路）。
  `next/navigation` の `redirect` はドメインへ持ち込まず、結果型（`unauthenticated | forbidden | ...`）で返して adapter が redirect する。
- **不変条件**: PR #265 で一本化した作品編集権限判定（権限源ごとの判定）、「creator owner のみが collaborator 権限を委譲できる」、dangerous key の常時 deny。
- **チャプターコメント**: 親チャプター削除時、コメントは物理削除せず論理保持する（[`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md) Chapter/comment model）。

### MIG-0305: event/slot domain group（イベント・枠）

- **対象**: SA-021〜039（event / event group / staff / template / playlist）、SA-056〜068（slot）。
- **Tier 1（先行可）**: `src/lib/event/eventOwnershipCore.ts`（`assertEventWillRetainOwner`, `validateEventStaffUniqueness`, `validateEventStaffSubject`, `assertOwnershipTransferInput`, `assertSelfChangeConfirmation`, `isEventOwner`, `planXIdMergeEventStaffOwnerProtection`）、`src/lib/slots/slotReservationLimit.ts`。
- **Tier 2（MIG-0308 待ち）**: `src/lib/event/eventVisibilityTransition.ts`, `src/lib/event/eventGroupVisibilityTransition.ts`。
- **不変条件**: `FN-X-001` event は常に operable owner を 1 人以上保持する（条件付き SQL/CAS を含む。UI 検証だけにしない）。
- **intentional exception（汎用 CRUD 化しない）**: SA-021 `renameEventId`, SA-056/057 slot の破壊的 release。

### MIG-0306: user/X/admin domain group（ユーザー・X・管理）

- **対象**: SA-016〜020（CostGuard）、SA-043〜055（moderation / notification-admin / terms）、SA-069〜081（static-rebuild / terms / user-admin）、SA-090〜106（X ID・merge・Active X・YouTube sync）。
- **Tier 1（先行可）**: `src/lib/xid/mergeBudget.ts`（`planXIdMergeD1Budget`）は `@/lib/audit/mutate` に依存するため audit core の分離が前提。単独では先行不可。
- **Tier 2（MIG-0308 待ち）**: `src/lib/xid/xUserVisibilityTransition.ts`（`server-only`）、`src/lib/xid/mergeSafety.ts`（drizzle `sql` を import）、`src/lib/xid/merge.ts`。
- **Auth User を Active X へ機械置換しない**: `approved_by_auth_user_id`, `edit_granted_by_auth_user_id`, audit `actor_user_id`, session/security 識別子は Auth User のまま（[`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md)）。
- **intentional exception**: SA-092〜097 X-ID merge/revert（安全な primitive のみ共有）、SA-011 audit restore、SA-050 public visibility repair。

### MIG-0307: Phase 3 Gate（完了判定）

- **完了チェックリスト**:
  - [ ] `packages/domain` に `next/*` / `react` / `hono` / `astro` / `server-only` の import がない（静的チェックを `scripts/` に追加し `check:project-docs` へ接続）
  - [ ] Tier 1 の対象がすべて `packages/domain` へ移り、`src/lib/**` は同名 export のブリッジである
  - [ ] MIG-0308で `packages/db` 移行が完了し、DB schema差分ゼロ、循環依存ゼロ、Next/Hono/Workersのビルド/テストを実証。Tier2を単に `BLOCKED/SKIPPED` と記録しただけでPhase Gateを通さない（例外はユーザー承認と代替タスクの追加が必須）
  - [ ] 既存テスト（`npm run test:unit`・`npm run test:integration`）が**無変更で**全件パスする（件数は固定せず、移行前後で同数であることを確認する）
  - [ ] `npm run verify:fast` が PASS
  - [ ] `STATUS.md` の Phase 3 を `DONE` に更新し、Phase 6 の MIG-0601 を `READY` にする
- **検証**:
  ```bash
  npm run typecheck
  npm run test:unit
  npm run test:integration
  npm run verify:fast
  npm run check:project-docs
  ```

---

# 4. 抽出規約（MIG-0301 で確定後に追記）

MIG-0301 完了時に、次を本節へ記録する。

- 配置: `packages/domain/src/<domain>/<module>.ts`
- 公開 export: `packages/domain/src/index.ts`（サブパス export の有無）
- ブリッジ: `src/lib/...` の元ファイルを再 export にする書き方
- テスト: 移動したテストの置き場所と実行コマンド
- 3 経路（node test / next build / tsc）の解決方法
