import "server-only";

// Compatibility bridge (MIG-0632, D-10): Next callers retain server-only guard.
export * from "@flamenode/server-core/eventExport/data";
