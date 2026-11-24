import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  disambiguateKey,
  generateCitationKey,
  type ZoteroItem,
} from "../lib/citekey.ts";
import {
  canonicalArxivDoi,
  formatBibtex,
  InputError,
  normalizeIdentifier,
  replaceBibtexKey,
} from "../lib/doi2bbt.ts";
import {
  itemFromArxiv,
  itemFromCrossref,
  parseArxivAtom,
} from "../lib/zotero-item.ts";

const libraryFixture = JSON.parse(
  readFileSync(new URL("./fixtures/bbt-library.json", import.meta.url), "utf8"),
) as Array<{ expected: string; DOI: string; item: ZoteroItem }>;

const item = (fields: Partial<ZoteroItem>): ZoteroItem => ({
  itemType: "journalArticle",
  title: "",
  creators: [],
  ...fields,
});

test("normalizes DOI variants", () => {
  assert.deepEqual(normalizeIdentifier("doi:10.1038/187493A0"), {
    input: "doi:10.1038/187493A0",
    type: "doi",
    normalized: "10.1038/187493a0",
  });
  assert.equal(
    normalizeIdentifier("https://doi.org/10.1109%2F5.771073").normalized,
    "10.1109/5.771073",
  );
});

test("normalizes PubMed, PMC, and modern arXiv identifiers", () => {
  assert.equal(normalizeIdentifier("PMID: 14420193").type, "pmid");
  assert.equal(normalizeIdentifier("PMC123456.2").type, "pmcid");
  assert.deepEqual(normalizeIdentifier("arXiv:1706.03762v7"), {
    input: "arXiv:1706.03762v7",
    type: "arxiv",
    normalized: "1706.03762v7",
  });
});

test("constructs canonical DataCite DOIs for modern arXiv identifiers", () => {
  assert.equal(
    canonicalArxivDoi("1506.01497"),
    "10.48550/arxiv.1506.01497",
  );
  assert.equal(
    canonicalArxivDoi("arXiv:1706.03762v7"),
    "10.48550/arxiv.1706.03762",
  );
  assert.throws(() => canonicalArxivDoi("0703.1234"), InputError);
});

test("rejects unsafe, unsupported, and legacy input", () => {
  assert.throws(() => normalizeIdentifier("hello"), InputError);
  assert.throws(() => normalizeIdentifier("0703.1234"), InputError);
  assert.throws(() => normalizeIdentifier("10.1234/a\u0000b"), InputError);
  assert.throws(() => normalizeIdentifier("https://example.com/10.1/x"), InputError);
});

test("matches keys Better BibTeX 9.0.77 generated in a real library", () => {
  assert.ok(libraryFixture.length >= 10);
  for (const entry of libraryFixture) {
    assert.equal(generateCitationKey(entry.item, entry.DOI), entry.expected);
  }
});

test("follows Better BibTeX title tokenization rules", () => {
  const key = (title: string) =>
    generateCitationKey(
      item({
        title,
        creators: [{ creatorType: "author", firstName: "A", lastName: "Doe" }],
        date: "2024",
      }),
    );
  // Hyphenated words stay joined; existing capitals are kept.
  assert.equal(key("DeepChem-DEL: An Open-Source Framework"), "doeDeepChemDELOpenSourceFramework2024");
  // Single letters are dropped; symbols survive, punctuation does not.
  assert.equal(key("BALLROOM A and S–A Benchmark"), "doeBALLROOMSABenchmark2024");
  assert.equal(key("Pro$^2$ Agent: Scientific Problem"), "doePro$^2$AgentScientific2024");
  assert.equal(key("You Don't Need Long Context"), "doeYouDontNeed2024");
  assert.equal(key("<i>In vivo</i> imaging of the brain"), "doeVivoImagingBrain2024");
});

test("transliterates names and uses German mode for German items", () => {
  const creators = [{ creatorType: "author", firstName: "S.", lastName: "Hönig" }];
  assert.equal(
    generateCitationKey(item({ creators, title: "Über Größe", date: "2020" })),
    "honigUberGrosse2020",
  );
  assert.equal(
    generateCitationKey(
      item({ creators, title: "Über Größe", date: "2020", language: "de" }),
    ),
    "hoenigUeberGroesse2020",
  );
  assert.equal(
    generateCitationKey(
      item({
        creators: [{ creatorType: "author", firstName: "J.", lastName: "Smith-Jones" }],
        title: "Results",
        date: "2001",
      }),
    ),
    "smith-jonesResults2001",
  );
});

test("falls back from authors to editors and to a stable hash", () => {
  assert.equal(
    generateCitationKey(
      item({
        itemType: "book",
        creators: [{ creatorType: "editor", lastName: "García", firstName: "M." }],
        title: "The book of examples",
        date: "2022",
      }),
    ),
    "garciaBookExamples2022",
  );
  assert.match(generateCitationKey(item({}), "10.1234/example"), /^ref[a-z0-9]{7}$/);
});

test("adds Better BibTeX postfixes only for taken keys", () => {
  assert.equal(disambiguateKey("doeTitle2024", []), "doeTitle2024");
  assert.equal(disambiguateKey("doeTitle2024", ["DOETITLE2024"]), "doeTitle2024a");
  assert.equal(
    disambiguateKey("doeTitle2024", ["doeTitle2024", "doeTitle2024a"]),
    "doeTitle2024b",
  );
  const many = ["k", ...Array.from({ length: 26 }, (_, i) => `k${String.fromCharCode(97 + i)}`)];
  assert.equal(disambiguateKey("k", many), "kaa");
});

test("maps Crossref works like Zotero's Crossref REST translator", () => {
  const mapped = itemFromCrossref({
    type: "journal-article",
    title: ["Topological Similarity Search in Large Combinatorial Fragment Spaces"],
    author: [
      { given: "Louis", family: "Bellmann" },
      { name: "The Consortium" },
    ],
    issued: { "date-parts": [[2020, 10, 21]] },
    "published-print": { "date-parts": [[2021, 1, 25]] },
    "container-title": ["Journal of Chemical Information and Modeling"],
    "short-container-title": ["J. Chem. Inf. Model."],
    volume: "61",
    issue: "1",
    page: "238-251",
    DOI: "10.1021/acs.jcim.0c00850",
    ISSN: ["1549-9596", "1549-960X"],
    event: { name: "ignored for journals" },
  });
  assert.equal(mapped.itemType, "journalArticle");
  assert.equal(mapped.date, "2021-01-25");
  assert.equal(mapped.publicationTitle, "Journal of Chemical Information and Modeling");
  assert.equal(mapped.ISSN, "1549-9596, 1549-960X");
  assert.equal(mapped.conferenceName, undefined);
  assert.deepEqual(mapped.creators, [
    { creatorType: "author", firstName: "Louis", lastName: "Bellmann" },
    { creatorType: "author", name: "The Consortium" },
  ]);
  assert.equal(
    generateCitationKey(mapped),
    "bellmannTopologicalSimilaritySearch2021",
  );

  const multiline = itemFromCrossref({
    type: "journal-article",
    title: ["DeepChem-DEL: An\nOpen-Source Framework for Reproducible\nDEL Modeling"],
    author: [{ given: "Aryan Amit", family: "Barsainyan" }],
    issued: { "date-parts": [[2026, 11, 19]] },
  });
  assert.equal(
    multiline.title,
    "DeepChem-DEL: An Open-Source Framework for Reproducible DEL Modeling",
  );
  assert.equal(
    generateCitationKey(multiline),
    "barsainyanDeepChemDELOpenSourceFramework2026",
  );

  const withSubtitle = itemFromCrossref({
    type: "book-chapter",
    title: ["Main"],
    subtitle: ["A subtitle"],
    author: [{ given: "ADA", family: "LOVELACE" }],
    issued: { "date-parts": [[1843, 9]] },
  });
  assert.equal(withSubtitle.itemType, "bookSection");
  assert.equal(withSubtitle.title, "Main: A subtitle");
  assert.equal(withSubtitle.date, "09/1843");
  assert.deepEqual(withSubtitle.creators[0], {
    creatorType: "bookAuthor",
    firstName: "Ada",
    lastName: "Lovelace",
  });
});

test("maps arXiv entries like Zotero's arXiv translator", () => {
  const entry = parseArxivAtom(`<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <updated>2026-11-24T00:00:00Z</updated>
  <entry>
    <id>http://arxiv.org/abs/2306.03530v4</id>
    <updated>2024-11-19T17:41:00Z</updated>
    <published>2023-06-06T09:26:43Z</published>
    <title>RLtools: A Fast, Portable Deep
      Reinforcement Learning Library for Continuous Control</title>
    <summary>Deep RL &amp; more.</summary>
    <author><name>Jonas Eschmann</name></author>
    <author><name>Giuseppe Loianno</name></author>
  </entry>
</feed>`);
  assert.ok(entry);
  const mapped = itemFromArxiv(entry);
  assert.equal(mapped.itemType, "preprint");
  assert.equal(mapped.date, "2024-11-19");
  assert.equal(mapped.archiveID, "arXiv:2306.03530");
  assert.equal(mapped.DOI, "10.48550/arXiv.2306.03530");
  assert.equal(mapped.abstractNote, "Deep RL & more.");
  assert.equal(generateCitationKey(mapped), "eschmannRLtoolsFastPortable2024");
  assert.equal(parseArxivAtom("<feed></feed>"), undefined);
});

test("replaces only the leading BibTeX entry key", () => {
  const source = `@article{old-key,
  title = {A title mentioning old-key},
  note = {old-key}
}`;
  const replaced = replaceBibtexKey(source, "doeTitle2024");
  assert.match(replaced, /^@article\{doeTitle2024,/);
  assert.match(
    replaceBibtexKey(source, "chenPro$^2$Agent$1"),
    /^@article\{chenPro\$\^2\$Agent\$1,/,
  );
  assert.match(replaced, /mentioning old-key/);
  assert.match(replaced, /note = \{old-key\}/);
  assert.throws(() => replaceBibtexKey("not bibtex", "safeKey"));
});

test("formats compact BibTeX as an indented multiline entry", () => {
  const source =
    "@article{maimanStimulatedOpticalRadiation1960, title={Stimulated Optical Radiation in Ruby}, volume={187}, ISSN={1476-4687}, url={http://dx.doi.org/10.1038/187493a0}, DOI={10.1038/187493a0}, number={4736}, journal={Nature}, publisher={Springer Science and Business Media LLC}, author={MAIMAN, T. H.}, year={1960}, month=Aug, pages={493–494} }";

  assert.equal(
    formatBibtex(source),
    `@article{maimanStimulatedOpticalRadiation1960,
  title = {Stimulated Optical Radiation in Ruby},
  volume = {187},
  ISSN = {1476-4687},
  url = {http://dx.doi.org/10.1038/187493a0},
  DOI = {10.1038/187493a0},
  number = {4736},
  journal = {Nature},
  publisher = {Springer Science and Business Media LLC},
  author = {MAIMAN, T. H.},
  year = {1960},
  month = Aug,
  pages = {493–494}
}`,
  );
});

test("preserves commas inside braced and quoted BibTeX values", () => {
  assert.equal(
    formatBibtex(
      '@article(old, title="One, {Two}", author={Doe, Jane}, month=jan,)',
    ),
    `@article(old,
  title = "One, {Two}",
  author = {Doe, Jane},
  month = jan
)`,
  );
  assert.throws(() => formatBibtex("@article{broken, title={Missing brace}"));
});
