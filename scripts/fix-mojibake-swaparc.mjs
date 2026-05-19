/**
 * Fix UTF-8 punctuation/icons saved as mojibake in SwaparcApp.jsx.
 */
import fs from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), "src", "SwaparcApp.jsx");
let s = fs.readFileSync(file, "utf8");

const replacements = [
  // Curly quotes (must run before em dash — same prefix)
  ["\u00e2\u20ac\u0153", '"'],
  ["\u00e2\u20ac\u009d", '"'],
  ["\u00e2\u20ac\u2122", "'"],
  ["\u00e2\u20ac\u00a6", "..."],
  ["\u00e2\u20ac\u00a2", " - "],
  ["\u00e2\u20ac\u2018", "-"],
  ["\u00e2\u2020\u2019", "->"],
  ["\u00e2\u2020\u201d", "<->"],
  ["\u00e2\u20ac\u201c", "-"],
  ["\u00e2\u20ac\u201d", " - "],
  // UI icons / symbols
  ["\u00e2\u0161\u00a0\ufeff\u008f", "! "],
  ["\u0161\u00a0\ufeff\u008f", "! "], // warning emoji tail after partial fix
  ["\u00e2\u0161\u2122", "*"], // settings gear mojibake
  ["\u00e2\u2013\u00b4", "^"],
  ["\u00e2\u2013\u00be", "v"],
  ["\u00e2\u2013\u00b6", ">"],
  ["\u00e2\u2014\u20ac", "<"], // avoid in JSX text; fix < Prev manually if needed
  ["\u00e2\u2014\u0152", "o"],
  ["\u00e2\u0153\u201c", "OK"],
  ["\u00e2\u0153\u2022", "x"],
  ["\u00e2\u0153\u00a6", "*"],
  ["\u00e2\u02dc\u00b0", "="],
  ["\u00e2\u2030\u02c6", "~"],
];

for (const [from, to] of replacements) {
  s = s.split(from).join(to);
}

// Tighten em-dash spacing
s = s.replace(/  -  /g, " - ");

// Fix strings where inner ASCII quotes broke JS string literals
s = s.replace(
  /then tap "Send OTP" again/g,
  'then tap \\"Send OTP\\" again'
);
s = s.replace(
  /press "Send OTP" again/g,
  'press \\"Send OTP\\" again'
);

const remaining = s.match(/\u00e2[\u20ac\u2020\u2013\u2014\u0153\u0161\u02dc\u2030]/g);
fs.writeFileSync(file, s, "utf8");
console.log(`Done. Remaining suspect chars: ${remaining?.length ?? 0}`);
if (remaining?.length) {
  const idx = s.search(/\u00e2[\u20ac\u2020\u2013\u2014\u0153\u0161\u02dc\u2030]/);
  console.error("Sample:", JSON.stringify(s.slice(idx, idx + 24)));
  process.exit(1);
}
