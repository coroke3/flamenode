/**
 * 重要書き込みの Commit 結果を明示する共通型。
 * 既存 Action の `{ ok, message }` を一括置換しない。段階導入用。
 */
export type PostCommitWarning = {
  name: string;
  error_code: string;
  retryable: boolean;
};

export type MutationResult<T> =
  | {
      kind: "committed";
      value: T;
      postCommitWarnings: PostCommitWarning[];
    }
  | {
      kind: "noop";
      value: T;
      reason: string;
    }
  | {
      kind: "rejected";
      code: string;
      retryable: boolean;
      message?: string;
    };

export function mutationCommitted<T>(
  value: T,
  postCommitWarnings: PostCommitWarning[] = [],
): MutationResult<T> {
  return { kind: "committed", value, postCommitWarnings };
}

export function mutationNoop<T>(value: T, reason: string): MutationResult<T> {
  return { kind: "noop", value, reason };
}

export function mutationRejected(
  code: string,
  options?: { retryable?: boolean; message?: string },
): MutationResult<never> {
  return {
    kind: "rejected",
    code,
    retryable: options?.retryable === true,
    message: options?.message,
  };
}
