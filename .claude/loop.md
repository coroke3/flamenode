Advance the FlameNode migration by one safe cycle using `/flamenode-migration`.

Before each wake, re-read `docs/migration/STATUS.md`. Execute only one `READY` MIG task whose dependencies are satisfied, validate it, persist `STATUS.md` plus affected function/route/API ledgers, and finish the task as `DONE`, `REVIEW`, or `BLOCKED` before the next wake.

Obey every stop condition in `docs/migration/AGENT_PROTOCOL.md`. Never auto-cross a Phase Gate or perform approval-required production actions merely to keep the loop running.
