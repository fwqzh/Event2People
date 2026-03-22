import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { HeaderRefreshButton } from "@/components/header-refresh-button";
import { prisma } from "@/lib/prisma";
import { ensureActiveDataset } from "@/lib/seed";
import { formatRefreshTime } from "@/lib/text";

export async function SiteHeader() {
  noStore();
  const activeDataset = await ensureActiveDataset(prisma);
  const lastUpdatedLabel = activeDataset.publishedAt ? formatRefreshTime(activeDataset.publishedAt) : null;

  return (
    <header className="site-header">
      <div className="page-shell site-header__inner">
        <div className="site-header__brand-cluster">
          <Link href="/" className="site-header__brand">
            <span className="brand-lockup">
              <span
                className="brand-lockup__wordmark"
                style={{
                  color: "#d7c892",
                  fontFamily: 'var(--font-serif), "Times New Roman", serif',
                  fontSize: "clamp(1.75rem, 2.7vw, 2.35rem)",
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                  lineHeight: 0.98,
                  textShadow: "0 0 10px rgba(215, 200, 146, 0.08)",
                }}
              >
                LANCHI SIGNAL
              </span>
              <span className="brand-lockup__tagline">在变化发生之处，看见人。</span>
            </span>
          </Link>
        </div>

        <nav className="site-nav" aria-label="主导航">
          <Link href="/" className="primary-button site-nav__button">
            Event Board
          </Link>
          <Link href="/pipeline" className="primary-button site-nav__button">
            Pipeline
          </Link>
          <HeaderRefreshButton lastUpdatedLabel={lastUpdatedLabel} />
        </nav>
      </div>
    </header>
  );
}
