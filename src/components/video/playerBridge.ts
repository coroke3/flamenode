/**
 * 動画プレイヤーと周辺 UI の軽量ブリッジ。
 *
 * - `seekToTime(time)`: 埋め込み iframe を指定秒から再生し直す。
 */

const SEEK = "flamenode:seek";

export function seekToTime(time: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SEEK, {
      detail: { time: Math.max(0, Math.floor(time)) },
    }),
  );
}