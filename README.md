# doi2bbt

Turn a DOI, PMID, PMCID, or modern arXiv identifier into BibTeX with a
Better BibTeX-style citation key.

doi2bbt is a focused, open-source, no-account webpage and API. It is inspired
by [doi2bib](https://www.doi2bib.org) and independently implements a frozen
version of Better BibTeX's documented default base-key formula:

```text
auth.lower + shorttitle(3,3) + year
```

It is not affiliated with doi2bib, Zotero, or Better BibTeX, and it is not a
replacement for Better BibTeX's full Zotero exporter.

## API

Raw BibTeX:

```sh
curl --get 'https://doi2bbt.org/api/v1/bibtex' \
  --data-urlencode 'id=10.1038/187493a0'
```

Structured JSON:

```sh
curl --get 'https://doi2bbt.org/api/v1/resolve' \
  --data-urlencode 'id=10.1038/187493a0'
```

The API supports `GET`, `HEAD`, and CORS `OPTIONS` without authentication.
Anonymous use is limited to 100 conversions per client every 15 minutes.
See [`/openapi.json`](https://doi2bbt.org/openapi.json) for the full contract.

## Development

Requires Node.js 22.13 or newer.

```sh
npm install
npm run dev
```

Run the test suite and production build:

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run test:contract
```

## Cloudflare deployment

The production service runs directly in the project owner's Cloudflare account.
Cloudflare Workers executes the application, Workers Assets serves the frontend,
and a D1 binding named `DB` stores short-lived rate-limit counters. A
`RATE_LIMIT_SECRET` runtime secret creates daily client-address hashes, and the
Cloudflare Cache API caches resolved citations for 24 hours.

Authenticate once, create the EU-jurisdiction database, and copy the returned
database ID into `wrangler.jsonc`:

```sh
npx wrangler login
npx wrangler d1 create doi2bbt-d1 --jurisdiction=eu
```

Apply the schema and set a randomly generated secret without committing it:

```sh
npm run db:migrate:remote
openssl rand -hex 32 | npx wrangler secret put RATE_LIMIT_SECRET
```

Validate and deploy:

```sh
npm run deploy:check
npm run deploy
DOI2BBT_BASE_URL=https://doi2bbt.<account-subdomain>.workers.dev npm run smoke
```

`wrangler.jsonc` is the source of truth for bindings, observability, and custom
domains. Production changes should be made there rather than only in the
Cloudflare dashboard.

The intended deployment stays on Workers Free. As of July 2026, that plan
includes 100,000 dynamic Worker requests per day, while static asset requests
are free and unlimited. D1 Free includes 5 million rows read per day, 100,000
rows written per day, and 5 GB of storage. Do not enable Workers Paid for this
project without an explicit cost review.

### Rollback

List deployments and roll the Worker back to a known-good version:

```sh
npx wrangler deployments list
npx wrangler rollback <version-id>
```

Worker rollback does not alter the D1 database. Schema changes therefore need
an explicit backwards-compatibility and rollback plan.

## Privacy

doi2bbt has no accounts, cookies, analytics, saved searches, or stored
bibliographies. D1 stores only short-lived counters keyed by a daily salted
HMAC of the connecting address. Raw client addresses are never stored and
counters expire within 24 hours.

## Metadata sources

- DOI content negotiation for CSL JSON and BibTeX
- NCBI ESummary for PMID records
- NCBI PMC ID Converter for PMCID records
- arXiv Atom API for publication DOIs

Valid PMID, PMCID, or arXiv records without an associated DOI return HTTP 422.

## License

[MIT](LICENSE)

Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Please report
security issues using the private process in [SECURITY.md](SECURITY.md).
