# FlameNode Phase 2 タスク仕様書（Design System & UI Primitives Spec）

> 状態: Active / Phase 2 実行向け仕様書
> 最終検証: 2026-10-13（HTMLモック登録 D-08 DECIDED, MIG-0200 DONE 後に策定）
> 対象モデル: Claude / Codex / Antigravity / 全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`AGENT_PROTOCOL.md`](AGENT_PROTOCOL.md), [`UI_REFERENCE.md`](UI_REFERENCE.md), [`CURRENT_ROUTES.md`](CURRENT_ROUTES.md), [`TASK_CARDS_2_3.md`](TASK_CARDS_2_3.md)

この仕様書は、Phase 2（デザインシステム・UI Primitives・IA抽出）のアーキテクチャ方針と各タスクの実行境界を定める。

> **タスク正本:** 個別タスクの実行指示（読む・変える・試す・DONE条件）の正本は [`TASK_CARDS_2_3.md`](TASK_CARDS_2_3.md) です。`npm run migration:next` がその内容を自動抽出します。

---

# 1. Phase 2 の目的と基本原則

### 目的

ユーザー承認済みの HTML モック（`docs/migration/mock/`、`UI_REFERENCE.md` 登録済み）から、デザイントークン（色・余白・タイポグラフィ・ブレークポイント等）および汎用 UI プリミティブ（Button, Link, Badge, Modal, Input 等）を抽出し、フレームワーク非依存の `packages/ui` に実装する。

### 基本原則

1. **公開画面と非公開画面の分離**:
   - **公開画面**: 登録済み HTML モック（D-08 DECIDED）を正本としてデザインを適用。
   - **非公開画面**: CURRENT UI / 機能を維持・再利用。モックの未掲載を理由に独自デザインを創作しない。
2. **既存機能・UX の完全保持**:
   - 見た目の変更（デザイン刷新）によって既存の認可、CSRF、キーボード操作、フォーカス管理、アクセシビリティ（a11y）、エラー表示、ローディング表示を欠落させない。
3. **薄い UI コンポーネント境界**:
   - `packages/ui` のコンポーネントは Next.js, Astro, Vite, Hono 等の特定フレームワークに密結合せず、純粋な React コンポーネントおよび CSS トークンとして提供する。
4. **段階的リリースと Gate 厳守**:
   - Phase 2 の完了は `MIG-0206`（Phase 2 Acceptance Gate）の明示的検証・承認をもって認定し、後続の個別画面移行（Phase 4/5）の前提条件とする。

---

# 2. Phase 2 タスク構成

| タスク ID | 名称 | 対象境界 | 主な成果物 |
| --- | --- | --- | --- |
| `MIG-0200` | 承認済み HTML モック登録（DONE） | `docs/migration/` | `UI_REFERENCE.md`, `OPEN_DECISIONS.md` |
| `MIG-0201` | IA・デザイントークン抽出 | `packages/ui/src/styles/` | `tokens.css`, `IA_MAPPING.md` |
| `MIG-0202` | 汎用 UI プリミティブ実装 | `packages/ui/src/components/` | Button, Link, Badge, Dialog, `bodyScrollLock.ts` |
| `MIG-0203` | 公開ナビゲーション・レイアウト | `packages/ui/src/layout/` | Header, Footer, SideNav, Layout Context |
| `MIG-0204` | フォーム・フィードバック・データ表示 | `packages/ui/src/` | Form controls, Toast, Alert, Table, Skeleton |
| `MIG-0205` | 代表的レスポンシブ公開画面プロトタイプ | `packages/ui/` | Video, Event, User 代表画面プロトタイプ |
| `MIG-0206` | Phase 2 受入 Gate | 全体検証 | UI Primitive テストスイート, Gate 判定記録 |

---

# 3. Work Orders

### MIG-0201: visual hierarchy / IA / tokens extraction
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — tokens.cssの数値・セレクタ規約とIA mappingのフォーマットを実コードで確定する
- **Depends on:** MIG-0108, MIG-0200 / **Decisions:** D-08 DECIDED
- **Verified against:** `5d15922f` (2026-10-13)
#### Source snapshot
`docs/migration/mock/` に登録された HTML モックおよび `docs/migration/UI_REFERENCE.md`。
#### Owned paths
- `+packages/ui/src/styles/tokens.css`
- `+docs/migration/design/IA_MAPPING.md`
#### Micro-units
- **U01**: HTML モックの CSS からカラーパレット、フォントファミリ、サイズスケール、スペーシング、角丸、シャドウを抽出し `tokens.css` を作成。
- **U02**: CURRENT visual routes（74件）とモック画面の対応表を `IA_MAPPING.md` に作成。
#### Test cases
| ID | 入力/操作 | 期待結果 |
| --- | --- | --- |
| T01 | `tokens.css` の CSS 変数検証 | 主要トークン（color, space, font）が定義されている |
| T02 | `IA_MAPPING.md` の URL 網羅性 | CURRENT visual routes の全件がマッピングされている |
#### Commands
```bash
npm run check:project-docs
npm run typecheck
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に `packages/ui/src/styles/tokens.css` を追加。
#### DONE checklist
- [ ] `tokens.css` が作成され、主要トークンが CSS 変数として定義されている
- [ ] `IA_MAPPING.md` に全公開画面の情報階層・ナビゲーション対応が記録されている
#### STOP
モックに未定義のスタイルを勝手に創作して追加しない。不明な値は推定値として明記する。
#### Rollback
作成したファイル（`tokens.css`, `IA_MAPPING.md`）を削除。
