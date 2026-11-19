"""Run with python -B tests/test_pipc.py after installing scripts/pipc/requirements.txt."""
import hashlib
import io
import json
import subprocess
import sys
import unittest
from contextlib import chdir
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch
from zipfile import ZipFile

from lxml import etree
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/pipc"))
from source import Board, article_url
from subjects import Review, image_rows, table_rows
from sync import CATEGORY, LEDGER, REVIEW, read, sync, write


def hwpx(rows):
    table = etree.Element("tbl")
    for values in [["순번", "위반행위를 한 자", "위반행위의 내용"], *rows]:
        row = etree.SubElement(table, "tr")
        for value in values:
            etree.SubElement(etree.SubElement(row, "tc"), "t").text = value
    buf = io.BytesIO()
    with ZipFile(buf, "w") as archive:
        archive.writestr("Contents/section0.xml", etree.tostring(table, encoding="utf8"))
    return buf.getvalue()


class PIPC(unittest.TestCase):
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
        for rows in [[["번호", "작성자"], ["1", "작성자"]],
                     [header, ["1", "", "위반"]],
                     [header, ["?", "다른기관", "위반"]],
                     [header, ["1", "○○기관", "위반"]]]:
            with self.assertRaises(Review):
                table_rows(rows)

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
        board = Mock()
        board.listing.return_value = ["10", "11", "12", "13"]
        def download(key, folder):
            if key == "13":
                raise OSError("temporary connection failure")
            files = []
            for i, data in enumerate(docs[key]):
                path = folder / f"{i}.bin"
                path.write_bytes(data)
                files.append({"name": f"원문 {i}.hwpx", "file": path.name, "sha256": hashlib.sha256(data).hexdigest()})
            return {"id": key, "url": article_url(key), "files": files, "body": "붙임과 같이 공표합니다.",
                    "fields": {"제목": "결과의 공표", "작성부서": "조사과", "작성자": "위원회", "작성일": "2026-11-18",
                               "조회수": "1", "공표상태": "공표중", "공표마감일": "2027-11-17"}}
        board.download_notice.side_effect = download
        with TemporaryDirectory() as temp, chdir(temp), patch.dict("os.environ", {"GITHUB_STEP_SUMMARY": ""}):
            LEDGER.parent.mkdir(parents=True)
            write(LEDGER, ["10"])
            index = Path("blog/index.json")
            write(index, {"format": "yt010108-post-index", "version": 1, "entries": [], "taxonomy": {"categories": [CATEGORY], "tags": []}})
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


if __name__ == "__main__":
    unittest.main()
