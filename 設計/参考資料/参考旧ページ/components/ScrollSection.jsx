import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import styles from "../styles/works.module.css";

export default function ScrollSection({ children, title, viewMoreLink, reverseScroll = false }) {
    const scrollRef = useRef(null);
    const [showButtons, setShowButtons] = useState(true);
    const [isScrolling, setIsScrolling] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const scrollingRef = useRef(false);
    const autoScrollRef = useRef(null);

    // ウィンドウサイズの監視
    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth <= 768);
        };

        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // コンテンツを用意
    const content = useMemo(() => {
        const items = Array.isArray(children) ? children : [children];

        if (isMobile) {
            // モバイル時は2行に分けて配置
            const rows = [[], []];
            items.forEach((item, index) => {
                rows[index % 2].push(item);
            });
            // 各行を3回繰り返す
            return [...rows[0], ...rows[0], ...rows[0], ...rows[1], ...rows[1], ...rows[1]];
        } else {
            // PC時は従来通り
            return [...items, ...items, ...items];
        }
    }, [children, isMobile]);

    // スクロール位置の監視と調整
    const handleScroll = useCallback(() => {
        if (!scrollRef.current || scrollingRef.current) return;

        const container = scrollRef.current;
        const { scrollLeft, scrollWidth } = container;
        const contentWidth = scrollWidth / 3;

        if (isMobile) {
            // モバイル時のスクロール位置調整
            if (scrollLeft <= contentWidth * 0.05) {
                container.scrollLeft = contentWidth;
            } else if (scrollLeft >= contentWidth * 2.95) {
                container.scrollLeft = contentWidth;
            }
        } else {
            // PC時は従来通り
            if (scrollLeft <= contentWidth * 0.05) {
                container.scrollLeft = contentWidth + (scrollLeft % contentWidth);
            } else if (scrollLeft >= contentWidth * 2.95) {
                container.scrollLeft = contentWidth + (scrollLeft % contentWidth);
            }
        }
    }, [isMobile]);

    // スクロール量を計算
    const calculateScrollAmount = useCallback(() => {
        if (!scrollRef.current) return 0;

        const container = scrollRef.current;
        const itemWidth = container.firstElementChild?.offsetWidth || 0;
        const gap = 24;

        if (isMobile) {
            // モバイル時は1アイテム分（2行分）
            return itemWidth + gap;
        } else {
            // PC時は1.5アイテム分
            return (itemWidth + gap) * 1.5;
        }
    }, [isMobile]);

    // スムーズスクロール
    const smoothScroll = useCallback((targetScroll, duration = 300) => {
        if (!scrollRef.current || scrollingRef.current) return;

        scrollingRef.current = true;
        setIsScrolling(true);

        const startScroll = scrollRef.current.scrollLeft;
        const startTime = performance.now();
        let frameId = null;

        const animateScroll = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            const easing = progress < 0.5
                ? 4 * progress * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 3) / 2;

            if (scrollRef.current) {
                const currentPosition = startScroll + (targetScroll - startScroll) * easing;
                scrollRef.current.scrollLeft = currentPosition;

                if (progress < 1) {
                    frameId = requestAnimationFrame(animateScroll);
                } else {
                    scrollingRef.current = false;
                    setIsScrolling(false);
                    handleScroll();
                }
            }
        };

        frameId = requestAnimationFrame(animateScroll);

        // クリーンアップ関数を返す（連打時に前のアニメーションをキャンセル）
        return () => {
            if (frameId) {
                cancelAnimationFrame(frameId);
                scrollingRef.current = false;
                setIsScrolling(false);
            }
        };
    }, [handleScroll]);

    // 自動スクロール
    const startAutoScroll = useCallback(() => {
        if (isPaused || !scrollRef.current) return;

        const scroll = () => {
            if (scrollRef.current && !scrollingRef.current) {
                const scrollAmount = reverseScroll ? -1 : 1;
                scrollRef.current.scrollLeft += scrollAmount;
                handleScroll();
                autoScrollRef.current = requestAnimationFrame(scroll);
            }
        };

        autoScrollRef.current = requestAnimationFrame(scroll);
    }, [isPaused, reverseScroll, handleScroll]);

    // 自動スクロールの停止
    const stopAutoScroll = useCallback(() => {
        if (autoScrollRef.current) {
            cancelAnimationFrame(autoScrollRef.current);
            autoScrollRef.current = null;
        }
    }, []);

    // 自動スクロールの制御
    useEffect(() => {
        const scrollContainer = scrollRef.current;
        if (!scrollContainer) return;

        // 初回マウント時のみ初期位置を設定
        if (!scrollContainer.scrollLeft) {
            const contentWidth = scrollContainer.scrollWidth / 3;
            scrollContainer.scrollLeft = contentWidth;
        }

        // isPausedの変更時は位置リセットせず、スクロールの開始/停止のみ制御
        if (isPaused) {
            stopAutoScroll();
        } else {
            startAutoScroll();
        }

        return () => stopAutoScroll();
    }, [isPaused, startAutoScroll, stopAutoScroll]);

    // スクロールボタンハンドラー
    const handleScrollButton = useCallback((direction) => {
        if (!scrollRef.current) return;

        // 前のアニメーションが実行中の場合はキャンセル
        if (scrollingRef.current) {
            scrollingRef.current = false;
            setIsScrolling(false);
        }

        const scrollAmount = calculateScrollAmount();
        const currentScroll = scrollRef.current.scrollLeft;
        const targetScroll = currentScroll + (direction === 'left' ? -scrollAmount : scrollAmount);

        smoothScroll(targetScroll);
    }, [smoothScroll, calculateScrollAmount]);

    // コンテンツ量に応じてボタン表示を制御
    useEffect(() => {
        const checkScrollable = () => {
            if (scrollRef.current) {
                const { scrollWidth, clientWidth } = scrollRef.current;
                setShowButtons(scrollWidth > clientWidth);
            }
        };

        checkScrollable();
        window.addEventListener('resize', checkScrollable);
        return () => window.removeEventListener('resize', checkScrollable);
    }, []);

    return (
        <section className={styles.sectionContainer}>
            <div className={styles.sectionHeader}>
                <h2>{title}</h2>
                {viewMoreLink}
            </div>
            <div
                className={styles.scrollWrapper}
                onMouseEnter={() => setIsPaused(true)}
                onMouseLeave={() => setIsPaused(false)}
            >
                {showButtons && (
                    <>
                        <button
                            className={`${styles.scrollButton} ${styles.scrollButtonLeft}`}
                            onClick={() => handleScrollButton('left')}
                            disabled={isScrolling}
                        >
                            <FontAwesomeIcon icon={faChevronLeft} />
                        </button>
                        <button
                            className={`${styles.scrollButton} ${styles.scrollButtonRight}`}
                            onClick={() => handleScrollButton('right')}
                            disabled={isScrolling}
                        >
                            <FontAwesomeIcon icon={faChevronRight} />
                        </button>
                    </>
                )}
                <div
                    ref={scrollRef}
                    className={styles.scrollContainer}
                    onScroll={handleScroll}
                >
                    {content}
                </div>
            </div>
        </section>
    );
} 