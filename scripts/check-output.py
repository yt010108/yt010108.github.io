"""Validate the published Hugo pages, links, search index, and draft boundaries."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit
import json
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "public"

class Document(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.ids = set()
        self.references = []
        self.h1_count = 0
        self.feed(text)

    def handle_starttag(self, tag, pairs):
        attrs = dict(pairs)
        if "id" in attrs:
            self.ids.add(attrs["id"])
        if tag == "h1":
            self.h1_count += 1
        for attr in ("href", "src"):
            if attr in attrs:
                self.references.append(attrs[attr])

def check():
    config = tomllib.loads((ROOT / "hugo.toml").read_text(encoding="utf-8"))
    base = config["baseURL"].rstrip("/")
    hosts = {urlsplit(base).hostname, "localhost", "127.0.0.1"}
    docs = {}
    errors = []
    references = 0
    for file in PUBLIC.rglob("*.html"):
        text = file.read_text(encoding="utf-8")
        docs[file] = Document(text)
        if "\ufffd" in text or "#ZgotmplZ" in text:
            errors.append(f"{file.relative_to(PUBLIC)}: invalid rendered output")
        if docs[file].h1_count > 1:
            errors.append(f"{file.relative_to(PUBLIC)}: multiple primary headings")
    if not docs:
        errors.append("No HTML output. Run hugo first.")
    for file, doc in docs.items():
        rel = file.relative_to(PUBLIC).as_posix()
        url = base + "/" + (rel[:-10] if rel.endswith("index.html") else rel)
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

    index = json.loads((PUBLIC / "index.json").read_text(encoding="utf-8"))
    search_paths = set()
    for item in index:
        route = urlsplit(item["permalink"]).path
        search_paths.add(route)
        if PUBLIC / route.lstrip("/") / "index.html" not in docs:
            errors.append(f"Search result has no page: {route}")

    published = 0
    draft_count = 0
    for source in (ROOT / "content").rglob("*.md"):
        raw = source.read_text(encoding="utf-8")
        metadata = tomllib.loads(raw.split("+++", 2)[1])
        if source.name == "_index.md":
            continue
        route = "/" + source.relative_to(ROOT / "content").with_suffix("").as_posix() + "/"
        path = PUBLIC / route.lstrip("/") / "index.html"
        if metadata.get("draft"):
            draft_count += 1
            if path.exists() or route in search_paths:
                errors.append(f"Draft is publicly available: {route}")
        elif source.parent.name in ("notes", "posts"):
            published += 1
            if path not in docs or route not in search_paths:
                errors.append(f"Published article is missing from pages/search: {route}")
            elif docs[path].h1_count != 1:
                errors.append(f"Article heading is missing: {route}")
    for path in ("admin/index.html", "admin/config.yml", "rss.xml", "notes/rss.xml", "about/index.html", "search/index.html"):
        if not (PUBLIC / path).is_file():
            errors.append(f"Required output missing: {path}")
    if "name: showToc," not in (PUBLIC / "admin/config.yml").read_text(encoding="utf-8"):
        errors.append("CMS table of contents field is not compatible with PaperMod")

    for error in errors:
        print("ERROR:", error)
    print(f"Checked {len(docs)} HTML pages, {references} internal references, {published} articles, {len(index)} search results, {draft_count} hidden drafts.")
    return bool(errors)

if __name__ == "__main__":
    sys.exit(check())
