# CLAUDE.md

> Status: Active
> Last verified: 2026-10-13
> Verified against commit: `7a29eab8f79ad53e607693c682333eaf1b08c170`
> Source of truth: `AGENTS.md`

規範・不変条件・検査の正本は [`AGENTS.md`](AGENTS.md)。タスク別の次の1件は [`docs/AI_CONTEXT.md`](docs/AI_CONTEXT.md)。

## 開始

1. `AGENTS.md`
2. `docs/AI_CONTEXT.md` の該当タスク行
3. 対象コードと関連test
4. migration taskだけ `docs/migration/MIGRATION_START_HERE.md` → GitHubの全open PRを `gh` またはMCPで確認 → `AGENT_PROTOCOL.md` のWake decision → 自分の既存PRの再開を優先し、新規claim候補の場合にのみ `npm run migration:next` → `STATUS.md` 該当行

ドキュメントと既存のコードが食い違うときはコードの書き方に従い、見つけた食い違いを最後の返答ですべて挙げること。

`.claude/flamenode/requirements-map.md`、`archive/`、完了済みphaseは、過去仕様調査を明示されたときだけ読む。

## 役割の選び方

| 状況 | 使うもの |
| --- | --- |
| 調査のみ（コード変更禁止） | `.claude/agents/flamenode-repo-cartographer.md` または `/flamenode-plan` |
| 境界が明確な通常実装 | `.claude/agents/flamenode-implementation-agent.md` |
| DB・権限・security・公開API・破壊的変更のレビュー | `.claude/agents/flamenode-architecture-reviewer.md` または `/flamenode-review` |
| **Next/OpenNextからの段階移行** | **`/flamenode-migration`** |
| **移行を反復実行** | **`/loop /flamenode-migration`** |

軽量モデルの停止条件は `AGENTS.md` を正本とする。

## Migration loop

`/flamenode-migration` は1回につき1 actionだけ進めるClaude adapter（`.claude/skills/flamenode-migration/SKILL.md`）。引数なしの `/loop` は `.claude/loop.md` を使う。同名の `.claude/commands/` は作らない（skillが優先され、commandは無視される）。

共通実行契約の正本は [`docs/migration/AGENT_PROTOCOL.md`](docs/migration/AGENT_PROTOCOL.md) §`/loop`（Wake decision / Independent review evidence / Pacing）。adapterは仕様正本ではない。

`/loop`併用時も以下を守る。

- 1 wake = 1 action（自PRのmicro-unit 1つ / merge統合 1件 / 他agent PRの独立レビュー 1件 / 何もしない）
- live stateはowner PR branchの `docs/migration/work-items/MIG-XXXX.md`。`STATUS.md` はmerge直前の統合でだけ更新
- checkpointの無い `IN_PROGRESS` を残さない
- 独立レビューは原則として他agent（Codex / Antigravity）か人間。builderより上位のモデルをsubagentで呼べる場合（例: Sonnet/Haikuで動作中 → `model: "opus"` の `flamenode-architecture-reviewer`）はそのレビューで可、APPROVE + 最終HeadのCI greenなら統合して最終HEADの独立レビュー・必須CI・全受入条件を再確認し、証拠を記録してexpected HEAD指定でsquash mergeし次へ進む。Opusで動作中のPRは他agentか人間のレビューを待つ
- REVIEW待ちPRは貯めたまま、依存の無い別task・他agent PRのレビュー・Work Order精緻化を進める（IN_PROGRESSは1つまで）
- 本番操作/仕様変更の承認・未解消Gate・BLOCKEDだけが残り進められる作業が無いときだけ、pollingせずloopを止めて報告
- Phase Gateを自動承認しない
- 2026-11-27 owner policy: 通常PRは最終HEADの独立APPROVE・必須CI・受入条件・最新main統合・rollback確認後にsquash mergeし、人間の個別承認は待たない。高リスクは独立Lead追加レビュー、非本番Gateも独立Leadで判定。本番切替・手動deploy / Worker Route / Custom Domain / Remote D1 / secret操作・仕様変更は別途明示承認。既存Workers Builds自動実行は通常mergeに含む。テストは既存suiteへの最小追加を優先し、重複ファイルや証跡だけのtest-only PRを増やさない。必要な新規ファイルのみ理由をPRに記録する。詳細はAGENT_PROTOCOL.md
- BLOCKEDを無視して後続Phaseへ進まない
- redesign画面をfunction parity未確認のままDONEにしない

## 出力

通常実装:

- 実装前: 対象・非対象・変更予定・検査予定を短く
- 実装後: 変更・維持した挙動・検査・残課題だけ

migration:

- MIG task ID / state
- affected function IDs
- 変更
- 維持したcontract
- 検査
- rollback
- next task / blocker
