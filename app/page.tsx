import { Converter } from "./converter";
import { SiteFooter, SiteHeader } from "./site-chrome";

export default function Home() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <span>Identifier in</span>
              <i aria-hidden="true" />
              <span>BibTeX out</span>
            </p>
            <h1 id="hero-title">
              Better citation keys.
              <br />
              One identifier.
            </h1>
            <p className="lede">
              Paste a DOI, PMID, PMCID, or arXiv ID. Get clean BibTeX with a
              predictable Better BibTeX-style key.
            </p>
          </div>
          <Converter />
        </section>

        <section className="trust-strip" aria-label="Product principles">
          <p>
            <span className="trust-number">01</span>
            No account
          </p>
          <p>
            <span className="trust-number">02</span>
            Open source
          </p>
          <p>
            <span className="trust-number">03</span>
            API included
          </p>
        </section>

        <section className="explanation" aria-labelledby="how-title">
          <div>
            <p className="section-kicker">A focused utility</p>
            <h2 id="how-title">From persistent ID to portable citation.</h2>
          </div>
          <div className="explanation-copy">
            <p>
              doi2bbt resolves your identifier to a DOI, asks the DOI registry
              for the citation, then replaces only the BibTeX entry key.
            </p>
            <p>
              The key follows a frozen version of Better BibTeX’s default:
              first author, three significant title words, and year.
            </p>
            <a className="text-link" href="/docs">
              Read the API and algorithm notes <span aria-hidden="true">→</span>
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
