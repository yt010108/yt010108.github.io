"""The public PIPC results board. Store downloaded bytes without converting them."""
import hashlib
import re
import time
from html import unescape
from http.client import HTTPException
from http.cookiejar import CookieJar
from urllib.error import URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener

from lxml import html

HOST = "https://pipc.go.kr"
BBS = "/np/cop/bbs/"
BOARD = {"bbsId": "BS258", "mCode": "C010040000"}
MAX_TOTAL = 50 * 1024 * 1024


def article_url(notice_id):
    return HOST + BBS + "selectBoardArticle.do?" + urlencode({**BOARD, "nttId": notice_id})


def clean(text):
    return " ".join(text.split())


class Board:
    def __init__(self):
        self.http = build_opener(HTTPCookieProcessor(CookieJar()))
        self.http.addheaders = [
            ("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"),
            ("Accept", "text/html,application/xhtml+xml,*/*"),
            ("Accept-Language", "ko-KR,ko;q=0.9"),
        ]

    def get(self, url, limit, referer=None):
        request = Request(url, headers={"Referer": referer} if referer else {})
        for attempt in range(3):
            try:
                with self.http.open(request, timeout=30) as response:
                    if urlsplit(response.url).hostname not in ("pipc.go.kr", "www.pipc.go.kr"):
                        raise ValueError("Unexpected download host")
                    data = response.read(limit + 1)
                    if len(data) > limit or not data:
                        raise ValueError("Empty or oversized response")
                    return data
            except (OSError, HTTPException, URLError):
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)

    def listing(self):
        found = []
        page = 1
        while True:
            url = HOST + BBS + "selectBoardList.do?" + urlencode({**BOARD, "pageIndex": page})
            root = html.fromstring(self.get(url, 3_000_000).decode("utf-8-sig"))
            summary = next((re.fullmatch(r"전체\s*([\d,]+)\s*건\s*·\s*현재페이지\s*(\d+)\s*/\s*(\d+)", clean(p.text_content()))
                            for p in root.xpath("//p[contains(.,'현재페이지')]")), None)
            if not summary or int(summary[2]) != page:
                raise ValueError("Cannot verify board pagination")
            total, pages = int(summary[1].replace(",", "")), int(summary[3])
            for link in root.xpath("//tr/td//a[contains(@href,'selectBoardArticle.do')]"):
                query = parse_qs(urlsplit(link.get("href")).query)
                notice_id = query.get("nttId", [""])[0]
                if query.get("bbsId") != ["BS258"] or not re.fullmatch(r"[0-9]+", notice_id):
                    raise ValueError("Unexpected notice link")
                found.append(notice_id)
            if page >= pages:
                break
            page += 1
        if len(found) != total or len(set(found)) != total:
            raise ValueError("Board count changed or a page is missing; retry the scan")
        return list(reversed(found))

    def download_notice(self, notice_id, folder):
        url = article_url(notice_id)
        root = html.fromstring(self.get(url, 3_000_000).decode("utf-8-sig"))
        table, = root.xpath("//table[.//th[normalize-space(.)='공표상태']]")
        fields = {clean(t.text_content()): clean(t.getnext().text_content())
                  for t in table.xpath(".//tr/th") if clean(t.text_content()) != "첨부파일 목록"}
        if not all(fields.get(k) for k in ("제목", "작성부서", "작성자", "작성일", "공표상태", "공표마감일")):
            raise ValueError("Incomplete notice metadata")
        body, = table.xpath(".//td[contains(concat(' ',normalize-space(@class),' '),' tbl_cnts ')]")
        buttons = table.xpath(".//a[contains(concat(' ',normalize-space(@class),' '),' downBtn ')]")
        declared = table.xpath(".//input[@name='fileListCnt']/@value")
        if not buttons or declared != [str(len(buttons))]:
            raise ValueError("Cannot verify the original attachment list")
        files = []
        remaining = MAX_TOTAL
        for i, button in enumerate(buttons):
            action = re.fullmatch(r"(?:javascript:)?fn_egov_downFile\(\s*'(FILE_\d+)'\s*,\s*'(\d+)'\s*,\s*'([A-Za-z0-9]+)'\s*\);?", button.get("onclick", "").strip())
            if not action:
                raise ValueError("Unrecognized download button")
            key, serial, ext = action.groups()
            name = (button.get("alt") or "").strip()
            if not name.lower().endswith("." + ext.lower()) or len(name) > 200:
                raise ValueError("Cannot verify attachment filename")
            args = dict(atchFileId=key, fileSn=serial, fileExtsn=ext, cnvCnt="")
            data = self.get(HOST + "/np/cmm/fms/FileDown.do?" + urlencode(args), remaining, url)
            comments = " ".join(str(c.text or "") for c in button.xpath("ancestor::div[contains(@class,'download')][1]/comment()"))
            expected = re.search(r"\[([\d,]+)\s*byte", unescape(comments), re.I)
            if expected and len(data) != int(expected[1].replace(",", "")):
                raise ValueError("Original attachment size mismatch")
            if re.match(rb"\s*(?:<!doctype\s+html|<html\b|<head\b|<script\b)", data[:256], re.I):
                raise ValueError("Received an HTML error instead of an attachment")
            signatures = {"pdf": b"%PDF-", "png": b"\x89PNG\r\n\x1a\n", "hwp": bytes.fromhex("d0cf11e0a1b11ae1"),
                          "hwpx": b"PK\x03\x04", "jpg": b"\xff\xd8\xff", "jpeg": b"\xff\xd8\xff", "webp": b"RIFF"}
            magic = signatures.get(ext.lower())
            if (magic and not data.startswith(magic)) or (not magic and not expected):
                raise ValueError("Cannot verify the original attachment format")
            path = folder / f"{i}.bin"
            path.write_bytes(data)
            files.append({"name": name, "file": path.name, "sha256": hashlib.sha256(data).hexdigest()})
            remaining -= len(data)
        return {"id": notice_id, "url": url, "fields": fields, "body": clean(body.text_content()), "files": files}
