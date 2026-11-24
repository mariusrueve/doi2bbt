/**
 * Port of Better BibTeX 9.0.77's default citation-key formula,
 * `auth.lower + shorttitle(3,3) + year`, with BBT's default preferences.
 *
 * Mirrors content/key-manager/formatter.ts from
 * https://github.com/retorquere/zotero-better-bibtex (MIT) and uses the same
 * tokenizer (compromise), transliteration, and fold-to-ascii versions.
 */
import nlp from "compromise/one";
import foldToAsciiLib from "fold-to-ascii";
import { transliterate as transliterateLib } from "transliteration";

export const KEY_ALGORITHM = {
  id: "bbt-default-v2",
  formula: "auth.lower + shorttitle(3,3) + year",
  better_bibtex_version: "9.0.77",
  collision_suffixes: "with-taken",
} as const;

export type ZoteroCreator = {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  name?: string;
};

export type ZoteroItem = {
  itemType: string;
  title: string;
  creators: ZoteroCreator[];
  date?: string;
  language?: string;
  citationKey?: string;
  [field: string]: unknown;
};

/** Better BibTeX's default `skipWords` preference. */
const SKIP_WORDS = new Set(
  "a,ab,aboard,about,above,across,after,against,al,along,amid,among,an,and,anti,around,as,at,before,behind,below,beneath,beside,besides,between,beyond,but,by,d,da,das,de,del,dell,dello,dei,degli,della,dell,delle,dem,den,der,des,despite,die,do,down,du,during,ein,eine,einem,einen,einer,eines,el,en,et,except,for,from,gli,i,il,in,inside,into,is,l,la,las,le,les,like,lo,los,near,nor,of,off,on,onto,or,over,past,per,plus,round,save,since,so,some,sur,than,the,through,to,toward,towards,un,una,unas,under,underneath,une,unlike,uno,unos,until,up,upon,versus,via,von,while,with,within,without,yet,zu,zum".split(
    ",",
  ),
);

const PUNCT = /\p{Pe}|\p{Pf}|\p{Pi}|\p{Po}|\p{Ps}/gu;
const DASH = /\p{Pd}|─|－|―/gu;
const CJK = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
/** Default `citekeyUnsafeChars` plus U+FFFD and whitespace. */
const UNSAFE = /[\\"#%'(),={}~�\s]/g;

type TransliterateMode = "german" | "minimal";

function modeFor(language: string | undefined): TransliterateMode {
  const tag = (language ?? "").trim().toLowerCase();
  return /^(de|deu|ger|german|deutsch)\b/.test(tag) ? "german" : "minimal";
}

function transliterate(value: string, mode: TransliterateMode): string {
  if (!value) return "";
  let text = value;
  if (mode === "german") {
    const umlauts: Record<string, string> = {
      ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue",
    };
    text = text.normalize("NFC").replace(/[äöüÄÖÜ]/g, (c) => umlauts[c] ?? c);
  }
  return foldToAsciiLib.foldMaintaining(
    transliterateLib(text, { unknown: "�" }),
  );
}

export function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function nopunct(text: string): string {
  return text.replace(DASH, "").replace(PUNCT, "");
}

function split(title: string): string[] {
  type Term = { text: string; post: string };
  const contracted: Term[] = [];
  let tail: Term | undefined;
  const sentences = nlp(title).json() as Array<{ terms: Term[] }>;
  for (const sentence of sentences) {
    sentence.terms.forEach((term, index) => {
      if (index !== 0 && tail && tail.post === "-") {
        tail.text += tail.post + term.text;
        tail.post = term.post;
      } else {
        tail = { text: term.text, post: term.post };
        contracted.push(tail);
      }
    });
  }
  return contracted
    .map((term) => term.text)
    .filter((text) => !SKIP_WORDS.has(text.toLowerCase()));
}

function titleWords(rawTitle: string, mode: TransliterateMode): string[] {
  if (!rawTitle) return [];
  const title = stripHtml(rawTitle).replace(/["]/g, "").replace(/[/:]/g, " ");
  return split(title)
    .map(nopunct)
    .filter(
      (word) =>
        word &&
        !(Array.from(word).length === 1 && !/^\d+$/.test(word) && !CJK.test(word)),
    )
    .filter((word) => !SKIP_WORDS.has(word.toLowerCase()))
    .map((word) => transliterate(word, mode));
}

function shortTitle(item: ZoteroItem, mode: TransliterateMode): string {
  return titleWords(item.title, mode)
    .slice(0, 3)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function firstCreatorName(item: ZoteroItem, mode: TransliterateMode): string {
  const groups: Record<string, string[]> = {
    author: [],
    editor: [],
    translator: [],
    collaborator: [],
  };
  let hasEditor = false;
  let hasSeriesEditor = false;
  for (const creator of item.creators ?? []) {
    const raw = stripHtml(
      (creator.lastName || creator.name || "").replace(/^"(.*)"$/, "$1"),
    );
    const name = transliterate(raw, mode);
    if (!name) continue;
    switch (creator.creatorType) {
      case "editor":
        hasEditor = true;
        groups.editor.push(name);
        break;
      case "seriesEditor":
        if (!hasEditor || hasSeriesEditor) {
          hasSeriesEditor = true;
          groups.editor.push(name);
        }
        break;
      case "translator":
        groups.translator.push(name);
        break;
      case "author":
        groups.author.push(name);
        break;
      default:
        groups.collaborator.push(name);
    }
  }
  for (const kind of ["author", "editor", "translator", "collaborator"]) {
    if (groups[kind].length) return groups[kind][0];
  }
  return "";
}

function yearOf(date: string | undefined): string {
  const match = (date ?? "").match(/\d{4}/);
  return match ? match[0] : "";
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0").slice(0, 7);
}

/** The base key Better BibTeX would generate before collision handling. */
export function generateCitationKey(item: ZoteroItem, fallbackSeed = ""): string {
  const mode = modeFor(item.language);
  const raw =
    firstCreatorName(item, mode).toLowerCase() +
    shortTitle(item, mode) +
    yearOf(item.date);
  const key = transliterate(raw, mode).replace(UNSAFE, "");
  return key || `ref${shortHash(fallbackSeed.toLowerCase())}`;
}

function alphaPostfix(n: number): string {
  let value = n;
  let out = "";
  while (value > 0) {
    value -= 1;
    out = String.fromCharCode(97 + (value % 26)) + out;
    value = Math.floor(value / 26);
  }
  return out;
}

/**
 * Applies Better BibTeX's default postfix (`a`, `b`, …, `z`, `aa`, …) when
 * the key is already used. Comparison is case-insensitive, like BBT's default.
 */
export function disambiguateKey(key: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (value) => value.toLowerCase()));
  if (!used.has(key.toLowerCase())) return key;
  for (let n = 1; ; n += 1) {
    const candidate = key + alphaPostfix(n);
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}
