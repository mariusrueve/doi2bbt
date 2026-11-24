---
name: doi2bbt
description: Get the Better BibTeX citation key and BibTeX for a paper from its DOI, PMID, PMCID, or arXiv ID, and add the paper to the user's Zotero library with that key. Use when citing a paper in LaTeX/Markdown, when the user asks for a citekey or BibTeX entry, or when a paper should be saved to Zotero.
---

# doi2bbt: Better BibTeX citation keys for agents

doi2bbt.org ports Better BibTeX 9.0.77's default key formula
(`auth.lower + shorttitle(3,3) + year`) and returns BibTeX plus a ready-made
Zotero item. When that item is created through the Zotero web API with its
`citationKey` already set, Better BibTeX on the user's desktop keeps that key,
so the key you cite with is the key the user's Zotero will have.

## Setup (once)

```sh
mkdir -p ~/.claude/skills/doi2bbt/scripts
curl -fsSL https://doi2bbt.org/skills/doi2bbt/SKILL.md -o ~/.claude/skills/doi2bbt/SKILL.md
curl -fsSL https://doi2bbt.org/skills/doi2bbt/scripts/zotero_cite.py -o ~/.claude/skills/doi2bbt/scripts/zotero_cite.py
```

The script needs Python 3.9+ and these environment variables, the same ones
`zotero-cli` (zotero-mcp-server) uses for web API access:

- `ZOTERO_API_KEY`: a key with write access
- `ZOTERO_LIBRARY_ID`: numeric user or group ID
- `ZOTERO_LIBRARY_TYPE`: `user` (default) or `group`

## Get a key and add the paper to Zotero

```sh
python3 ~/.claude/skills/doi2bbt/scripts/zotero_cite.py '10.1038/187493a0'
```

Accepts a DOI, PMID, PMCID, modern arXiv ID, or a doi.org/arxiv.org/PubMed
URL. Options: `--dry-run` (never write), `--tags a,b`, `--collection KEY`
(repeatable).

It prints one JSON object. Act on `status`:

| status | meaning | what to do |
|---|---|---|
| `existing` | The paper is already in Zotero. | Cite with `citation_key`. It is the key Better BibTeX assigned. |
| `created` | The paper was added with `citation_key` set. | Cite with `citation_key`. |
| `would-create` | `--dry-run`: nothing was written. | Cite with `citation_key` only if the user agrees to add the paper later. |
| `pending-key` | The paper is in Zotero, but Better BibTeX has not synced a key yet (the desktop app has not run since it was added). | Use `citation_key` (the predicted key) and tell the user it is unconfirmed. Do not edit the item's citation key: that races Better BibTeX and causes a sync conflict. |
| `error` | See `error`. | Report it. A 422 from doi2bbt means the record has no DOI. |

The output also has `bibtex` (an entry using `citation_key`), `doi`, and
`item_key`.

What it does:
1. Resolves the identifier with `GET https://doi2bbt.org/api/v1/resolve?id=…`.
2. Searches the library for the DOI and, if found, returns that item's
   `citationKey`.
3. Otherwise it collects existing keys that start with the new key (searching
   by first-author surname) and resolves again with `taken=…`. doi2bbt then adds
   Better BibTeX's postfix (`a`, `b`, …) just like Better BibTeX would.
4. POSTs the returned `zotero_item` (with `citationKey`) to
   `https://api.zotero.org/{users|groups}/{id}/items`.

## Rules

- Never change the citation key of an item that already exists in Zotero.
  Only set `citationKey` when creating an item.
- Do not add papers with `zotero-cli add bibtex`: it puts the key into Extra,
  which Better BibTeX ignores. Use this script, or POST `zotero_item` yourself.
- `zotero-cli add doi` works too, but then Better BibTeX picks the key when the
  desktop syncs, and you cannot know it in advance.
- To look up a paper without touching Zotero, call the API directly:
  `curl --get https://doi2bbt.org/api/v1/resolve --data-urlencode 'id=…'`
  (fields: `citation_key`, `base_key`, `bibtex`, `zotero_item`, `doi`). Use
  `/api/v1/bibtex` for the raw entry.
- The API allows 100 lookups per client every 15 minutes. On HTTP 429, wait
  until the `RateLimit-Reset` time.

## Limits

The key matches Better BibTeX with its default formula and settings. It can
differ for items saved from publisher pages whose metadata differs from the DOI
registry, for languages other than English and German, and when the user has
changed their Better BibTeX formula.
