import { useMemo } from "react";
import { Navigate, useParams } from "react-router-dom";
import MarkdownDoc from "../components/docs/MarkdownDoc";
import FaqAccordion from "../components/docs/FaqAccordion";
import DocsPrevNext from "../components/docs/DocsPrevNext";
import { DEFAULT_DOC_PAGE_ID, DOCS_FLAT_PAGES } from "../docsPreviewCatalog";

export default function DocsArticlePage() {
  const { pageId } = useParams();
  const page = useMemo(() => DOCS_FLAT_PAGES.find((p) => p.id === pageId), [pageId]);

  if (!page) {
    return <Navigate to={`/docs/${DEFAULT_DOC_PAGE_ID}`} replace />;
  }

  if (pageId === "faq") {
    return (
      <div className="docsArticle docsArticleFaqShell">
        <div className="docsArticleBadges docsArticleFaqBadges">
          <span className="docsArticleAudience">{page.audienceLabel}</span>
          <span className="docsArticleSection">{page.navSection}</span>
        </div>
        <FaqAccordion markdown={page.markdown} />
        <DocsPrevNext pageId={pageId} />
      </div>
    );
  }

  return (
    <article className="docsArticle">
      <header className="docsArticleHeader">
        <h1 className="docsArticleTitle">{page.title}</h1>
        <div className="docsArticleBadges">
          <span className="docsArticleAudience">{page.audienceLabel}</span>
          <span className="docsArticleSection">{page.navSection}</span>
        </div>
      </header>
      <MarkdownDoc markdown={page.markdown} suppressFirstH1 />
      <DocsPrevNext pageId={pageId} />
    </article>
  );
}
