#!/usr/bin/env python3
"""Get the Better BibTeX citation key for a work, adding it to Zotero if needed.

Usage:
  zotero_cite.py IDENTIFIER [--dry-run] [--tags a,b] [--collection KEY]

IDENTIFIER is a DOI, PMID, PMCID, or modern arXiv ID (URLs work too).

Environment:
  ZOTERO_API_KEY       Zotero web API key with write access
  ZOTERO_LIBRARY_ID    numeric user or group ID
  ZOTERO_LIBRARY_TYPE  "user" (default) or "group"
  DOI2BBT_BASE_URL     default https://doi2bbt.org

Prints one JSON object:
  status        "existing" | "created" | "would-create" | "pending-key"
  citation_key  the key to cite with
  item_key      Zotero item key (absent for would-create)
  doi, bibtex

Only the standard library is used.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

USER_AGENT = "doi2bbt-skill/1.0 (+https://doi2bbt.org/skills/doi2bbt/SKILL.md)"


def fail(message: str, code: int = 1) -> None:
    print(json.dumps({"status": "error", "error": message}))
    sys.exit(code)


def request(url: str, *, method: str = "GET", headers: dict | None = None, body: bytes | None = None):
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("User-Agent", USER_AGENT)
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, json.loads(response.read().decode("utf-8") or "null")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        try:
            detail = json.loads(detail).get("detail", detail)
        except (ValueError, AttributeError):
            pass
        fail(f"{method} {url.split('?')[0]} returned {error.code}: {detail}")
    except urllib.error.URLError as error:
        fail(f"{method} {url.split('?')[0]} failed: {error.reason}")


def resolve(base: str, identifier: str, taken: list[str]) -> dict:
    query = [("id", identifier)] + [("taken", key) for key in taken]
    _, payload = request(f"{base}/api/v1/resolve?{urllib.parse.urlencode(query)}")
    return payload


class Zotero:
    def __init__(self) -> None:
        key = os.environ.get("ZOTERO_API_KEY")
        library = os.environ.get("ZOTERO_LIBRARY_ID")
        kind = os.environ.get("ZOTERO_LIBRARY_TYPE", "user").rstrip("s")
        if not key or not library:
            fail("Set ZOTERO_API_KEY and ZOTERO_LIBRARY_ID.")
        self.prefix = f"https://api.zotero.org/{kind}s/{library}"
        self.headers = {"Zotero-API-Key": key, "Zotero-API-Version": "3"}

    def search(self, q: str, qmode: str) -> list[dict]:
        items: list[dict] = []
        start = 0
        while True:
            params = urllib.parse.urlencode(
                {"q": q, "qmode": qmode, "format": "json", "limit": 100, "start": start}
            )
            _, page = request(f"{self.prefix}/items/top?{params}", headers=self.headers)
            items.extend(entry["data"] for entry in page or [])
            if not page or len(page) < 100 or start >= 900:
                return items
            start += 100

    def create(self, item: dict) -> str:
        headers = {
            **self.headers,
            "Content-Type": "application/json",
            "Zotero-Write-Token": uuid.uuid4().hex,
        }
        _, result = request(
            f"{self.prefix}/items",
            method="POST",
            headers=headers,
            body=json.dumps([item]).encode("utf-8"),
        )
        created = (result or {}).get("successful", {}).get("0")
        if not created:
            fail(f"Zotero rejected the item: {json.dumps((result or {}).get('failed'))}")
        return created["key"]


def arxiv_of(doi: str) -> str:
    return doi[len("10.48550/arxiv."):] if doi.startswith("10.48550/arxiv.") else ""


def is_same_work(data: dict, doi: str) -> bool:
    if doi_of(data) == doi:
        return True
    arxiv = arxiv_of(doi)
    return bool(arxiv) and (data.get("archiveID") or "").lower() == f"arxiv:{arxiv}"


def doi_of(data: dict) -> str:
    if data.get("DOI"):
        return data["DOI"].strip().lower()
    for line in (data.get("extra") or "").splitlines():
        if line.lower().startswith("doi:"):
            return line[4:].strip().lower()
    return ""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("identifier")
    parser.add_argument("--dry-run", action="store_true", help="never write to Zotero")
    parser.add_argument("--tags", default="", help="comma-separated tags for a new item")
    parser.add_argument("--collection", action="append", default=[], help="collection key for a new item")
    args = parser.parse_args()

    base = os.environ.get("DOI2BBT_BASE_URL", "https://doi2bbt.org").rstrip("/")
    zotero = Zotero()
    citation = resolve(base, args.identifier, [])
    doi = citation["doi"].lower()

    creators = citation["zotero_item"].get("creators") or []
    surname = (creators[0].get("lastName") or creators[0].get("name") or "") if creators else ""
    by_author = zotero.search(surname, "titleCreatorYear") if surname else []

    # 1. Already in the library? Use the key Better BibTeX assigned.
    #    Zotero's quick search misses some full DOIs, so also try the DOI
    #    suffix and every item by the first author, then match exactly.
    candidates = {}
    for data in [
        *zotero.search(doi, "everything"),
        *zotero.search(doi.split("/", 1)[-1], "everything"),
        *by_author,
    ]:
        candidates[data["key"]] = data
    for data in candidates.values():
        if is_same_work(data, doi):
            key = (data.get("citationKey") or "").strip()
            print(json.dumps({
                "status": "existing" if key else "pending-key",
                "citation_key": key or citation["base_key"],
                "item_key": data["key"],
                "doi": citation["doi"],
                "bibtex": citation["bibtex"] if not key else citation["bibtex"].replace(
                    citation["citation_key"], key, 1),
                **({} if key else {"note": "Better BibTeX has not synced a key for this item yet; citation_key is the predicted key."}),
            }, ensure_ascii=False))
            return

    # 2. Collect existing keys that could collide (same first-author surname).
    base_key = citation["base_key"].lower()
    taken = sorted({
        data["citationKey"]
        for data in by_author
        if (data.get("citationKey") or "").lower().startswith(base_key)
    })
    if taken:
        citation = resolve(base, args.identifier, taken)

    item = dict(citation["zotero_item"])
    item["tags"] = [{"tag": tag.strip()} for tag in args.tags.split(",") if tag.strip()]
    if args.collection:
        item["collections"] = args.collection

    if args.dry_run:
        print(json.dumps({
            "status": "would-create",
            "citation_key": citation["citation_key"],
            "doi": citation["doi"],
            "bibtex": citation["bibtex"],
            "taken": taken,
        }, ensure_ascii=False))
        return

    # 3. Create the item with citationKey set, so Better BibTeX keeps it.
    item_key = zotero.create(item)
    print(json.dumps({
        "status": "created",
        "citation_key": citation["citation_key"],
        "item_key": item_key,
        "doi": citation["doi"],
        "bibtex": citation["bibtex"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
