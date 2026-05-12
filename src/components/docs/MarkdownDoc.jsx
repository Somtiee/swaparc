import { useMemo } from "react";
import { Link } from "react-router-dom";

/**
 * Map common markdown relative .md targets to in-app /docs/:id routes (id = filename without .md).
 * @param {string} href
 * @returns {string | null}
 */
function docPathFromMarkdownHref(href) {
  const h = String(href || "").trim();
  if (!h || /^https?:\/\//i.test(h) || h.startsWith("mailto:") || h.startsWith("#")) return null;
  const path = h.split("#")[0].split("?")[0];
  if (!path.endsWith(".md")) return null;
  const base = path.replace(/^.*\//, "").replace(/\.md$/i, "").toLowerCase();
  return base ? `/docs/${base}` : null;
}

/**
 * @param {string} str
 * @param {string} keyPrefix
 * @returns {import("react").ReactNode[]}
 */
function renderBoldSegments(str, keyPrefix) {
  if (!str) return [];
  const parts = String(str).split(/\*\*([^*]+)\*\*/g);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) out.push(parts[i]);
    } else {
      out.push(
        <strong key={`${keyPrefix}-b-${i}`}>{parts[i]}</strong>
      );
    }
  }
  return out.length ? out : [str];
}

/**
 * Inline: **bold**, [label](href), and ![alt](src) images.
 * Internal .md links are converted to /docs/:id routes.
 * @param {string} str
 * @param {string} keyPrefix
 */
function renderRichInline(str, keyPrefix) {
  const text = String(str || "");
  const tokenRe = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]*)\]\(([^)]+)\)/g;
  const nodes = [];
  let last = 0;
  let m;
  let ki = 0;
  while ((m = tokenRe.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(
        ...renderBoldSegments(text.slice(last, m.index), `${keyPrefix}-pre-${ki}`)
      );
    }

    // Markdown image: ![alt](src)
    if (m[1] != null && m[2] != null) {
      const alt = m[1];
      const src = m[2];
      nodes.push(
        <img
          key={`${keyPrefix}-img-${ki}`}
          src={src}
          alt={alt || "documentation screenshot"}
          className="docsMdInlineImage"
          loading="lazy"
        />
      );
    } else {
      const label = m[3] || "";
      const href = m[4] || "";
      const docTo = docPathFromMarkdownHref(href);
      const labelContent = renderBoldSegments(label, `${keyPrefix}-lbl-${ki}`);
      if (docTo) {
        nodes.push(
          <Link key={`${keyPrefix}-lnk-${ki}`} to={docTo} className="docsMdInlineLink">
            {labelContent}
          </Link>
        );
      } else {
        nodes.push(
          <a key={`${keyPrefix}-lnk-${ki}`} href={href} target="_blank" rel="noreferrer" className="docsMdInlineLink">
            {labelContent}
          </a>
        );
      }
    }

    last = m.index + m[0].length;
    ki += 1;
  }
  if (last < text.length) {
    nodes.push(...renderBoldSegments(text.slice(last), `${keyPrefix}-post`));
  }
  if (nodes.length === 0) {
    return renderBoldSegments(text, keyPrefix);
  }
  return nodes;
}

function stripBackticks(str) {
  return String(str).replace(/`([^`]+)`/g, "$1");
}

/**
 * Lightweight markdown renderer used by the in-app docs (source: docs/swaparc/*.md).
 * @param {{ markdown?: string, suppressFirstH1?: boolean }} props — when suppressFirstH1, skips the first `# …` line (avoids duplicating the layout title).
 */
export default function MarkdownDoc({ markdown, suppressFirstH1 = false }) {
  const blocks = useMemo(() => {
    let lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    if (suppressFirstH1) {
      let i = 0;
      while (i < lines.length && !lines[i].trim()) i += 1;
      const line = lines[i] || "";
      if (/^#\s+/.test(line) && !line.startsWith("##")) {
        i += 1;
        while (i < lines.length && !lines[i].trim()) i += 1;
        lines = lines.slice(i);
      }
    }
    const result = [];
    let i = 0;
    let key = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith("```")) {
        const fence = line.slice(3).trim();
        i += 1;
        const code = [];
        while (i < lines.length && !lines[i].startsWith("```")) {
          code.push(lines[i]);
          i += 1;
        }
        if (i < lines.length && lines[i].startsWith("```")) i += 1;
        result.push(
          <pre key={`code-${key++}`} className="docsMdCode">
            <code>{code.join("\n")}</code>
          </pre>
        );
        if (fence) {
          result.push(
            <div key={`lang-${key++}`} className="docsMdCodeLang">
              {fence}
            </div>
          );
        }
        continue;
      }
      if (!line.trim()) {
        i += 1;
        continue;
      }
      const heading = /^(#{1,4})\s+(.*)$/.exec(line);
      if (heading) {
        const depth = heading[1].length;
        const rawText = heading[2].trim();
        const hk = key++;
        const textNodes = renderRichInline(stripBackticks(rawText), `h-${hk}`);
        if (depth === 1) result.push(<h1 key={`h1-${hk}`}>{textNodes}</h1>);
        if (depth === 2) result.push(<h2 key={`h2-${hk}`}>{textNodes}</h2>);
        if (depth === 3) result.push(<h3 key={`h3-${hk}`}>{textNodes}</h3>);
        if (depth === 4) result.push(<h4 key={`h4-${hk}`}>{textNodes}</h4>);
        i += 1;
        continue;
      }
      if (line.startsWith("- ")) {
        const list = [];
        while (i < lines.length && lines[i].startsWith("- ")) {
          list.push(lines[i].slice(2).trim());
          i += 1;
        }
        result.push(
          <ul key={`ul-${key++}`}>
            {list.map((item, idx) => (
              <li key={`${idx}-${item.slice(0, 24)}`}>
                {renderRichInline(stripBackticks(item), `li-${key}-${idx}`)}
              </li>
            ))}
          </ul>
        );
        continue;
      }
      if (/^\d+\.\s+/.test(line)) {
        const list = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
          list.push(lines[i].replace(/^\d+\.\s+/, "").trim());
          i += 1;
        }
        const ok = key++;
        result.push(
          <ol key={`ol-${ok}`}>
            {list.map((item, idx) => (
              <li key={`${idx}-${item.slice(0, 24)}`}>
                {renderRichInline(stripBackticks(item), `oli-${ok}-${idx}`)}
              </li>
            ))}
          </ol>
        );
        continue;
      }
      if (line.startsWith("|")) {
        const tableLines = [];
        while (i < lines.length && lines[i].startsWith("|")) {
          tableLines.push(lines[i]);
          i += 1;
        }
        result.push(
          <pre key={`table-${key++}`} className="docsMdTableRaw">
            {tableLines.join("\n")}
          </pre>
        );
        continue;
      }
      const paragraph = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !lines[i].startsWith("#") &&
        !lines[i].startsWith("- ") &&
        !/^\d+\.\s+/.test(lines[i]) &&
        !lines[i].startsWith("```") &&
        !lines[i].startsWith("|")
      ) {
        paragraph.push(lines[i].trim());
        i += 1;
      }
      const joined = stripBackticks(paragraph.join(" "));
      const pk = key++;
      result.push(
        <p key={`p-${pk}`}>
          {renderRichInline(joined, `p-${pk}`)}
        </p>
      );
    }
    return result;
  }, [markdown, suppressFirstH1]);

  return <div className="docsMdArticle">{blocks}</div>;
}
