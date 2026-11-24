// Compare doi2bbt keys with the keys Better BibTeX assigned in a real library.
//
// Export a library or collection from Zotero as "Better BibLaTeX" or
// "Better BibTeX", then run:
//   node scripts/parity.mjs library.bib [base-url]
//
// With Zotero running, BBT can also export over HTTP:
//   curl -o library.bib 'http://localhost:23119/better-bibtex/export/library?/1/library.biblatex'
import { readFileSync } from "node:fs";

const [file, base = "https://doi2bbt.org"] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node scripts/parity.mjs library.bib [base-url]");
  process.exit(2);
}

const bib = readFileSync(file, "utf8");
const entries = [...bib.matchAll(/^@\w+\{([^,\s]+),([\s\S]*?)^\}/gm)]
  .map(([, key, body]) => ({ key, doi: body.match(/^\s*doi\s*=\s*\{([^}]+)\}/im)?.[1] }))
  .filter((entry) => entry.doi);

let matches = 0;
for (const { key, doi } of entries) {
  const url = new URL("/api/v1/resolve", base);
  url.searchParams.set("id", doi);
  let ours;
  try {
    const response = await fetch(url, { headers: { "User-Agent": "doi2bbt-parity/1" } });
    const payload = await response.json();
    ours = response.ok ? payload.citation_key : `HTTP ${response.status}: ${payload.title}`;
  } catch (error) {
    ours = `ERROR ${error.message}`;
  }
  // Better BibTeX adds postfixes for collisions inside the library; compare base keys.
  const same = ours === key || ours === key.replace(/(\d)[a-z]+$/, "$1");
  if (same) matches += 1;
  console.log(`${same ? "OK  " : "DIFF"} ${key.padEnd(50)} ${same ? "" : ours}`);
  // Stay well inside the anonymous quota of 100 lookups per 15 minutes.
  if (entries.length > 90) await new Promise((resolve) => setTimeout(resolve, 9_500));
}
console.log(`\n${matches}/${entries.length} keys match`);
process.exit(matches === entries.length ? 0 : 1);
