/**
 * SSR で `<html>` にテーマ属性をハイドレーション前に書き込み、
 * 初回レンダリング時のフラッシュを防ぐためのインラインスクリプト。
 */
export function ThemeBootstrap(): React.ReactElement {
  const code = `(()=>{try{var t=localStorage.getItem('fn-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
