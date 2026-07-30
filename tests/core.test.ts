import assert from "node:assert/strict";
import test from "node:test";
import {
  foldToAscii,
  generateCitationKey,
  InputError,
  normalizeIdentifier,
  replaceBibtexKey,
} from "../lib/doi2bbt.ts";

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

test("rejects unsafe, unsupported, and legacy input", () => {
  assert.throws(() => normalizeIdentifier("hello"), InputError);
  assert.throws(() => normalizeIdentifier("0703.1234"), InputError);
  assert.throws(() => normalizeIdentifier("10.1234/a\u0000b"), InputError);
  assert.throws(() => normalizeIdentifier("https://example.com/10.1/x"), InputError);
});

test("folds accents and common non-Latin scripts on a best-effort basis", () => {
  assert.equal(foldToAscii("Rüve Łódź Straße"), "Ruve Lodz Strasse");
  assert.equal(foldToAscii("Петров"), "Petrov");
  assert.equal(foldToAscii("Παπαδόπουλος"), "Papadopoylos");
});

test("generates the frozen default Better BibTeX-style examples", () => {
  assert.equal(
    generateCitationKey(
      {
        author: [{ family: "Maiman" }],
        title: "Stimulated optical radiation in ruby",
        issued: { "date-parts": [[1960]] },
      },
      "10.1038/187493a0",
    ),
    "maimanStimulatedOpticalRadiation1960",
  );
  assert.equal(
    generateCitationKey(
      {
        author: [{ family: "Vaswani" }],
        title: "Attention Is All You Need",
        issued: { "date-parts": [[2017]] },
      },
      "10.48550/arxiv.1706.03762",
    ),
    "vaswaniAttentionAllYou2017",
  );
});

test("uses editor and missing-field fallbacks without collision suffixes", () => {
  assert.equal(
    generateCitationKey(
      {
        editor: [{ family: "García" }],
        title: "The book of examples",
        published: { "date-parts": [[2022]] },
      },
      "10.1234/example",
    ),
    "garciaBookExamples2022",
  );
  assert.match(generateCitationKey({}, "10.1234/example"), /^ref[a-z0-9]{7}$/);
  assert.equal(
    generateCitationKey(
      { author: [{ family: "Doe" }], title: "A useful paper" },
      "10.1234/one",
    ),
    generateCitationKey(
      { author: [{ family: "Doe" }], title: "A useful paper" },
      "10.1234/two",
    ),
  );
});

test("replaces only the leading BibTeX entry key", () => {
  const source = `@article{old-key,
  title = {A title mentioning old-key},
  note = {old-key}
}`;
  const replaced = replaceBibtexKey(source, "doeTitle2024");
  assert.match(replaced, /^@article\{doeTitle2024,/);
  assert.match(replaced, /mentioning old-key/);
  assert.match(replaced, /note = \{old-key\}/);
  assert.throws(() => replaceBibtexKey("not bibtex", "safeKey"));
});
