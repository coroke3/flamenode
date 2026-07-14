# FlameNode 旧サブエージェント割当

> Status: Historical
> Archived: 2026-07-14
> Current guide: `AGENTS.md`, `CLAUDE.md`, `docs/AI_CONTEXT.md`

このファイルは2026年5月の大規模修正キャンペーン用に作成された旧統合指示書である。現行仕様や通常作業の根拠として使用しない。

## 現行の読取順

1. `AGENTS.md`
2. `docs/AI_CONTEXT.md`の該当タスク行
3. 対象コードと関連test
4. 必要なActive文書

## 旧資料が必要な場合

過去要件、回帰理由、当時の判断経緯を調べる場合だけ、`.claude/flamenode/`から必要な資料1件を読む。旧資料と現行コードが衝突した場合は、現行コード、schema、active migration、Active文書を優先する。

## モデル選択

- 軽量モデル: 検索、一覧化、単純変換、限定的な文書修正
- 中位モデル: 境界が明確な通常実装
- 上位モデル: DB、認証・認可、security、公開API、破壊的変更、仕様衝突、最終レビュー
