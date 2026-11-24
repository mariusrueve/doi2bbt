import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../site-chrome";

export const metadata: Metadata = {
  title: "API & docs",
  description:
    "Use doi2bbt from curl, Python, or an agent, and understand its citation-key algorithm.",
  alternates: { canonical: "/docs" },
};

const curlExample = `curl --get 'https://doi2bbt.org/api/v1/bibtex' \\
  --data-urlencode 'id=10.1038/187493a0'`;

const pythonExample = `import requests

response = requests.get(
    "https://doi2bbt.org/api/v1/resolve",
    params={"id": "10.1038/187493a0"},
    timeout=20,
)
response.raise_for_status()
citation = response.json()
print(citation["citation_key"])
print(citation["bibtex"])`;

const agentExample = `GET https://doi2bbt.org/api/v1/resolve?id={url_encoded_identifier}&taken={existing_keys}
Accept: application/json

Use citation_key when citing the work.
Use bibtex when updating a .bib file.
POST [zotero_item] to the Zotero web API to add the work with that key.
If status is 422, report that the record has no associated DOI.

Agent skill: https://doi2bbt.org/skills/doi2bbt/SKILL.md`;

export default function DocsPage() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="docs-main">
        <header className="docs-intro">
          <p className="section-kicker">API version 1</p>
          <h1>One small API, no key required.</h1>
          <p>
            Resolve one scholarly identifier at a time. Responses are CORS
            enabled, cacheable, and limited to 100 conversions per client every
            15 minutes.
          </p>
        </header>

        <div className="docs-layout">
          <aside>
            <p>On this page</p>
            <a href="#endpoints">Endpoints</a>
            <a href="#examples">Examples</a>
            <a href="#algorithm">Citation keys</a>
            <a href="#errors">Errors</a>
            <a href="#privacy">Privacy &amp; credits</a>
          </aside>

          <div className="docs-content">
            <section id="endpoints">
              <h2>Endpoints</h2>
              <div className="endpoint">
                <div>
                  <span className="method">GET</span>
                  <code>/api/v1/bibtex?id=…&amp;taken=…</code>
                </div>
                <p>
                  Raw BibTeX as{" "}
                  <code>application/x-bibtex; charset=utf-8</code>.
                </p>
              </div>
              <div className="endpoint">
                <div>
                  <span className="method">GET</span>
                  <code>/api/v1/resolve?id=…&amp;taken=…</code>
                </div>
                <p>
                  Structured JSON with the normalized input, DOI, citation key,
                  BibTeX, a ready-to-post Zotero item, source URL, and algorithm
                  version.
                </p>
              </div>
              <p>
                The optional <code>taken</code> parameter lists citation keys
                already in your library (comma-separated or repeated, up to
                500). When the generated key is taken, doi2bbt appends Better
                BibTeX’s postfix: <code>a</code>, <code>b</code>, … The
                unsuffixed key is always returned as <code>base_key</code>.
              </p>
              <p>
                Both endpoints also support <code>HEAD</code> and CORS{" "}
                <code>OPTIONS</code>. See the machine-readable{" "}
                <a href="/openapi.json">OpenAPI document</a>.
              </p>
            </section>

            <section id="examples">
              <h2>Examples</h2>
              <h3>curl</h3>
              <pre>
                <code>{curlExample}</code>
              </pre>
              <h3>Python</h3>
              <pre>
                <code>{pythonExample}</code>
              </pre>
              <h3>Agents</h3>
              <pre>
                <code>{agentExample}</code>
              </pre>
            </section>

            <section id="algorithm">
              <h2>Citation keys</h2>
              <p>
                Version <code>bbt-default-v2</code> ports Better BibTeX
                9.0.77’s default formula,{" "}
                <code>auth.lower + shorttitle(3,3) + year</code>, with its
                default preferences. It uses the same title tokenizer,
                transliteration, and stop-word list, and builds the Zotero item
                the way Zotero’s translators do: Crossref’s print date first,
                and the latest-version date for arXiv preprints.
              </p>
              <div className="formula-example">
                <span>Vaswani · “Attention Is All You Need” · 2017</span>
                <strong>vaswaniAttentionAllYou2017</strong>
              </div>
              <p>
                Keys can still differ from Better BibTeX when Zotero stores
                different metadata than the DOI registry, for example after a
                save from a publisher page or a manual edit. Language-specific
                modes other than German, and the optional Chinese and Japanese
                segmentation, are not ported. To guarantee a key, create the
                Zotero item from <code>zotero_item</code>: Better BibTeX keeps a
                citation key that is set when an item is created. Metadata
                corrections upstream may change a key after the 24-hour cache
                expires.
              </p>
              <p>
                doi2bbt changes only the entry key of DOI-provided BibTeX. It is
                not a replacement for Better BibTeX’s full Zotero exporter.
              </p>
            </section>

            <section id="errors">
              <h2>Errors</h2>
              <div className="error-grid">
                <span>
                  <code>400</code> malformed input
                </span>
                <span>
                  <code>404</code> unknown identifier
                </span>
                <span>
                  <code>422</code> valid record, no DOI
                </span>
                <span>
                  <code>429</code> quota exceeded
                </span>
                <span>
                  <code>502</code> unusable upstream response
                </span>
                <span>
                  <code>504</code> upstream timeout
                </span>
              </div>
              <p>
                Errors use <code>application/problem+json</code> and include a
                concise, user-safe <code>detail</code>.
              </p>
            </section>

            <section id="privacy">
              <h2>Privacy, sources, and credits</h2>
              <p>
                There are no accounts, cookies, analytics, saved searches, or
                stored bibliographies. Short-lived quota counters contain only
                a daily salted hash of the connecting address; raw addresses
                are never stored and counters expire within 24 hours.
              </p>
              <p>
                Metadata comes from DOI content negotiation. PMID and PMCID
                lookups use NCBI services; arXiv lookups use the arXiv API and
                fall back to the record&apos;s canonical DataCite DOI. This service
                is not endorsed by or affiliated with DOI Foundation, Crossref,
                DataCite, NCBI, arXiv, Zotero, Better BibTeX, or doi2bib.
                Availability depends on those upstream services.
              </p>
              <p>
                The interaction is intentionally inspired by{" "}
                <a href="https://www.doi2bib.org">doi2bib</a>. Citation-key
                behavior is independently implemented from the documented
                defaults of{" "}
                <a href="https://retorque.re/zotero-better-bibtex/citing/">
                  Better BibTeX
                </a>
                . The source is available under the MIT License on{" "}
                <a href="https://github.com/mariusrueve/doi2bbt">GitHub</a>.
              </p>
            </section>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
