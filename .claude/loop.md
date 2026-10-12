# Claude migration loop wake

Checkpoint policy: WORK_ITEM_ONLY

Used as the per-wake prompt by a bare `/loop` (Claude Code ignores this file when `/loop` is given a prompt such as `/loop /flamenode-migration`; both run the same procedure).

Invoke the `flamenode-migration` skill once. 1 wake = at most one action from the Wake decision in `docs/migration/AGENT_PROTOCOL.md` § `/loop` / continuous execution: one micro-unit of an owned MIG task, one merge integration, one independent review of another agent's PR, or nothing.

- Writer wakes save live state only in their own PR's `docs/migration/work-items/MIG-XXXX.md`; `STATUS.md` changes only at pre-merge integration. Review-only wakes leave evidence in the reviewed PR without branch/checkpoint edits; wait/no-action wakes report the gate without a checkpoint-only push.
- Pace the next wake per the protocol's Pacing rules. When the only remaining work needs a human (Phase Gate, high-risk approval, `BLOCKED`, no READY task), stop the loop and report instead of polling.
- Never perform production deploy, Worker Route / Custom Domain, Remote D1 or secret changes, and never auto-cross a Phase Gate.
