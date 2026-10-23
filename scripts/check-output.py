"""Check rendered routes, anchors, listings, and UTF-8 output without dependencies."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit
import json
import re
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"

class Document(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.ids = set()
        self.references = []
        self.headings = 0
        self.entry_titles = []
        self.in_entry_title = False
        self.feed(text)

    def handle_starttag(self, tag, pairs):
        attrs = dict(pairs)
        if "id" in attrs:
            self.ids.add(attrs["id"])
        if tag == "h1":
            self.headings += 1
        for attr in ("href", "src"):
            if attr in attrs:
                self.references.append(attrs[attr])
        if "release__title" in attrs.get("class", "").split():
            self.in_entry_title = True

    def handle_endtag(self, tag):
        if tag in ("h2", "h3"):
            self.in_entry_title = False

    def handle_data(self, text):
        if self.in_entry_title and text.strip():
            self.entry_titles.append(text.strip())

def check():
    config = tomllib.loads((ROOT / "config.toml").read_text(encoding="utf-8"))
    origin = urlsplit(config["base_url"])
    hosts = {origin.hostname, "localhost", "127.0.0.1"}
    docs = {}
    errors = []
    for file in PUBLIC.rglob("*.html"):
        text = file.read_text(encoding="utf-8")
        docs[file] = Document(text)
        if "\ufffd" in text:
            errors.append(f"{file.relative_to(PUBLIC)}: invalid UTF-8 replacement character")
        if re.search(r"\{[{%]", text):
            errors.append(f"{file.relative_to(PUBLIC)}: unrendered template")
    if not docs:
        errors.append("No rendered HTML files. Run hwaro build first.")
    references = 0
    for file, doc in docs.items():
        rel = file.relative_to(PUBLIC).as_posix()
        url = config["base_url"].rstrip("/") + "/" + re.sub(r"index\.html$", "", rel)
        # The Sveltia CMS admin shell mounts its UI client-side, so its
        # static HTML entrypoint does not contain a document heading.
        # Continue checking its links and other output invariants.
        if rel != "admin/index.html" and doc.headings != 1:
            errors.append(f"{rel}: expected one h1, found {doc.headings}")
        for reference in doc.references:
            if not reference:
                errors.append(f"{rel}: empty URL")
                continue
            target = urlsplit(urljoin(url, reference))
            if target.hostname not in hosts:
                continue
            path = PUBLIC / unquote(target.path).lstrip("/")
            if path.is_dir():
                path /= "index.html"
            references += 1
            if not path.is_file():
                errors.append(f"{rel}: missing {reference}")
            elif target.fragment and path in docs and unquote(target.fragment) not in docs[path].ids:
                errors.append(f"{rel}: missing anchor {reference}")
    for section in ("posts", "notes", "projects"):
        doc = docs.get(PUBLIC / section / "index.html")
        if not doc or not doc.entry_titles:
            errors.append(f"{section}: empty rendered listing")
    search = json.loads((PUBLIC / "search.json").read_text(encoding="utf-8"))
    for item in search:
        path = PUBLIC / item["url"].lstrip("/") / "index.html"
        if path not in docs:
            errors.append(f"Search result has no page: {item['url']}")
    for error in errors:
        print("ERROR:", error)
    print(f"Checked {len(docs)} HTML pages, {references} internal references, {len(search)} search results.")
    return bool(errors)

if __name__ == "__main__":
    sys.exit(check())
