type SerializedEnv = { DB: D1Database };

type AsyncStatementMethod = "all" | "first" | "run" | "raw";

const ASYNC_STATEMENT_METHODS = new Set<PropertyKey>([
  "all",
  "first",
  "run",
  "raw",
] satisfies AsyncStatementMethod[]);

/** D1 Free の 50 statements/invocation 手前で通常処理を安全停止する。 */
export const D1_QUERY_SOFT_LIMIT = 40;
/** Cloudflare D1 Free の 1 Worker invocation あたり hard limit。 */
export const D1_QUERY_HARD_LIMIT = 50;

export class D1BudgetExceededError extends Error {
  readonly currentStatements: number;
  readonly requestedStatements: number;
  readonly limit: number;

  constructor(currentStatements: number, requestedStatements: number) {
    super(
      `d1_query_budget_exceeded:${currentStatements}+${requestedStatements}/${D1_QUERY_HARD_LIMIT}`,
    );
    this.name = "D1BudgetExceededError";
    this.currentStatements = currentStatements;
    this.requestedStatements = requestedStatements;
    this.limit = D1_QUERY_HARD_LIMIT;
  }
}

export type D1Budget = {
  /** 実行済み + 実行開始済みのstatement数。失敗したattemptも安全側で消費扱いにする。 */
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

/**
 * D1 callを開始する前にstatement枠を予約する。
 * 完了後に加算すると、39件消費済みから12件batchを開始して51件へ飛び越えられるため、
 * batch/並行Promiseのどちらでも先に予約してCloudflareのhard limitをfail-closedで守る。
 */
function reserveD1Statements(budget: D1Budget, count: number): void {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("d1_query_budget_invalid_reservation");
  }
  if (count === 0) return;
  if (budget.statements + count > D1_QUERY_HARD_LIMIT) {
    throw new D1BudgetExceededError(budget.statements, count);
  }
  budget.statements += count;
}

function recordD1ResultMetrics(budget: D1Budget, result: unknown): void {
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
 * invocation 内の D1 statement 数と rows read/write を集計し、Free hard limit超過を
 * D1へ送る前に拒否する。`withSerializedD1` の外側へ重ねる。
 *
 * `DB.exec()` は複数SQLを1文字列で実行でき、実行前に正確なstatement数を確定できない。
 * Cloudflareもmaintenance/one-shot用途としているため、budgeted runtimeではfail-closedにし、
 * prepare/batchだけを許可する。将来execが追加されても50 query上限を迂回させない。
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
            reserveD1Statements(budget, 1);
            const result = await Reflect.apply(method, statement, args);
            recordD1ResultMetrics(budget, result);
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
          reserveD1Statements(budget, statements.length);
          const results = await env.DB.batch(
            statements.map(
              (statement) =>
                originalStatement.get(statement as object) ?? statement,
            ),
          );
          for (const result of results) {
            recordD1ResultMetrics(budget, result);
          }
          return results;
        };
      }
      if (property === "exec") {
        return async () => {
          throw new Error("d1_exec_disallowed_in_budgeted_worker");
        };
      }
      if (property === "withSession") {
        return () => {
          throw new Error("d1_session_disallowed_in_budgeted_worker");
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(env.DB) : value;
    },
  }) as D1Database;

  return { ...env, DB: database, d1Budget: budget };
}
