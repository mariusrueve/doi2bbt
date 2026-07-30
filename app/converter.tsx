"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type ResolveResult = {
  input: string;
  input_type: "doi" | "pmid" | "pmcid" | "arxiv";
  normalized_id: string;
  doi: string;
  citation_key: string;
  bibtex: string;
  source_url: string;
  key_algorithm: {
    id: string;
    formula: string;
    collision_suffixes: boolean;
  };
};

type Problem = {
  title?: string;
  detail?: string;
  status?: number;
};

const examples = [
  { label: "DOI", value: "10.1038/187493a0" },
  { label: "PMID", value: "14420193" },
  { label: "arXiv", value: "1506.01497" },
];

export function Converter({
  initialIdentifier = "",
}: {
  initialIdentifier?: string;
}) {
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState("");
  const submittedInitial = useRef(false);

  async function resolve(value: string) {
    const clean = value.trim();
    if (!clean || loading) return;

    setLoading(true);
    setError("");
    setResult(null);
    setCopied("");

    try {
      const response = await fetch(
        `/api/v1/resolve?id=${encodeURIComponent(clean)}`,
        { headers: { accept: "application/json" } },
      );
      const body = (await response.json()) as ResolveResult | Problem;
      if (!response.ok) {
        const problem = body as Problem;
        throw new Error(
          problem.detail ??
            problem.title ??
            "The citation could not be resolved.",
        );
      }
      setResult(body as ResolveResult);
      window.history.replaceState(
        null,
        "",
        `/bib/${encodeURIComponent(clean)}`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The citation could not be resolved.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialIdentifier && !submittedInitial.current) {
      submittedInitial.current = true;
      void resolve(initialIdentifier);
    }
    // Run only once for a deep link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIdentifier]);

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1800);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void resolve(identifier);
  }

  return (
    <div className="converter-wrap">
      <form className="converter" onSubmit={submit}>
        <label htmlFor="identifier">DOI, PMID, PMCID, or arXiv ID</label>
        <div className="input-row">
          <input
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            id="identifier"
            name="identifier"
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="10.1038/187493a0"
            spellCheck={false}
            type="text"
            value={identifier}
          />
          <button disabled={loading || !identifier.trim()} type="submit">
            {loading ? "Resolving…" : "Make BibTeX"}
            {!loading && <span aria-hidden="true">→</span>}
          </button>
        </div>
        <div className="examples" aria-label="Try an example">
          <span>Try:</span>
          {examples.map((example) => (
            <button
              key={example.label}
              onClick={() => {
                setIdentifier(example.value);
                void resolve(example.value);
              }}
              type="button"
            >
              {example.label}
            </button>
          ))}
        </div>
      </form>

      <div aria-live="polite">
        {loading && (
          <div className="status-card">
            <span className="loading-mark" aria-hidden="true" />
            Resolving the identifier and building its citation…
          </div>
        )}

        {error && (
          <div className="error-card" role="alert">
            <span>Couldn’t make that citation.</span>
            <p>{error}</p>
          </div>
        )}

        {result && (
          <article className="result-card">
            <div className="result-heading">
              <div>
                <p className="result-label">Citation key</p>
                <h2>{result.citation_key}</h2>
              </div>
              <button
                className="copy-button"
                onClick={() => copy(result.citation_key, "key")}
                type="button"
              >
                {copied === "key" ? "Copied" : "Copy key"}
              </button>
            </div>

            <div className="result-meta">
              <span>{result.input_type.toUpperCase()}</span>
              <a href={result.source_url} rel="noreferrer" target="_blank">
                {result.doi} <span aria-hidden="true">↗</span>
              </a>
            </div>

            <pre tabIndex={0}>
              <code>{result.bibtex}</code>
            </pre>

            <div className="result-actions">
              <button
                className="primary-small"
                onClick={() => copy(result.bibtex, "bibtex")}
                type="button"
              >
                {copied === "bibtex" ? "BibTeX copied" : "Copy BibTeX"}
              </button>
              <button
                className="secondary-small"
                onClick={() => copy(window.location.href, "link")}
                type="button"
              >
                {copied === "link" ? "Link copied" : "Copy result link"}
              </button>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
