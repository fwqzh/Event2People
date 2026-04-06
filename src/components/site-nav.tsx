"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { HeaderRefreshButton } from "@/components/header-refresh-button";
import { HeaderSettingsButton } from "@/components/header-settings-button";

type SiteNavProps = {
  lastUpdatedLabel: string | null;
};

export function SiteNav({ lastUpdatedLabel }: SiteNavProps) {
  const pathname = usePathname();
  const isGitHubActive = pathname === "/" || pathname === "/github";
  const isKickstarterActive = pathname === "/kickstarter";
  const isArxivActive = pathname === "/arxiv";
  const isPipelineActive = pathname === "/pipeline";
  const isSettingsActive = pathname === "/settings";

  return (
    <nav className="site-nav" aria-label="主导航">
      <Link href="/github" className={`site-nav__button ${isGitHubActive ? "is-active" : ""}`} aria-current={isGitHubActive ? "page" : undefined}>
        GitHub
      </Link>
      <Link
        href="/arxiv"
        className={`site-nav__button ${isArxivActive ? "is-active" : ""}`}
        aria-current={isArxivActive ? "page" : undefined}
      >
        arXiv
      </Link>
      <Link
        href="/kickstarter"
        className={`site-nav__button ${isKickstarterActive ? "is-active" : ""}`}
        aria-current={isKickstarterActive ? "page" : undefined}
      >
        Kickstarter
      </Link>
      <Link href="/pipeline" className={`site-nav__button ${isPipelineActive ? "is-active" : ""}`} aria-current={isPipelineActive ? "page" : undefined}>
        Pipeline
      </Link>
      <HeaderSettingsButton isActive={isSettingsActive} />
      <HeaderRefreshButton lastUpdatedLabel={lastUpdatedLabel} />
    </nav>
  );
}
