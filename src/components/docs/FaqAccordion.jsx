import { useCallback, useId, useState } from "react";
import MarkdownDoc from "./MarkdownDoc";
import { parseFaqMarkdown } from "../../utils/parseFaqMarkdown";

export default function FaqAccordion({ markdown }) {
  const baseId = useId();
  const { title, description, items } = parseFaqMarkdown(markdown);
  const [open, setOpen] = useState(() => new Set());

  const toggle = useCallback((index) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  if (!items.length) {
    return <MarkdownDoc markdown={markdown} suppressFirstH1 />;
  }

  return (
    <div className="docsFaq">
      <header className="docsFaqHeader">
        <h1 className="docsFaqTitle">{title}</h1>
        {description
          ? description.split(/\n\n+/).map((para, i) => (
              <p key={i} className="docsFaqDescription">
                {para.trim()}
              </p>
            ))
          : null}
      </header>
      <div className="docsFaqList" role="list">
        {items.map((item, index) => {
          const expanded = open.has(index);
          const panelId = `${baseId}-panel-${index}`;
          const headerId = `${baseId}-header-${index}`;
          return (
            <div key={index} className="docsFaqItem" role="listitem">
              <button
                type="button"
                id={headerId}
                className="docsFaqTrigger"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggle(index)}
              >
                <span className="docsFaqQuestion">{item.question}</span>
                <span className={`docsFaqIcon${expanded ? " docsFaqIconOpen" : ""}`} aria-hidden>
                  +
                </span>
              </button>
              <div
                id={panelId}
                role="region"
                aria-labelledby={headerId}
                className={`docsFaqPanel${expanded ? " docsFaqPanelOpen" : ""}`}
              >
                <div className="docsFaqAnswer">
                  <MarkdownDoc markdown={item.answer} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
