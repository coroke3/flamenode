/**
 * 動画プレイヤーとフォームの間の軽量 PubSub。
 *
 * - `requestCurrentTime()`: フォーム側から呼ぶ。500ms 以内に応答が無ければ 0 を返す。
 * - YoutubePlayer 側は `flamenode:request-time` を listen し、`flamenode:current-time`
 *   をディスパッチして応答する。
 */

const REQUEST = "flamenode:request-time";
const RESPONSE = "flamenode:current-time";

export function requestCurrentTime(timeoutMs = 500): Promise<number> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(0);
    let done = false;
    const onResponse = (ev: Event) => {
      if (done) return;
      done = true;
      window.removeEventListener(RESPONSE, onResponse as EventListener);
      const time = (ev as CustomEvent<{ time?: number }>).detail?.time ?? 0;
      resolve(Math.max(0, Math.floor(time * 1000) / 1000));
    };
    window.addEventListener(RESPONSE, onResponse as EventListener);
    window.dispatchEvent(new CustomEvent(REQUEST));
    setTimeout(() => {
      if (done) return;
      done = true;
      window.removeEventListener(RESPONSE, onResponse as EventListener);
      resolve(0);
    }, timeoutMs);
  });
}

export const PLAYER_BRIDGE_EVENTS = { REQUEST, RESPONSE } as const;
