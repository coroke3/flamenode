/** 元配列を変更せず、Fisher-Yates法で表示用のランダム順コピーを返す。 */
export function shuffledCopy<T>(
  items: readonly T[],
  random: () => number = Math.random,
): T[] {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const sample = random();
    // Test/seeded generators may return 1 or malformed values. Keep swaps
    // inside the array so a bad sample cannot append an undefined item.
    const swapIndex = Number.isFinite(sample)
      ? Math.max(0, Math.min(index, Math.floor(sample * (index + 1))))
      : 0;
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}
