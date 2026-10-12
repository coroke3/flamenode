# FlameNode workspace rule

Read repository root `AGENTS.md` first.

For any platform/UI migration work, `/flamenode-migration`, or code intended for the migration target, follow `docs/migration/AGENT_PROTOCOL.md` as the canonical execution contract.

Mandatory sources include:

- `docs/migration/STATUS.md`（merge済み依存状態）+ `docs/migration/work-items/MIG-XXXX.md`（open PRのlive checkpoint）
- `docs/migration/FEATURE_CATALOG.md`
- `docs/migration/GIT_WORKFLOW.md`
- `docs/migration/PRODUCT_REQUIREMENTS.md`
- `docs/migration/CODE_QUALITY.md`
- relevant `CURRENT_ROUTES.md` / `FRONTEND_FEATURES.md` / `frontend/*.md` / `docs/migration/screen-mapping/README.md`
- relevant `FUNCTION_INVENTORY.md` / `functions/*.md`
- `BACKEND_OPTIMIZATION.md` for backend work
- `docs/migration/server-actions/README.md` for Server Action migration/audit work
- `docs/migration/route-handlers/README.md` for Route Handler/API migration/audit work
- `docs/migration/cloudflare/TOPOLOGY.md` for Cloudflare Worker/ingress/binding/build/job migration/audit work
- `docs/migration/cloudflare/PERFORMANCE_BASELINE.md` for CPU/1102/request/PoC performance migration/audit work
- `docs/migration/static-delivery/README.md` for static artifact/alias/visibility/fallback/repair migration/audit work
- `docs/migration/auth/README.md` for auth/session/linking/terms/Active X/permission/owner migration/audit work
- `docs/migration/background-jobs/README.md` for Queue/Cron/background job/retry/DLQ/recovery migration/audit work
- `UI_REFERENCE.md` for visual work

Rules:

Checkpoint policy: WORK_ITEM_ONLY. Writer wakes update only their own PR's task work-item; review-only wakes leave evidence in the reviewed PR without branch/checkpoint edits. Wait/no-action wakes report the gate without a checkpoint-only push. Update STATUS only at merge integration after independent review/CI.

- Do not create a separate Antigravity migration process or progress ledger.
- One migration writer per MIG task; obey branch/PR/squash workflow.
- Preserve user-visible UX, functions, permissions, visibility, audit and side effects by default.
- Before migration work, use `FEATURE_CATALOG.md` to identify the complete affected capability set and add any newly discovered CURRENT capability before implementation.
- Backend implementation may be redesigned/commonized only when semantics remain correct and clearer.
- Do not optimize for line count.
- Code must satisfy the professional-quality standard in `CODE_QUALITY.md`.
- `docs/design-redesign` is obsolete; do not use old redesign artifacts as the target design.
- The HTML mock is registered (`UI_REFERENCE.md`, `docs/migration/mock/`, MIG-0200 DONE, D-08 DECIDED); visual work follows the mock and the STATUS dependency chain. Do not invent/finalize a visual design that departs from it; stop visual work only if `UI_REFERENCE.md` reverts to `PENDING_HTML`.
- Do not perform production Cloudflare routing, Remote D1, secret, or deploy mutations without explicit approval.
- Never automatically approve/cross a Phase Gate.
