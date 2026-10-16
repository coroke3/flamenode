# Claude移行手順レビュー / Mac引き継ぎ

> Status: Historical / original handoff retained, actionable corrections integrated; 実装仕様・進捗の正本ではない
> Updated: 2026-10-16
> Branch: `codex/claude-migration-work-orders`
> Base: `aacf4fd835fb3bca9101f2a4214cc75bc8354693`

ユーザーの中断・Mac引き継ぎ依頼に合わせ、途中修正をDraft PRへ保存する。mergeやMIG実装開始の許可をこの文書から推定しない。再開時は最新main・live PR・[AGENT_PROTOCOL.md](AGENT_PROTOCOL.md)を再確認する。


## 2026-10-16 レビュー修正の統合結果

このファイルは当時の中断・引継ぎ記録であり、以下の項目は下記のPRにより解決された。以降の旧記述「未解決」「未完了」「merge禁止」は**記録当時の状態**を表し、現在の指示には使わない。

| 指摘 | 統合先と対応 |
| --- | --- |
| P1: worktree上の `git switch main` | PR #298: `IMPLEMENTATION_RUNBOOK.md` は `git fetch origin` と `origin/main` の参照へ変更。dirty checkoutを変更せず所有PRを先に確認する |
| P1: rebase/STATUS統合後の最終Headレビュー免除 | PR #298: 免除削除、最終Headの独立レビューとCIを必須にした |
| P2: CURRENT `apps/api/**/route.ts` | PR #300: `PHASE_6_SPEC.md` の実在 `app/api/**/route.ts` を明記 |
| P2: card/spec正本矛盾 | PR #298: Work Orderを実行手順、cardを索引、CURRENTコードを事実正本と明確化 |
| P2: 空placeholderのPR本文 | PR #298: `--body-file` と実値・空欄検査を追加 |
| 共有ledger/PR所有の見落とし | PR #298: open PRの所有パス・domain・共有台帳を照合する前提を追加 |
| 既存checker/selectorの不備 | PR #300: fence・重複・空節・small-model候補の実検査・不正引数拒否を統合しCI成功後にmerge |
| mock PR #297 | 2026-10-15に別PRとしてmainへmerge済み（このPRでmockは触らない） |

作業に用いる最新契約は `AGENT_PROTOCOL.md`, `GIT_WORKFLOW.md`, `IMPLEMENTATION_RUNBOOK.md` と Work Order。ここに記載した過去のSHAやブランチ状態をlive ownershipの代替にしない。

---

## 元の中断時メモ（監査用保存）

## 保存した変更

- `scripts/check-migration-task-cards.mjs`: fence内のサンプルをModel/Readiness/必須節として数えない。重複metadata・重複MIG/節・空の必須節を拒否。ENOENT以外の読込エラーを隠さない。
- `scripts/print-migration-task-context.mjs`: 小型モデル候補はラベルだけでなくWork Order全体の構造検査を通す。明示MIG IDでも`--model small`を適用。未知/重複/missingのCLI引数を拒否。
- 対応する2つのtestファイルへ回帰試験を追加。
- CURRENT runtime、DB、Cloudflare、STATUS、他ownerのwork-itemは変更していない。構造検査は手順内容の正しさ・live owner・レビュー・CI・本番承認の代替ではない。

## 実行済みと未完了

Node 22.23.2で2 testファイルの **24/24 PASS**、全migration回帰 **81/81 PASS**、`node scripts/check-migration-docs.mjs` / `npm run check:project-docs` / `git diff --check` のPASSを確認済み。最終修正Headの独立レビューはまだ実施していない。typecheck/full unit/verify:full/build/本番測定はこの途中変更について未実行。

修正前には次の両方がexit 0だったことを再現済み。現在は拒否する。

```sh
node scripts/print-migration-task-context.mjs MIG-0301 --model small --offline
node scripts/print-migration-task-context.mjs --next --model smal --offline
```

1つ目はmainのMIG-0301が `Model: lead / NEEDS_REFINEMENT` なのに出力できた例。将来Work Orderを正式に精査したら、この例の意味は変わるため固定的な拒否条件にはしない。

## 未解消のClaudeレビュー指摘

対象: [PR #295](https://github.com/coroke3/flamenode/pull/295) / [PR #296](https://github.com/coroke3/flamenode/pull/296)、比較 `d28160b6..aacf4fd8`。別Codex reviewer `/root/claude_change_review` の判定はCHANGES_REQUESTED。以下はこのWIPではまだ直していない。

1. **P1 / runbook開始手順**: `IMPLEMENTATION_RUNBOOK.md` Aの `git switch main` はmainを別worktreeで使用中だと失敗する。owner PRの再開判定より先にselectorを実行する順序も見直す。dirty checkoutは保持し、最新`origin/main`を参照して判定する。
2. **P1 / 最終Headのレビュー**: 競合のないrebaseとSTATUS/work-item統合commitを再レビュー免除にする規則は、レビュー対象と最終Headをずらす。独立レビューとCIの対象を最終Headで一致させ、関連Git文書/adapterとも揃える。
3. **P2 / CURRENTとTARGETの参照**: `PHASE_6_SPEC.md`の新規CURRENT artifact表が `apps/api/**/route.ts` を参照するが、現物は `app/api/**/route.ts`。RH/SA IDと実在sourceを照合して直す。単純置換で未確認のファイル名まで確定しない。
4. **P2 / 実装正本**: 各Phase spec冒頭はTASK_CARDSを正本とし、runbook/TASK_CARDSはPhase specのWork Orderを正本としている。CURRENT事実・実行手順・要約索引の役割を統一する。
5. **P2 / claimのPR本文**: runbook Bのplaceholder本文をそのまま投稿しない。scope/CURRENT-TARGET/ownership/検証/rollbackを具体化したUTF8本文を先に作り、`--body-file`で渡す。Draft初期差分とwork-itemのPR番号取得順も確認する。
6. 全open PRのOwned pathsだけでなくdomain・共有ledger行を照合する手順を具体化し、REVIEW待ちPRのlockと依存main DONEを維持する。未完了unitをREVIEWへ移してwriter枠を空けない。

## Work Orderの続き

- mainのMIG-0201/0301はlead / NEEDS_REFINEMENT、0401も小型writerの候補ではない。小型候補0件を誤って移行準備完了と報告しない。
- MIG-0301のimport方式について、一時領域でNode 22のpackage entry/subpath、旧TS bridge、tsc生成ESMが同じ関数を解決するPoCはPASS。実repoの移行・Next buildをPASSとしたものではない。
- Claudeが別worktreeで `wip/mig-0301-resolution-experiment` / `65b89a60` を作成済み。`HANDOFF.md`付きの**merge禁止の試作**なので、ownerとlive PRを確認し、コードを勝手に本実装へ取り込まない。
- 依存実装が未確定の後続Phaseはrolling waveで精査する。未検証のWork OrderをREADY_FOR_SMALL_MODELにしない。
- 前回の重複草稿はWindowsのstashへ退避済み。このbranchは最新mainへ追随した修正だけを含み、stash適用は再開の前提ではない。

## 最新Claude PRのレビュー

[PR #297](https://github.com/coroke3/flamenode/pull/297)（mock `1792048584-12ca`、Head `a82f990ae81bc3b3e3ea1cfb6f3c42eed9041f80`）のレビューは **CHANGES_REQUESTED / P2 1件**。[レビューコメント](https://github.com/coroke3/flamenode/pull/297#issuecomment-6197788011)へ記録済み。390px幅で確認overlay内の「削除する」ボタンが画面右外（left440px/right700px、iframe client幅375px）になることを実ブラウザで再現した。90 routes/96mock/329リンクの整合性とUI-reference関連7テストはPASS。全viewport/テーマの総当たり検証は未実施。Claudeの修正後Headで再レビューする。

このWIPへmockやClaudeの並行作業を混ぜない。PR #283のowner作業も横取りしない。

## Macで再開

clean checkoutで次を実行する。既存の同名branchがある場合は `git switch codex/claude-migration-work-orders` と `git pull --ff-only` を使う。

```sh
git fetch origin
git switch --track origin/codex/claude-migration-work-orders
git status --short
git log -1 --oneline
```

Node 22で `npm ci --no-audit --no-fund`、`npm run check:project-docs`、`node --test scripts/check-migration-*.test.mjs scripts/print-migration-task-context.test.mjs`。不足するcheckpoint source履歴はwork-items/README.mdの明示手順で取得する。

続きは上記P1指摘から。同じDraft PRで修正し、最終Headの独立レビューとCIを満たすまでmergeしない。復旧はこのWIP branch/PRを閉じるか、該当commitをrevertする。本番変更は無い。
