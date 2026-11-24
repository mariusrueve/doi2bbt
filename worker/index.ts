/** Cloudflare Worker entry point for doi2bbt. */
import handler from "vinext/server/app-router-entry";
import {
  disambiguateKey,
  generateCitationKey,
  KEY_ALGORITHM,
  type ZoteroItem,
} from "../lib/citekey";
import {
  canonicalArxivDoi,
  formatBibtex,
  InputError,
  normalizeIdentifier,
  replaceBibtexKey,
  type NormalizedIdentifier,
} from "../lib/doi2bbt";
import {
  itemFromArxiv,
  itemFromCrossref,
  itemFromCsl,
  parseArxivAtom,
  type ArxivEntry,
  type CrossrefWork,
  type CslRecord,
} from "../lib/zotero-item";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  RATE_LIMIT_SECRET?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type ResolvePayload = {
  input: string;
  input_type: NormalizedIdentifier["type"];
  normalized_id: string;
  doi: string;
  citation_key: string;
  base_key: string;
  bibtex: string;
  zotero_item: ZoteroItem;
  source_url: string;
  key_algorithm: typeof KEY_ALGORITHM;
};

const MAX_TAKEN_KEYS = 500;

type RateLimit = {
  limit: number;
  remaining: number;
  reset: number;
  allowed: boolean;
};

const QUOTA = 100;
const WINDOW_MS = 15 * 60 * 1000;
const CACHE_SECONDS = 24 * 60 * 60;
const CACHE_VERSION = "v3";
const NCBI_EMAIL = "contact@doi2bbt.org";
const UPSTREAM_TIMEOUT_MS = 12_000;

class HttpProblem extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail: string,
  ) {
    super(detail);
  }
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function problemResponse(problem: HttpProblem, request: Request): Response {
  const body = JSON.stringify({
    type: `https://doi2bbt.org/docs#errors`,
    title: problem.title,
    status: problem.status,
    detail: problem.detail,
    instance: new URL(request.url).pathname,
  });
  return new Response(request.method === "HEAD" ? null : body, {
    status: problem.status,
    headers: {
      ...corsHeaders(),
      "Cache-Control": "no-store",
      "Content-Type": "application/problem+json; charset=utf-8",
    },
  });
}

function encodeDoi(doi: string): string {
  return doi.split("/").map(encodeURIComponent).join("/");
}

async function fetchUpstream(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent":
          "doi2bbt/1.0 (https://doi2bbt.org; mailto:contact@doi2bbt.org)",
        ...init.headers,
      },
    });
    if (response.status === 404) {
      throw new HttpProblem(
        404,
        "Identifier not found",
        "No matching scholarly record was found.",
      );
    }
    if (!response.ok) {
      throw new HttpProblem(
        502,
        "Upstream service error",
        "A metadata provider returned an unusable response. Try again shortly.",
      );
    }
    return response;
  } catch (error) {
    if (error instanceof HttpProblem) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new HttpProblem(
        504,
        "Upstream timeout",
        "A metadata provider took too long to respond. Try again shortly.",
      );
    }
    throw new HttpProblem(
      502,
      "Upstream service error",
      "A metadata provider could not be reached. Try again shortly.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function noDoi(type: string): never {
  throw new HttpProblem(
    422,
    "No associated DOI",
    `This ${type} record is valid, but it has no associated DOI.`,
  );
}

async function doiForIdentifier(identifier: NormalizedIdentifier): Promise<string> {
  if (identifier.type === "doi") return identifier.normalized;

  if (identifier.type === "pmid") {
    const url = new URL(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
    );
    url.search = new URLSearchParams({
      db: "pubmed",
      id: identifier.normalized,
      retmode: "json",
      tool: "doi2bbt",
      email: NCBI_EMAIL,
    }).toString();
    const response = await fetchUpstream(url.toString());
    const payload = (await response.json()) as {
      result?: Record<string, unknown> & { uids?: string[] };
    };
    const uid = payload.result?.uids?.[0];
    const record = uid ? payload.result?.[uid] as {
      articleids?: Array<{ idtype?: string; value?: string }>;
      elocationid?: string;
    } : undefined;
    if (!uid || !record) {
      throw new HttpProblem(
        404,
        "Identifier not found",
        "No matching PubMed record was found.",
      );
    }
    const doi =
      record.articleids?.find((id) => id.idtype?.toLowerCase() === "doi")
        ?.value ?? record.elocationid?.match(/^doi:\s*(.+)$/i)?.[1];
    return doi?.trim().toLowerCase() || noDoi("PubMed");
  }

  if (identifier.type === "pmcid") {
    const url = new URL(
      "https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/",
    );
    url.search = new URLSearchParams({
      ids: identifier.normalized,
      format: "json",
      versions: "yes",
      showaiid: "yes",
      tool: "doi2bbt",
      email: NCBI_EMAIL,
    }).toString();
    const response = await fetchUpstream(url.toString());
    const payload = (await response.json()) as {
      records?: Array<{
        doi?: string;
        status?: string;
        error?: string;
        versions?: Array<{ doi?: string; pmcid?: string }>;
      }>;
    };
    const record = payload.records?.[0];
    if (!record || record.status === "error" || record.error) {
      throw new HttpProblem(
        404,
        "Identifier not found",
        "No matching PMC record was found.",
      );
    }
    const versionDoi = record.versions?.find(
      (version) =>
        version.pmcid?.toLowerCase() === identifier.normalized.toLowerCase(),
    )?.doi;
    return (versionDoi ?? record.doi)?.trim().toLowerCase() || noDoi("PMC");
  }

  throw new Error("arXiv identifiers are resolved by resolveFresh.");
}

async function fetchArxiv(id: string): Promise<ArxivEntry> {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("id_list", id.replace(/v\d+$/i, ""));
  const response = await fetchUpstream(url.toString(), {
    headers: { Accept: "application/atom+xml" },
  });
  const xml = await response.text();
  const entry = /<opensearch:totalResults[^>]*>\s*0\s*</i.test(xml)
    ? undefined
    : parseArxivAtom(xml);
  if (!entry) {
    throw new HttpProblem(
      404,
      "Identifier not found",
      "No matching arXiv record was found.",
    );
  }
  return entry;
}

const ARXIV_DOI = /^10\.48550\/arxiv\.(.+)$/i;

/**
 * Builds the Zotero item the way Zotero's translators would: arXiv preprints
 * from the arXiv API, Crossref DOIs from the Crossref REST API, anything else
 * from doi.org CSL JSON.
 */
async function zoteroItemFor(
  doi: string,
  arxiv?: ArxivEntry,
): Promise<ZoteroItem> {
  // An arXiv ID with a published DOI resolves as that publication.
  if (arxiv && !arxiv.doi) return itemFromArxiv(arxiv);
  const arxivId = doi.match(ARXIV_DOI)?.[1];
  if (arxivId) {
    try {
      return itemFromArxiv(await fetchArxiv(arxivId));
    } catch {
      // Fall back to the DataCite record below.
    }
  }

  if (!ARXIV_DOI.test(doi)) {
    try {
      const response = await fetchUpstream(
        `https://api.crossref.org/works/${encodeDoi(doi)}`,
        { headers: { Accept: "application/json" } },
      );
      const payload = (await response.json()) as { message?: CrossrefWork };
      if (payload.message) return itemFromCrossref(payload.message);
    } catch {
      // Not a Crossref DOI, or Crossref is unavailable: use doi.org CSL JSON.
    }
  }

  const response = await fetchUpstream(`https://doi.org/${encodeDoi(doi)}`, {
    headers: { Accept: "application/vnd.citationstyles.csl+json" },
  });
  try {
    return itemFromCsl((await response.json()) as CslRecord);
  } catch {
    throw new HttpProblem(
      502,
      "Invalid metadata",
      "The DOI provider returned metadata that could not be read.",
    );
  }
}

async function resolveFresh(
  identifier: NormalizedIdentifier,
): Promise<ResolvePayload> {
  const arxiv =
    identifier.type === "arxiv"
      ? await fetchArxiv(identifier.normalized)
      : undefined;
  const doi = arxiv
    ? (arxiv.doi?.trim().toLowerCase() ?? canonicalArxivDoi(identifier.normalized))
    : await doiForIdentifier(identifier);
  const doiUrl = `https://doi.org/${encodeDoi(doi)}`;
  const [item, upstreamBibtex] = await Promise.all([
    zoteroItemFor(doi, arxiv),
    fetchUpstream(doiUrl, {
      headers: { Accept: "application/x-bibtex" },
    }).then((response) => response.text()),
  ]);

  const citationKey = generateCitationKey(item, doi);
  let bibtex: string;
  try {
    bibtex = formatBibtex(replaceBibtexKey(upstreamBibtex, citationKey));
  } catch {
    throw new HttpProblem(
      502,
      "Invalid BibTeX",
      "The DOI provider returned BibTeX that could not be read safely.",
    );
  }

  return {
    input: identifier.input,
    input_type: identifier.type,
    normalized_id: identifier.normalized,
    doi,
    citation_key: citationKey,
    base_key: citationKey,
    bibtex,
    zotero_item: { ...item, citationKey },
    source_url: doiUrl,
    key_algorithm: KEY_ALGORITHM,
  };
}

function parseTaken(url: URL): string[] {
  const keys = url.searchParams
    .getAll("taken")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  if (keys.length > MAX_TAKEN_KEYS || keys.some((key) => key.length > 200)) {
    throw new InputError(
      `Pass at most ${MAX_TAKEN_KEYS} taken keys of up to 200 characters each.`,
    );
  }
  return keys;
}

/** Adds Better BibTeX's collision postfix when the base key is taken. */
function withTakenKeys(payload: ResolvePayload, taken: string[]): ResolvePayload {
  if (!taken.length) return payload;
  const key = disambiguateKey(payload.base_key, taken);
  if (key === payload.citation_key) return payload;
  return {
    ...payload,
    citation_key: key,
    bibtex: replaceBibtexKey(payload.bibtex, key),
    zotero_item: { ...payload.zotero_item, citationKey: key },
  };
}

async function cachedResolve(
  request: Request,
  identifier: NormalizedIdentifier,
  ctx: ExecutionContext,
): Promise<ResolvePayload> {
  const cacheUrl = new URL(request.url);
  cacheUrl.pathname = `/__doi2bbt-cache/${CACHE_VERSION}/${identifier.type}/${encodeURIComponent(identifier.normalized)}`;
  cacheUrl.search = "";
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  try {
    const edgeCache = (caches as unknown as { default: Cache }).default;
    const cached = await edgeCache.match(cacheKey);
    if (cached) return (await cached.json()) as ResolvePayload;
  } catch {
    // Cache API may not be available in local or test runtimes.
  }

  const payload = await resolveFresh(identifier);
  const cacheResponse = new Response(JSON.stringify(payload), {
    headers: {
      "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
      "Content-Type": "application/json",
    },
  });
  try {
    const edgeCache = (caches as unknown as { default: Cache }).default;
    ctx.waitUntil(edgeCache.put(cacheKey, cacheResponse));
  } catch {
    // Resolution is still valid if edge caching is temporarily unavailable.
  }
  return payload;
}

let schemaReady: Promise<void> | undefined;

function ensureRateLimitSchema(db: D1Database): Promise<void> {
  schemaReady ??= db
    .batch([
      db.prepare(`
        CREATE TABLE IF NOT EXISTS rate_limits (
          client_hash TEXT NOT NULL,
          window_start INTEGER NOT NULL,
          count INTEGER NOT NULL DEFAULT 1,
          expires_at INTEGER NOT NULL,
          PRIMARY KEY (client_hash, window_start)
        )
      `),
      db.prepare(`
        CREATE INDEX IF NOT EXISTS rate_limits_expires_at_idx
        ON rate_limits (expires_at)
      `),
    ])
    .then(() => undefined);
  return schemaReady!;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function clientHash(
  request: Request,
  secret: string,
  now: number,
): Promise<string> {
  const address =
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const day = new Date(now).toISOString().slice(0, 10);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${day}|${address}`),
  );
  return bytesToHex(digest).slice(0, 40);
}

async function applyRateLimit(request: Request, env: Env): Promise<RateLimit> {
  if (!env.DB) {
    throw new HttpProblem(
      502,
      "Quota service unavailable",
      "The anonymous quota service is temporarily unavailable.",
    );
  }
  await ensureRateLimitSchema(env.DB);
  const now = Date.now();
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const reset = Math.floor((windowStart + WINDOW_MS) / 1000);
  const hostname = new URL(request.url).hostname;
  const isLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1";
  const secret =
    env.RATE_LIMIT_SECRET ??
    (isLocal ? "doi2bbt-local-development" : undefined);
  if (!secret) {
    throw new HttpProblem(
      502,
      "Quota service unavailable",
      "The anonymous quota service is temporarily unavailable.",
    );
  }
  const hash = await clientHash(request, secret, now);
  const row = await env.DB.prepare(
    `
      INSERT INTO rate_limits (client_hash, window_start, count, expires_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT (client_hash, window_start)
      DO UPDATE SET count = count + 1
      RETURNING count
    `,
  )
    .bind(hash, windowStart, now + 24 * 60 * 60 * 1000)
    .first<{ count: number }>();
  const count = row?.count ?? QUOTA + 1;

  if (Math.random() < 0.02) {
    env.DB.prepare("DELETE FROM rate_limits WHERE expires_at <= ?")
      .bind(now)
      .run()
      .catch(() => undefined);
  }

  return {
    limit: QUOTA,
    remaining: Math.max(0, QUOTA - count),
    reset,
    allowed: count <= QUOTA,
  };
}

function rateHeaders(rate: RateLimit): Record<string, string> {
  return {
    "RateLimit-Limit": String(rate.limit),
    "RateLimit-Remaining": String(rate.remaining),
    "RateLimit-Reset": String(rate.reset),
  };
}

const openApi = {
  openapi: "3.1.0",
  info: {
    title: "doi2bbt API",
    version: "1.1.0",
    description:
      "Resolve DOI, PMID, PMCID, and modern arXiv identifiers to BibTeX, a Zotero item, and the citation key Better BibTeX 9.0.77 would generate with its default formula.",
    license: {
      name: "MIT",
      identifier: "MIT",
    },
  },
  servers: [{ url: "https://doi2bbt.org" }],
  paths: {
    "/api/v1/resolve": {
      get: {
        summary: "Resolve an identifier to structured citation data",
        operationId: "resolveCitation",
        parameters: [
          { $ref: "#/components/parameters/Id" },
          { $ref: "#/components/parameters/Taken" },
        ],
        responses: {
          "200": {
            description: "Resolved citation",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ResolvedCitation" },
              },
            },
          },
          "400": { $ref: "#/components/responses/Problem" },
          "404": { $ref: "#/components/responses/Problem" },
          "422": { $ref: "#/components/responses/Problem" },
          "429": { $ref: "#/components/responses/Problem" },
          "502": { $ref: "#/components/responses/Problem" },
          "504": { $ref: "#/components/responses/Problem" },
        },
      },
    },
    "/api/v1/bibtex": {
      get: {
        summary: "Resolve an identifier to raw BibTeX",
        operationId: "resolveBibtex",
        parameters: [
          { $ref: "#/components/parameters/Id" },
          { $ref: "#/components/parameters/Taken" },
        ],
        responses: {
          "200": {
            description: "BibTeX with a Better BibTeX-style key",
            content: {
              "application/x-bibtex": { schema: { type: "string" } },
            },
          },
          "400": { $ref: "#/components/responses/Problem" },
          "404": { $ref: "#/components/responses/Problem" },
          "422": { $ref: "#/components/responses/Problem" },
          "429": { $ref: "#/components/responses/Problem" },
          "502": { $ref: "#/components/responses/Problem" },
          "504": { $ref: "#/components/responses/Problem" },
        },
      },
    },
  },
  components: {
    parameters: {
      Id: {
        name: "id",
        in: "query",
        required: true,
        schema: { type: "string", maxLength: 512 },
      },
      Taken: {
        name: "taken",
        in: "query",
        required: false,
        description:
          "Citation keys already in the library (comma-separated or repeated, at most 500). Only keys that start with base_key matter.",
        schema: { type: "string" },
        style: "form",
        explode: true,
      },
    },
    schemas: {
      ResolvedCitation: {
        type: "object",
        required: [
          "input",
          "input_type",
          "normalized_id",
          "doi",
          "citation_key",
          "base_key",
          "bibtex",
          "zotero_item",
          "source_url",
          "key_algorithm",
        ],
        properties: {
          input: { type: "string" },
          input_type: { enum: ["doi", "pmid", "pmcid", "arxiv"] },
          normalized_id: { type: "string" },
          doi: { type: "string" },
          citation_key: {
            type: "string",
            description:
              "The key to use: base_key plus a Better BibTeX postfix (a, b, …) when base_key is in `taken`.",
          },
          base_key: {
            type: "string",
            description: "The key before collision handling.",
          },
          bibtex: { type: "string" },
          zotero_item: {
            type: "object",
            description:
              "Zotero web API item JSON with citationKey set. POST it as a one-element array to /users/{id}/items so Better BibTeX keeps the key.",
            required: ["itemType", "title", "creators", "citationKey"],
            additionalProperties: true,
          },
          source_url: { type: "string", format: "uri" },
          key_algorithm: {
            type: "object",
            properties: {
              id: { const: "bbt-default-v2" },
              formula: {
                const: "auth.lower + shorttitle(3,3) + year",
              },
              better_bibtex_version: { type: "string" },
              collision_suffixes: { const: "with-taken" },
            },
          },
        },
      },
      Problem: {
        type: "object",
        required: ["type", "title", "status", "detail"],
        properties: {
          type: { type: "string", format: "uri" },
          title: { type: "string" },
          status: { type: "integer" },
          detail: { type: "string" },
          instance: { type: "string" },
        },
      },
    },
    responses: {
      Problem: {
        description: "Problem details",
        content: {
          "application/problem+json": {
            schema: { $ref: "#/components/schemas/Problem" },
          },
        },
      },
    },
  },
};

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (
      (url.hostname === "doi2bbt.org" ||
        url.hostname === "www.doi2bbt.org") &&
      (url.protocol !== "https:" || url.hostname === "www.doi2bbt.org")
    ) {
      url.protocol = "https:";
      url.hostname = "doi2bbt.org";
      return Response.redirect(url.toString(), 308);
    }

    if (url.pathname === "/healthz") {
      return new Response(
        request.method === "HEAD"
          ? null
          : JSON.stringify({ status: "ok", service: "doi2bbt", version: "1" }),
        {
          status: 200,
          headers: {
            ...corsHeaders(),
            "Cache-Control": "no-store",
            "Content-Type": "application/json; charset=utf-8",
          },
        },
      );
    }

    if (url.pathname === "/openapi.json") {
      return new Response(
        request.method === "HEAD" ? null : JSON.stringify(openApi, null, 2),
        {
          status: 200,
          headers: {
            ...corsHeaders(),
            "Cache-Control": "public, max-age=3600",
            "Content-Type": "application/json; charset=utf-8",
          },
        },
      );
    }

    const isResolve = url.pathname === "/api/v1/resolve";
    const isBibtex = url.pathname === "/api/v1/bibtex";
    if (isResolve || isBibtex) {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return problemResponse(
          new HttpProblem(
            405,
            "Method not allowed",
            "Use GET, HEAD, or OPTIONS for this endpoint.",
          ),
          request,
        );
      }

      try {
        const rawIdentifier = url.searchParams.get("id") ?? "";
        const identifier = normalizeIdentifier(rawIdentifier);
        const taken = parseTaken(url);
        const rate = await applyRateLimit(request, env);
        if (!rate.allowed) {
          const response = problemResponse(
            new HttpProblem(
              429,
              "Quota exceeded",
              "This client has used 100 conversions in 15 minutes. Try again after the reset time.",
            ),
            request,
          );
          Object.entries({
            ...rateHeaders(rate),
            "Retry-After": String(Math.max(1, rate.reset - Math.floor(Date.now() / 1000))),
          }).forEach(([key, value]) => response.headers.set(key, value));
          return response;
        }

        const payload = withTakenKeys(
          await cachedResolve(request, identifier, ctx),
          taken,
        );
        const body = isBibtex ? payload.bibtex : JSON.stringify(payload, null, 2);
        return new Response(request.method === "HEAD" ? null : body, {
          status: 200,
          headers: {
            ...corsHeaders(),
            ...rateHeaders(rate),
            "Cache-Control": `public, max-age=3600, s-maxage=${CACHE_SECONDS}`,
            "Content-Type": isBibtex
              ? "application/x-bibtex; charset=utf-8"
              : "application/json; charset=utf-8",
          },
        });
      } catch (error) {
        if (error instanceof InputError) {
          return problemResponse(
            new HttpProblem(400, "Malformed identifier", error.message),
            request,
          );
        }
        if (error instanceof HttpProblem) {
          return problemResponse(error, request);
        }
        return problemResponse(
          new HttpProblem(
            502,
            "Resolution failed",
            "The citation could not be resolved safely. Try again shortly.",
          ),
          request,
        );
      }
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
