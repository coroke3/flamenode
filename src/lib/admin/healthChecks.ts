import "server-only";

// Compatibility bridge (MIG-0626 U06): Next callers retain the unchanged health-check API.
export * from "@flamenode/server-core/admin/healthChecks";
