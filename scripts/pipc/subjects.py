"""Extract only the numbered recipient column, or ask for a review of the whole notice."""
import csv
import io
import re
import subprocess
import unicodedata
import zipfile
from contextlib import closing

import pdfplumber
from hwp5.xmlmodel import Hwp5File
from lxml import etree
from PIL import Image, ImageOps


class Review(ValueError):
    pass


def compact(value):
    return "".join(unicodedata.normalize("NFKC", value or "").split())


def name_text(value):
    value = re.sub(r"(?<=[가-힣])\s*\n\s*(?=[가-힣])", "", (value or "").strip())
    value = " ".join(value.split())
    if (not 1 < len(value) <= 150 or not re.search(r"[^\W\d_]", value)
            or compact(value).strip("()") in {"비공개", "미상", "불명", "익명", "해당없음", "미기재", "성명불상", "미확인"}
            or re.search(r"[?�□○◯●■*<>ㄱ-ㅎㅏ-ㅣ]|\.{2,}|\(cid:|(?:외|등)\s*(?:\d+\s*(?:개|곳|명)|다수)|보호법\s*제", value, re.I)):
        raise Review("명칭 셀에 누락·마스킹 또는 불확실한 문자가 있습니다.")
    return value


def table_rows(rows):
    header = None
    for i, row in enumerate(rows):
        cells = [compact(c) for c in row]
        if cells and cells[0].isdigit():
            raise Review("머리글 전에 번호가 있는 행이 있습니다.")
        if cells[:2] == ["순번", "위반행위를한자"]:
            header = i
            break
    if header is None:
        raise Review("‘순번 / 위반행위를 한 자’ 열을 확인할 수 없습니다.")
    result = []
    for row in rows[header + 1:]:
        seq, name = (list(row) + [None, None])[:2]
        key = compact(seq)
        if "위반조항" in [compact(c) for c in row] and "처분내용" in [compact(c) for c in row]:
            continue
        if re.fullmatch(r"[0-9]+", key):
            result.append((int(key), name_text(name)))
        elif len([c for c in row if compact(c)]) == 1 and (key.startswith(("*", "※")) or "개인정보보호위원회" in key):
            continue
        elif result and seq is None and name is None:
            continue  # A vertically merged recipient spans several violation rows in a native PDF.
        else:
            raise Review("번호와 명칭을 대응시킬 수 없는 행이 있습니다.")
    if not result:
        raise Review("명칭 열에서 번호가 있는 행을 찾지 못했습니다.")
    return result


def xml_rows(root, table_tag, row_tag, cell_tag, text_tag):
    if root.xpath("//*[local-name()='pic' or local-name()='ShapePicture']"):
        raise Review("한글 본문에 이미지가 있어 표의 완전성을 확인할 수 없습니다.")
    tables = root.xpath("//*[local-name()=$tag]", tag=table_tag)
    if not tables:
        raise Review("한글 문서에서 처분 표를 찾지 못했습니다.")
    found = []
    for table in tables:
        rows = []
        for row in table.xpath("./*[local-name()=$tag]", tag=row_tag):
            cells = row.xpath("./*[local-name()=$tag]", tag=cell_tag)
            rows.append(["".join(c.xpath(".//*[local-name()=$tag]/text()", tag=text_tag)) for c in cells])
        found.extend(table_rows(rows))
    return found


def centers(values):
    groups = []
    for n in values:
        if not groups or n > groups[-1][-1] + 1:
            groups.append([])
        groups[-1].append(n)
    return [(g[0] + g[-1]) // 2 for g in groups]


def read_cell(image, *, alternate=False):
    factor = 4 if alternate else 3
    scaled = image.resize((image.width * factor, image.height * factor), Image.Resampling.LANCZOS)
    if alternate:
        scaled = scaled.point(lambda v: 255 if v > 175 else 0)
    buf = io.BytesIO()
    ImageOps.expand(scaled, border=16, fill=255).save(buf, format="PNG")
    job = subprocess.run(["tesseract", "stdin", "stdout", "-l", "kor+eng", "--psm", "6", "tsv"],
                         input=buf.getvalue(), capture_output=True, check=True, timeout=30)
    words = [w for w in csv.DictReader(job.stdout.decode("utf8").splitlines(), delimiter="\t", quoting=csv.QUOTE_NONE)
             if w["level"] == "5" and (w.get("text") or "").strip()]
    return " ".join(w["text"].strip() for w in words), min((float(w["conf"]) for w in words), default=0)


def image_rows(image):
    image = ImageOps.grayscale(image)
    image.thumbnail((1800, 2600))
    width, height = image.size
    pixels = image.point(lambda v: 1 if v < 165 else 0).tobytes()
    rule = re.compile(b"\x01{%d,}" % max(50, int(width * 0.43)))
    lines = centers(y for y in range(height) if rule.search(pixels[y*width:(y+1)*width]))
    if not 3 <= len(lines) <= 200:
        raise Review("이미지에서 표의 가로선을 확인할 수 없습니다.")
    found, parent_column, header, ended = [], None, None, False
    for top, bottom in zip(lines, lines[1:]):
        if bottom - top < 10:
            continue
        band = image.crop((0, top+2, width, bottom-1))
        strips = band.point(lambda v: 1 if v < 165 else 0).transpose(Image.Transpose.TRANSPOSE).tobytes()
        h = band.height
        edges = centers(x for x in range(width) if strips[x*h:(x+1)*h].count(1) >= h * .91)
        if len(edges) < 6:
            if header is None and 4 <= len(edges) <= 5:
                group, _ = read_cell(band.crop((edges[1]+3, 1, edges[2]-2, h-1)))
                if compact(group) == "위반행위를한자":
                    parent_column = edges[1:3]
            elif header and found:
                if ended or len(edges) != 2 or abs(edges[0]-header[0]) > 4:
                    raise Review("OCR에서 마지막 데이터 행의 경계가 불분명합니다.")
                footer, _ = read_cell(band.crop((edges[0]+3, 1, edges[-1]-2, h-1)))
                if "개인정보보호위원회" not in compact(footer):
                    raise Review("OCR 표 하단에서 공표기관 표시를 확인할 수 없습니다.")
                ended = True
            elif header:
                raise Review("OCR 표 머리글 이후의 행 구조가 불분명합니다.")
            continue
        if ended or len(edges) != 7:
            raise Review("OCR 표에서 모든 행의 열 구성을 확인할 수 없습니다.")
        def cell(col):
            left, right = edges[col]+3, edges[col+1]-2
            if right <= left:
                raise Review("OCR 셀 경계가 불분명합니다.")
            return band.crop((left, 1, right, h-1))
        label, confidence = read_cell(cell(1))
        if header is None:
            aligned = parent_column and all(abs(x-y) <= 4 for x, y in zip(parent_column, edges[1:3]))
            if aligned and compact(label) == "명칭" and compact(read_cell(cell(2))[0]) == "위반조항":
                header = edges[:3]
            continue
        if any(abs(x-y) > 4 for x, y in zip(header, edges[:3])):
            raise Review("OCR 명칭 열의 위치가 달라졌습니다.")
        serial, serial_conf = read_cell(cell(0))
        second, second_conf = read_cell(cell(1), alternate=True)
        if (not re.fullmatch(r"[0-9]+", compact(serial)) or serial_conf < 75 or min(confidence, second_conf) < 87
                or compact(label) != compact(second)):
            raise Review("OCR의 번호·명칭 신뢰도 또는 두 판독 결과가 일치하지 않습니다.")
        # Korean TSV often inserts a space between individual syllables.
        label = re.sub(r"(?<=[가-힣]) +(?=[가-힣])", "", label)
        found.append((int(compact(serial)), name_text(label)))
    if not found or not ended:
        raise Review("OCR로 명칭 열의 시작과 끝을 확인할 수 없습니다.")
    return found


def extract(path, filename):
    ext = filename.lower().rsplit(".", 1)[-1]
    rows = []
    parser = etree.XMLParser(resolve_entities=False, no_network=True)
    if ext == "pdf":
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                tables = page.extract_tables()
                if not tables or not page.chars:
                    rows.extend(image_rows(page.to_image(resolution=165).original))
                else:
                    if any(i["width"] > page.width * .45 and i["height"] > page.height * .12 for i in page.images):
                        raise Review("텍스트 표와 큰 이미지가 섞인 페이지입니다.")
                    for table in tables:
                        rows.extend(table_rows(table))
    elif ext == "hwpx":
        with zipfile.ZipFile(path) as doc:
            sections = [(int(m[1]), z) for z in doc.infolist()
                        if (m := re.fullmatch(r"Contents/section(\d+)\.xml", z.filename))]
            if not sections or sum(z.file_size for _, z in sections) > 40_000_000:
                raise Review("HWPX 본문 섹션을 확인할 수 없습니다.")
            for _, section in sorted(sections, key=lambda item: item[0]):
                root = etree.fromstring(doc.read(section), parser)
                rows.extend(xml_rows(root, "tbl", "tr", "tc", "t"))
    elif ext == "hwp":
        with closing(Hwp5File(str(path))) as doc:
            buf = io.BytesIO()
            doc.xmlevents().dump(buf)
        rows = xml_rows(etree.fromstring(buf.getvalue(), parser), "TableBody", "TableRow", "TableCell", "Text")
    elif ext in {"png", "jpg", "jpeg", "webp"}:
        with Image.open(path) as image:
            if getattr(image, "n_frames", 1) != 1:
                raise Review("여러 프레임으로 구성된 이미지입니다.")
            rows = image_rows(image)
    else:
        raise Review("지원하지 않는 원본 형식입니다: " + ext)
    if not rows or [n for n, _ in rows] != list(range(1, len(rows)+1)):
        raise Review("전체 쪽의 순번이 1부터 빠짐없이 이어지지 않습니다.")
    return [name for _, name in rows]
