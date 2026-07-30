import assert from "node:assert/strict";

const baseUrl = new URL(
  process.env.DOI2BBT_BASE_URL ?? "https://doi2bbt.org",
);
const request = (path, init) => fetch(new URL(path, baseUrl), init);

async function expectOk(path, contentType) {
  const response = await request(path);
  assert.equal(response.status, 200, `${path} returned ${response.status}`);
  assert.match(
    response.headers.get("content-type") ?? "",
    contentType,
    `${path} returned an unexpected content type`,
  );
  return response;
}

const health = await expectOk("/healthz", /^application\/json\b/i);
assert.deepEqual(await health.json(), {
  status: "ok",
  service: "doi2bbt",
  version: "1",
});

const homepage = await expectOk("/", /^text\/html\b/i);
const homepageHtml = await homepage.text();
assert.match(homepageHtml, /Better citation keys/);
assert.match(
  homepageHtml,
  /href="(?:https:\/\/doi2bbt\.org)?\/favicon\.svg"/,
);

await expectOk("/favicon.svg", /^image\/svg\+xml\b/i);
await expectOk("/favicon-32x32.png", /^image\/png\b/i);
await expectOk("/apple-touch-icon.png", /^image\/png\b/i);

const docs = await expectOk("/docs", /^text\/html\b/i);
assert.match(await docs.text(), /API/);

const deepLink = await expectOk(
  "/bib/10.1038%2F187493a0",
  /^text\/html\b/i,
);
assert.match(await deepLink.text(), /doi2bbt/);

const openApi = await expectOk("/openapi.json", /^application\/json\b/i);
assert.equal((await openApi.json()).openapi, "3.1.0");

const resolve = await expectOk(
  "/api/v1/resolve?id=10.1038%2F187493a0",
  /^application\/json\b/i,
);
assert.equal(resolve.headers.get("access-control-allow-origin"), "*");
assert.equal(
  (await resolve.json()).citation_key,
  "maimanStimulatedOpticalRadiation1960",
);

for (const [identifier, inputType] of [
  ["14420193", "pmid"],
  ["PMC3531190.1", "pmcid"],
  ["1207.7214", "arxiv"],
]) {
  const response = await expectOk(
    `/api/v1/resolve?id=${encodeURIComponent(identifier)}`,
    /^application\/json\b/i,
  );
  const payload = await response.json();
  assert.equal(payload.input_type, inputType);
  assert.match(payload.doi, /^10\./);
  assert.ok(payload.citation_key);
}

const arxivWithoutDoi = await request(
  "/api/v1/resolve?id=1506.01497",
);
assert.equal(arxivWithoutDoi.status, 422);
assert.match(
  arxivWithoutDoi.headers.get("content-type") ?? "",
  /^application\/problem\+json\b/i,
);

const bibtex = await request(
  "/api/v1/bibtex?id=10.1038%2F187493a0",
  { method: "HEAD" },
);
assert.equal(bibtex.status, 200);
assert.match(
  bibtex.headers.get("content-type") ?? "",
  /^application\/x-bibtex\b/i,
);

const options = await request("/api/v1/resolve", { method: "OPTIONS" });
assert.equal(options.status, 204);
assert.equal(options.headers.get("access-control-allow-origin"), "*");

const malformed = await request("/api/v1/resolve?id=not-an-id");
assert.equal(malformed.status, 400);
assert.match(
  malformed.headers.get("content-type") ?? "",
  /^application\/problem\+json\b/i,
);

console.log(`doi2bbt smoke checks passed for ${baseUrl.origin}`);
