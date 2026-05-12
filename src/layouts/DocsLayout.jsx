import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import logo from "../assets/swaparc-logo.png";
import { DOCS_FLAT_PAGES, DOCS_PREVIEW_SECTIONS } from "../docsPreviewCatalog";

const GITHUB_HREF = "https://github.com/Somtiee/swaparc";
const X_HREF = "https://x.com/swaparc_app";

const AUDIENCE_SIDEBAR_TITLE = {
  user: "User guide",
  developer: "Developers & operators",
};

const SECTIONS_BY_AUDIENCE = {
  user: DOCS_PREVIEW_SECTIONS.filter((s) => s.audience === "user"),
  developer: DOCS_PREVIEW_SECTIONS.filter((s) => s.audience === "developer"),
};

export default function DocsLayout() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [audienceOpen, setAudienceOpen] = useState(() => ({
    user: true,
    developer: true,
  }));

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia("(max-width: 900px)");
    if (!sidebarOpen || !mq.matches) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [sidebarOpen]);

  const activePageId = useMemo(() => {
    const m = location.pathname.match(/\/docs\/([^/]+)/);
    return m ? m[1] : null;
  }, [location.pathname]);

  useEffect(() => {
    if (!activePageId) return;
    const page = DOCS_FLAT_PAGES.find((p) => p.id === activePageId);
    if (!page) return;
    setAudienceOpen((prev) => ({ ...prev, [page.audience]: true }));
  }, [activePageId]);

  const toggleAudience = useCallback((key) => {
    setAudienceOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const renderAudienceBlock = (audienceKey) => {
    const sections = SECTIONS_BY_AUDIENCE[audienceKey];
    if (!sections.length) return null;

    const expanded = audienceOpen[audienceKey];
    const title = AUDIENCE_SIDEBAR_TITLE[audienceKey];

    return (
      <div className="docsSidebarAudienceBlock" key={audienceKey}>
        <button
          type="button"
          className={`docsSidebarAudienceToggle${expanded ? " docsSidebarAudienceToggleOpen" : ""}`}
          aria-expanded={expanded}
          onClick={() => toggleAudience(audienceKey)}
        >
          <span className="docsSidebarAudienceToggleLabel">{title}</span>
          <span className="docsSidebarAudienceChevron" aria-hidden>
            {expanded ? "▼" : "▶"}
          </span>
        </button>
        {expanded ? (
          <div className="docsSidebarAudiencePanel">
            {sections.map((section) => (
              <div key={`${section.audience}-${section.label}`} className="docsSidebarGroup">
                <div className="docsSidebarGroupTitle">{section.label}</div>
                {section.pages.map((page) => (
                  <NavLink
                    key={page.id}
                    to={`/docs/${page.id}`}
                    className={({ isActive }) =>
                      `docsSidebarLink${isActive ? " docsSidebarLinkActive" : ""}`
                    }
                    onClick={closeSidebar}
                  >
                    {page.title}
                  </NavLink>
                ))}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="docsLayoutRoot">
      <header className="docsLayoutHeader">
        <Link to="/docs/readme" className="docsLayoutBrand" onClick={closeSidebar}>
          <img src={logo} alt="" className="docsLayoutLogo" />
          <div>
            <div className="docsLayoutTitle">SwapArc</div>
            <div className="docsLayoutSubtitle">Docs</div>
          </div>
        </Link>

        <nav className="docsLayoutHeaderNav" aria-label="External">
          <a href={GITHUB_HREF} className="docsLayoutHeaderLink" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href={X_HREF} className="docsLayoutHeaderLink" target="_blank" rel="noreferrer">
            X
          </a>
          <Link to="/" className="docsLayoutHeaderCta">
            Open app
          </Link>
        </nav>

        <button
          type="button"
          className="docsLayoutMenuBtn"
          aria-expanded={sidebarOpen}
          aria-controls="docs-sidebar"
          onClick={() => setSidebarOpen((o) => !o)}
        >
          <span className="docsLayoutMenuIcon" aria-hidden>
            ☰
          </span>
          <span className="srOnly">Menu</span>
        </button>
      </header>

      <div
        className={`docsLayoutBackdrop${sidebarOpen ? " docsLayoutBackdropOpen" : ""}`}
        aria-hidden={!sidebarOpen}
        onClick={closeSidebar}
      />

      <div className="docsLayoutBody">
        <aside
          id="docs-sidebar"
          className={`docsLayoutSidebar${sidebarOpen ? " docsLayoutSidebarOpen" : ""}`}
          aria-label="Documentation"
        >
          {renderAudienceBlock("user")}
          {renderAudienceBlock("developer")}
          <div className="docsSidebarFooter">
            <a href={GITHUB_HREF} className="docsSidebarFooterLink" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href={X_HREF} className="docsSidebarFooterLink" target="_blank" rel="noreferrer">
              X
            </a>
          </div>
        </aside>

        <main className="docsLayoutMain">
          <div className="docsLayoutMainInner">
            <Outlet />
            <div className="docsLayoutCtaStrip" role="region" aria-label="Get started">
              <div className="docsLayoutCtaStripText">
                <div className="docsLayoutCtaStripTitle">Start using SwapArc</div>
                <div className="docsLayoutCtaStripSub">Web app on Arc testnet — swaps, liquidity, PrivPay.</div>
              </div>
              <Link to="/" className="docsLayoutCtaStripBtn">
                Open app
              </Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
