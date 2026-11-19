"""Run with python -B tests/test_pipc.py after installing scripts/pipc/requirements.txt."""
import hashlib
import io
import os
import subprocess
import sys
import unittest
from contextlib import chdir, contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch
from zipfile import ZipFile

import pdfplumber
from lxml import etree
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/pipc"))
from source import Board, article_url
from release_files import upload_originals
from subjects import Review, image_rows, pdf_rows, table_rows
from sync import CATEGORY, LEDGER, REVIEW, read, sync, write


def hwpx(rows, headings=("명칭",), padding=0):
    table = etree.Element("tbl", colCnt=str(len(headings) + 2))
    def cell(row, col, value, across=1, down=1):
        tc = etree.SubElement(row, "tc")
        etree.SubElement(tc, "cellAddr", colAddr=str(col), rowAddr=str(len(table)-1))
        etree.SubElement(tc, "cellSpan", colSpan=str(across), rowSpan=str(down))
        etree.SubElement(tc, "t").text = value
    header = etree.SubElement(table, "tr")
    cell(header, 0, "순번", down=2)
    cell(header, 1, "위반행위를 한 자", across=len(headings))
    cell(header, 1 + len(headings), "위반행위의 내용")
    subheader = etree.SubElement(table, "tr")
    for col, value in enumerate((*headings, "위반조항"), 1):
        cell(subheader, col, value)
    for values in rows:
        row = etree.SubElement(table, "tr")
        for col, value in enumerate(values):
            cell(row, col, value)
    buf = io.BytesIO()
    with ZipFile(buf, "w") as archive:
        archive.writestr("Contents/section0.xml", etree.tostring(table, encoding="utf8"))
        if padding:
            archive.writestr("BinData/test.bin", bytes(padding))
    return buf.getvalue()


def board_with(docs):
    board = Mock()
    board.listing.return_value = list(docs)
    def download(key, folder):
        if docs[key] is None:
            raise OSError("temporary connection failure")
        files = []
        for i, (name, data) in enumerate(docs[key]):
            path = folder / f"{i}.bin"
            path.write_bytes(data)
            files.append({"name": name, "file": path.name, "sha256": hashlib.sha256(data).hexdigest()})
        return {"id": key, "url": article_url(key), "files": files, "body": "붙임과 같이 공표합니다.",
                "fields": {"제목": "결과의 공표", "작성부서": "조사과", "작성자": "위원회", "작성일": "2026-11-18",
                           "조회수": "1", "공표상태": "공표중", "공표마감일": "2027-11-17"}}
    board.download_notice.side_effect = download
    return board


@contextmanager
def archive(published=()):
    with TemporaryDirectory() as temp, chdir(temp), patch.dict(os.environ, {
        "GITHUB_STEP_SUMMARY": "", "PIPC_RELEASE_DIR": str(Path(temp) / "spool")
    }):
        LEDGER.parent.mkdir(parents=True)
        write(LEDGER, list(published))
        index = Path("blog/index.json")
        write(index, {"format": "yt010108-post-index", "version": 1, "entries": [], "taxonomy": {"categories": [CATEGORY], "tags": []}})
        yield index


class PIPC(unittest.TestCase):
    def test_streamed_original_retries_a_truncated_response(self):
        payload = b"%PDF-" + bytes(1024 * 1024)
        url = "https://pipc.go.kr/np/cmm/fms/FileDown.do"
        def response(data):
            result = io.BytesIO(data)
            result.url = url
            result.headers = {"Content-Length": str(len(payload))}
            return result
        board = Board()
        with TemporaryDirectory() as temp, patch.object(board.http, "open", side_effect=[response(b"short"), response(payload)]) as opened, patch("source.time.sleep"):
            path = Path(temp) / "0.bin"
            board.get(url, len(payload), path=path)
            self.assertEqual(path.read_bytes(), payload)
            self.assertEqual(opened.call_count, 2)

    def test_pagination_requires_complete_distinct_source_ids(self):
        board = Board()
        def page(number, notice):
            return (f"<p>전체 2건 · 현재페이지 {number}/2</p><table><tr><td>"
                    f"<a href='{article_url(notice)}'>공표</a></td></tr></table>").encode()
        with patch.object(board, "get", side_effect=[page(1, "21"), page(2, "20")]):
            self.assertEqual(board.listing(), ["20", "21"])
        with patch.object(board, "get", side_effect=[page(1, "21"), page(2, "21")]):
            with self.assertRaises(ValueError):
                board.listing()

    def test_suspicious_or_missing_rows_require_review(self):
        header = ["순번", "위반행위를 한 자", "위반내용"]
        subheader = [None, "명칭", "위반조항"]
        for rows in [[["번호", "작성자"], ["1", "작성자"]],
                     [header, ["1", "명칭", "위반"]],
                     [header, subheader, ["1", "", "위반"]],
                     [header, subheader, ["?", "다른기관", "위반"]],
                     [header, subheader, ["1", "○○기관", "위반"]],
                     [header, [None, "대표자", "명칭"], ["1", "대표자이름", "다른기관"]]]:
            with self.assertRaises(Review):
                table_rows(rows, [{i: (1, 1) for i, c in enumerate(row) if c is not None} for row in rows])

    def test_ocr_must_agree_and_read_the_footer(self):
        im = Image.new("L", (640, 280), 255)
        pen = ImageDraw.Draw(im)
        for y in [5, 50, 95, 155, 220]:
            pen.line((15, y, 625, y), fill=0)
        for x in [15, 70, 200, 310, 400, 500, 625]:
            pen.line((x, 5 if x in (15, 70, 200, 400, 625) else 50, x, 220 if x in (15, 625) else 155), fill=0)
        good = [("위반행위를 한 자", 96), ("명칭", 97), ("위반조항", 96), ("가 나 기 관", 95), ("1", 95), ("가나기관", 97), ("개인정보보호위원회", 90)]
        with patch("subjects.read_cell", side_effect=good):
            self.assertEqual(image_rows(im), [(1, "가나기관")])
        for idx, reading in [(5, ("다른기관", 95)), (5, ("가나기관", 65)), (6, ("불명", 90))]:
            values = good.copy()
            values[idx] = reading
            with patch("subjects.read_cell", side_effect=values), self.assertRaises(Review):
                image_rows(im)

    def test_new_only_original_bytes_and_manual_release(self):
        docs = {"11": [hwpx([["1", "가나기관", "위반"], ["2", "가나기관", "다른 위반"]]), hwpx([["1", "다라기관", "위반"]])],
                "12": [hwpx([["1", "가나기관", "위반"], ["3", "미확정기관", "순번 누락"]])]}
        docs["13"] = None
        board = board_with({key: None if blobs is None else [(f"공표 {i}.hwpx", data) for i, data in enumerate(blobs)]
                            for key, blobs in docs.items()})
        board.listing.return_value = ["10", "11", "12", "13"]
        with archive(["10"]) as index:
            self.assertEqual(sync(board), ["13"])
            self.assertEqual(read(LEDGER), ["10", "11"])
            first, = read(index)["entries"]
            post = read(Path(first["path"]))
            self.assertEqual(post["category"], CATEGORY)
            self.assertEqual(post["doc"]["content"][-2]["content"][0]["text"], "가나기관, 다라기관")
            self.assertEqual(post["doc"]["content"][-1]["content"][0]["marks"][0]["attrs"]["href"], article_url("11"))
            self.assertEqual([Path(a["path"][1:]).read_bytes() for a in post["assets"]], docs["11"])
            pending = REVIEW / "12"
            self.assertIn("순번", read(pending / "notice.json")["reviewReason"])
            self.assertEqual((pending / "0.bin").read_bytes(), docs["12"][0])
            before = index.read_bytes()
            board.reset_mock()
            board.listing.return_value = ["10", "11", "12"]
            sync(board)
            board.download_notice.assert_not_called()
            self.assertEqual(index.read_bytes(), before)
            sync(board, "12", "확인기관 A | 확인기관 B")
            self.assertFalse(pending.exists())
            self.assertEqual(read(LEDGER), ["10", "11", "12"])
            second = read(Path(read(index)["entries"][1]["path"]))
            self.assertEqual(second["doc"]["content"][-2]["content"][0]["text"], "확인기관 A, 확인기관 B")
            self.assertEqual(Path(second["assets"][0]["path"][1:]).read_bytes(), docs["12"][0])
            sync(board, "12", "확인기관 A | 확인기관 B")
            self.assertEqual(len(read(index)["entries"]), 2)
            subprocess.run(["node", str(ROOT / "scripts/build-content.mjs")], check=True, capture_output=True)

    def test_subject_column_and_unclosed_pdf_go_through_publication_gate(self):
        incomplete = (ROOT / "tests/fixtures/pipc-open-last-row.pdf").read_bytes()
        with pdfplumber.open(io.BytesIO(incomplete)) as pdf:
            first, last = pdf.pages
            self.assertEqual(pdf_rows(first, first.find_tables()), [(1, "가나기관"), (2, "다라기관")])
            self.assertIn("4 다라기관", last.extract_text())
            self.assertEqual(last.extract_tables()[0][-1][0], "3")
        reordered = hwpx([["1", "가상대표자", "가상법인", "위반"]], ("대표자", "명칭"))
        docs = {"21": [("원문.hwpx", reordered)],
                "22": [("원문.hwpx", hwpx([["1", "가상대표자", "위반"]], ("대표자",)))],
                "23": [("공표.hwpx", reordered), ("공표.pdf", incomplete)],
                "24": [("원문.hwpx", hwpx([["1", "가상대표자", "가상법인", "위반"]], ("명칭", "명칭")))]}
        with archive() as index:
            board = board_with(docs)
            self.assertEqual(sync(board), [])
            self.assertEqual(read(LEDGER), ["21"])
            entry, = read(index)["entries"]
            self.assertEqual(read(Path(entry["path"]))["doc"]["content"][-2]["content"][0]["text"], "가상법인")
            for notice, reason in [("22", "명칭"), ("23", "표 밖"), ("24", "명칭")]:
                folder = REVIEW / notice
                self.assertIn(reason, read(folder / "notice.json")["reviewReason"])
                self.assertEqual([(folder / f"{i}.bin").read_bytes() for i in range(len(docs[notice]))],
                                 [data for _, data in docs[notice]])
            board.reset_mock()
            sync(board)
            board.download_notice.assert_not_called()
            self.assertEqual(len(read(index)["entries"]), 1)

    def test_related_notices_are_neither_skipped_nor_removed_from_review(self):
        good = [("원문.hwpx", hwpx([["1", "가나기관", "위반"]]))]
        unclear = [("원문.hwpx", hwpx([["1", "○○기관", "위반"]]))]
        with archive() as index:
            sync(board_with({"31": good, "32": unclear}))
            entry, = read(index)["entries"]
            path = Path(entry["path"])
            post = read(path)
            for i in ("32", "33"):
                post["doc"]["content"].append({"type": "paragraph", "content": [{"type": "text", "text": "관련 공표",
                    "marks": [{"type": "link", "attrs": {"href": article_url(i)}}]}]})
            write(path, post)
            write(LEDGER, [])  # Simulate a manually authored post without a ledger entry.
            board = board_with({"31": good, "32": unclear, "33": good})
            sync(board)
            self.assertEqual([call.args[0] for call in board.download_notice.call_args_list], ["33"])
            self.assertEqual(read(LEDGER), ["31", "33"])
            self.assertEqual((REVIEW / "32/0.bin").read_bytes(), unclear[0][1])
            self.assertEqual(len(read(index)["entries"]), 2)

    def test_large_originals_are_published_intact_including_after_review(self):
        size = 10 * 1024 * 1024 + 1
        good = hwpx([["1", "가나기관", "위반"]], padding=size)
        unclear = hwpx([["1", "○○기관", "위반"]], padding=size)
        with archive() as index:
            sync(board_with({"41": [("첨부.hwpx", good)], "42": [("첨부.hwpx", unclear)]}))
            self.assertEqual(read(LEDGER), ["41"])
            self.assertIn("마스킹", read(REVIEW / "42/notice.json")["reviewReason"])
            sync(Mock(), "42", "확인기관")
            self.assertFalse((REVIEW / "42").exists())
            self.assertEqual(read(LEDGER), ["41", "42"])
            for item, data in zip(read(index)["entries"], [good, unclear], strict=True):
                asset, = read(Path(item["path"]))["assets"]
                self.assertEqual(Path(asset["path"][1:]).read_bytes(), data)

    def test_release_overflow_digest_and_manual_approval(self):
        good = hwpx([["1", "가나기관", "위반"]])
        unclear = hwpx([["1", "○○기관", "위반"]], padding=250)
        with archive() as index, patch("release_files.GIT_FILE_LIMIT", len(good)), patch("release_files.CMS_FILE_COUNT", 1):
            sync(board_with({"51": [("큰 원문.hwpx", unclear), ("추가 원문.hwpx", good)]}))
            pending = REVIEW / "51"
            manifest = read(pending / "notice.json")
            self.assertEqual(list(pending.iterdir()), [pending / "notice.json"])
            spool = Path(os.environ["PIPC_RELEASE_DIR"])
            urls = [f["release"] for f in manifest["files"]]
            for url, data in zip(urls, [unclear, good], strict=True):
                self.assertEqual((spool / "pipc-51" / url.rsplit("/", 1)[1]).read_bytes(), data)
            server, tags = {}, set()
            def gh(args, **kwargs):
                if args[1] == "api" and not tags:
                    return subprocess.CompletedProcess(args, 1, "", "gh: Not Found (HTTP 404)")
                if args[:3] == ["gh", "release", "create"]:
                    tags.add(args[3])
                if args[:3] == ["gh", "release", "upload"]:
                    file = Path(args[4])
                    self.assertNotIn(file.name, server)
                    server[file.name] = "sha256:" + hashlib.sha256(file.read_bytes()).hexdigest()
                return subprocess.CompletedProcess(args, 0, "123", "")
            def inventory(*args, **kwargs):
                return "".join(f"{name}\t{digest}\n" for name, digest in server.items())
            with patch("release_files.subprocess.run", side_effect=gh), patch("release_files.subprocess.check_output", side_effect=inventory):
                upload_originals(spool)
                upload_originals(spool)  # Retrying a push must reuse the same assets.
            approval = spool.parent / "approval"
            with patch.dict(os.environ, {"PIPC_RELEASE_DIR": str(approval)}):
                sync(Mock(), "51", "확인기관")
            with patch("release_files.subprocess.run", side_effect=gh), patch("release_files.subprocess.check_output", side_effect=inventory):
                upload_originals(approval)
                server[next(iter(server))] = "sha256:changed"
                with self.assertRaisesRegex(ValueError, "SHA-256"):
                    upload_originals(approval)
                server.clear()
                with self.assertRaisesRegex(ValueError, "원본이 없습니다"):
                    upload_originals(approval)
            entry, = read(index)["entries"]
            post = read(Path(entry["path"]))
            self.assertEqual(post["assets"], [])
            self.assertEqual([block["content"][0]["marks"][0]["attrs"]["href"] for block in post["doc"]["content"][1:-2]], urls)
            self.assertEqual(read(LEDGER), ["51"])
            subprocess.run(["node", str(ROOT / "scripts/build-content.mjs")], check=True, capture_output=True)

    def test_151st_original_can_be_downloaded_from_the_post(self):
        data = hwpx([["1", "가나기관", "위반"]])
        with archive() as index:
            sync(board_with({"61": [(f"공표{i}.hwpx", data) for i in range(151)]}))
            entry, = read(index)["entries"]
            post = read(Path(entry["path"]))
            self.assertEqual(len(post["assets"]), 150)
            links = post["doc"]["content"][1:-2]
            self.assertEqual(len(links), 151)
            last, = links[-1]["content"]
            url = last["marks"][0]["attrs"]["href"]
            self.assertEqual(last["text"], "공표150.hwpx")
            self.assertIn("/releases/download/pipc-61/", url)
            self.assertEqual((Path(os.environ["PIPC_RELEASE_DIR"]) / "pipc-61" / url.rsplit("/", 1)[1]).read_bytes(), data)


if __name__ == "__main__":
    unittest.main()
