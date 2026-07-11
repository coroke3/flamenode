# Legacy Import

> Status: Active
> Last verified: 2026-07-11
> Verified against commit: `5f48e0f` + working tree
> Source of truth: `src/lib/import/legacy/`

legacy dataはcanonical shapeへnormalizeしてからvalidate、dry run、署名preview、staging、atomic apply、integrity、enqueue、auditの順に処理する。旧列をruntime fallbackとして保存・二重書込みしない。
