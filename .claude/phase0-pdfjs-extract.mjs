// Phase 0 spike: validate pdfjs-dist text extraction on a real PDF in Node.
// Mirrors what a Deno edge function `pdf-extract-text` would do (text layer only).
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const path = process.argv[2];
if (!path) { console.error("usage: node phase0-pdfjs-extract.mjs <file.pdf>"); process.exit(1); }

const data = new Uint8Array(readFileSync(path));
const doc = await getDocument({
  data,
  useWorkerFetch: false,
  isEvalSupported: false,
  useSystemFonts: true,
}).promise;

const pages = Math.min(doc.numPages, 40); // edge function cap
const parts = [];
for (let i = 1; i <= pages; i++) {
  const page = await doc.getPage(i);
  const content = await page.getTextContent();
  const text = content.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  parts.push(`\n--- PAGE ${i} ---\n${text}`);
  page.cleanup();
}
await doc.destroy();
const out = parts.join("");
console.log(`pages=${doc.numPages} extractedChars=${out.length}`);
console.log(out.slice(0, 1200));
