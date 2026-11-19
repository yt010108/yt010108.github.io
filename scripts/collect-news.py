"""Update the public headline archive from the three publishers' RSS feeds."""

import argparse
import html
import json
import os
import re
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from http.client import HTTPException
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets/security-news.json"
KST = timezone(timedelta(hours=9))
FEEDS = {
    "kisa": "https://www.boho.or.kr/kr/rss.do?bbsId=B0000133",
    "dailysecu": "https://www.dailysecu.com/rss/S1N2.xml",
    "boannews": "https://www.boannews.com/rss/S1N2.xml",
}
CVE = re.compile(r"\bCVE-\d{4}-\d{4,}\b", re.I)
TECHNICAL = re.compile(r"취약점|보안\s*업데이트|긴급\s*패치|제로데이|실제\s*악용")
PATCH_OR_ATTACK = re.compile(r"(?:긴급|즉시|긴급히)\s*(?:보안\s*)?(?:패치|업데이트)|실제\s*공격에(?:서)?\s*(?:악용|사용)|실제\s*악용(?:됐|된|되고|이\s*확인|을\s*확인)")
INCIDENT = re.compile(r"(?:개인|고객|학생|가입자|임직원|계정|신용|정보|데이터|자료).{0,32}(?:유출|탈취)|(?:해킹|침해사고|랜섬웨어).{0,32}(?:신고|확인|중단|피해)")
DOMESTIC = re.compile(r"국내|한국|금융당국|금융감독원|개인정보위|주민등록번호|과학기술정보통신부|교육청|[가-힣]{2,}대학|[가-힣]{2,}대(?:\s|·|,)|코스[피닥]|시청|구청")
ARTICLE_URL = re.compile(r'https?://(?:www\.)?(?:boho\.or\.kr|dailysecu\.com|boannews\.com)/[^\s<>"\']+', re.I)


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "yt010108-security-news/1.0"})
    with urllib.request.urlopen(request, timeout=12) as response:
        data = response.read(4_000_001)
        if len(data) > 4_000_000:
            raise ValueError("response too large")
        return data


def article_link(url):
    parts = urlsplit(html.unescape(url.strip()))
    if parts.scheme not in ("http", "https"):
        return None
    query = parse_qs(parts.query)
    for source, feed in FEEDS.items():
        host = urlsplit(feed).hostname
        if parts.hostname not in (host, host.removeprefix("www.")):
            continue
        if source == "kisa":
            if parts.path != "/kr/bbs/view.do" or query.get("bbsId") != ["B0000133"]:
                continue
            number = query.get("nttId", [""])[0]
            path = "/kr/bbs/view.do?menuNo=205020&bbsId=B0000133&nttId="
        else:
            if parts.path != "/news/articleView.html":
                continue
            number = query.get("idxno", [""])[0]
            path = "/news/articleView.html?idxno="
        if re.fullmatch(r"[0-9]+", number):
            return source, f"{source}-{number}", f"https://{host}{path}{number}"
    return None


class ArticleBody(HTMLParser):
    """Extract editorial text and cited links, excluding navigation and related stories."""

    def __init__(self, source):
        super().__init__()
        self.source = source
        self.container = None
        self.depth = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if not self.depth:
            classes = (attrs.get("class") or "").split()
            if attrs.get("id") == "article-view-content-div" or (self.source == "kisa" and "content_html" in classes):
                self.container = tag
            else:
                return
        if tag == self.container:
            self.depth += 1
        if tag == "a" and attrs.get("href"):
            self.parts.append(attrs["href"])

    def handle_endtag(self, tag):
        if self.depth and tag == self.container:
            self.depth -= 1

    def handle_data(self, data):
        if self.depth:
            self.parts.append(data)


def references(text):
    keys = {match.upper() for match in CVE.findall(text)}
    for raw in ARTICLE_URL.findall(html.unescape(text)):
        linked = article_link(raw.rstrip(").,"))
        if linked:
            keys.add(linked[1])
    return keys


def published_date(raw):
    raw = raw.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        return date.fromisoformat(raw).isoformat()
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        parsed = parsedate_to_datetime(raw)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=KST)
    return parsed.astimezone(KST).isoformat(timespec="seconds")


def clean(value):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", value)).split())


def read_source(source, previous, last_success, today):
    rows = []
    channel = ET.fromstring(fetch(FEEDS[source])).find("./channel")
    if channel is None:
        raise ValueError("Invalid RSS channel")
    for item in channel.findall("./item"):
        title = clean(item.findtext("title") or "")
        link = article_link(item.findtext("link") or "")
        if not title or not link or link[0] != source:
            continue
        try:
            published = published_date(item.findtext("pubDate") or "")
        except (TypeError, ValueError, OverflowError):
            continue
        _, key, url = link
        old = previous.get(key, {})
        description = item.findtext("description") or ""
        summary = clean(description)
        eligible = source == "kisa" or bool(PATCH_OR_ATTACK.search(title + " " + summary) or (INCIDENT.search(title) and DOMESTIC.search(title + " " + summary)))
        technical = bool(TECHNICAL.search(title))
        if not eligible and not technical:
            continue
        refs = references(title + " " + description)
        same_revision = old and old["title"] == title and old["published"] == published
        if same_revision:
            refs.update(old.get("refs", []))
        elif technical:
            try:
                document = fetch(url).decode("utf-8", errors="replace")
                body = ArticleBody(source)
                body.feed(document)
                refs.update(references(" ".join(body.parts)))
            except (OSError, HTTPException, ValueError):
                pass  # The feed is usable even when an article page is unavailable.
        day = published[:10]
        if last_success and day >= last_success[:10]:
            day = today
        rows.append({"id": key, "source": source, "title": title, "url": url,
                     "published": published, "day": old.get("day", day), "eligible": eligible,
                     "refs": sorted(refs - {key})})
    return rows


def write_snapshot(path, text):
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as tmp:
        try:
            tmp.write(text)
            tmp.close()
            os.replace(tmp.name, path)
        finally:
            Path(tmp.name).unlink(missing_ok=True)


def merge_archives(seed, published):
    if (not isinstance(published, dict) or published.get("version") != 1
            or not isinstance(published.get("articles"), list) or not isinstance(published.get("checked"), dict)):
        raise ValueError("Invalid published news archive")
    articles = {}
    checked = {}
    published_days = {a["id"]: a["day"] for a in published["articles"]}
    for source in FEEDS:
        # A partial collection can leave each publisher at a different timestamp.
        for archive in sorted((seed, published), key=lambda a: a.get("checked", {}).get(source, "")):
            stamp = archive.get("checked", {}).get(source)
            if stamp:
                checked[source] = stamp
            for article in archive.get("articles", []):
                if article["source"] == source:
                    key = article["id"]
                    articles[key] = {**article, "day": published_days.get(key, article["day"])}
    complete = max(seed.get("lastComplete") or "", published.get("lastComplete") or "")
    return {"version": 1, "articles": list(articles.values()), "checked": checked, "lastComplete": complete or None}


def update(published_archive=None):
    previous = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {}
    if previous and previous.get("version") != 1:
        raise ValueError("Unrecognized news archive version")
    if published_archive is not None and published_archive.resolve() != OUTPUT.resolve():
        previous = merge_archives(previous, json.loads(published_archive.read_text(encoding="utf-8")))
    articles = {article["id"]: article for article in previous.get("articles", [])}
    checked = dict(previous.get("checked", {}))
    failed = []
    run_day = datetime.now(KST).date().isoformat()
    with ThreadPoolExecutor(max_workers=3) as pool:
        jobs = {key: pool.submit(read_source, key, dict(articles), checked.get(key), run_day) for key in FEEDS}
        for source, job in jobs.items():
            try:
                rows = job.result()
            except (OSError, HTTPException, ValueError, ET.ParseError) as error:
                print(f"{source}: {error}", file=sys.stderr)
                failed.append(source)
                continue
            for row in rows:
                articles[row["id"]] = row
            checked[source] = datetime.now(KST).isoformat(timespec="seconds")
            print(f"{source}: {len(rows)} items")
    if len(failed) == len(FEEDS) and not articles:
        raise RuntimeError("No publisher responded. No archive was written.")
    result = {"version": 1, "lastComplete": previous.get("lastComplete") if failed else datetime.now(KST).isoformat(timespec="seconds"),
              "checked": checked, "failed": failed,
              "articles": sorted(articles.values(), key=lambda row: (row["published"], row["id"]), reverse=True)}
    text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    write_snapshot(OUTPUT, text)
    preview = ROOT / os.environ.get("SITE_OUTPUT", "_site") / "assets" / OUTPUT.name
    if preview.parent.is_dir() and preview.resolve() != OUTPUT.resolve():
        write_snapshot(preview, text)
    print(f"{len(articles)} unique articles in {OUTPUT.relative_to(ROOT)}")
    if published_archive is not None and failed:
        print("::warning::News feeds unavailable: " + ", ".join(failed) + ". Serving the available archive.")
        return 0
    return 1 if failed else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--published-archive", type=Path, help="Merge the previous Pages snapshot and keep available results when a feed is down.")
    args = parser.parse_args()
    # OS-owned lock is released even if a collection process exits unexpectedly.
    with (ROOT / ".news-update.lock").open("a+b") as lock:
        if os.name == "nt":
            import msvcrt
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        sys.exit(update(args.published_archive))
