import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

function assetEnv() {
  return {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  };
}

test("server-renders the finished homepage", async () => {
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    assetEnv(),
    context,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Better citation keys/);
  assert.match(html, /DOI, PMID, PMCID, or arXiv ID/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("serves health, OpenAPI, CORS, and problem details", async () => {
  const health = await worker.fetch(
    new Request("http://localhost/healthz"),
    assetEnv(),
    context,
  );
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    status: "ok",
    service: "doi2bbt",
    version: "1",
  });

  const spec = await worker.fetch(
    new Request("http://localhost/openapi.json"),
    assetEnv(),
    context,
  );
  assert.equal(spec.status, 200);
  assert.equal((await spec.json()).openapi, "3.1.0");

  const options = await worker.fetch(
    new Request("http://localhost/api/v1/resolve", { method: "OPTIONS" }),
    assetEnv(),
    context,
  );
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), "*");

  const invalid = await worker.fetch(
    new Request("http://localhost/api/v1/resolve?id=not-an-id"),
    assetEnv(),
    context,
  );
  assert.equal(invalid.status, 400);
  assert.match(
    invalid.headers.get("content-type") ?? "",
    /^application\/problem\+json/,
  );
});
