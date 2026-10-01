---
name: flamenode-optimize
description: FlameNodeを反復的に分析・修正し、バグ、D1/R2/Workers負荷、複雑性、オーバーエンジニアリングを既存機能を維持したまま継続的に削減する。
model: inherit
effort: high
disallowed-tools: AskUserQuestion
---

# FlameNode Continuous Optimization

対象は `coroke3/flamenode`。

このSkillは単発レビューではない。

`/loop` から繰り返し呼び出されることを前提として、

**分析 → 最も価値の高い改善 → 検証 → 再分析**

を繰り返し、FlameNodeを段階的に収束させる。

目的は新機能追加ではない。

既存の機能、仕様、UI、公開API、権限、データ整合性、安全性を原則維持しながら、

- バグを減らす
- D1負荷を減らす
- R2負荷を減らす
- Workers負荷を減らす
- Queue / Cronを軽量化する
- 不要なI/Oを減らす
- SQLを改善する
- race conditionを減らす
- fallbackを単純化する
- 重複処理を減らす
- オーバーエンジニアリングを解消する
- コードを明瞭にする
- 状態数と分岐数を減らす
- 不要な抽象化を削除する

ことを継続的に行う。

最終目標は、

**「高度な仕組みを持つシステム」ではなく、「必要な複雑さしか存在しないシステム」**

である。

---

# 0. 絶対条件

最初に `AGENTS.md` を確認し、その規則を守る。

以下は変更してはいけない。

- D1をcanonical sourceとする
- R2/KVは配信/cacheとして扱う
- ownerを0人にしない
- authorizationを弱めない
- public visibility境界を弱めない
- audit保証を弱めない
- atomicityを弱めない
- retry safetyを弱めない
- idempotencyを弱めない
- migration safetyを弱めない
- production fail-closedを弱めない
- Remote D1保護を弱めない
- public API contractを勝手に変えない

安全性を落として単純化してはいけない。

同じ保証をもっと単純に実装できる場合のみ変更する。

---

# 1. Loopとして振る舞う

これは毎回ゼロから始めるレビューではない。

各iterationの冒頭で必ず、

1. 現在のgit diff
2. 前iterationまでの変更
3. 前回実行したtest
4. 前回残った問題
5. 新しく発生したregression
6. まだ触れていない高優先領域

を確認する。

同じ問題を毎回再調査しない。

既に十分改善された箇所より、

**まだ改善余地の大きい箇所**

へ進む。

毎iterationでリポジトリ全体を無差別に読み直してはいけない。

---

# 2. 1 iterationの基本フロー

毎回以下を実行する。

## STEP 1: 現状確認

`git status` と `git diff` を確認する。

現在進行中の修正を理解してから次へ進む。

以前のiterationの変更を勝手に取り消さない。

---

## STEP 2: 次に改善すべき箇所を探索

以下の優先度で探す。

### P0

- データ破壊
- 権限漏れ
- privateデータ漏洩
- authentication / authorization bypass
- 深刻な整合性問題

### P1

- 本番障害
- race condition
- partial failure
- D1 limit
- Worker limit
- R2異常負荷
- Queue二重処理
- Cron競合
- stale visibility
- retryによる破損

### P2

- N+1
- 大量rows_read
- 不要rows_written
- full scan
- correlated subquery
- JSON1高コスト走査
- 重複query
- 重複R2アクセス
- unnecessary PUT / DELETE / HEAD / LIST
- 不要なQueue message
- 不要な再生成
- cache miss amplification

### P3

- オーバーエンジニアリング
- 重複コード
- wrapperの多重化
- 不要なabstraction
- fallbackの多重化
- 過剰なdefensive code
- 状態遷移の複雑化
- 責務の分散
- 読みにくい制御フロー

### P4

- 命名
- 小さなcleanup
- 局所的整理

P4を大量処理して成果扱いしてはいけない。

P0〜P2を優先する。

---

# 3. 毎iterationで範囲を絞る

一度にプロジェクト全体を書き換えない。

毎iterationでは、

**現在最も改善効果が高い1つの問題群**

を中心にする。

関連性が非常に高い場合のみ複数箇所をまとめて変更する。

巨大なarchitecture rewriteは禁止。

変更量ではなく、

**問題1件あたりの改善効果**

を優先する。

---

# 4. Bug hunting

TODO / FIXME検索だけで判断してはいけない。

実際の制御フローを追跡し、

- concurrent request
- retry
- partial failure
- duplicate execution
- stale state
- timeout
- queue redelivery
- Cron/Web競合
- D1成功→R2失敗
- R2成功→D1失敗
- Queue投入失敗
- notification重複
- cleanup競合
- visibility変更
- event状態変更
- slot状態変更
- submission状態変更
- YouTube同期
- audit
- restore
- pagination
- cursor
- timestamp
- null boundary

を調べる。

「通常成功する」だけでは正しいと判断しない。

---

# 5. D1最適化

毎iterationで関連するD1 pathを確認する。

重点:

- query回数
- rows_read
- rows_written
- N+1
- SELECT *
- duplicate SELECT
- full scan
- correlated subquery
- JSON1
- JOIN
- index
- unnecessary UPDATE
- unchanged UPDATE
- cleanup
- OFFSET
- unbounded query
- COUNT
- batch化
- conditional SQL
- CAS

単純にindexを追加するだけの解決は禁止。

index追加時は、

- write cost
- storage
- maintenance
- migration

まで考える。

可能なら変更前後について、

- query count
- rows_read
- rows_written
- DB round trip

を比較する。

実測できない場合は、

`静的解析上`

と明示する。

---

# 6. R2最適化

関連するR2 pathについて、

- GET
- PUT
- DELETE
- HEAD
- LIST
- artifact生成
- invalidation
- old key cleanup
- degraded fallback

を確認する。

特に、

- 同じobjectを複数回読む
- 同じ内容をPUTする
- 内容未変更PUT
- 不要HEAD
- 不要LIST
- D1/R2往復
- artifact過分割
- artifact巨大化
- invalidation複雑化
- fallback多重化

を探す。

R2をcanonical sourceにはしない。

---

# 7. Worker / Queue / Cron

現在存在する構成を正しい前提として扱わない。

それぞれについて、

- 本当にasyncが必要か
- Queueが必要か
- wake queueが必要か
- DLQが必要か
- Cronが必要か
- recovery処理が必要か
- retry保証が必要か
- 同一状態を複数箇所で管理していないか

を調べる。

ただし、この段階で機能を削除してはいけない。

同じ機能をより単純な内部構造にできるなら先にそれを行う。

---

# 8. Overengineering hunting

積極的に以下を探す。

- wrapperを呼ぶwrapper
- 1箇所利用の過剰抽象化
- 型を移し替えるだけのlayer
- validation重複
- authorization重複
- visibility判定重複
- fallbackのfallback
- defensive code重複
- unreachable branch
- stale compatibility code
- 固定化されたfeature flag
- abstraction維持のためだけのcode
- testのためにproductionを複雑化している構造
- general-purposeすぎるhelper
- 巨大framework的内部機構

短いコードを目的にしない。

不変条件を直接表現できるコードを優先する。

---

# 9. Claude Code組み込みSkillを利用する

必要に応じてClaude Codeの組み込みSkill / commandを活用する。

ただし、Skillを使うこと自体を目的にしない。

## `/code-review`

ある程度まとまった変更後、

**correctness bug、regression、境界条件の見落とし**

を探すために利用する。

可能なら高いeffortでレビューする。

見つかった問題を鵜呑みにせず、コード上の根拠を確認して修正する。

---

## `/simplify`

変更後のコードに対して、

- reuse
- simplification
- efficiency
- abstraction level

を再評価するときに利用する。

特に、

「今回の修正そのものが新しいオーバーエンジニアリングを生んでいないか」

を確認する。

指摘は必ずFlameNodeの不変条件と照合する。

---

## `/security-review`

以下を変更したiterationでは優先的に利用する。

- auth
- permission
- admin
- public API
- visibility
- upload
- import
- event ownership
- audit
- restore

security reviewのために仕様を弱めてはいけない。

---

## `/debug`

runtime issueや再現可能な異常が存在する場合に使う。

静的解析で十分な問題には乱用しない。

---

## `/batch`

大規模な独立変更が明確に存在する場合のみ使用を検討する。

通常iterationでは使用しない。

今回の目的は巨大並列rewriteではない。

---

## `/verify`

有用だが、自動loopから起動できない場合がある。

そのためloop中は、

- relevant tests
- typecheck
- lint
- Worker tests
- integration tests
- FlameNode固有check

を直接実行して検証する。

`/verify` が必要な段階になった場合は最終報告で明示する。

---

# 10. Subagentの利用

独立した分析は必要に応じてsubagentへ委譲してよい。

特に、

- D1 query audit
- R2 path audit
- concurrency audit
- security audit
- simplification review

は並列分析と相性が良い。

ただし複数agentに同じファイルを同時編集させない。

分析の並列化と実装の並列化を混同しない。

Leadが必ず最終判断する。

---

# 11. 修正後の検証

変更対象に応じて必要な検査を実行する。

候補:

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit`
- `npm run test:workers`
- `npm run test:integration`
- `npm run test:critical`
- `npm run verify:fast`
- `npm run check:db-schema`
- `npm run check:db-migration`
- `npm run check:public-api-contract`
- `npm run check:public-visibility-fences`
- 関連する個別test

毎iterationで無条件にfull suiteを回す必要はない。

局所変更では関連testを優先する。

広範囲変更または節目ではfull verificationを行う。

testが失敗した状態で次の最適化へ進まない。

---

# 12. Regression prevention

修正により新しい問題を作らないことを重視する。

変更後は、

1. 本当に元の問題が消えたか
2. 別pathへ問題を移しただけではないか
3. cache追加で隠しただけではないか
4. abstraction追加で隠しただけではないか
5. 新しいfallbackを増やしていないか
6. D1を減らしてR2を悪化させていないか
7. R2を減らしてWorker CPUを悪化させていないか
8. requestを軽くしてbackground jobを爆発させていないか

を確認する。

局所最適化ではなく全体コストを見る。

---

# 13. Loop progress

各iterationの最後に必ず簡潔な `LOOP STATE` を残す。

形式:

## LOOP STATE

### 今回直したもの
- ...

### 確認した根拠
- ...

### 実行したtest
- ...

### 改善前 → 改善後
- ...

### 残っている高優先問題
- ...

### 次iterationの第一候補
- ...

### Regression
- none
または
- ...

次iterationではこれを起点にする。

---

# 14. 収束判定

以下を満たすまでは機能削減へ進まない。

- P0/P1の既知バグがない
- obvious N+1がない
- unbounded queryがない
- 不要なfull scanを放置していない
- D1の明白な不要read/writeを削減済み
- R2の明白な不要read/writeを削減済み
- duplicate I/Oを整理済み
- fallbackの多重化を整理済み
- 重複実装を整理済み
- 不要なabstractionを整理済み
- hot pathが追いやすい
- background processingが追いやすい
- testsが通る
- 追加改善が仕様変更なしでは小さくなっている

---

# 15. 改善余地が尽きた場合

無理に変更を作らない。

以下の場合は

`CODE OPTIMIZATION SATURATED`

と判断してよい。

- 新しい変更のriskがbenefitを上回る
- 数字上の改善がほぼない
- 単純化すると安全性を落とす
- 同じ領域を繰り返し確認して新しい問題が出ない
- 残りが仕様そのもの由来

この状態になったらコード変更を止める。

---

# 16. その後のみ機能レベルのボトルネックを提案

ここまで到達して初めて、

**機能そのものが大きな負荷・複雑性を生んでいるもの**

を提案する。

実装はしない。

候補ごとに、

- 機能名
- 提供価値
- なぜボトルネックか
- D1負荷
- R2負荷
- Worker負荷
- Queue/Cron負荷
- コード複雑性
- 簡略化した場合
- 廃止した場合
- ユーザー影響
- 運営影響
- 代替案

を示す。

「使っていなさそう」だけを理由にしない。

---

# 禁止

- 新機能追加
- unnecessary framework追加
- unnecessary infrastructure追加
- 巨大rewrite
- cache layer追加による隠蔽
- 大量index追加による隠蔽
- R2 canonical化
- 既適用migration変更
- runtime DDL復活
- legacy fallback復活
- security低下
- permission低下
- audit低下
- production deploy
- Remote D1変更
- production secret操作
- git push
- merge

明示指示なしでは行わない。

---

# 最終思想

毎iterationで自問する。

> この仕組みは本当に必要か？

> 同じ保証をもっと少ないquery、I/O、state、branch、layerで実現できないか？

> 今回の改善は問題を解消したのか、それとも別の場所へ移しただけか？

> 新しく書いたコードは、削除したコードより理解しやすいか？

目的はコード量を減らすことではない。

**FlameNodeに存在する本質的でない複雑さを、改善余地がなくなるまで削ること。**