import Link from "next/link";

export function Wordmark() {
  return (
    <Link className="wordmark" href="/" aria-label="doi2bbt home">
      doi<span>2</span>bbt
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <Wordmark />
      <nav aria-label="Primary navigation">
        <Link href="/docs">API &amp; docs</Link>
        <a
          href="https://github.com/mariusrueve/doi2bbt"
          rel="noreferrer"
          target="_blank"
        >
          GitHub <span aria-hidden="true">↗</span>
        </a>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <Wordmark />
        <p>A small, open tool for researchers and their scripts.</p>
      </div>
      <div className="footer-links">
        <Link href="/docs">Docs</Link>
        <a href="/openapi.json">OpenAPI</a>
        <a href="mailto:contact@doi2bbt.org">Contact</a>
      </div>
      <p className="credits">
        Inspired by{" "}
        <a href="https://www.doi2bib.org" rel="noreferrer" target="_blank">
          doi2bib
        </a>
        . Citation-key behavior is inspired by{" "}
        <a
          href="https://retorque.re/zotero-better-bibtex/"
          rel="noreferrer"
          target="_blank"
        >
          Better BibTeX
        </a>
        . Not affiliated with either project.
      </p>
    </footer>
  );
}
