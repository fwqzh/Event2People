import Link from "next/link";

export function SiteHeader() {
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
          <Link href="/admin/refresh" className="primary-button site-nav__button">
            Refresh
          </Link>
        </nav>
      </div>
    </header>
  );
}
