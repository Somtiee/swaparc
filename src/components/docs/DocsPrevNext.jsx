import { Link } from "react-router-dom";
import { DOCS_FLAT_PAGES } from "../../docsPreviewCatalog";

/**
 * @param {{ pageId: string }} props
 */
export default function DocsPrevNext({ pageId }) {
  const i = DOCS_FLAT_PAGES.findIndex((p) => p.id === pageId);
  if (i < 0) return null;

  const prev = i > 0 ? DOCS_FLAT_PAGES[i - 1] : null;
  const next = i < DOCS_FLAT_PAGES.length - 1 ? DOCS_FLAT_PAGES[i + 1] : null;

  if (!prev && !next) return null;

  return (
    <nav className="docsPrevNext" aria-label="Previous and next page">
      <div className="docsPrevNextHeading">Continue reading</div>
      <div className="docsPrevNextGrid">
        {prev ? (
          <Link to={`/docs/${prev.id}`} className="docsPrevNextCard docsPrevNextCardPrev">
            <span className="docsPrevNextLabel">Previous</span>
            <span className="docsPrevNextTitle">{prev.title} →</span>
            <span className="docsPrevNextMeta">{prev.audienceLabel}</span>
          </Link>
        ) : (
          <span className="docsPrevNextCard docsPrevNextCardSpacer" aria-hidden />
        )}
        {next ? (
          <Link to={`/docs/${next.id}`} className="docsPrevNextCard docsPrevNextCardNext">
            <span className="docsPrevNextLabel">Next</span>
            <span className="docsPrevNextTitle">{next.title} →</span>
            <span className="docsPrevNextMeta">{next.audienceLabel}</span>
          </Link>
        ) : (
          <span className="docsPrevNextCard docsPrevNextCardSpacer" aria-hidden />
        )}
      </div>
    </nav>
  );
}
