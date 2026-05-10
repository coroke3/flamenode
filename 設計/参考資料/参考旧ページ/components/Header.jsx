import { useState, useEffect } from "react";
import Link from "next/link";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { useTheme } from "next-themes";

function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <header>
      <div className={`hamburger-menu ${isMenuOpen ? "open" : ""}`}>
        <div className={`menu-btn`} onClick={toggleMenu}>
          <div className="menu-btn__burger"></div>
          <div className="menu-btn__burger"></div>
          <div className="menu-btn__burger"></div>
        </div>
        <div className="menu-items">
          <div className="title">
            <Link href="/">Event Archives</Link>
          </div>
          <div className="menubar">
            <div className="menubars">
              <Link href="/">
                <div className="en">TOP</div>
                トップページ
              </Link>
            </div>
            <div className="menubars">
              <Link href="/list">
                <div className="en">LIST</div>
                一覧から探す
              </Link>
            </div>
            <div className="menubars">
              <Link href="/user">
                <div className="en">CREATOR</div>
                クリエイターから探す
              </Link>
            </div>
            <div className="menubars">
              <Link href="/event">
                <div className="en">EVENT</div>
                イベントから探す
              </Link>
            </div>
          </div>
          <div className="theme-switch-wrapper">
            <label className="theme-switch" htmlFor="theme-toggle">
              <input
                type="checkbox"
                id="theme-toggle"
                checked={mounted && theme === 'dark'}
                onChange={toggleTheme}
              />
              <div className="slider round">
                <div className="slider-icons">
                  <span className="sun">☀️</span>
                  <span className="moon">🌙</span>
                </div>
              </div>
            </label>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;
