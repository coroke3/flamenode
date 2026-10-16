# Implementation cards: Phase 2 / 3 (15 tasks, including MIG-0308)

> Status: Active / mandatory task recipes
> Companion: [IMPLEMENTATION_RUNBOOK.md](IMPLEMENTATION_RUNBOOK.md), [STATUS.md](STATUS.md), [PHASE_3_SPEC.md](PHASE_3_SPEC.md), [DB_PACKAGE_EXTRACTION_PLAN.md](DB_PACKAGE_EXTRACTION_PLAN.md)
> Rule: one MIG card per invocation; check the actual code before editing; `+path` denotes a planned new file.
> Work Order: 実装手順の正本は各Phase仕様書の `### MIG-XXXX:` 節（Model / Readiness付き）。このカードは要約。小型モデルは `Model: small` かつ `READY_FOR_SMALL_MODEL` のWork Orderだけを実行する（[IMPLEMENTATION_RUNBOOK.md](IMPLEMENTATION_RUNBOOK.md)）。

## Common contract

各MIG開始前に `FILE_MIGRATION_MATRIX.md` で所有source、テスト、依存consumerを絞り込み、実target fileと接続済みexport/importを `FILE_PROGRESS_PROTOCOL.md` に従って同じPRで更新する。タスクDONEの前に担当ファイルに `NOT_STARTED` が残っていないことを checker で確認する。

The user HTML mock is registered in `UI_REFERENCE.md` (MIG-0200 DONE, D-08 DECIDED, 2026-10-13), so Phase 2 visual cards are gated by the STATUS dependency chain, not by missing HTML: MIG-0201 is READY, MIG-0202..0206 follow in order, and MIG-0206 (Phase 2 Gate) is never self-approved. Stop visual work only if `UI_REFERENCE.md` reverts to `PENDING_HTML`. Phase 3 pure/domain cards may proceed in parallel **only where STATUS dependencies actually allow**. After D-01=A, D-01 no longer blocks design; **MIG-0308 code migration** gates DB-coupled extraction. All PRs preserve legacy Next behavior, user-facing UX and owner/security/visibility invariants. Never fabricate approved HTML or mark unexecuted tests as PASS.

### MIG-0200 — register approved HTML mock

- 読む: `UI_REFERENCE.md`, user-provided attachment/file, `CURRENT_ROUTES.md`, `screen-mapping/README.md`.
- 変更: HTML取得元と実際のhash/version/date/scope・screen対応を記録。原本を参照可能なrepositoryまたは接続先に登録し、1 surfaceごとにCURRENT route/UX/FN対応表を追加。ユーザー未提供なら`BLOCKED_ON_USER`のまま（MIG-0200は2026-10-13にDONE済み。再登録・差し替え時のみ該当）。
- 試験: fileの実在/hash、未掲載画面一覧、scope/excludedを手動review。新デザインの推測禁止。
- DONE: `UI_REFERENCE.md` の記載とHTML実体、ユーザーの採用確認が一致。D-08の状態更新は**HTML受領後**のみ。

### MIG-0201 — design tokens extraction

- 読む: `PHASE_2_SPEC.md` の MIG-0201 Work Order（正本。script と test の全文あり）、`docs/migration/mock/source/design-system/tokens.json`。
- 変更: `+scripts/generate-ui-tokens.mjs` で tokens.json から `+packages/ui/src/styles/tokens.css` を生成し、`+scripts/generate-ui-tokens.test.mjs` で一致を検査する。route と mock の対応表は `UI_REFERENCE.md` に既にあるので別表を作らない。
- 試験: 生成物の sha256 一致、test 3件 PASS、`npm run test:unit`。
- DONE: Work Order の DONE checklist。
- 停止: tokens.json の version・件数が Work Order と違う、sha256 が合わない。

### MIG-0202 — shared UI primitives

- 読む: `packages/ui/src/components/Button.tsx`, `packages/ui/src/adapters/index.tsx`, HTMLのbutton/link/input類、`src/components/layout/bodyScrollLock.ts`。
- 変更: `packages/ui/src/components/`でButton, Link wrapper, Badge, Dialogのうち登録済みHTMLに存在するprimitiveだけ作成。disabled/loading/error/focus状態とa11yを含む。モーダル/ドロワー背景固定用に `+packages/ui/src/layout/bodyScrollLock.ts` へ移植し、即時復元セマンティクスを維持する。
- 試験: `npm run build --workspace=@flamenode/ui`、keyboard/aria/focusのcomponent tests、`bodyScrollLock.contract.test.mjs` パリティ、Next/Astro/Vite双方のbundler解決を確認。
- DONE: 対象primitivesのUI_REFERENCE差分、状態変化とdisabled semanticsのE2E/スナップショットが記録済み。

### MIG-0203 — public navigation / layout

- 読む: `screen-mapping/README.md`, HTML header/footer/side-nav, `CURRENT_ROUTES.md`, `UI_MIGRATION_GUIDE.md`。
- 変更: `+packages/ui/src/navigation/`, `+packages/ui/src/layout/`のroot別Context/Providerを作成。別SPA間のリンクは通常navigation、Next/React Router/静的Astroを一つのmutable global setterで共有しない。
- 試験: mobile/desktop nav、active route、search query preserved、back/forward、direct reload、認証なしのリンク。
- DONE: CURRENTの全ナビゲーション入口とfocus/keyboard behaviorが消えていない。

### MIG-0204 — forms / feedback / data display

- 読む: HTML form/table/error/pending表現、`frontend/CROSS_CUTTING.md`, `UI_REFERENCE.md`。
- 変更: field/confirm/dialog/toast/table/list等の登録済みUIをUI packageに追加し、validation/pending/degraded/empty/forbidden/error/retry状態を実装。既存mutationをUI側で作り直さない。
- 試験: error stateごとのaria-live、二重submit抑止、textarea focus、キーボード、loading skeletonをケース化。
- DONE: 用いたUX IDsのstate coverageが台帳から照合可能。

### MIG-0205 — representative responsive public screens

- 読む: Phase2 HTML mock、`CURRENT_ROUTES.md`, `frontend/PUBLIC.md`, `PHASE_4_5_SPEC.md`。
- 変更: video/event/userの3代表画面をvisual prototypeとして作成。見た目の構造はmockと一致、動作はCURRENTを維持。MIG-0402/0403との作業境界をPRに記載し、重い配信処理は移植しない。
- 試験: screen比較（desktop/mobile）、SEO/OGPメタ、hydration、a11y、empty/private/failed states。
- DONE: 代表3画面のUX IDごとに保持/未対応/次MIGが分かる記録。

### MIG-0206 — Phase 2 acceptance gate

- 読む: `UI_REFERENCE.md`, Phase2全PR、`FRONTEND_FEATURES.md`, `FEATURE_CATALOG.md`。
- 変更: checklistと画像差分/対応表/未対応画面をレビュー成果物として固定。承認されるまでSTATUSのGateはCLOSED。
- 試験: registered HTML hash一致、全public screen mapping、responsive/a11y、UX/FN削除なし、独立review。
- DONE: Gate明示承認とCI合格をPRに記録し、後続MIG-0402のみdependencyが解消されたらREADY。

### MIG-0301 — domain extraction / import resolution PoC

- 読む: `PHASE_3_SPEC.md` の MIG-0301 Work Order（正本。手順は実コードで確認済み）、`IMPLEMENTATION_RECIPES.md` の R-DOMAIN。
- 変更: `src/lib/slots/slotReservationLimit.ts` の実装を `+packages/domain/src/slots/reservationLimit.ts` へ意味を変えずに移し、旧 path を re-export の bridge にする。`packages/domain/src/permissions.ts` の偽の `canEditVideo` を消す。`packages/domain` を source 参照の `exports` と test script にし、CI で test を回す。
- 試験: 既存3 file の test が `# pass 6`、domain の test、`npm run typecheck`、`npm run test:unit`、`npm run verify:fast`。
- DONE: Work Order の DONE checklist。
- 停止: 偽の `canEditVideo` に呼び出し元がある、既存 test の件数が変わる、`@flamenode/domain/slots/reservationLimit` が解決できない。

### MIG-0302 — pure read helpers

- 読む: `src/lib/utils/softwareLabels.ts`, `src/lib/slots/limits.ts`と隣接tests・利用者、`route-handlers/README.md` RH-029。
- 変更: `+packages/domain/src/software/labels.ts`, `+packages/domain/src/slots/limits.ts`へ関数/定数を同名移動。元のpathはbridgeで残す。検証対象/エラー表現を変えない。
- 試験: software label長さ/正規化/重複、slot最小最大/無効入力、Node test/TypeScript/Next/worker bundle。
- DONE: すべての既存importが動き、APIのソフトウェア候補がDTO形式を維持。DBを読む処理はMIG-0308後。

### MIG-0308 — packages/db extraction (D-01=A)

- 読む: **[DB_PACKAGE_EXTRACTION_PLAN.md](DB_PACKAGE_EXTRACTION_PLAN.md)全体**、`src/lib/db/schema.ts`, `schema.base.ts`, `schema.canonical.ts`, `scripts/check-db-schema.mjs`, `drizzle.config.ts`。
- 変更: `+packages/db/package.json`, `+packages/db/src/schema/{base,canonical,index}.ts`, `+packages/db/tsconfig.json`へ移設し、旧schema.tsをexport bridgeへ。FK/partial index/check/defaultのDrizzle定義を一切変えない。root lockfileとmanifest checkerを新しいpathに適合。
- 試験: baseline manifest/SQL migration dry-run diff **ゼロ**、全symbol exports、`npm ci`, `npm run check:db-schema`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run verify:fast`、Next/Worker/Hono build。
- DONE: schema constructorの正本は一つ、循環importなし、直接legacy fragment importsなし、Remote D1未操作。schema高リスクの独立review後までmergeしない。

### MIG-0303 — low-risk mutations

- 読む: `server-actions/README.md` SA-004..008, SA-035..037、`src/lib/actions/announcement.ts`, `api-endpoints.ts`, `event-template-admin.ts`。**SA-035..037の一次抽出はMIG-0303。MIG-0305/0604は既存サービスの呼び出し・権限・監査を検証し、二重実装しない。**
- 変更: input validation → permission result → DB transaction/mutateWithAudit → post-commit enqueueを段階的に分離。domainのpolicyはframework-neutral、D1 session/binding/redirectはadapterに残す。旧Server ActionとHonoで同一serviceを呼ぶ。
- 試験: unauthorized/forbidden, CAS競合、失敗時no-audit/write、成功時audit + static reflection、同時操作retryの実験。
- DONE: SAごとのbefore/afterレスポンス・監査/Queue/permission一致。対象外のadmin mutationは触らない。

### MIG-0304 — video domain

- 読む: `src/lib/actions/admin.ts` (SA-001..003)、`src/lib/auth/ownershipCore.ts`, `ownership.ts`, `src/lib/video/videoVisibilityTransition.ts`, `computeEditSections.ts`, SA-012..015,040..042,082..089、`auth/README.md`。**動画管理actionはMIG-0304の一次所有、MIG-0306は重複抽出しない。**
- 変更: mode-aware permission/visibility/chapters/collab/update serviceを凝集単位で移す。イベントmodeへowner/adminを暗黙fallbackさせない。D-03 fan-outの履歴移行と**新規Active X単位操作を区別**する。
- 試験: creator owner/staff/collab/admin/banned/mode切替/dangerous key、visibility CAS、章削除でもコメント論理保持、post-commit notification/rebuild。
- DONE: 対象SA/UX/FNの行を全数照合、権限の許可/拒否と副作用一致。

### MIG-0305 — event/slot domain

- 読む: `src/lib/event/eventOwnershipCore.ts`, `src/lib/event/eventVisibilityTransition.ts`, `src/lib/slots/slotReservationLimit.ts`, SA-021..034、SA-038..039とSA-056..068（SA-035..037はMIG-0303で抽出）、`background-jobs/README.md`。
- 変更: event owner保護/枠制約/atomic reservation/releaseのpolicyとtransaction boundaryを抽出。破壊的rename/releaseを汎用CRUDに吸収しない。
- 試験: 最終owner解任拒否、同時予約、連続枠上限、期限超過、再実行、DM失敗・outbox retryのaudit/Queue不変。
- DONE: 認可とownerゼロ防止がDB transactionを含め実証され、経路別UX/FNは維持。

### MIG-0306 — user/X/admin domain

- 読む: `src/lib/xid/merge.ts`, `mergeSafety.ts`, `xUserVisibilityTransition.ts`、SA-016..020,043..055,069..081,090..106、`ACTIVE_X_MIGRATION_PLAN.md`。
- 変更: X link/merge/revert、user/admin moderationと監査/rollbackを分離。Auth UserとActive Xのidentity typeを混同しない。D-03 fan-outは**専用backfillフローと既存live mutationを別系統**で検証。
- 試験: merge/revert overlapping owner、link owner/manager、approved/rejected/imported、複数Auth/単一X重複、BAN、監査actor identity、permission/security mode。
- DONE: X merge rollbackとデータ帰属の再実行性、旧/新の認可一致、ロール変更と監査一致が確認済み。

### MIG-0307 — Phase 3 Gate

- 読む: MIG-0301..0306 + MIG-0308のmerge済PR、`DB_PACKAGE_EXTRACTION_PLAN.md`、`API_MATRIX.md`。
- 変更: `packages/db/domain`の依存方向とtype/runtime exportsを検証し、禁止import checkerを正式CIに接続。STATUS・台帳にパリティと証拠を記録。
- 試験: `npm ci`、typecheck、`test:unit`、`test:integration`、`verify:fast`、`check:db-schema`、workspace+Next build、schema zero diff。
- DONE: **MIG-0308 DONE**が必須。skipped Tier2があるなら明示承認と代替task/ownerが必要。Phase Gate独立レビュー・ユーザー承認までDONEにしない。
