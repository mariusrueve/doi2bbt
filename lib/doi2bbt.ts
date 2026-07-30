export type IdentifierType = "doi" | "pmid" | "pmcid" | "arxiv";

export type NormalizedIdentifier = {
  input: string;
  type: IdentifierType;
  normalized: string;
};

export type CslName = {
  family?: string;
  given?: string;
  literal?: string;
};

export type CslDate = {
  "date-parts"?: Array<Array<number | string>>;
  raw?: string;
};

export type CslRecord = {
  author?: CslName[];
  editor?: CslName[];
  title?: string | string[];
  issued?: CslDate;
  published?: CslDate;
  created?: CslDate;
  DOI?: string;
  [key: string]: unknown;
};

export const KEY_ALGORITHM = {
  id: "bbt-default-v1",
  formula: "auth.lower + shorttitle(3,3) + year",
  stop_words_revision: "better-bibtex-2026-07-30",
  ascii_folding: "best-effort-v1",
  collision_suffixes: false,
} as const;

const DOI_PATTERN = /^10\.\d{4,9}\/[-._;()/:a-z0-9%]+$/i;
const PMID_PATTERN = /^(?:pmid\s*:\s*)?(\d+)$/i;
const PMCID_PATTERN = /^(?:pmcid?\s*:\s*)?(PMC\d+(?:\.\d+)?)$/i;
const ARXIV_PATTERN =
  /^(?:arxiv\s*:\s*)?(\d{4}\.\d{4,5}(?:v\d+)?)$/i;

const STOP_WORDS = new Set(
  "a,ab,aboard,about,above,across,after,against,al,along,amid,among,an,and,anti,around,as,at,before,behind,below,beneath,beside,besides,between,beyond,but,by,d,da,das,de,del,dell,dello,dei,degli,della,dell,delle,dem,den,der,des,despite,die,do,down,du,during,ein,eine,einem,einen,einer,eines,el,en,et,except,for,from,gli,i,il,in,inside,into,is,l,la,las,le,les,like,lo,los,near,nor,of,off,on,onto,or,over,past,per,plus,round,save,since,so,some,sur,than,the,through,to,toward,towards,un,una,unas,under,underneath,une,unlike,uno,unos,until,up,upon,versus,via,von,while,with,within,without,yet,zu,zum"
    .split(","),
);

const CHAR_FOLD: Record<string, string> = {
  ß: "ss",
  ẞ: "SS",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ø: "o",
  Ø: "O",
  ł: "l",
  Ł: "L",
  đ: "d",
  Đ: "D",
  ð: "d",
  Ð: "D",
  þ: "th",
  Þ: "Th",
  ħ: "h",
  Ħ: "H",
  ı: "i",
  ſ: "s",
};

const CYRILLIC_FOLD: Record<string, string> = {
  А: "A", Б: "B", В: "V", Г: "G", Д: "D", Е: "E", Ё: "E", Ж: "Zh",
  З: "Z", И: "I", Й: "I", К: "K", Л: "L", М: "M", Н: "N", О: "O",
  П: "P", Р: "R", С: "S", Т: "T", У: "U", Ф: "F", Х: "Kh", Ц: "Ts",
  Ч: "Ch", Ш: "Sh", Щ: "Shch", Ъ: "", Ы: "Y", Ь: "", Э: "E", Ю: "Yu",
  Я: "Ya", а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e",
  ж: "zh", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n",
  о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh",
  ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e",
  ю: "yu", я: "ya",
};

const GREEK_FOLD: Record<string, string> = {
  Α: "A", Β: "V", Γ: "G", Δ: "D", Ε: "E", Ζ: "Z", Η: "I", Θ: "Th",
  Ι: "I", Κ: "K", Λ: "L", Μ: "M", Ν: "N", Ξ: "X", Ο: "O", Π: "P",
  Ρ: "R", Σ: "S", Τ: "T", Υ: "Y", Φ: "F", Χ: "Ch", Ψ: "Ps", Ω: "O",
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th",
  ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p",
  ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps",
  ω: "o",
};

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

export function foldToAscii(value: string): string {
  const preFolded = Array.from(value.normalize("NFD"))
    .map(
      (character) =>
        CHAR_FOLD[character] ??
        CYRILLIC_FOLD[character] ??
        GREEK_FOLD[character] ??
        character,
    )
    .join("");
  return preFolded
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .replace(/[^\x00-\x7F]/g, "");
}

function words(value: string): string[] {
  const withoutMarkup = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gi, " ");
  return foldToAscii(withoutMarkup)
    .split(/[\s\u2010-\u2015/]+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean);
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1).toLowerCase() : "";
}

function firstTitle(record: CslRecord): string {
  if (Array.isArray(record.title)) return record.title[0] ?? "";
  return typeof record.title === "string" ? record.title : "";
}

function yearFrom(record: CslRecord): string {
  for (const key of ["issued", "published", "created"] as const) {
    const date = record[key];
    const first = date?.["date-parts"]?.[0]?.[0];
    const match = String(first ?? date?.raw ?? "").match(/\b(\d{4})\b/);
    if (match) return match[1];
  }
  return "";
}

function authorFrom(record: CslRecord): string {
  const creator = record.author?.[0] ?? record.editor?.[0];
  const value = creator?.family ?? creator?.literal ?? creator?.given ?? "";
  return foldToAscii(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shortTitleFrom(record: CslRecord): string {
  const significant = words(firstTitle(record)).filter(
    (word) => !STOP_WORDS.has(word.toLowerCase()),
  );
  return significant.slice(0, 3).map(capitalize).join("");
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0").slice(0, 7);
}

export function generateCitationKey(record: CslRecord, doi: string): string {
  const author = authorFrom(record);
  const title = shortTitleFrom(record);
  const year = yearFrom(record);
  const key = `${author}${title}${year}`.replace(/["#%'(),={}~\\]/g, "");
  return key || `ref${shortHash(doi.toLowerCase())}`;
}

export function replaceBibtexKey(bibtex: string, key: string): string {
  const safeKey = key.replace(/[^A-Za-z0-9_:.+/-]/g, "");
  if (!safeKey) throw new Error("The generated citation key is empty.");
  const entry =
    /^(\uFEFF?\s*@[A-Za-z][A-Za-z0-9_-]*\s*[\{\(]\s*)([^,\s]+)(\s*,)/;
  if (!entry.test(bibtex)) {
    throw new Error("The upstream BibTeX entry could not be parsed.");
  }
  return bibtex.replace(entry, `$1${safeKey}$3`).trim();
}
