/**
 * Remove Cursor co-author trailers from a git commit message (stdin -> stdout).
 * Used by git filter-branch and prepare-commit-msg hook.
 */
import fs from "node:fs";

const msg = fs.readFileSync(0, "utf8");
const cleaned = msg
  .split(/\r?\n/)
  .filter(
    (line) =>
      !/^Co-authored-by:\s*Cursor\s*</i.test(line) &&
      !/cursoragent@cursor\.com/i.test(line) &&
      !/^Made-with:\s*Cursor/i.test(line)
  )
  .join("\n")
  .replace(/\n{3,}/g, "\n\n")
  .replace(/\n+$/, "\n");

process.stdout.write(cleaned);
