# FlameNode 小型エージェント実装ランブック（必読・共通）

> Status: Active / operational instructions, not a replacement for AGENT_PROTOCOL.md
> Updated: 2026-10-09
> Authority: `STATUS.md`（状態と依存）→ `OPEN_DECISIONS.md`（決定）→ `TASK_CARDS_*.md`（手順）→ `CURRENT code/tests`（実行時の事実）
> Audience: Claude Haiku / Luna / Flash / Codex / Antigravity / human reviewer

## 最初の90秒に行うこと

1. GitHubの最新`main` commitを読む。変更が作業ブランチ上にしか無い場合、そのbranchの`STATUS.md`を読んでowner PRを特定する。**作業中のPRがあるMIGを横取りしない**。
2. `AGENTS.md`, `AGENT_PROTOCOL.md`, `GIT_WORKFLOW.md`と`STATUS.md`を読む。60k tokenの全台帳を一度に取り込まない。
3. `STATUS.md`で依存がDONEの`READY`を1件だけ選ぶ。`OPEN_DECISIONS.md`にある未提供資料・PoC・人間承認と照合する。**DECIDED = 本番操作許可ではない**。
4. 該当カードだけ開く: [Phase2/3](TASK_CARDS_2_3.md), [Phase4/5](TASK_CARDS_4_5.md), [Phase6/7](TASK_CARDS_6_7.md), [Phase8/9](TASK_CARDS_8_9.md)。フェーズSPECとカードが食い違う場合は**両方の引用箇所と衝突を記録して停止**。都合がよい方を勝手に選ばない。
5. 該当`CURRENT_ROUTES.md` / `route-handlers/README.md` / `server-actions/README.md`の対象行とCURRENT code/testを**実際に開く**。名前だけから動作を推測しない。
6. 作業PRをclaimし、範囲内だけ編集する。1 wake = 1 task。Phase Gate/Remote D1/secret/production Route変更はユーザー承認がない限り実施しない。

## ファイル進捗が必要な理由

`STATUS.md` は親MIGのみの状態であり、同じMIG内の多数の既存ソースがどこまで移ったかを示せない。`FILE_MIGRATION_MATRIX.md` は1ファイル1行で `NOT_STARTED / IN_PROGRESS / BRIDGED / PARITY_VERIFIED / CUTOVER / RETIRED / RETAINED / BLOCKED` を記録。**対象ファイルすべての現物・変更先・importer・テストを確認し、他MIGの共有ソースに無断で触らない。** 差分チェックは`node scripts/check-migration-file-progress.mjs`。接続手順と失敗時は`FILE_PROGRESS_PROTOCOL.md`を読む。

## 一件を進める厳密な手順（省略不可）

```text
START
  -> FETCH latest main + open migration PRs
  -> CHECK ownership + task READY + parent tasks DONE
  -> CHECK decisions, required PoCs, mock state and approvals
  -> READ task card + target ledger + CURRENT files/tests
  -> WRITE mini-claim (exact files / UX / FN / acceptance / rollback)
  -> CREATE short-lived migration/MIG branch + Draft PR (check duplicate again)
  -> WRITE failing characterization tests BEFORE behavior relocation
  -> IMPLEMENT only named scope; keep legacy behavior and fallback
  -> RUN relevant tests + full PR CI
  -> REVIEW actual diff and contracts, note evidence with SHA
  -> REPORT:
       PASS -> REVIEW until independent reviewer and required CI are available
       FAIL -> fix within scope; otherwise BLOCKED with repro and next action
  -> INDEPENDENT review + correct approval -> DONE, update next READY -> squash merge
  -> NEXT wake starts from newly merged main, never stale branch
END
```

**重要：** Hostに反復機構が無い場合は1タスクで終了する。`/loop`と書いたMDはschedulerではない。レビュー/CI待ち中は同じMIGを再claimしない。

## 大型MIGを複数wakeに分割する方法

45画面などを1回で全部実装しようとしない。[TASK_MICRO_UNITS.md](TASK_MICRO_UNITS.md)を読み、**1 wake = 最大1 micro-unit、親MIGとopen PRは固定**。STATUSのPR branchへ各unitのDONE/BLOCKEDとテスト証拠・次unitを記録する。未完了なら`IN_PROGRESS`で同じowner PRに安全なcheckpointを残して次wakeへ引き継ぐ。すべてunit DONEになるまで`REVIEW`にしない。

## 作業カードの読み方

各`### MIG-XXXX`が最小実装単位。
- `読む`: 特定の**既存**コード・台帳・テストを先に検証。`+path`は新規作成予定で実在の保証はない。
- `変更`: 必ず既存コードのインターフェースを確認してから、移す/追加する/修正する。
- `試験`: 対象の異常系・permission・Queue・state・CPUを含む。本番操作はsimulation/previewから。
- `DONE証拠`: 何をコード/テスト/マトリクスで証明するかをPRへ記録する。
- `停止`: 必要な情報が無い・失敗したときは手を止めて根拠と再開条件を書き残す。

同一タスクが大きすぎて1 PRで完成できないと判明した場合、無理に`DONE`にしない。`STATUS.md`の分割提案（親子MIG-IDと依存、影響台帳）を別レビューに出す。勝手に他タスクを処理したことにしない。

## 最小検証コマンド

```bash
npm ci
node scripts/check-migration-file-progress.mjs
node --test scripts/check-migration-file-progress.test.mjs
node scripts/check-migration-docs.mjs
node --test scripts/check-migration-execution.test.mjs
node --test scripts/check-migration-task-cards.test.mjs
npm run check:project-docs
npm run typecheck
npm run test:unit
npm run verify:fast
```

- `npm run test:integration` はDB/トランザクション/権限/並走に関係する変更で実行。
- `npm run build --workspace=@flamenode/contracts`, `@flamenode/domain`, `@flamenode/ui`, `@flamenode/site`, `@flamenode/app`, `@flamenode/api` は依存に応じて実行。
- `@flamenode/db` および`@flamenode/ops`は**計画上のworkspace**。該当MIGで実際に作成するまで npm workspace buildを実行しない。
- 現行Nextの全体build/Cloudflareの実配置を確認する場合は`npm run cf:cloud-build`等**既存のスクリプトの非本番安全性と副作用を確認してから**使う。
- GitHub Actionsのgreenはローカル未実行E2Eや実Cloudflare PoCの合格ではない。
- 変更したコードのhappy pathだけでなく、no session / banned / revoked permission / timeout / D1 unavailable / stale R2 / duplicate request / idempotent retry / wrong URLをチェックする。

## 「実装完了」を偽装しない報告テンプレート

```text
MIG: MIG-XXXX | branch: migration/... | PR: URL | head SHA: ...
Status: REVIEW / BLOCKED / DONE
CURRENT evidence: path#symbol + relevant test file
Changes: path list and reason
UX: UX-... parity status + screenshots or scenarios
FN: FN-... parity status + requests/side effects
API/SA/Route: RH/SA id / method / status / DTO / cache / auth
Tests run: exact commands and pass/fail count + CI URL
Not run: exact command and reason
CPU/DB: benchmark numbers if relevant, otherwise "not measured"
Rollback: code/flag/data/route order + rehearsal evidence
Decision/Gate: D-XX and actual evidence; human approval if necessary
Next: one explicit action and its owner
```

## 高リスクケース早見表

| 症状 | まず確認 | してはいけない |
| --- | --- | --- |
| `module not found` | npm ci、exports、tsconfig、node strip-types、実build成果物 | TS pathだけを直してNode検証を飛ばす |
| Honoだけ403/401 | Auth.js session cookie、callback、CSRF、Auth UserとActive X、許可モード | UIで認可を代行する |
| いいね件数が異なる | D-03 fan-outでX件数増加、重複/解除/未連携、app_like_count再集計 | 古いAuth User件数に上書き |
| loop二重実行 | open PR、writer、branch STATUS、head SHA | 2つ目のPRを作って並走 |
| 公開privateが漏れる | visibility fence、entity→path map、キャッシュ、R2 snapshot version | Cache missでprivate JSONを直接出す |
| SSRで1102懸念 | request CPU p99, hard limit, R2事前HTML、Queue側事前生成 | SSG容量超過を理由に無条件SSR |
| SPA直アクセス404 | `/dashboard`等bare path、Cloudflare asset prefix、SPA fallback、Auth旧経路 | `/*` catch-allで全公開URLを奪う |
| Previewは通るのに本番Routing失敗 | D-02 ingress PoCとDNS/root+www、独立API/path route、旧Worker fallback | 自動で本番Route/Custom Domainを書き換える |

## 人間承認が必要な境界

本番DB書き込み・データ移行・適用済みmigrationの変更、本番Route/Custom Domain/DNS、Secrets、Discord認証cutover、権限/可視性を変えるproduct behavior、Phase Gate、採用済み仕様の再決定。これらは設計が`DECIDED`でも作業実行を自動許可しない。

HTMLモックはまだ受領していないため、D-08は **BLOCKED_ON_USER** を維持。D-08を根拠にPhase2/4/5のvisual taskを`READY`にしてはいけない。非visual調査・domain/DB抽出など独立したtaskのみ進める。

## 優先して読む詳細資料

- [設計判断](OPEN_DECISIONS.md) / [DB package移設](DB_PACKAGE_EXTRACTION_PLAN.md)
- [Active X fan-out / one-shot cutover](ACTIVE_X_MIGRATION_PLAN.md)
- [Cloudflare実態](cloudflare/TOPOLOGY.md) / [1102/CPU](cloudflare/PERFORMANCE_BASELINE.md) / [Static visibility](static-delivery/README.md)
- [API method inventory](route-handlers/README.md) / [Server Action 110単位](server-actions/README.md)
- [既存UX/FN全件](FEATURE_CATALOG.md) / [画面対応](screen-mapping/README.md)

本書はagent手順を限定する運用文書。正しい実装仕様・現状を推測で上書きしない。
