/**
 * Builds Zotero item JSON the way Zotero's own translators would, so the
 * citation key is computed from the same metadata Better BibTeX sees.
 *
 * - Crossref DOIs follow Zotero's "Crossref REST" translator.
 * - arXiv preprints follow Zotero's arXiv translator (latest-version date).
 * - Other DOIs fall back to CSL JSON from doi.org.
 */
import { stripHtml, type ZoteroCreator, type ZoteroItem } from "./citekey";

/** Fields Zotero accepts per item type (subset we populate). */
const FIELDS: Record<string, readonly string[]> = {
  journalArticle: ["title", "abstractNote", "publicationTitle", "publisher", "place", "date", "volume", "issue", "pages", "journalAbbreviation", "DOI", "ISSN", "url", "language", "citationKey", "rights", "libraryCatalog", "extra"],
  preprint: ["title", "abstractNote", "repository", "archiveID", "place", "date", "DOI", "url", "language", "citationKey", "rights", "libraryCatalog", "extra"],
  conferencePaper: ["title", "abstractNote", "proceedingsTitle", "conferenceName", "publisher", "place", "date", "volume", "issue", "pages", "DOI", "ISBN", "ISSN", "url", "language", "citationKey", "rights", "libraryCatalog", "extra"],
  bookSection: ["title", "abstractNote", "bookTitle", "volume", "edition", "date", "publisher", "place", "pages", "ISBN", "DOI", "ISSN", "url", "language", "citationKey", "rights", "libraryCatalog", "extra"],
  book: ["title", "abstractNote", "series", "volume", "edition", "date", "publisher", "place", "ISBN", "DOI", "ISSN", "url", "language", "citationKey", "rights", "libraryCatalog", "extra"],
  report: ["title", "abstractNote", "institution", "place", "date", "seriesTitle", "pages", "DOI", "ISBN", "ISSN", "url", "language", "citationKey", "rights", "libraryCatalog", "extra"],
  thesis: ["title", "abstractNote", "thesisType", "university", "place", "date", "DOI", "ISBN", "ISSN", "url", "language", "citationKey", "rights", "libraryCatalog", "extra"],
  dataset: ["title", "abstractNote", "date", "repository", "DOI", "url", "language", "citationKey", "rights", "libraryCatalog", "extra"],
  standard: ["title", "abstractNote", "publisher", "place", "date", "DOI", "url", "language", "citationKey", "rights", "libraryCatalog", "extra"],
  manuscript: ["title", "abstractNote", "type", "place", "date", "DOI", "url", "language", "citationKey", "rights", "libraryCatalog", "extra"],
  blogPost: ["title", "abstractNote", "blogTitle", "date", "DOI", "url", "language", "citationKey", "rights", "extra"],
  document: ["title", "abstractNote", "publisher", "date", "DOI", "url", "language", "citationKey", "rights", "libraryCatalog", "extra"],
};

function finalize(
  itemType: string,
  creators: ZoteroCreator[],
  fields: Record<string, unknown>,
): ZoteroItem {
  const allowed = FIELDS[itemType] ?? FIELDS.document;
  const item: ZoteroItem = { itemType, title: "", creators };
  for (const field of allowed) {
    const value = fields[field];
    if (typeof value === "string" && value.trim()) item[field] = value.trim();
  }
  item.title ||= "[No title found]";
  return item;
}

/** Zotero's capitalizeName: title-case names that arrive in all caps. */
function capitalizeName(value: string | undefined): string {
  if (!value) return "";
  if (value.toUpperCase() !== value) return value;
  return value
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{Ll})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

function removeUnsupportedMarkup(text: string): string {
  const supported = ["i", "b", "sub", "sup", "span", "sc"];
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<(\/?)(\w+)[^<>]*>/gi, (_, close: string, name: string) => {
      const tag = name.toLowerCase();
      if (supported.includes(tag)) return `<${close}${tag}>`;
      if (tag === "scp") {
        return close ? "</span>" : '<span style="font-variant:small-caps;">';
      }
      return "";
    });
}

/**
 * Zotero's Crossref REST translator deletes newlines, which glues words
 * together ("An\nOpen" -> "AnOpen"). Items saved from publisher pages get
 * normal spacing, so we collapse newlines to one space instead.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/[ \t]*\r?\n[ \t]*/g, " ")
    .replace(/&quot;|&lt;|&gt;|&amp;/g, (m) =>
      ({ "&quot;": '"', "&lt;": "<", "&gt;": ">", "&amp;": "&" })[m] ?? m,
    );
}

type DateParts = { "date-parts"?: Array<Array<number | string | null>> };

function crossrefDate(value: DateParts | undefined): string | undefined {
  const [year, month, day] = value?.["date-parts"]?.[0] ?? [];
  if (!year) return undefined;
  if (!month) return String(year);
  const mm = String(month).padStart(2, "0");
  return day ? `${year}-${mm}-${String(day).padStart(2, "0")}` : `${mm}/${year}`;
}

type CrossrefName = { given?: string; family?: string; name?: string };

export type CrossrefWork = {
  type?: string;
  subtype?: string;
  title?: string[];
  subtitle?: string[];
  author?: CrossrefName[];
  editor?: CrossrefName[];
  chair?: CrossrefName[];
  translator?: CrossrefName[];
  "container-title"?: string[];
  "short-container-title"?: string[];
  "group-title"?: string;
  "published-print"?: DateParts;
  issued?: DateParts;
  approved?: DateParts;
  degree?: string[];
  abstract?: string;
  page?: string;
  "article-number"?: string;
  ISBN?: string[];
  ISSN?: string[];
  issue?: string;
  volume?: string;
  language?: string;
  "edition-number"?: string;
  publisher?: string;
  "publisher-location"?: string;
  event?: { name?: string; location?: string };
  institution?: Array<{ name?: string; place?: string[] }>;
  resource?: { primary?: { URL?: string } };
  license?: Array<{ URL?: string }>;
  DOI?: string;
};

function crossrefItemType(work: CrossrefWork): string {
  const type = work.type ?? "";
  if (["journal", "journal-article", "journal-volume", "journal-issue"].includes(type)) return "journalArticle";
  if (["report", "report-series", "report-component"].includes(type)) return "report";
  if (["book", "book-series", "book-set", "book-track", "monograph", "reference-book", "edited-book"].includes(type)) return "book";
  if (["book-chapter", "book-part", "book-section", "reference-entry"].includes(type)) return "bookSection";
  if (type === "other" && work.ISBN && work["container-title"]) return "bookSection";
  if (type === "standard") return "standard";
  if (["dataset", "database"].includes(type)) return "dataset";
  if (["proceedings", "proceedings-article", "proceedings-series"].includes(type)) return "conferencePaper";
  if (type === "dissertation") return "thesis";
  if (type === "posted-content") return work.subtype === "preprint" ? "preprint" : "blogPost";
  if (type === "peer-review") return "manuscript";
  return "document";
}

/** Mirrors Zotero's "Crossref REST" translator. */
export function itemFromCrossref(work: CrossrefWork): ZoteroItem {
  const itemType = crossrefItemType(work);
  const override: Record<string, string> =
    itemType === "bookSection" ? { author: "bookAuthor" } : {};

  const creators: ZoteroCreator[] = [];
  for (const role of ["author", "editor", "chair", "translator"] as const) {
    const creatorType =
      override[role] ??
      (role === "chair" ? "contributor" : role);
    for (const person of work[role] ?? []) {
      if (person.name) {
        creators.push({ creatorType, name: person.name });
      } else {
        const firstName = capitalizeName(person.given);
        const lastName = capitalizeName(person.family);
        creators.push(
          firstName
            ? { creatorType, firstName, lastName }
            : { creatorType, name: lastName },
        );
      }
    }
  }
  if (itemType === "manuscript" && !work.author) {
    creators.push({ creatorType: "author", name: "Anonymous Reviewer" });
  }

  const fields: Record<string, string | undefined> = {
    abstractNote: work.abstract && removeUnsupportedMarkup(work.abstract),
    pages: work.page || work["article-number"],
    ISBN: work.ISBN?.join(", "),
    ISSN: work.ISSN?.join(", "),
    issue: work.issue,
    volume: work.volume,
    language: work.language,
    edition: work["edition-number"],
    publisher: work.publisher,
    institution: work.publisher,
    university: work.publisher,
    conferenceName: work.event?.name,
    DOI: work.DOI,
    url: work.resource?.primary?.URL,
    rights: work.license?.[0]?.URL,
    libraryCatalog: "Crossref",
  };

  if (itemType === "preprint") fields.repository = work["group-title"];
  if (itemType === "thesis") {
    fields.date = crossrefDate(work.approved);
    fields.thesisType = work.degree?.[0]?.replace(/\(.+\)/, "");
  }
  if (itemType === "manuscript") fields.type = "peer review";
  if (itemType === "blogPost") fields.blogTitle = work.institution?.[0]?.name;

  const container = work["container-title"]?.[0];
  if (itemType === "bookSection" && work.type === "other") {
    const titles = work["container-title"] ?? [];
    if (titles.length >= 2) {
      fields.seriesTitle = titles[0];
      fields.bookTitle = titles[1];
    } else {
      fields.bookTitle = titles[0];
    }
  } else if (container) {
    const target =
      itemType === "journalArticle" ? "publicationTitle"
      : itemType === "conferencePaper" ? "proceedingsTitle"
      : itemType === "book" ? "series"
      : itemType === "bookSection" ? "bookTitle"
      : "seriesTitle";
    fields[target] = container;
  }
  const short = work["short-container-title"]?.[0];
  if (short && short !== container) fields.journalAbbreviation = short;

  fields.place =
    work.event?.location ??
    (work.institution?.[0]?.place?.join(", ") || work["publisher-location"]);

  const printed = crossrefDate(work["published-print"]);
  const issued = crossrefDate(work.issued);
  if (printed) fields.date = printed;
  else if (issued) fields.date = issued;

  let title = work.title?.[0] ?? "";
  const subtitle = work.subtitle?.[0];
  if (title && subtitle && !title.toLowerCase().includes(subtitle.toLowerCase())) {
    if (!title.endsWith(":")) title += ":";
    title += ` ${subtitle}`;
  }
  fields.title = title ? removeUnsupportedMarkup(title) : "";

  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== "string") continue;
    let text = value;
    if (/[\u007F-\u009F]/.test(text)) {
      try {
        text = decodeURIComponent(escape(text));
      } catch {
        text = text.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
      }
    }
    fields[key] = decodeEntities(text);
  }

  return finalize(itemType, creators, fields);
}

export type ArxivEntry = {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  updated: string;
  published: string;
  doi?: string;
};

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function tag(xml: string, name: string): string | undefined {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return match ? decodeXml(match[1]).replace(/\s+/g, " ").trim() : undefined;
}

/** Parses the first <entry> of an arXiv Atom API response. */
export function parseArxivAtom(xml: string): ArxivEntry | undefined {
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/i)?.[1];
  if (!entry) return undefined;
  const id = tag(entry, "id") ?? "";
  const title = tag(entry, "title") ?? "";
  if (!id || !title || /^error$/i.test(title)) return undefined;
  const authors = Array.from(
    entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi),
    (m) => decodeXml(m[1]).replace(/\s+/g, " ").trim(),
  );
  return {
    id,
    title,
    summary: tag(entry, "summary") ?? "",
    authors,
    updated: tag(entry, "updated") ?? "",
    published: tag(entry, "published") ?? "",
    doi: tag(entry, "arxiv:doi"),
  };
}

/** Zotero's cleanAuthor for "First Middle Last" strings. */
function splitName(name: string, creatorType: string): ZoteroCreator {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { creatorType, name: parts[0] };
  const lastName = parts.pop()!;
  return { creatorType, firstName: parts.join(" "), lastName };
}

/** Mirrors Zotero's arXiv translator for preprints without a journal DOI. */
export function itemFromArxiv(entry: ArxivEntry): ZoteroItem {
  const arxivId = entry.id.replace(/^https?:\/\/arxiv\.org\/abs\//i, "").replace(/v\d+$/i, "");
  return finalize(
    "preprint",
    entry.authors.map((name) => splitName(name, "author")),
    {
      title: entry.title,
      abstractNote: entry.summary,
      date: (entry.updated || entry.published).slice(0, 10),
      repository: "arXiv",
      archiveID: `arXiv:${arxivId}`,
      DOI: `10.48550/arXiv.${arxivId}`,
      url: `http://arxiv.org/abs/${arxivId}`,
      libraryCatalog: "arXiv.org",
    },
  );
}

type CslName = { family?: string; given?: string; literal?: string };
export type CslRecord = {
  type?: string;
  title?: string | string[];
  author?: CslName[];
  editor?: CslName[];
  issued?: DateParts & { raw?: string };
  published?: DateParts;
  "container-title"?: string | string[];
  publisher?: string;
  volume?: string | number;
  issue?: string | number;
  page?: string;
  abstract?: string;
  language?: string;
  ISSN?: string | string[];
  ISBN?: string | string[];
  DOI?: string;
  URL?: string;
  [key: string]: unknown;
};

const CSL_TYPES: Record<string, string> = {
  "article-journal": "journalArticle",
  "journal-article": "journalArticle",
  "paper-conference": "conferencePaper",
  "proceedings-article": "conferencePaper",
  book: "book",
  chapter: "bookSection",
  "book-chapter": "bookSection",
  report: "report",
  thesis: "thesis",
  dataset: "dataset",
  article: "preprint",
  "posted-content": "preprint",
  standard: "standard",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Fallback for non-Crossref DOIs (DataCite, mEDRA, …) using doi.org CSL JSON. */
export function itemFromCsl(record: CslRecord): ZoteroItem {
  const itemType = CSL_TYPES[record.type ?? ""] ?? "document";
  const creators: ZoteroCreator[] = [];
  for (const role of ["author", "editor"] as const) {
    for (const person of record[role] ?? []) {
      if (person.family) {
        creators.push(
          person.given
            ? { creatorType: role, firstName: person.given, lastName: person.family }
            : { creatorType: role, name: person.family },
        );
      } else if (person.literal) {
        creators.push({ creatorType: role, name: person.literal });
      }
    }
  }
  const container = first(record["container-title"]);
  const containerField =
    itemType === "journalArticle" ? "publicationTitle"
    : itemType === "conferencePaper" ? "proceedingsTitle"
    : itemType === "bookSection" ? "bookTitle"
    : itemType === "preprint" || itemType === "dataset" ? "repository"
    : "seriesTitle";
  return finalize(itemType, creators, {
    title: stripHtml(first(record.title) ?? ""),
    abstractNote: record.abstract,
    date:
      crossrefDate(record.issued) ??
      crossrefDate(record.published) ??
      record.issued?.raw,
    [containerField]: container,
    publisher: record.publisher,
    volume: record.volume === undefined ? undefined : String(record.volume),
    issue: record.issue === undefined ? undefined : String(record.issue),
    pages: record.page,
    language: record.language,
    ISSN: Array.isArray(record.ISSN) ? record.ISSN.join(", ") : record.ISSN,
    ISBN: Array.isArray(record.ISBN) ? record.ISBN.join(", ") : record.ISBN,
    DOI: record.DOI,
    url: record.URL,
  });
}
