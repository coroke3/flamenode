# FlameNode 移行 引き継ぎメモ (Handoff)

> **作成日時**: 2026-10-26 02:10 (JST)  
> **ベースコミット**: `0a0f62a2` (`origin/main`)  
> **オープンPR状態**: 自PR 0件（完了済み）。#386 のみセキュリティ関連の別PRで放置。

---

## 1. 直近で完了・mainにマージされたタスク（全件Green・マージ済み）

以下の直近5タスク（Tier 1〜4 + 関連タスク）はすべて独立レビュー（APPROVE）およびCI全項目（`migration-contract`, `migration-workspaces`）を通過し、`origin/main` に squash merge 済みです。

| タスクID | PR | 内容 | マージコミット |
| :--- | :--- | :--- | :--- |
| **MIG-0634** | #401 | 公開動画一覧・viewer overlay Hono API (RH-031, RH-032) | `16ba53a0` |
| **MIG-0633** | #402 | イベント所有権・権限リゾルバ core (D-10 R-CORE) | `15f41cef` |
| **MIG-0635** | #406 | 管理者Read API part C (`videos/:id`, `members`, `users/:id/edit`) | `16c9ba08` |
| **MIG-0629** | #407 | 監査設定更新 (SA-009) & 復元 dry-run (SA-010) API | `0a0f62a2` |
| **D-14** | #404 | D-14 readiness refresh (18タスクのREADY化・依存整理) | `509d0e69` |

---

## 2. 次端末での再開手順

### Step 1: リポジトリの最新化
```bash
git checkout main
git pull --ff-only origin main
git status
```
最新コミットが `0a0f62a2`（またはそれ以降）であることを確認。

### Step 2: 依存関係・チェッカー確認
```bash
npm ci
npm run check:project-docs
```

### Step 3: 着手可能タスクの選定
```bash
npm run migration:next -- --model small
```
または `PHASE_6_SPEC.md` / `PHASE_4_5_SPEC.md` より候補を確認。

#### おすすめの次回着手候補
1. **小型モデル向け (READY_FOR_SMALL_MODEL)**:
   - **MIG-0501**: `fixed/static routes (/about & /rules + /maintenance shell)`
     - Work order: `docs/migration/PHASE_4_5_SPEC.md ### MIG-0501`
     - Brand 資産の複製（13ファイル）、`/maintenance.astro` の layout 修正、画面確認
   - **MIG-0503**: `fixed event list /events (SSG)`
   - **MIG-0504**: `creator profile /user/[id] (SSG)`
   - **MIG-0505**: `top page / (SSG)`
   - **MIG-0506**: `browse /browse (SSG)`
   - **MIG-0511**: `search /search (SSG)`

2. **Phase 6 API 残りタスク**:
   - **MIG-0638**: `Route Handlers 残り（RH-002, RH-004..008, RH-019, RH-023..025, RH-027/028）`
   - **MIG-0636**: `Personal X / Active X / 規約同意 API`
   - **MIG-0637**: `admin 運用の書き込み API`

---

## 3. 重要な不変条件・ルール（厳守）

- **1 MIG task = 1 branch = 1 PR = 1 squash merge**
- **main 直接 push 禁止**: 作業は必ず `migration/mig-xxxx-<slug>` または `task/...` ブランチで実施。
- **自動マージ禁止**: 自PRは最終 Head で独立レビュー（APPROVE）と CI 全項目 green を確認後、PR コメントに `Merge requested: integrated | Head: <sha> | Review: <URL> | CI: <URL>` を記録して人間に引き渡す。
- **Zero-1102 実行予算**:
  - `S2` (Admin Read): D1 ステートメント <= 3、一覧上限 <= 100
  - `S3` (Mutations): D1 読み取り <= 3、書き込み 1 atomic batch、リクエストボディ <= 64KB
- **境界原則**: `packages/server-core` は Next/React/Hono/server-only 等の依存を含めない。
