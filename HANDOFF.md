# Claude handoff — 2026-10-13（Windows → Mac）

> このブランチは **merge しない**。MIG-0301 の import 解決を試した未検証の試作コードと、移行仕様づくりの引き継ぎメモだけを置く。

## main に入ったもの（引き継ぎ時点 main = `aacf4fd8`）

- #293: `/loop /flamenode-migration` の実行準備（Claude adapter一本化、Wake decision、`migration:next` のopen PR除外、STATUS整理、旧資料削除）
- #295（別エージェントがmerge）: Work Order形式（各`PHASE_*_SPEC.md`の`### MIG-XXXX:`節）、`validateWorkOrders`、`npm run migration:next -- --model small`、PHASE_2_SPEC.md の仮置き、PHASE_6_SPEC.md の分類
- #296: レビュー運用（独立レビューは原則他agent/人間。builderより上位モデルのfresh-context subagentも可→APPROVE+CI greenでmerge。REVIEW待ちPRは貯めて依存の無い別taskへ進む。agentあたりIN_PROGRESSは1つ。runbookに手順E/F）

## ユーザー決定

- 移行文書・仕様づくりは **Claudeが全部担当**（Codexの `codex/claude-migration-work-orders` は停止を依頼済み、Antigravityも触らない前提）。
- 目的: Haiku / Luna でも実装できるよう移行手順・仕様を詰める。

## 残作業（優先順）

1. **PHASE_3_SPEC.md**: MIG-0301 / MIG-0302 を `Model: small` + `READY_FOR_SMALL_MODEL` にする。このブランチの試作（`packages/domain` の exports を `src/*.ts` へ、`rewriteRelativeImportExtensions`、旧 `src/lib/slots/slotReservationLimit.ts` を再exportのbridgeに、`slotReservationLimit.bridge.test.mjs`、`permissions.ts` 削除）を材料に、次を **実行して確認してから** 書く: `node --test --experimental-strip-types`（Node 22）、`npm run typecheck`、Next build（"use client" の `src/components/event/SlotGrid.tsx` がbridge経由で解決できるか）、`canEditVideo` の呼び出し元0件、既存 `slotReservationLimit.contract.test.mjs`（ソース文字列の正規表現検査）への影響。MIG-0308 / 0303 は lead、0304–0306 は NEEDS_REFINEMENT + Refinement inputs、0307 は Gate(lead)。
2. **PHASE_2_SPEC.md**: MIG-0201 を READY_FOR_SMALL_MODEL に。`docs/migration/mock/source/design-system/tokens.json`・`source/fn.css`・`mock/README.md`（決まりごとがtokens.jsonより優先）から全tokenとbreakpointを事前抽出して表にし、`packages/ui` のCSS export方法（buildはtscのみ）と `IA_MAPPING.md` の全行を確定。0202–0205 は部品の列挙と、判断が要る点を options+推奨で。0206 は Gate(lead)。
3. **PHASE_4_5_SPEC.md**: 0401 は PR #283（owner chatgpt-loop、REVIEW、CI green、レビュー0件）。0404–0406 は #283 のinterfaceに対する完全なWork Order（#283 merge待ちだけをNEEDS_REFINEMENTの理由に）。0402/0403/Phase 5 は Refinement inputs。0407 は Gate(lead)。
4. **PHASE_7_SPEC.md / PHASE_8_9_SPEC.md**: Model/Readiness ヘッダ + Refinement inputs。Haiku版は存在しないファイル（例 `src/lib/actions/submission.ts`）や存在しないSA ID（SA-120..145。実際はSA-110まで）を書いたため破棄した。Model: lead = 0702–0706, 0801–0806, 0902–0904, 0906 / small = 0701, 0901, 0905。
5. **PR #283（MIG-0401）**: builderがchatgpt-loopなので、Claude Opusが独立レビュー可能。

## 検証コマンド

```bash
npm run check:project-docs
node scripts/check-migration-task-cards.mjs
node --test scripts/check-migration-*.test.mjs scripts/print-migration-task-context.test.mjs
npm run migration:next -- --model small   # 引き継ぎ時点では該当なし
```

## 教訓

- 他エージェントが作業中のworktreeをcommit/merge/削除することがある。専用worktree + 早めのpush。
- 仕様書を書かせるsubagentは `general-purpose` + `isolation: worktree` + git操作禁止。`flamenode-implementation-agent` は実装を始めてしまった。Haikuは実在確認を怠りやすいので、出力のパス/IDは必ず機械照合する。
- Claude Code auto mode は自分のPRの `gh pr merge` を止める。ユーザーの明示OKが必要（`Bash(gh pr merge *)` の許可ルール追加は未実施）。
