type SerializedEnv = { DB: D1Database };

type AsyncStatementMethod = "all" | "first" | "run" | "raw";

const ASYNC_STATEMENT_METHODS = new Set<PropertyKey>([
  "all",
  "first",
  "run",
  "raw",
] satisfies AsyncStatementMethod[]);

/** D1 Free の 50 statements/invocation 手前で安全停止する。operation_mode は変更しない（ランタイム安全装置）。 */
export const D1_QUERY_SOFT_LIMIT = 40;

export type D1Budget = {
  statements: number;
  rowsRead: number;
  rowsWritten: number;
};

export function createD1Budget(): D1Budget {
  return { statements: 0, rowsRead: 0, rowsWritten: 0 };
}

export function isD1BudgetExhausted(budget: D1Budget): boolean {
  return budget.statements >= D1_QUERY_SOFT_LIMIT;
}

export type EnvWithD1Budget<Env extends SerializedEnv> = Env & {
  d1Budget: D1Budget;
};

function recordD1Result(budget: D1Budget, result: unknown): void {
  budget.statements += 1;
  const meta = (
    result as {
      meta?: { rows_read?: number; rows_written?: number; changes?: number };
    }
  )?.meta;
  if (!meta) return;
  budget.rowsRead += Number(meta.rows_read ?? 0);
  budget.rowsWritten += Number(meta.rows_written ?? 0);
}

/**
 * invocation 内の D1 statement 数と rows read/write を集計する。
 * `withSerializedD1` の外側へ重ねる。
 */
export function withD1Budget<Env extends SerializedEnv>(
  env: Env,
): EnvWithD1Budget<Env> {
  const budget = createD1Budget();
  const originalStatement = new WeakMap<object, D1PreparedStatement>();

  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(statement as object, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) =>
            wrapStatement(statement.bind(...values));
        }
        if (ASYNC_STATEMENT_METHODS.has(property)) {
          const method = Reflect.get(target, property, target);
          if (typeof method !== "function") return method;
          return async (...args: unknown[]) => {
            const result = await Reflect.apply(method, statement, args);
            recordD1Result(budget, result);
            return result;
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(statement) : value;
      },
    }) as D1PreparedStatement;
    originalStatement.set(wrapped as object, statement);
    return wrapped;
  };

  const database = new Proxy(env.DB as object, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => wrapStatement(env.DB.prepare(query));
      }
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          const results = await env.DB.batch(
            statements.map(
              (statement) =>
                originalStatement.get(statement as object) ?? statement,
            ),
          );
          for (const result of results) {
            recordD1Result(budget, result);
          }
          return results;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(env.DB) : value;
    },
  }) as D1Database;

  return { ...env, DB: database, d1Budget: budget };
}
