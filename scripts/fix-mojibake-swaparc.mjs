/**
 * Repair SwaparcApp.jsx when UTF-8 symbols were saved as Latin-1 mojibake.
 * Restores proper Unicode (from pre-d4b7544 UI), NOT ASCII placeholders.
 *
 * Usage: node scripts/fix-mojibake-swaparc.mjs
 */
import fs from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), "src", "SwaparcApp.jsx");
let s = fs.readFileSync(file, "utf8");

const replacements = [
  // Emoji mojibake -> intended emoji
  ["\u00f0\u0178\u2019\u00a7", "\u{1f4a7}"], // 💧
  ["\u00f0\u0178\u201c\u00b7", "\u{1f4f7}"], // 📷
  ["\u00f0\u0178\u2018\u00a4", "\u{1f464}"], // 👤
  ["\u00f0\u0178\u201c\u2039", "\u{1f4cb}"], // 📋
  ["\u00f0\u0178\u2022\u02dc", "\u{1f558}"], // 🕘
  // Punctuation mojibake
  ["\u00c2\u00b7", "\u00b7"], // ·
  ["\u00e2\u20ac\u0153", "\u201c"],
  ["\u00e2\u20ac\u009d", "\u201d"],
  ["\u00e2\u20ac\u2122", "\u2019"],
  ["\u00e2\u20ac\u00a6", "\u2026"],
  ["\u00e2\u20ac\u00a2", "\u00b7"],
  ["\u00e2\u20ac\u201d", "\u2014"],
  ["\u00e2\u20ac\u201c", "\u2013"],
  ["\u00e2\u2013\u00b4", "\u25b4"],
  ["\u00e2\u2013\u00be", "\u25be"],
  // Landing / swap symbol mojibake (if present)
  ["\u00e2\u2020\u201d", "\u2194"], // ↔
];

for (const [from, to] of replacements) {
  s = s.split(from).join(to);
}

fs.writeFileSync(file, s, "utf8");
console.log("Mojibake repair pass complete (UTF-8 symbols restored).");
