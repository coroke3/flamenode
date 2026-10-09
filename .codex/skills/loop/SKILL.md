---
name: loop
description: Safely run one resumable FlameNode MIG task per external Codex invocation; never imply a background scheduler exists.
---

# Codex migration loop

This is a **procedural** loop adapter, not a timer or autonomous trigger.
Use the Codex host's supported repetition feature if available; otherwise a user/external orchestrator must invoke the skill again.
Invoke `.codex/skills/flamenode-migration/SKILL.md` for the task implementation and obey `docs/migration/AGENT_PROTOCOL.md`.


## Loop実行時の統一契約（全エージェント共通）

- 1 invocation / 1 wake = 最大 **1 MIG task**。反復を自動スケジューリングする機能はこのskill自体にはない。Claudeの`/loop`等、host側に実在する反復機構だけを使用する。
- 各wakeは必ず **最新main → open migration PR → PR branch STATUS → OPEN_DECISIONS → 依存状態 → CI** の順で読み直す。古い会話や前wakeの判定で実行しない。
- `OPEN_DECISIONS.md`で対象taskまたは関連cutoverに紐づく`OPEN`/`PROVISIONAL`/`BLOCKED_ON_USER`の決定がある場合は、未決の前提を採用しない。影響する実装は`BLOCKED`またはその前で停止。無関係な純粋ロジックだけ対象scope内で進めてよい。
- 原則1writer。branchを作る前にopen PR検索を行い、draft PR作成後にも同じtaskの重複open PRを再確認する。重複を発見したwriterは実装・mergeせず報告する（Draft PRは厳密な排他ロックではない）。
- `IN_PROGRESS`がmainに無くても、owner PRがあればそちらがlive lock。途中失敗したら同じPR/branchを再開する。新規branchで同じtaskをやり直さない。
- 各taskの品質ゲートは`npm run check:project-docs`、対象package build/typecheck/test、契約・権限・副作用・rollbackの検証。実行していない検証をPASS扱いしない。
- 完了は `REVIEW` → **独立レビューの証拠** + 必須CI成功 → `DONE` + 次`READY` → squash merge。自分で独立レビューを代行したことにしない。レビュアーやmerge権限が利用できなければ`REVIEW`で停止して引継ぎする。
- Phase Gateおよびauth/permissions/visibility/schema/Remote D1/route/custom domain/secret/production deployに関係する操作は、要求された承認証跡なしに`DONE`化・merge・実行しない。
- テスト失敗を直す試行は同じtaskのscope内で最大2回まで。残る失敗、未確定仕様、task間依存の不整合は`BLOCKED`として原因・再開条件・PRを記録。失敗回避のために検証を弱めない。
- 次taskはmergeされたmainの更新を観測した**次のwake**にだけ選択する。外部schedulerが存在しない環境では1task後に終了する。

