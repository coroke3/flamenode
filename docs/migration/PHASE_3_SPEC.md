# FlameNode Phase 3 タスク仕様書（Domain Extraction Spec）

> 状態: Active / Phase 3 実行向け完全仕様書
> 対象モデル: Claude / Codex / Antigravity / GPT-5.6-luna / Gemini Flash 等の全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`AGENT_PROTOCOL.md`](AGENT_PROTOCOL.md), [`CODE_QUALITY.md`](CODE_QUALITY.md), [`FEATURE_CATALOG.md`](FEATURE_CATALOG.md)

このドキュメントは、**Luna や Flash などの軽量モデルでも一切迷わずに実装できるよう、Phase 3 の各タスクの目的・作成ファイル・コード仕様・禁止事項・検証コマンドを完全に具体化した仕様書**である。

---

# 1. Phase 3 の目的と基本原則

### 目的
現行の Next.js (`src/lib/`) に散らばっているビジネスロジック・権限判定・データアクセスを、**フレームワーク非依存の純粋な TypeScript パッケージ（`packages/domain`）** へ抽出し、集約する。

### 基本原則（Invariant Rules）
1. **フレームワーク非依存（Pure Domain）**:
   - `packages/domain` 内で `next/*`, `react`, `hono`, `astro` などの Web/UI フレームワークをインポートすることを**厳格に禁止**する。
   - すべての関数は純粋な関数、または依存性を引数（`DomainContext`）として受け取る DI（Dependency Injection）パターンで実装する。
2. **既存契約・権限・安全保証の 100% 保持**:
   - `owner` 不変条件（イベントオーナーをゼロにしない）、fail-closed な可視性フェンス、CAS（Compare-And-Swap）による楽観的排他制御、監査ログ記録をそのまま維持する。
3. **薄いラッパーの禁止**:
   - 単なる D1 クエリの 1 行ラッパーを乱立させない。ドメインルール、権限検証、トランザクション境界を含む凝集度の高い関数として設計する。

---

# 2. Phase 3 タスク別詳細仕様書（Zero-Ambiguity Spec）

---

### MIG-0301: extraction/DI pattern（依存性注入パターンとドメイン基盤）

- **目的**:
  - `packages/domain` におけるデータベース・環境変数・ロガーの注入基盤（`DomainContext`）およびトランザクション実行ヘルパーを確立する。
- **編集・作成ファイル**:
  1. `packages/domain/src/context.ts`:
     ```typescript
     import type { DrizzleD1Database } from "drizzle-orm/d1";
     import * as schema from "../../src/lib/db/schema";

     export type AppDatabase = DrizzleD1Database<typeof schema>;

     export interface DomainLogger {
       info(message: string, meta?: Record<string, unknown>): void;
       warn(message: string, meta?: Record<string, unknown>): void;
       error(message: string, error?: unknown, meta?: Record<string, unknown>): void;
     }

     export interface DomainContext {
       db: AppDatabase;
       logger?: DomainLogger;
       now?: () => Date;
     }

     export function createDomainContext(params: {
       db: AppDatabase;
       logger?: DomainLogger;
       now?: () => Date;
     }): DomainContext {
       return {
         db: params.db,
         logger: params.logger,
         now: params.now || (() => new Date()),
       };
     }
     ```
  2. `packages/domain/src/index.ts`:
     - `context.ts` の型とファクトリ関数を export。
  3. `packages/domain/test/context.test.ts`:
     - メモリ内コンテキスト生成の単体テスト。
- **禁止事項**:
  - Next.js 固有の `headers()`, `cookies()`, `next/cache` を持ち込まないこと。
- **検証コマンド**:
  ```bash
  npm run typecheck --workspace=@flamenode/domain
  npm run build --workspace=@flamenode/domain
  node scripts/check-migration-docs.mjs
  ```

---

### MIG-0302: low-risk read domain（低リスク参照系ドメインの抽出）

- **目的**:
  - 依存が少なく副作用のない参照系ドメイン（ソフトウェア一覧・ラベル解決・メタデータ取得）を `packages/domain` へ移行する。
- **対象ソース**:
  - `src/lib/db/software.ts`
  - `src/lib/utils/softwareLabels.ts`
- **作成ファイル**:
  1. `packages/domain/src/software/read.ts`:
     - `getSoftwareList(ctx: DomainContext, options?: { activeOnly?: boolean })`
     - `getSoftwareById(ctx: DomainContext, id: string)`
     - `resolveSoftwareLabel(key: string): string`
  2. `packages/domain/src/software/index.ts`:
     - 参照系関数の export。
  3. `packages/domain/test/software-read.test.ts`:
     - 照合・ラベル解決のテスト。
  4. `src/lib/db/software.ts`:
     - `packages/domain` の関数を呼び出す互換ブリッジに切り替え。
- **検証コマンド**:
  ```bash
  npm run typecheck
  npm run test:unit
  node scripts/check-migration-docs.mjs
  ```

---

### MIG-0303: low-risk mutation domain（低リスク更新系ドメインの抽出）

- **目的**:
  - 副作用が限定的で安全な更新系ドメイン（ソフトウェアの登録・更新、通知の既読化）を `packages/domain` へ移行する。
- **対象ソース**:
  - `src/lib/db/software.ts`（更新系）
  - `src/lib/notifications/`（既読化）
- **作成ファイル**:
  1. `packages/domain/src/software/mutate.ts`:
     - `upsertSoftware(ctx: DomainContext, input: SoftwareInput)`
  2. `packages/domain/src/notification/mutate.ts`:
     - `markNotificationsRead(ctx: DomainContext, params: { userId: string; notificationIds: string[] })`
  3. 単体テスト:
     - 入力検証（Zod 等）、重複エラー、トランザクション正常系のテスト。
- **検証コマンド**:
  ```bash
  npm run typecheck
  npm run test:unit
  node scripts/check-migration-docs.mjs
  ```

---

### MIG-0304: video domain group（動画ドメイングループの抽出）

- **目的**:
  - 最も重要な中核ビジネスルールである動画の権限判定・編集可否・可視性状態遷移を `packages/domain` へ集約する。
- **対象ソース**:
  - `src/lib/auth/ownershipCore.ts`（作品編集権限判定 `canEditVideo`, `ownerPolicyAllows`）
  - `src/lib/video/computeEditSections.ts`（許可編集セクション計算）
  - `src/lib/video/videoVisibilityStatusAction.ts`（公開状態遷移・CAS判定）
- **作成ファイル**:
  1. `packages/domain/src/video/permissions.ts`:
     - `canEditVideo(ctx: DomainContext, params: VideoEditPermissionCheckParams)`
     - `computeAllowedVideoEditSections(params: EditSectionParams)`
  2. `packages/domain/src/video/visibility.ts`:
     - `transitionVideoVisibility(ctx: DomainContext, params: VideoVisibilityParams)`
  3. `packages/domain/src/video/index.ts`
  4. `src/lib/auth/ownershipCore.ts` は `packages/domain` を呼び出す薄い互換ブリッジへ更新。
- **不変条件の保持**:
  - PR #265 で一本化した「権限源ごとの判定規則」を完全に保持すること。
- **検証コマンド**:
  ```bash
  npm run typecheck
  npm run test:unit
  npm run verify:fast
  ```

---

### MIG-0305: event/slot domain group（イベント・枠予約ドメイングループの抽出）

- **目的**:
  - イベント管理、スタッフ権限、連続枠確保制限（予約ロジック）を `packages/domain` へ集約する。
- **対象ソース**:
  - `src/lib/event/eventVisibilityTransition.ts`
  - `src/lib/slots/slotReservationLimit.ts`
  - `src/lib/event/eventGroupVisibilityTransition.ts`
- **作成ファイル**:
  1. `packages/domain/src/event/visibility.ts`:
     - `transitionEventVisibility(ctx: DomainContext, params: ...)`
  2. `packages/domain/src/slots/reservation.ts`:
     - `validateSlotReservationLimit(ctx: DomainContext, params: ...)`
  3. `packages/domain/src/event/index.ts`
- **不変条件の保持**:
  - `owner` 権限プリセットを持つスタッフが 0 人にならないこと（オーナー不変条件）。
- **検証コマンド**:
  ```bash
  npm run typecheck
  npm run test:unit
  npm run verify:fast
  ```

---

### MIG-0306: user/X/admin domain group（ユーザー・Active X・管理ドメインの抽出）

- **目的**:
  - Active X の承認・却下・可視性制御、X ID 統合・差し戻しロジック、管理者権限管理を `packages/domain` へ集約する。
- **対象ソース**:
  - `src/lib/xid/xUserVisibilityTransition.ts`
  - `src/lib/xid/mergeSafety.ts`
  - `src/lib/xid/mergePreflight.ts`
- **作成ファイル**:
  1. `packages/domain/src/user/xid.ts`:
     - `transitionXUserVisibility(ctx: DomainContext, params: ...)`
     - `validateXIdMergePreflight(ctx: DomainContext, params: ...)`
  2. `packages/domain/src/user/index.ts`
- **要件の保持**:
  - ユーザー合意事項である「Active X 未連携ユーザーには登録モーダルを表示して促す」フローと矛盾しないドメイン境界を維持すること。
- **検証コマンド**:
  ```bash
  npm run typecheck
  npm run test:unit
  npm run verify:fast
  ```

---

### MIG-0307: Phase 3 Gate（完了判定）

- **目的**:
  - `packages/domain` にすべての主要ビジネスロジックが抽出され、フレームワークから完全に分離されたことを検証・承認する。
- **完了チェックリスト**:
  - [ ] `packages/domain` に Next.js / React / Hono / Astro のインポートが一切存在しない（静的解析チェック）
  - [ ] 動画・イベント・枠・ユーザーの主要ドメイン関数がすべて `packages/domain` から export されている
  - [ ] 現行 Next.js (`src/lib/`) は `packages/domain` を呼び出す薄い互換ブリッジとして機能し、既存テスト 2,405 件がすべてパスしている
  - [ ] `npm run verify:fast`（全9ステップ）がすべて PASS している
  - [ ] `STATUS.md` の Phase 3 を `DONE` に更新し、Phase 6（Hono API: `MIG-0601`）を `READY` にアンブロック
- **検証コマンド**:
  ```bash
  npm run typecheck
  npm run test:unit
  npm run verify:fast
  node scripts/check-migration-docs.mjs
  ```
