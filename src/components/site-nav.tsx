"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { HeaderRefreshButton } from "@/components/header-refresh-button";

type SiteNavProps = {
  lastUpdatedLabel: string | null;
};

export function SiteNav({ lastUpdatedLabel }: SiteNavProps) {
  const pathname = usePathname();
  const isGitHubActive = pathname === "/" || pathname === "/github";
  const isArxivActive = pathname === "/arxiv";
  const isPipelineActive = pathname === "/pipeline";

  return (
    <nav className="site-nav" aria-label="主导航">
      <Link href="/github" className={`site-nav__button ${isGitHubActive ? "is-active" : ""}`} aria-current={isGitHubActive ? "page" : undefined}>
        GitHub
      </Link>
      <Link href="/arxiv" className={`site-nav__button ${isArxivActive ? "is-active" : ""}`} aria-current={isArxivActive ? "page" : undefined}>
        arXiv
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
