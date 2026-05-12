/**
 * Split FAQ markdown (H1 title + optional body before first ## + ## Q/A blocks).
 * Answer bodies are markdown for MarkdownDoc.
 */
export function parseFaqMarkdown(markdown) {
  const raw = String(markdown || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return { title: "FAQ", description: "", items: [] };

  const lines = raw.split("\n");
  let i = 0;
  let title = "FAQ";

  if (lines[0]?.startsWith("# ")) {
    title = lines[0].slice(2).trim();
    i = 1;
  }

  while (i < lines.length && !lines[i].trim()) i += 1;

  const descLines = [];
  while (i < lines.length && !lines[i].startsWith("## ")) {
    descLines.push(lines[i]);
    i += 1;
  }
  const description = descLines.join("\n").trim();

  const rest = lines.slice(i).join("\n").trim();
  const chunks = rest.split(/\n(?=## )/);
  const items = [];

  for (const chunk of chunks) {
    const c = chunk.trim();
    if (!c.startsWith("## ")) continue;
    const nl = c.indexOf("\n");
    const question = nl === -1 ? c.slice(3).trim() : c.slice(3, nl).trim();
    const answer = (nl === -1 ? "" : c.slice(nl + 1)).trim();
    if (question) items.push({ question, answer });
  }

  return { title, description, items };
}
