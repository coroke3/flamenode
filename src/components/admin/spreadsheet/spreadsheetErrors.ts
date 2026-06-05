/** クライアント側スプレッドシート API エラー（循環 import 回避用） */

export class SpreadsheetApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "SpreadsheetApiError";
    this.status = status;
    this.code = code;
  }
}

export function spreadsheetUserMessage(
  error: unknown,
  fallback: string,
): string {
  if (error instanceof SpreadsheetApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
