"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { HeaderRefreshButton } from "@/components/header-refresh-button";

type SiteNavProps = {
  lastUpdatedLabel: string | null;
};

export function SiteNav({ lastUpdatedLabel }: SiteNavProps) {
  const pathname = usePathname();
  const isEventBoardActive = pathname === "/";
  const isPipelineActive = pathname === "/pipeline";

  return (
    <nav className="site-nav" aria-label="主导航">
      <Link href="/" className={`site-nav__button ${isEventBoardActive ? "is-active" : ""}`} aria-current={isEventBoardActive ? "page" : undefined}>
        Event Board
      </Link>
      <Link
        href="/pipeline"
        className={`site-nav__button ${isPipelineActive ? "is-active" : ""}`}
        aria-current={isPipelineActive ? "page" : undefined}
      >
        Pipeline
      </Link>
      <HeaderRefreshButton lastUpdatedLabel={lastUpdatedLabel} />
    </nav>
  );
}
