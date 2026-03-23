"use client";

import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

type SiteHeaderShellProps = {
  children: ReactNode;
};

export function SiteHeaderShell({ children }: SiteHeaderShellProps) {
  const headerRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const [isScrolled, setIsScrolled] = useState(false);

  const syncScrolled = useEffectEvent(() => {
    setIsScrolled(window.scrollY > 20);
  });

  const syncHeight = useEffectEvent(() => {
    const height = headerRef.current?.offsetHeight ?? 0;

    if (height > 0) {
      document.documentElement.style.setProperty("--site-header-height", `${height}px`);
    }
  });

  useEffect(() => {
    syncScrolled();
    syncHeight();

    const queueSyncScrolled = () => {
      if (frameRef.current !== null) {
        return;
      }

      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        syncScrolled();
      });
    };

    const resizeObserver = new ResizeObserver(() => {
      syncHeight();
    });

    if (headerRef.current) {
      resizeObserver.observe(headerRef.current);
    }

    window.addEventListener("scroll", queueSyncScrolled, { passive: true });
    window.addEventListener("resize", syncHeight, { passive: true });

    return () => {
      window.removeEventListener("scroll", queueSyncScrolled);
      window.removeEventListener("resize", syncHeight);
      resizeObserver.disconnect();

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return (
    <header ref={headerRef} className={`site-header ${isScrolled ? "is-scrolled" : ""}`}>
      {children}
    </header>
  );
}
