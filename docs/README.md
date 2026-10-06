# FlameNode ドキュメント索引

> Status: Active
> Last verified: 2026-10-06
> Verified against commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Source of truth: `AGENTS.md`、現行コード/test、DB schema/migrations

## AIの読取順

通常:

`../AGENTS.md` → `AI_CONTEXT.md` の該当行 → 対象コード/test

移行:

`../AGENTS.md` → `AI_CONTEXT.md` の移行行 → `migration/README.md` → `migration/STATUS.md` → 対象matrix/code/test

Historical / archive / 完了済みphaseは現行仕様の根拠にしない。

## Active入口

| 目的 | 文書 |
| --- | --- |
| AI作業判断 | [AI_CONTEXT.md](AI_CONTEXT.md) |
| **Next/OpenNextからの段階移行** | **[migration/README.md](migration/README.md)** |
| **移行の現在地 / 次タスク** | **[migration/STATUS.md](migration/STATUS.md)** |
| route移行契約 | [migration/ROUTE_MATRIX.md](migration/ROUTE_MATRIX.md) |
| API/Server移行契約 | [migration/API_MATRIX.md](migration/API_MATRIX.md) |
| UI/UX再設計proposal | [design-redesign/README.md](design-redesign/README.md) |
| UI受入 | [operations/ui-acceptance.md](operations/ui-acceptance.md) |
| 公開static/visibility | [operations/static-delivery.md](operations/static-delivery.md) |
| Worker/Queue | [operations/workers.md](operations/workers.md) |
| 運用タスク表 | [operations/README.md](operations/README.md) |
| DB運用 | [database/README.md](database/README.md) |
| DB変更履歴 | [database/change-log.md](database/change-log.md) |
| 未完了 | [implementation-backlog.md](implementation-backlog.md) |
| ローカル | [../LOCAL.md](../LOCAL.md) |
| デプロイ | [../DEPLOY.md](../DEPLOY.md) |

## 現行と移行後

- 現行productionの実装・bindingはコード / wrangler / Cloudflare実設定を正本とする。
- 移行後target architectureは `migration/README.md` を正本とする。
- 移行進捗・次READY taskは `migration/STATUS.md` だけを正本とする。
- `design-redesign/` は次期UI proposalであり、機能・権限・DB/API契約の正本ではない。
- migration完了までNext/OpenNext文書と新構成文書が並存するため、CURRENT/TARGETを明示する。

## 移行コマンド

標準入口:

```text
/flamenode-migration
```

反復実行:

```text
/loop /flamenode-migration
```

各iterationは `migration/STATUS.md` の1 MIG taskだけを進める。
Phase Gate、production deploy、Worker Route/Custom Domain、Remote D1、secret変更は自動突破しない。

## Historical（必要時のみ）

- [historical/README.md](historical/README.md)
- [db-history/README.md](db-history/README.md)
- `.claude/flamenode/`

必要な資料1件だけを読む。

実装変更時は該当Active文書だけ更新する。schema列・実装・設定値をMarkdownへ過剰複製しない。
