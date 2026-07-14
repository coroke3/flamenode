# FlameNode 旧実装キャンペーン資料

> Status: Historical
> Archived: 2026-07-14
> Current guide: `AGENTS.md`, `CLAUDE.md`, `docs/AI_CONTEXT.md`

このディレクトリは2026年5月のPhase 0〜9修正キャンペーンの記録であり、現行作業の指示書ではない。

## 読取ルール

- 通常の実装、調査、レビューでは読まない。
- 現行仕様はコード、test、`src/lib/db/schema.ts`、active migration、Statusが`Active`の文書から確認する。
- 過去の要件ID、判断経緯、回帰原因を調べる場合だけ、必要なファイル1件を読む。
- このディレクトリの記述と現行コードが衝突した場合は現行コードを優先する。

## 内容

- `source/`: 当時の詳細設計、監査、チェックリスト
- `phases/`: 完了済みPhase 0〜9の作業指示
- `requirements-map.md`: 当時の要求対応表
- `IMPLEMENTATION_PLAN.md`: 当時の実装計画
- `archive/`: 旧端末・運用ガイド

## 現行入口

1. `/AGENTS.md`
2. `/docs/AI_CONTEXT.md`
3. 対象コードと関連test
4. 必要なActive文書
