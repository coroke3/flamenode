# /flamenode-migration

FlameNodeの段階移行を1回につき1タスクだけ進める。

このコマンド固有の仕様は持たない。共通実行契約は以下を正本とする。

1. `AGENTS.md`
2. `docs/migration/AGENT_PROTOCOL.md`
3. `docs/migration/README.md`
4. `docs/migration/STATUS.md`
5. `docs/migration/FUNCTION_INVENTORY.md`
6. 該当する `ROUTE_MATRIX.md` / `API_MATRIX.md`; Cloudflare Worker/ingress/binding/build/CPU/job作業では `docs/migration/cloudflare/TOPOLOGY.md`
7. 対象コードと関連test

実行時は `STATUS.md` の次のREADY taskを **1つだけ** claimし、`Owner: claude` を記録する。

終了時は必ず `DONE` / `REVIEW` / `BLOCKED` のいずれかへ遷移し、STATUS・function inventory・matrixを必要に応じて更新する。

`/loop /flamenode-migration` で反復実行してよいが、1 iteration = 1 MIG taskを維持する。

Phase Gate、production deploy、Worker Route / Custom Domain、Remote D1、secret変更は明示承認なしで自動突破しない。

画面リデザインでは見た目の完成だけでDONEにしない。関連function IDのparityを `FUNCTION_INVENTORY.md` で検証する。
