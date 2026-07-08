/** Worker scheduled ジョブ用の共通 try-catch ラッパー。 */
export async function runJob(
  name: string,
  task: () => Promise<unknown>,
): Promise<void> {
  try {
    await task();
  } catch (e) {
    console.error(`[${name}] failed:`, e);
  }
}
