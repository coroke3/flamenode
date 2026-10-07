# FlameNode workspace rule

Read repository root `AGENTS.md` first.

For any platform/UI migration work, `/flamenode-migration`, or code intended for the migration target, follow `docs/migration/AGENT_PROTOCOL.md` as the canonical execution contract.

Mandatory sources include:

- `docs/migration/STATUS.md`
- `docs/migration/GIT_WORKFLOW.md`
- `docs/migration/PRODUCT_REQUIREMENTS.md`
- `docs/migration/CODE_QUALITY.md`
- relevant `CURRENT_ROUTES.md` / `FRONTEND_FEATURES.md` / `frontend/*.md`
- relevant `FUNCTION_INVENTORY.md` / `functions/*.md`
- `BACKEND_OPTIMIZATION.md` for backend work
- `docs/migration/server-actions/README.md` for Server Action migration/audit work
- `docs/migration/route-handlers/README.md` for Route Handler/API migration/audit work
- `docs/migration/cloudflare/TOPOLOGY.md` for Cloudflare Worker/ingress/binding/build/job migration/audit work
- `docs/migration/cloudflare/PERFORMANCE_BASELINE.md` for CPU/1102/request/PoC performance migration/audit work
- `docs/migration/static-delivery/README.md` for static artifact/alias/visibility/fallback/repair migration/audit work
- `docs/migration/auth/README.md` for auth/session/linking/terms/Active X/permission/owner migration/audit work
- `UI_REFERENCE.md` for visual work

Rules:

- Do not create a separate Antigravity migration process or progress ledger.
- One migration writer per MIG task; obey branch/PR/squash workflow.
- Preserve user-visible UX, functions, permissions, visibility, audit and side effects by default.
- Backend implementation may be redesigned/commonized only when semantics remain correct and clearer.
- Do not optimize for line count.
- Code must satisfy the professional-quality standard in `CODE_QUALITY.md`.
- `docs/design-redesign` is obsolete; do not use old redesign artifacts as the target design.
- While `UI_REFERENCE.md` is `PENDING_HTML`, do not invent/finalize a new visual design.
- Do not perform production Cloudflare routing, Remote D1, secret, or deploy mutations without explicit approval.
- Never automatically approve/cross a Phase Gate.