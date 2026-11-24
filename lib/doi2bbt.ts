export type IdentifierType = "doi" | "pmid" | "pmcid" | "arxiv";

export type NormalizedIdentifier = {
  input: string;
  type: IdentifierType;
  normalized: string;
};

const DOI_PATTERN = /^10\.\d{4,9}\/[-._;()/:a-z0-9%]+$/i;
const PMID_PATTERN = /^(?:pmid\s*:\s*)?(\d+)$/i;
const PMCID_PATTERN = /^(?:pmcid?\s*:\s*)?(PMC\d+(?:\.\d+)?)$/i;
const ARXIV_PATTERN =
  /^(?:arxiv\s*:\s*)?(\d{4}\.\d{4,5}(?:v\d+)?)$/i;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new InputError("The identifier contains invalid URL encoding.");
  }
}

function validateModernArxiv(value: string): boolean {
  const base = value.replace(/v\d+$/i, "");
  const [yearMonth] = base.split(".");
  const year = Number(yearMonth.slice(0, 2));
  const month = Number(yearMonth.slice(2));
  return (
    month >= 1 &&
    month <= 12 &&
    (year > 7 || (year === 7 && month >= 4))
  );
}

export function canonicalArxivDoi(value: string): string {
  const normalized = value.trim().replace(/^arxiv\s*:\s*/i, "").toLowerCase();
  const match = normalized.match(ARXIV_PATTERN);
  if (!match || !validateModernArxiv(match[1])) {
    throw new InputError("Use a modern arXiv identifier.");
  }
  return `10.48550/arxiv.${match[1].replace(/v\d+$/i, "")}`;
}

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export function normalizeIdentifier(raw: string): NormalizedIdentifier {
  const input = raw.trim();
  if (!input) throw new InputError("Enter a DOI, PMID, PMCID, or arXiv ID.");
  if (input.length > 512) throw new InputError("The identifier is too long.");
  if (/[\u0000-\u001f\u007f]/.test(input)) {
    throw new InputError("The identifier contains unsafe control characters.");
  }

  let candidate = input;
  if (/^https?:\/\//i.test(candidate)) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new InputError("The identifier URL is malformed.");
    }
    const host = url.hostname.toLowerCase();
    if (host === "doi.org" || host === "dx.doi.org") {
      candidate = safeDecode(url.pathname.replace(/^\/+/, ""));
    } else if (host === "arxiv.org" || host === "www.arxiv.org") {
      const match = url.pathname.match(/^\/(?:abs|pdf)\/([^/?#]+?)(?:\.pdf)?$/i);
      if (!match) throw new InputError("The arXiv URL is malformed.");
      candidate = safeDecode(match[1]);
    } else if (
      host === "pubmed.ncbi.nlm.nih.gov" ||
      host === "www.ncbi.nlm.nih.gov"
    ) {
      const match = url.pathname.match(/\/(?:pubmed\/)?(\d+)\/?$/i);
      if (!match) throw new InputError("The PubMed URL is malformed.");
      candidate = match[1];
    } else if (host === "pmc.ncbi.nlm.nih.gov") {
      const match = url.pathname.match(/\/articles\/(PMC\d+(?:\.\d+)?)\/?$/i);
      if (!match) throw new InputError("The PMC URL is malformed.");
      candidate = match[1];
    } else {
      throw new InputError("Only DOI, PubMed, PMC, and arXiv URLs are supported.");
    }
  }

  candidate = candidate.trim().replace(/^doi\s*:\s*/i, "");
  if (DOI_PATTERN.test(candidate)) {
    return { input, type: "doi", normalized: candidate.toLowerCase() };
  }

  const pmcid = candidate.match(PMCID_PATTERN);
  if (pmcid) {
    return { input, type: "pmcid", normalized: pmcid[1].toUpperCase() };
  }

  const pmid = candidate.match(PMID_PATTERN);
  if (pmid) {
    return { input, type: "pmid", normalized: pmid[1] };
  }

  const arxiv = candidate.match(ARXIV_PATTERN);
  if (arxiv && validateModernArxiv(arxiv[1])) {
    return { input, type: "arxiv", normalized: arxiv[1].toLowerCase() };
  }

  throw new InputError(
    "Use a DOI, numeric PMID, PMCID, or modern arXiv identifier.",
  );
}

export function replaceBibtexKey(bibtex: string, key: string): string {
  const safeKey = key.replace(/[\\"#%'(),={}~\s]/g, "");
  if (!safeKey) throw new Error("The generated citation key is empty.");
  const entry =
    /^(\uFEFF?\s*@[A-Za-z][A-Za-z0-9_-]*\s*[\{\(]\s*)([^,\s]+)(\s*,)/;
  if (!entry.test(bibtex)) {
    throw new Error("The upstream BibTeX entry could not be parsed.");
  }
  return bibtex
    .replace(entry, (_, head: string, _key: string, tail: string) => `${head}${safeKey}${tail}`)
    .trim();
}

export function formatBibtex(bibtex: string): string {
  const source = bibtex.trim().replace(/^\uFEFF/, "");
  const header = source.match(/^@([A-Za-z][A-Za-z0-9_-]*)\s*([\{\(])/);
  if (!header) {
    throw new Error("The upstream BibTeX entry could not be parsed.");
  }

  const entryType = header[1];
  const opening = header[2];
  const closing = opening === "{" ? "}" : ")";
  const parts: string[] = [];
  let partStart = header[0].length;
  let outerDepth = 1;
  let braceDepth = 0;
  let quoted = false;
  let closingIndex = -1;

  for (let index = partStart; index < source.length; index += 1) {
    const character = source[index];

    if (character === "\\") {
      index += 1;
      continue;
    }

    if (opening === "{") {
      if (character === '"' && outerDepth === 1) {
        quoted = !quoted;
      } else if (character === "{") {
        outerDepth += 1;
      } else if (character === "}" && !(quoted && outerDepth === 1)) {
        outerDepth -= 1;
        if (outerDepth === 0) {
          parts.push(source.slice(partStart, index));
          closingIndex = index;
          break;
        }
      } else if (character === "," && outerDepth === 1 && !quoted) {
        parts.push(source.slice(partStart, index));
        partStart = index + 1;
      }
    } else {
      if (character === '"' && outerDepth === 1 && braceDepth === 0) {
        quoted = !quoted;
      } else if (character === "{") {
        braceDepth += 1;
      } else if (character === "}" && braceDepth > 0) {
        braceDepth -= 1;
      } else if (braceDepth === 0 && !quoted) {
        if (character === "(") {
          outerDepth += 1;
        } else if (character === ")") {
          outerDepth -= 1;
          if (outerDepth === 0) {
            parts.push(source.slice(partStart, index));
            closingIndex = index;
            break;
          }
        } else if (character === "," && outerDepth === 1) {
          parts.push(source.slice(partStart, index));
          partStart = index + 1;
        }
      }
    }
  }

  if (
    closingIndex < 0 ||
    braceDepth !== 0 ||
    quoted ||
    source.slice(closingIndex + 1).trim()
  ) {
    throw new Error("The upstream BibTeX entry could not be parsed.");
  }

  while (parts.at(-1)?.trim() === "") parts.pop();
  const key = parts.shift()?.trim();
  if (!key || /[\s,]/.test(key)) {
    throw new Error("The upstream BibTeX entry could not be parsed.");
  }

  const fields = parts.map((part) => {
    const field = part
      .trim()
      .match(/^([A-Za-z][A-Za-z0-9_:-]*)\s*=\s*([\s\S]+)$/);
    if (!field) {
      throw new Error("The upstream BibTeX entry could not be parsed.");
    }
    return `  ${field[1]} = ${field[2].trim()}`;
  });

  return fields.length
    ? `@${entryType}${opening}${key},\n${fields.join(",\n")}\n${closing}`
    : `@${entryType}${opening}${key}${closing}`;
}
