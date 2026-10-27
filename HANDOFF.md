# FlameNode 移行 引き継ぎメモ (Handoff)

> **初版**: 2026-10-26 02:10 JST — `main=0a0f62a2` 時点の履歴スナップショット  
> **追補**: 2026-10-27 21:06 JST — GitHub の open PR、各PR最終Headの Actions とレビュー一覧を再照合（#422 を追加）  
> **確認した main**: `fc5b97856abf82c31bda8e1d1f5def1ca2d9e05e`（2026-10-27のPR base SHA）  
> **注意**: 初版の「open PR 0件」「#386 のみ」は現在の作業状態を表していない。最新の正本は GitHub の open PR、PR branch の work-item、および main の `docs/migration/STATUS.md`。

---

## 0. 2026-10-27 最新の引き継ぎ・未完了ゲート

**mainの状態**: `fc5b97856abf82c31bda8e1d1f5def1ca2d9e05e` をPRのbaseとして確認。Production Cutoverは `docs/migration/STATUS.md` で **NOT STARTED**。作業ブランチのチェックポイントを main の DONE とみなさない。

| Open PR | Task | Head SHA (照合時点) | 最終Head CI | 独立 APPROVE | 依存・次の行動 |
| --- | --- | --- | --- | --- | --- |
| [#416](https://github.com/coroke3/flamenode/pull/416) | MIG-0908 | `4e9f5f39` | [40458494865](https://github.com/coroke3/flamenode/actions/runs/40458494865): contract/workspaces SUCCESS | 0 | 最終コード・TOML parserと36 declaration rowsの独立レビュー。27件の未確定処遇は勝手にretireしない |
| [#419](https://github.com/coroke3/flamenode/pull/419) | MIG-0661 | `4f84a4e9` | [40456482435](https://github.com/coroke3/flamenode/actions/runs/40456482435): 両job SUCCESS | 0 | **BLOCKED**: 64 KiB超の有効KV mirrorのmode保持とJSON.parse CPU予算を両立する方針・非本番測定が未完。サイズだけでnormalに戻さない |
| [#420](https://github.com/coroke3/flamenode/pull/420) | MIG-0718 | `bf6aee9b` | [40450876830](https://github.com/coroke3/flamenode/actions/runs/40450876830): 両job SUCCESS | 0 | **Draft**: U01–U02のみ。U03統合はMIG-0661・MIG-0701の両方がmainでDONEになってから |
| [#421](https://github.com/coroke3/flamenode/pull/421) | MIG-0664 | `74db20d7` | [40471288115](https://github.com/coroke3/flamenode/actions/runs/40471288115): 両job SUCCESS | 0 | REVIEW: 最終Headの独立レビューと統合ゲート確認 |
| [#422](https://github.com/coroke3/flamenode/pull/422) | MIG-0701 U04–U06 | `5b97f752` | [40486390396](https://github.com/coroke3/flamenode/actions/runs/40486390396): 両job SUCCESS | 0 | **Draft / REVIEW**: CSS/font、root documentとledger実装済み。独立レビュー、390/1440ブラウザ視覚検証（MIG-0706）と人間の判断が別途必要。MIG-0718 U03は#419と本件がmainでDONEになるまで着手不可 |
| [#408](https://github.com/coroke3/flamenode/pull/408) | handoff docs | `e6b61f2d`（本追補の変更前） | [40494091238](https://github.com/coroke3/flamenode/actions/runs/40494091238): 両job SUCCESS（**変更前のみ**） | 0 | Draft: 再開手順と残課題を更新。本追補後は新HeadのCIと独立レビューが必要 |

**次に解除すべき依存関係**:
- MIG-0701 は [PR #422](https://github.com/coroke3/flamenode/pull/422) のオーナーブランチ上で **REVIEW / 未マージ**。U04 CSS/font、U05 root document、U06 evidence は実装済みで、最終Head CI（40486390396）は両job SUCCESS。ただし独立承認なし。main の古い `STATUS.md` / work-item が READY と見えても、進行中PRを未着手と誤認しない。PR #420 の U03 は MIG-0701 と MIG-0661 (#419) の双方が main で DONE になるまで着手しない。
- #419 のCPU/パリティトレードオフは `docs/migration/ZERO_1102.md` の予算と、CURRENT `src/lib/operationMode/kvMirrorCore.ts` の振る舞いを照合する。単純な生JSON長上限による `normal` fallback は mode を壊すので禁止。非本番測定のない段階で「1102解消」とは記録しない。
- #416, #421, #422 は最終HeadのCIがgreenだが独立レビュー0。**CI成功 != レビュー承認**。#422はDraftでもある。PRごとに独立した非実装者のレビューと、人間のsquash merge判断が必要。
- #422 CSS確認で `apps/app/src/styles/dashboard.css` の `.dash-accountActions .dash-fn-btn` に対し、Personal `Dashboard.tsx` 側は `dash-accountActions` と `fn-btn` を出力しているため、この生成セレクタはそのボタンには一致しない。CURRENT CSS module の元 `.accountActions .fn-btn` と同じ問題が存在する可能性があり、**移行起因の表示差分とは未断定**。字句変換の一致テストでは実描画を保証できない。MIG-0706の390/1440視覚確認で比較し、修正する場合はCURRENTとの差分を明記して扱う。
- mainへの直接push、自動マージ、本番Cloudflare/Worker Route/Remote D1/R2/KV/Queue/Secrets変更は禁止。STATUSのDONE更新はPRの承認・統合段階に行う。

**再開の照合コマンド例**（出力を現在値として信用する。上表はスナップショット）:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git rev-parse HEAD
gh pr list --state open --json number,title,isDraft,headRefOid,url
npm run migration:next -- --model small
```

---

## 1. 直近で完了・mainにマージされたタスク（全件Green・マージ済み）

以下は **初版時点のマージ履歴**。この追補では各履歴PRのレビュー証跡を再検証していないため、全件独立 APPROVE 済みとは断定しない。現在の open PR の統合可否は次節で別途判断する。

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
固定 SHA `0a0f62a2` を最新と誤認しない。GitHub の現在の main と照合し、`git rev-parse HEAD` で実 HEAD を確認する。2026-10-27照合時の main は `fc5b9785`。

### Step 2: 依存関係・チェッカー確認
```bash
npm ci
npm run check:project-docs
```

### Step 3: 着手可能タスクの選定
まず GitHub の open PR と各オーナーブランチの work-item を確認し、main の `STATUS.md` に反映前の進行中タスクを重複claimしない。
```bash
npm run migration:next -- --model small
```
または `PHASE_6_SPEC.md` / `PHASE_4_5_SPEC.md` より候補を確認。

#### 初版時点の着手候補（最新の READY とは限らない）
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
