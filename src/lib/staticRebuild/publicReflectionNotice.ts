/** 静的 JSON / R2 再生成が必要な保存のあと、公開ページへ出す案内文。 */
export const PUBLIC_REFLECTION_DELAY_MESSAGE =
  "公開ページへの反映は、静的データの再生成が完了するまでしばらく時間がかかることがあります。";

export type PendingPublicReflection = {
  pendingPublicReflection?: boolean;
};

export function markPendingPublicReflection<T extends { ok: boolean }>(
  result: T,
  enqueued: boolean,
): T & PendingPublicReflection {
  if (!result.ok || !enqueued) return result;
  return { ...result, pendingPublicReflection: true };
}

export function appendPublicReflectionDelayNotice(message: string): string {
  if (message.includes(PUBLIC_REFLECTION_DELAY_MESSAGE)) {
    return message;
  }
  const trimmed = message.trimEnd();
  const separator = trimmed.endsWith("。") ? " " : "。";
  return `${trimmed}${separator}${PUBLIC_REFLECTION_DELAY_MESSAGE}`;
}

export function withPublicReflectionDelayMessage(
  message: string,
  enqueued: boolean,
): { message: string; pendingPublicReflection?: boolean } {
  if (!enqueued) return { message };
  return {
    message: appendPublicReflectionDelayNotice(message),
    pendingPublicReflection: true,
  };
}

export function spreadsheetSaveStatusMessage(
  base: string,
  pending?: boolean,
): string {
  if (!pending) return base;
  return appendPublicReflectionDelayNotice(base);
}
