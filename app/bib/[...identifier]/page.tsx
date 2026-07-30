import type { Metadata } from "next";
import { Converter } from "../../converter";
import { SiteFooter, SiteHeader } from "../../site-chrome";

export const metadata: Metadata = {
  title: "Resolve a citation",
  robots: { index: false, follow: true },
};

export default async function BibPage({
  params,
}: {
  params: Promise<{ identifier: string[] }>;
}) {
  const { identifier } = await params;
  const value = identifier.join("/");

  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="deep-link-main">
        <section className="hero compact" aria-labelledby="resolve-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <span>Shared citation</span>
            </p>
            <h1 id="resolve-title">Here’s your better BibTeX.</h1>
            <p className="lede">
              This link resolves live metadata and applies doi2bbt’s frozen
              citation-key algorithm.
            </p>
          </div>
          <Converter initialIdentifier={value} />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
