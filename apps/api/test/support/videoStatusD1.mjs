import { createD1 } from "./personalHarness.mjs";

/**
 * D1-compatible SQLite reader for video-status parity tests.
 * Drizzle's D1 session reads SELECT rows through statement.raw(), while the
 * general personalHarness D1 stub only implements all()/first(). Keep this
 * adapter local to the MIG-0603 tests; do not weaken the real D1 contract.
 */
export function createVideoStatusD1(sqlite) {
  const base = createD1(sqlite);
  return {
    ...base,
    // Real Cloudflare D1 batch() commits all statements or none. The generic
    // personal test harness does not wrap them in a transaction, so status
    // mutation tests must add the real D1 atomicity boundary explicitly.
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = await base.batch(statements);
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(sql) {
      const original = base.prepare(sql);
      return {
        ...original,
        bind(...params) {
          const bound = original.bind(...params);
          return {
            ...bound,
            async raw() {
              base.stats.statements += 1;
              base.stats.maxBinds = Math.max(base.stats.maxBinds, params.length);
              const prepared = sqlite.prepare(sql);
              prepared.setReturnArrays(true);
              try {
                return prepared.all(...params).map((row) => [...row]);
              } finally {
                prepared.setReturnArrays(false);
              }
            },
          };
        },
      };
    },
  };
}
