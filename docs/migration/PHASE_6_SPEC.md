# FlameNode Phase 6 タスク仕様書（Hono API Spec）

> 状態: Active / Phase 6 実行向け仕様書
> 最終検証: 2026-10-09（`route-handlers/README.md` の RH-001〜RH-033 および `API_MATRIX.md` に基づき改定）
> 対象モデル: Claude / Codex / Antigravity / GPT-5.6-luna / Gemini Flash 等の全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`API_MATRIX.md`](API_MATRIX.md), [`route-handlers/README.md`](route-handlers/README.md), [`CODE_QUALITY.md`](CODE_QUALITY.md), [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) (D-01, D-02)
> **タスク正本:** 個別タスクの実行指示（読む・変える・試す・DONE条件）の正本は [`TASK_CARDS_6_7.md`](TASK_CARDS_6_7.md) です。`npm run migration:next` がその内容を自動抽出します。本仕様書はPhase 6全体のアーキテクチャ背景と設計意図を補足します。

---

# 1. Hono API の基本方針

1. **薄いトランスポート層（Thin Adapter）**:
   - `apps/api` は HTTP 入出力（リクエストパース、Zod バリデーション、レスポンス成形、ステータスコードマッピング）のみを担当。
   - ビジネスロジック・権限判定方針を`packages/domain`に共通化する。**D1 binding/session/request context/SQL実行・監査commitはapplication service/DB adapter側**で管理し、transaction境界・post-commit Queueを維持。`packages/domain`から旧`src/**`へのimportは禁止し、schema型はMIG-0308後の`@flamenode/db`から参照する。
2. **共有 Zod 契約（`packages/contracts`）**:
   - リクエストボディおよびレスポンス DTO は `packages/contracts` で型定義。
   - D1 テーブルのカラムをそのまま漏洩させず、明示的 DTO のみを返却（`check:public-api-leaks` 準拠）。
3. **有界な CPU 時間（< 10ms）と非同期委譲**:
   - HTTP リクエスト内で行う処理量は厳格に制限。重い処理・再生成は Queue（`fast-jobs`, `content-jobs`, `sync-jobs`）へ委譲。
4. **URL 体系の維持**:
   - 新規の独自プレフィックス（`/api/v1` 等）を勝手に作らず、CURRENT の `/api/*` パス構造（RH-001〜RH-033）を原則維持。

---

# 2. Phase 6 タスク別詳細仕様書（実 API 対応）

### MIG-0601: low-risk reads（低リスク参照系 API）

**Model:** small
**Readiness:** NEEDS_REFINEMENT — MIG-0307 domain extraction merged / MIG-0107 apps/api skeleton merged
**Depends on:** MIG-0307, MIG-0107 / **Decisions:** D-02 (DECIDED)
**Verified against:** `d28160b6` (2026-10-13)

- **対象**:
  - `GET /api/health` (RH-018)
  - `GET /api/health/deep` (RH-017, WORKER_ADMIN_TOKEN 認証)
  - `GET /api/public/about-stats` (RH-026, R2 静的アーティファクト参照)
  - `GET /api/software/suggestions` (RH-029, ソフトウェア候補)
- **仕様**: `packages/domain` または静的キャッシュから DTO を返却。
- **検証**: 単体テスト + CPU 時間実測。

#### Refinement inputs

| CURRENT artifact | ID | file |
| --- | --- | --- |
| public health check | RH-018 | `apps/api/health/route.ts` |
| admin deep health | RH-017 | `apps/api/health/deep/route.ts` |
| public statistics | RH-026 | `apps/api/public/about-stats/route.ts` |
| software suggestions | RH-029 | `apps/api/software/suggestions/route.ts` |

確定が必要な事実:
- Phase 3 ドメイン extraction で public read-only module (FN-API-004, FN-API-007, FN-API-008) が提供される確認
- RH-026 の R2 artifact access が Hono の環境で同じ binding を使用可能か確認
- CPU baseline (p95 < 5ms target) の測定方法・ツールの確認

### MIG-0602: low-risk mutations（低リスク更新系 API）

**Model:** lead
**Readiness:** NEEDS_REFINEMENT — MIG-0601 low-risk reads merged / MIG-0308 DB package extraction merged
**Depends on:** MIG-0601, MIG-0308 / **Decisions:** D-01 (DECIDED)
**Verified against:** `d28160b6` (2026-10-13)

- **対象**:
  - 単一テーブル更新、監査ログ記録、軽量な更新処理（announcements, api-endpoints, settings 等のドメイン呼び出し）。
- **仕様**: 認証ミドルウェアで Auth User を特定し、Zod バリデーション後に `packages/domain` を実行。

#### Refinement inputs

| CURRENT artifact | ID | file |
| --- | --- | --- |
| announcement lifecycle | SA-004..006 | `src/lib/actions/announcement.ts` |
| API endpoint config | SA-007..008 | `src/lib/actions/api-endpoints.ts` |
| cost guard settings | SA-016..020 | `src/lib/actions/cost-guard.ts` |
| audit log settings | SA-009..011 | `src/lib/actions/audit-admin.ts` |

確定が必要な事実:
- 認証ミドルウェア (auth context/current user) の Hono での実装パターン確認
- transaction/audit logging が Hono middleware → domain service のどこで発生するか確認
- Domain service の permission guard（requireAdminWrite 等）が Hono context から呼び出し可能か確認

### MIG-0603: video APIs（動画・チャプター API）

**Model:** lead
**Readiness:** NEEDS_REFINEMENT — MIG-0602 low-risk mutations merged / MIG-0304 video domain merged
**Depends on:** MIG-0602, MIG-0304 / **Decisions:** none
**Verified against:** `d28160b6` (2026-10-13)

- **対象**:
  - `GET /api/videos` (RH-032)
  - `GET /api/videos/:id` (RH-030)
  - `GET /api/videos/:id/viewer-overlay` (RH-031, セッション依存オーバーレイ)
  - 動画・チャプター更新エンドポイント（SA-012〜015, SA-087, SA-089 を受ける Hono エンドポイント）
- **仕様**:
  - `canEditVideo`（PR #265 一本化ロジック）による厳格な認可。
  - チャプター削除時のコメント論理保持（浮遊コメント化）。
  - 更新後の静的再生成 Queue wake 送信。

#### Refinement inputs

| CURRENT artifact | ID | file |
| --- | --- | --- |
| video list | RH-032 | `apps/api/videos/route.ts` |
| video detail | RH-030 | `apps/api/videos/[id]/route.ts` |
| video viewer overlay | RH-031 | `apps/api/videos/[id]/viewer-overlay/route.ts` |
| chapter mutations | SA-012..015 | `src/lib/actions/chapter.ts` |

確定が必要な事実:
- Phase 3 で提供される video domain module の canEditVideo permission contract の確認
- chapter deletion の comment orphan handling が domain service のどの層で実装されるか
- Queue/static rebuild trigger の実装が Hono endpoint に含まれるか/domain service か

### MIG-0604: event/slot APIs（イベント・枠 API）

**Model:** lead
**Readiness:** NEEDS_REFINEMENT — MIG-0602 low-risk mutations merged / MIG-0305 event/slot domain merged
**Depends on:** MIG-0602, MIG-0305 / **Decisions:** none
**Verified against:** `d28160b6` (2026-10-13)

- **対象**:
  - `GET /api/events` (RH-015)
  - `GET /api/live/events/:id/slots` (RH-020)
  - `GET /api/live/events/:id/submissions` (RH-021)
  - `GET /api/live/events/:id/summary` (RH-022)
  - `GET /api/events/:id/slots/viewer-overlay` (RH-014)
  - 枠予約・解放・イベント設定変更（SA-021〜039, SA-056〜068 を受ける Hono エンドポイント）
- **仕様**: オーナー 0 人禁止不変条件、連続枠上限の厳格検証。

#### Refinement inputs

| CURRENT artifact | ID | file |
| --- | --- | --- |
| event list | RH-015 | `apps/api/events/route.ts` |
| live slots | RH-020 | `apps/api/live/events/[id]/slots/route.ts` |
| live submissions | RH-021 | `apps/api/live/events/[id]/submissions/route.ts` |
| live summary | RH-022 | `apps/api/live/events/[id]/summary/route.ts` |
| slot viewer overlay | RH-014 | `apps/api/events/[id]/slots/viewer-overlay/route.ts` |
| event lifecycle | SA-022..024, SA-035..039 | `src/lib/actions/event-admin.ts`, `event-template-admin.ts` |
| event staff | SA-031..034 | `src/lib/actions/event-staff-admin.ts` |
| slot operations | SA-058..059, SA-056..057 | `src/lib/actions/slot-admin.ts`, `slot-admin-danger.ts` |

確定が必要な事実:
- FN-X-001 (owner 0 人禁止) invariant が domain module のどこで validate されるか
- 連続枠上限チェック logic がどの layer で実装されるか（endpoint/domain/service）
- Live API (RH-020..022) の 5s cache header が Hono response headers で再現可能か

### MIG-0605: user/X/admin APIs（ユーザー・X・管理 API）

**Model:** lead
**Readiness:** NEEDS_REFINEMENT — MIG-0602 low-risk mutations merged / MIG-0306 user/X/admin domain merged
**Depends on:** MIG-0602, MIG-0306 / **Decisions:** D-03 (DECIDED), D-04 (DECIDED)
**Verified against:** `d28160b6` (2026-10-13)

- **対象**:
  - `GET /api/account/summary` (RH-001, presence / detail モード)
  - `GET /api/internal/x-users/search` (RH-019)
  - `GET /api/admin/spreadsheet/*` (RH-003〜009)
  - Active X 切り替え・連携・X ID マージ・モデレーション（SA-043〜055, SA-090〜106）
- **仕様**: `ACTIVE_X_MIGRATION_PLAN.md` に従い、未連携ユーザーへのモーダル誘導データを提供。

#### Refinement inputs

| CURRENT artifact | ID | file |
| --- | --- | --- |
| account summary | RH-001 | `apps/api/account/summary/route.ts` |
| X-user search | RH-019 | `apps/api/internal/x-users/search/route.ts` |
| spreadsheet read | RH-003, RH-007, RH-009 | `apps/api/admin/spreadsheet/data/route.ts` (GET), `export`, `tables` |
| spreadsheet write | RH-004..006, RH-008 | `apps/api/admin/spreadsheet/data/route.ts` (PATCH/POST/DELETE), `import` |
| moderation | SA-043..044 | `src/lib/actions/moderation-admin.ts` |
| X ID merges | 未確認 | `src/lib/actions/x-id-merge*.ts` (search required) |

確定が必要な事実:
- ACTIVE_X_MIGRATION_PLAN.md で指定される fan-out logic が domain module か endpoint か
- Spreadsheet write (RH-004..006, RH-008) が domain service を通して atomic を保証するか確認
- X ID merge / Active X switching の permission model が domain export に含まれるか

### MIG-0606: API CPU benchmark

**Model:** small
**Readiness:** NEEDS_REFINEMENT — MIG-0603..0605 all video/event/user APIs merged
**Depends on:** MIG-0603, MIG-0604, MIG-0605 / **Decisions:** D-06 (DECIDED)
**Verified against:** `d28160b6` (2026-10-13)

- **目的**: 全エンドポイントについて、Cloudflare Workers Free 枠の CPU 時間 < 10ms（単純 read < 5ms, mutation < 8ms）を自動測定・検証。

#### Refinement inputs

| CURRENT artifact | ID | file |
| --- | --- | --- |
| API routes | RH-001..033 (except 010, 011) | measured via Cloudflare dashboard / Worker metrics |
| Route Handlers | 31 methods | `apps/api/**/route.ts` |

確定が必要な事実:
- Cloudflare Workers Free の CPU budget 測定方法と data collection process
- p95 threshold (p99 hard limit 10ms) の measurement window/representative load
- Hono endpoint のCPU vs Next.js Route Handler の baseline 比較 methodology

### MIG-0607: Phase 6 Gate

**Model:** lead
**Readiness:** NEEDS_REFINEMENT — MIG-0606 API CPU benchmark merged / independent review required
**Depends on:** MIG-0606 / **Decisions:** none
**Verified against:** `d28160b6` (2026-10-13)

- **完了条件**: RH-010/011（Auth.js GET/POST）はPhase 8まで現行Next側に維持し、**残り31メソッド**をHonoまたは同等の明示的な互換経路へ移行する。33メソッドすべてに移行先・HTTP method単位のルーティング・契約テスト・未移行の明示的なフォールバックを記録し、CPU予算を確認する。Phase 8前にAuth.jsをHonoへ一括移行したと誤判定しない。

#### Refinement inputs

| CURRENT artifact | ID | file |
| --- | --- | --- |
| Route Handlers | RH-001..009, RH-012..033 | `apps/api/**/route.ts` (31 methods, RH-010/011 exempted) |
| Auth.js transport | RH-010, RH-011 | `apps/api/auth/[...nextauth]/route.ts` (deferred to Phase 8) |

確定が必要な事実:
- 31 RH methods すべてについて Hono への移行/compat shim/fallback disposition の記録location
- HTTP method routing の Hono vs Next.js での互換性確認 method
- RH-010/011 exemption の明示的な記録と Phase 8 への handoff contract
