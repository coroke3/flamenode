/** 元配列を変更せず、Fisher-Yates法で表示用のランダム順コピーを返す。 */
export function shuffledCopy<T>(
  items: readonly T[],
  random: () => number = Math.random,
): T[] {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const sampled = random();
    // 注入された乱数生成器の不正値で範囲外の要素とswapし、配列を壊さない。
    const bounded = Number.isFinite(sampled)
      ? Math.min(Math.max(sampled, 0), 1 - Number.EPSILON)
      : 0;
    const swapIndex = Math.floor(bounded * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}
