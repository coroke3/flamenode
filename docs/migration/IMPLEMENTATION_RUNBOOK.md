# FlameNode 小型エージェント実装ランブック（必読・共通）

> Status: Active / operational instructions, not a replacement for AGENT_PROTOCOL.md
> Updated: 2026-10-13
> Authority: `STATUS.md`（merge済み状態と依存） + `work-items/MIG-XXXX.md`（作業中PRのcheckpoint）→ `OPEN_DECISIONS.md`（決定）→ `TASK_CARDS_*.md`（手順）→ `CURRENT code/tests`（実行時の事実）
> Audience: Claude Haiku / Luna / Flash / Codex / Antigravity / human reviewer

Checkpoint policy: WORK_ITEM_ONLY

## 最初の90秒に行うこと

**実行環境:** `package.json`のNode要件（22系）を先に確認する。Windowsで標準Nodeが異なる場合は、導入済みfnmの例として `fnm exec --using 22 node --version`、`fnm exec --using 22 npm.cmd ci --no-audit --no-fund` を使い、以降のnpm/node検証も同じ22系で実行する。engine checkを無効化せず、ホスト全体の既定バージョンを変更する必要はない。

**コンテキスト予算:** まず[MIGRATION_START_HERE.md](MIGRATION_START_HERE.md)で対象MIG行・カード・関連ownerファイル行を絞る。**STATUS/AGENT_PROTOCOL/README/台帳全文の一括読込は禁止**。ルールの正本は維持したまま、対象節・根拠ソースを検索して読む。MIG-0401非visual性能PoCはMIG-0301と並行READY。HTMLモック受領（MIG-0200完了）に伴いD-08はDECIDEDとなりMIG-0201（デザイントークン）もREADY。後続のvisual画面実装は先行する基盤タスク完了に依存する。

1. GitHubの最新`main` commitを読む。変更が作業ブランチ上にしか無い場合、そのbranchの`work-items/MIG-XXXX.md`とopen PRを読んでownerを特定する。**作業中のPRがあるMIGを横取りしない**。
2. `AGENTS.md`と`AGENT_PROTOCOL.md`の関連ルール、`GIT_WORKFLOW.md`の現段階の操作手順、`STATUS.md`の該当行・依存行のみ読む。移行台帳や過去MIGを全件取り込まない。
3. `AGENT_PROTOCOL.md` §Wake decisionで今回の1 actionを選ぶ。自ownerのIN_PROGRESSは同じPRを再開し、REVIEW/BLOCKEDは記録済みgate/再開条件を確認する。新規claimの場合だけ`STATUS.md`で依存がDONEの`READY`を1件選ぶ。reviewer laneではbranchを編集しない。`OPEN_DECISIONS.md`にある未提供資料・PoC・人間承認と照合する。**DECIDED = 本番操作許可ではない**。
4. 該当カードだけ開く: [Phase2/3](TASK_CARDS_2_3.md), [Phase4/5](TASK_CARDS_4_5.md), [Phase6/7](TASK_CARDS_6_7.md), [Phase8/9](TASK_CARDS_8_9.md)。フェーズSPECとカードが食い違う場合は**両方の引用箇所と衝突を記録して停止**。都合がよい方を勝手に選ばない。
5. 該当`CURRENT_ROUTES.md` / `route-handlers/README.md` / `server-actions/README.md`の対象行とCURRENT code/testを**実際に開く**。名前だけから動作を推測しない。
6. writer actionは既存owner PRを再開するか、未所有のREADYを新規claimし、範囲内だけ編集する。**1 wake = 1 action**（最大1 micro-unit / merge統合 / 独立レビュー / 何もしない）。Phase Gate/Remote D1/secret/production Route変更はユーザー承認がない限り実施しない。

## ファイル進捗が必要な理由

`STATUS.md` は親MIGのみの状態であり、同じMIG内の多数の既存ソースがどこまで移ったかを示せない。`FILE_MIGRATION_MATRIX.md` は1ファイル1行で `NOT_STARTED / IN_PROGRESS / BRIDGED / PARITY_VERIFIED / CUTOVER / RETIRED / RETAINED / BLOCKED` を記録。**対象ファイルすべての現物・変更先・importer・テストを確認し、他MIGの共有ソースに無断で触らない。** 差分チェックは`node scripts/check-migration-file-progress.mjs`。接続手順と失敗時は`FILE_PROGRESS_PROTOCOL.md`を読む。

## 一件を進める厳密な手順（省略不可）

```text
START
  -> FETCH latest main + open migration PRs
  -> APPLY AGENT_PROTOCOL Wake decision: choose exactly ONE action below
       WRITER UNIT:
         -> RESUME own IN_PROGRESS branch/PR and recorded next unit
            OR CLAIM one unowned READY (parents DONE), create branch + Draft PR,
               write work-item claim, re-check duplicate PRs
         -> CHECK decisions, required PoCs, mock state and approvals
         -> READ one task card/unit + target ledger + CURRENT files/tests
         -> WRITE characterization tests before behavior relocation
         -> IMPLEMENT only named scope; keep CURRENT contracts
         -> RUN relevant tests + required CI; inspect diff and actual SHA evidence
         -> CHECKPOINT own work-item, leave STATUS unchanged:
              PASS + units remain -> IN_PROGRESS + next unit
              PASS + all units complete -> REVIEW, await independent review/CI
              FAIL -> fix within scope; otherwise BLOCKED + recovery condition
       MERGE INTEGRATION:
         -> CHECK independent review, required CI and applicable human approvals
         -> SYNC latest main; reconcile STATUS DONE/next READY and work-item DONE
         -> RE-RUN required validation/review on changed Head; squash merge only after gates pass
       INDEPENDENT REVIEW:
         -> REVIEW eligible other-family/human builder PR, leave evidence at its current Head
         -> DO NOT edit branch/work-item/STATUS or merge
       WAIT / NO ACTION:
         -> REPORT reason and recovery condition, no checkpoint-only push
  -> STOP; next external wake re-reads main and the live owner PR checkpoint
END
```

**重要：** Hostに反復機構が無い場合は1 actionで終了する。`/loop`と書いたMDはschedulerではない。レビュー/CI待ち中は同じMIGを再claimしない。writer unitの実装とmerge統合を同じwakeで続けて実行しない。

## 大型MIGを複数wakeに分割する方法

45画面などを1回で全部実装しようとしない。[TASK_MICRO_UNITS.md](TASK_MICRO_UNITS.md)を読み、**1 wake = 最大1 micro-unit、親MIGとopen PRは固定**。PR branchのwork-items/MIG-XXXX.mdへ各unitのDONE/BLOCKEDとテスト証拠・次unitを記録する。未完了なら`IN_PROGRESS`で同じowner PRに安全なcheckpointを残して次wakeへ引き継ぐ。すべてunit DONEになるまで`REVIEW`にしない。

## 作業カードの読み方

各`### MIG-XXXX`が最小実装単位。
- `読む`: 特定の**既存**コード・台帳・テストを先に検証。`+path`は新規作成予定で実在の保証はない。
- `変更`: 必ず既存コードのインターフェースを確認してから、移す/追加する/修正する。
- `試験`: 対象の異常系・permission・Queue・state・CPUを含む。本番操作はsimulation/previewから。
- `DONE証拠`: 何をコード/テスト/マトリクスで証明するかをPRへ記録する。
- `停止`: 必要な情報が無い・失敗したときは手を止めて根拠と再開条件を書き残す。

同一タスクが大きすぎて1 PRで完成できないと判明した場合、無理に`DONE`にしない。`STATUS.md`の分割提案（親子MIG-IDと依存、影響台帳）を別レビューに出す。勝手に他タスクを処理したことにしない。

## Work Order（仕様節）と小型モデルの実行条件

カード（`TASK_CARDS_*.md`）は要約、実装の正本は各Phase仕様書（[Phase 2](PHASE_2_SPEC.md) / [Phase 3](PHASE_3_SPEC.md) / [Phase 4/5](PHASE_4_5_SPEC.md) / [Phase 6](PHASE_6_SPEC.md) / [Phase 7](PHASE_7_SPEC.md) / [Phase 8/9](PHASE_8_9_SPEC.md)）の `### MIG-XXXX:` 節（Work Order）。`npm run migration:next` / `node scripts/print-migration-task-context.mjs MIG-XXXX` はカードとこの節を1つのパケットにまとめて出力する。

Work Orderの必須形式（見出しは一字一句この通り。checkerが解析する）:

```text
### MIG-XXXX: <title>
- **Model:** small | lead
- **Readiness:** READY_FOR_SMALL_MODEL | NEEDS_REFINEMENT — <理由と確定に必要なもの>
- **Depends on:** <MIG IDs> / **Decisions:** <D-xx DECIDED | none>
- **Verified against:** `<main short SHA>` (<date>)
#### Source snapshot      … `path:line` と事実。mainと違えばSTOP
#### Owned paths          … 新規 / 変更 / 触らない（理由）
#### Micro-units          … U01.. 各unitに手順・コード・検証コマンドと期待結果
#### Test cases           … | ID | 入力/操作 | 期待 |
#### Commands             … 全unit完了時のコマンドと期待結果
#### Ledger updates       … FILE_MIGRATION_MATRIX行（貼り付け可能な形式）・UX/FN ID
#### DONE checklist       … 2値で検証できる項目のみ
#### STOP                 … 小型モデルが止まってleadへ返す条件
#### Rollback
```

DONE/SKIPPED以外の全taskはこの形式のWork Orderを持ち、`Depends on` はSTATUSの依存を全部含み、STATUSに無い依存経路を足さない。READYのtaskは依存が全部DONEであること。`node scripts/check-migration-task-cards.mjs`（`validatePlanCompleteness`）がCIで検証する。

小型モデル（Haiku / Luna / Flash 等）は、Work Orderが **`Model: small` かつ `Readiness: READY_FOR_SMALL_MODEL`** のtaskだけをwriterとして実行する（`npm run migration:next -- --model small` はそれ以外を候補から外す）。それ以外のtask、他agent PRの独立レビュー、Phase Gate、高リスクPRのmerge、Work Orderの作成・更新はlead（上位モデルまたは人間）の担当。小型モデルは自分のPRについて、上位モデルsubagentによるレビュー（下記 **E**）とmerge統合（**F**）まで行ってよい。

小型モデルの実行規則:

- Micro-unitsを番号順に、1 wake = 1 unit。手順にない編集・リファクタ・命名変更をしない。
- `Owned paths` 以外のファイルを変更しない。必要になったらSTOP。
- `Source snapshot` と実ファイルが1点でも違えばSTOP（自分で仕様を読み替えない）。
- 検証コマンドの結果が `期待` と違う場合、同じunit内で修正を2回まで。解消しなければ`BLOCKED`としてコマンド・出力・差分をwork-itemへ記録してSTOP。
- テスト・checkerを弱めない、skipしない、実行していないものをPASSと書かない。
- `STOP` に該当したら、work-itemの`Next`に「lead判断待ち: <具体的な問い>」を書いて終了する。

## 1 wake のコマンド手順（小型モデルはこの順にそのまま実行）

`MIG-XXXX` / `mig-xxxx-<slug>` / `<n>` は実値に置き換える。slugはWork Orderのtitleを英小文字kebab-caseにしたもの。

**A. 状況確認（毎wake）**

```bash
git fetch origin
git switch main && git pull --ff-only origin main
npm run migration:next -- --model small
gh pr list --state open --json number,headRefName,title,isDraft
```

上から順に判定する（自分 = work-itemの`Owner`が自分のPR）。

1. 自分のPRに、現在のHeadへの `Independent review: ... | Verdict: APPROVE` commentがあり、CIがgreen → **F**
2. 自分のPRが`REVIEW`でレビューが無く、自分より上位のモデルをsubagentとして起動できる → **E**
3. 自分のPRが`IN_PROGRESS` → **C**（`git switch migration/mig-xxxx-<slug> && git pull --ff-only`）
4. 自分の`IN_PROGRESS` PRが無く、候補が出た → **B**（自分の`REVIEW`待ちPRがあっても進める）
5. どれも無い → 何もせず「進められる作業無し」とREVIEW待ちPR一覧を報告して終了

**B. claim（新規taskのみ）**

```bash
git switch -c migration/mig-xxxx-<slug> origin/main
git commit --allow-empty -m "MIG-XXXX: 作業開始"
git push -u origin migration/mig-xxxx-<slug>
gh pr create --draft --base main --title "MIG-XXXX: <日本語の短い説明>" --body "GIT_WORKFLOW.md §5 の必須項目を記入"
gh pr list --state open --json number,headRefName --jq '.[] | select(.headRefName | startswith("migration/mig-xxxx-")) | .number'
```

最後のコマンドが2件以上を返したら、作ったPRをcloseしてSTOP（後発が引く）。1件なら `docs/migration/work-items/MIG-XXXX.md` を [work-items/README.md](work-items/README.md) の形式で作成（`State: IN_PROGRESS`、`Owner`、`Branch`、`PR: #<n>`、`Owned paths` はWork Orderの値、`Current unit: U01`）し、commit/pushする。

**C. micro-unit 1つ**

```bash
# Work Orderの U0n 手順を実行し、U0n の検証コマンドを実行する
npm run check:migration-work-items
npm run check:project-docs
git add <Owned pathsのファイルだけ>
git commit -m "MIG-XXXX U0n: <やったこと>"
git rev-parse HEAD          # この値を work-item の Head に書く
# work-item を更新: Current unit / Validation（実行コマンドと実結果）/ Head / Next（次unit）
git add docs/migration/work-items/MIG-XXXX.md
git commit -m "MIG-XXXX: U0n checkpoint"
git push
```

**D. 全unit完了時**

Work Orderの `Commands` と `DONE checklist` を全部実行・確認し、work-itemを `State: REVIEW` にしてpush。`gh pr ready <n>` の後、PRへ「Independent review requested: Head <40hex>」とcommentして終了する。次のwakeからは **A** の判定に従い、レビュー待ちの間も別taskへ進む。

**E. 上位モデルによる独立レビュー（自分のPR、1件）**

```bash
gh pr view <n> --json headRefOid --jq .headRefOid     # Head
gh pr diff <n> > /tmp/mig-xxxx.diff
node scripts/print-migration-task-context.mjs MIG-XXXX > /tmp/mig-xxxx-packet.md
```

自分より上位のモデル（例: Haiku/Sonnet/Luna/Flashで動作中なら Opus）を新しいcontextのsubagentとして起動し、Head・diff・packetを渡して「Work OrderのTest cases・DONE checklist・STOPとCURRENT契約（UX/FN/permission/visibility/side effect/rollback）に照らしてレビューし、APPROVEかCHANGES_REQUESTEDと理由を返せ。branchは編集するな」と依頼する。結果をそのままPRへ記録する。

```bash
gh pr comment <n> --body "Independent review: <agent>/<model> (fresh-context subagent of <自分のmodel>) | Head: <40hex> | Verdict: <APPROVE|CHANGES_REQUESTED>
<確認した項目と指摘>"
```

CHANGES_REQUESTEDならwork-itemを`IN_PROGRESS`に戻し、`Next`に指摘を書いて終了（次wakeで **C**）。APPROVEでCIがgreenなら同じwakeで **F** へ進んでよい。同等以下のモデルしか起動できない場合は **E** を行わず、他agentか人間のレビューを待つ。

**F. merge統合（Model: small のPRのみ。leadのPR・高リスク・Phase Gateはleadとユーザー承認）**

```bash
gh pr checks <n>                                   # 全てpassでなければ終了して次wake
git switch migration/mig-xxxx-<slug> && git pull --ff-only
git fetch origin && git rebase origin/main         # 競合したら git rebase --abort してSTOP（leadへ）
```

1. `docs/migration/STATUS.md`: 当該MIG行のStateを`DONE`にする。Depends onの全MIGが`DONE`になった行だけ`BLOCKED`→`READY`にする。他の行は変えない。
2. `docs/migration/work-items/MIG-XXXX.md`: `State: DONE`、`Evidence`にレビューcommentのURLとCI runのURL。
3. 検証して統合commitをpushする。

```bash
npm run check:migration-work-items && npm run check:project-docs
git add docs/migration/STATUS.md docs/migration/work-items/MIG-XXXX.md
git commit -m "MIG-XXXX: STATUS統合"
git push --force-with-lease
gh pr ready <n>
gh pr checks <n> --watch                           # 最終HeadのCIがpassしてから
gh pr merge <n> --squash
```

統合commit（`STATUS.md`と自分のwork-itemだけの変更、競合の無いrebase）は再レビュー不要だが、CIは最終Headでpassが必要。hostの権限設定が`gh pr merge`を拒否したら、PRに「merge待ち（統合済み）」とcommentしてユーザーへ委ね、他の作業へ進む。

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
Status: IN_PROGRESS / REVIEW / BLOCKED / DONE
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
| loop二重実行 | open PR、writer、branch work-item checkpoint、head SHA | 2つ目のPRを作って並走 |
| 公開privateが漏れる | visibility fence、entity→path map、キャッシュ、R2 snapshot version | Cache missでprivate JSONを直接出す |
| SSRで1102懸念 | request CPU p99, hard limit, R2事前HTML、Queue側事前生成 | SSG容量超過を理由に無条件SSR |
| SPA直アクセス404 | `/dashboard`等bare path、Cloudflare asset prefix、SPA fallback、Auth旧経路 | `/*` catch-allで全公開URLを奪う |
| Previewは通るのに本番Routing失敗 | D-02 ingress PoCとDNS/root+www、独立API/path route、旧Worker fallback | 自動で本番Route/Custom Domainを書き換える |

## 人間承認が必要な境界

本番DB書き込み・データ移行・適用済みmigrationの変更、本番Route/Custom Domain/DNS、Secrets、Discord認証cutover、権限/可視性を変えるproduct behavior、Phase Gate、採用済み仕様の再決定。これらは設計が`DECIDED`でも作業実行を自動許可しない。

HTMLモックは受領・登録済み（MIG-0200完了、D-08は **DECIDED**）。Phase 2の基盤タスク（MIG-0201: visual/IA抽出・デザイントークン）はREADY。ただし、各画面の個別visual移行は先行基盤（MIG-0201等）の完了と、UI_REFERENCE.mdの受入基準（機能パリティ・状態・権限検証）を満たす必要がある。

## 優先して読む詳細資料

- [設計判断](OPEN_DECISIONS.md) / [DB package移設](DB_PACKAGE_EXTRACTION_PLAN.md)
- [Active X fan-out / one-shot cutover](ACTIVE_X_MIGRATION_PLAN.md)
- [Cloudflare実態](cloudflare/TOPOLOGY.md) / [1102/CPU](cloudflare/PERFORMANCE_BASELINE.md) / [Static visibility](static-delivery/README.md)
- [API method inventory](route-handlers/README.md) / [Server Action 110単位](server-actions/README.md)
- [既存UX/FN全件](FEATURE_CATALOG.md) / [画面対応](screen-mapping/README.md)

本書はagent手順を限定する運用文書。正しい実装仕様・現状を推測で上書きしない。
