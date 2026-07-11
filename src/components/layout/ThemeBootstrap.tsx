/**
 * React の初回描画前に保存済み設定または OS 設定から実テーマを決定する。
 * `system` 自体を DOM の data-theme に入れず、常に light / dark へ解決する。
 */
export function ThemeBootstrap(): React.ReactElement {
  const code = `(()=>{var d=document.documentElement;var q=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)');var read=function(){try{var v=localStorage.getItem('fn-theme');return v==='light'||v==='dark'||v==='system'?v:'system'}catch(_){return'system'}};var apply=function(mode){var resolved=mode==='system'?(q&&q.matches?'dark':'light'):mode;d.setAttribute('data-theme',resolved);d.setAttribute('data-theme-preference',mode)};var mode=read();apply(mode);if(q&&mode==='system'){var onChange=function(){if((d.getAttribute('data-theme-preference')||'system')==='system')apply('system')};if(q.addEventListener)q.addEventListener('change',onChange);else if(q.addListener)q.addListener(onChange)}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
