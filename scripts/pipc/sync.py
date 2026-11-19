"""Sync public notices, or release one saved review after explicit human confirmation."""
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from http.client import HTTPException
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import parse_qs, urlsplit
from uuid import NAMESPACE_URL, uuid5

from release_files import stage_originals
from source import Board, article_url
from subjects import Review, compact, extract

CATEGORY = "Archive / 개인정보보호법 결과 공표"
ARCHIVE = Path("blog/pipc")
REVIEW = ARCHIVE / "review"
LEDGER = ARCHIVE / "published.json"
PUBLISHER = Path(__file__).with_name("publish.mjs").resolve()


class FetchFailed(Exception):
    pass


def read(path):
    return json.loads(path.read_bytes())


def write(path, value):
    path.write_bytes((json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode())


def manual_posts():
    """Also recognize notices posted manually since the previous run, including trashed entries."""
    found = set()
    for item in read(Path("blog/index.json"))["entries"]:
        if item["category"] != CATEGORY:
            continue
        primary = set()
        for block in read(Path(item["path"]))["doc"]["content"]:
            if block["type"] != "paragraph":
                continue
            nodes = block.get("content", [])
            label = "".join(n.get("text", "") for n in nodes).strip()
            if not re.fullmatch(r"개인정보보호위원회 원문(?:\s*\(\d{4}-\d{2}-\d{2} 확인\))?", label):
                continue
            links = {m["attrs"]["href"] for n in nodes for m in n.get("marks", []) if m["type"] == "link"}
            if len(links) == 1:
                url = urlsplit(links.pop())
                query = parse_qs(url.query)
                ids = query.get("nttId", [])
                if (url.hostname in ("pipc.go.kr", "www.pipc.go.kr") and url.path == "/np/cop/bbs/selectBoardArticle.do"
                        and query.get("bbsId") == ["BS258"] and len(ids) == 1 and re.fullmatch(r"[0-9]+", ids[0])):
                    primary.add(ids[0])
        if len(primary) == 1:
            found.update(primary)
    return found


def recognize(notice, folder):
    names = {}
    for f in notice["files"]:
        try:
            values = extract(folder / f["file"], f["name"])
        except (FileNotFoundError, PermissionError, MemoryError):
            raise
        except Exception as exc:
            # Different document readers raise different exceptions for unreadable originals.
            reason = str(exc) if isinstance(exc, Review) else "원문을 해석할 수 없습니다 (" + type(exc).__name__ + ")."
            raise Review(f["name"] + " — " + reason) from exc
        for value in values:
            names.setdefault(compact(value), value)
    if not names:
        raise Review("확인할 수 있는 대상 이름이 없습니다.")
    return list(names.values())


def publish(folder, names):
    subprocess.run(["node", str(PUBLISHER), str(folder.resolve())], input=json.dumps(names), encoding="utf-8", check=True)


def collect_one(board, notice_id, published):
    with TemporaryDirectory() as temp:
        folder = Path(temp)
        try:
            notice = board.download_notice(notice_id, folder)
        except (OSError, HTTPException, ValueError) as exc:
            raise FetchFailed(str(exc)) from exc
        notice["postId"] = str(uuid5(NAMESPACE_URL, notice["url"]))
        notice["checked"] = datetime.now(timezone(timedelta(hours=9))).date().isoformat()
        try:
            names = recognize(notice, folder)
        except Review as exc:
            notice["reviewReason"] = str(exc)
        stage_originals(notice, folder)
        write(folder / "notice.json", notice)
        if "reviewReason" in notice:
            archived = [f["file"] for f in notice["files"] if f.get("release")]
            shutil.copytree(folder, REVIEW / notice_id, ignore=shutil.ignore_patterns(*archived))
            return "검토 대기"
        publish(folder, names)
        published.add(notice_id)
        return "발행"


def clear_review(folder, notice):
    for i, f in enumerate(notice["files"]):
        if f["file"] != f"{i}.bin":
            raise ValueError("검토 원본 파일 경로가 올바르지 않습니다.")
        (folder / f["file"]).unlink(missing_ok=bool(f.get("release")))
    (folder / "notice.json").unlink()
    folder.rmdir()


def approve(notice_id, raw_names, published):
    if not re.fullmatch(r"[0-9]+", notice_id):
        raise ValueError("검토할 원문 글 번호를 입력하세요.")
    names = [s.strip() for s in raw_names.split("|")]
    if any(not n or len(n) > 150 or re.search(r"[\x00-\x1f\x7f]", n) for n in names):
        raise ValueError("대상 이름을 | 로 구분해서 입력하세요.")
    folder = REVIEW / notice_id
    if notice_id in published:
        print("이미 발행한 글:", notice_id)
        return False
    if not (folder / "notice.json").is_file():
        raise ValueError("검토 대기 목록에 없는 원문 글 번호입니다.")
    notice = read(folder / "notice.json")
    if notice["id"] != notice_id or notice["url"] != article_url(notice_id):
        raise ValueError("검토 원문 글 번호가 일치하지 않습니다.")
    stage_originals(notice, folder)
    write(folder / "notice.json", notice)
    publish(folder, list(dict.fromkeys(names)))
    published.add(notice_id)
    clear_review(folder, notice)
    return True


def sync(board, review_id="", supplied_names=""):
    original = read(LEDGER)
    published = set(original) | manual_posts()
    events, errors = [], []
    for manifest in REVIEW.glob("*/notice.json"):
        if manifest.parent.name in published:
            clear_review(manifest.parent, read(manifest))
    if review_id or supplied_names:
        if not review_id or not supplied_names:
            raise ValueError("수동 발행에는 글 번호와 확인한 이름을 함께 입력하세요.")
        if approve(review_id, supplied_names, published):
            events.append((review_id, "검토 반영"))
    else:
        notices = board.listing()
        for notice_id in notices:
            if notice_id in published or (REVIEW / notice_id / "notice.json").is_file():
                continue
            try:
                result = collect_one(board, notice_id, published)
                events.append((notice_id, result))
            except FetchFailed as exc:
                errors.append(notice_id)
                print(f"{notice_id} 수집 실패, 다음 실행에서 재시도: {exc}", file=sys.stderr)
    if published != set(original):
        write(LEDGER, sorted(published, key=int))
    pending = sorted((p.parent.name for p in REVIEW.glob("*/notice.json")), key=int)
    lines = ["### 개인정보위 결과 공표", "", f"이번 실행에서 처리한 공표 {len(events)}건 · 검토 대기 {len(pending)}건"]
    lines += [f"- {status} [{i}]({article_url(i)})" for i, status in events]
    repo = os.getenv("GITHUB_REPOSITORY")
    if pending and repo:
        lines += ["", "검토 원본과 사유"] + [f"- [{i}](https://github.com/{repo}/tree/main/blog/pipc/review/{i})" for i in pending]
    if errors:
        lines.append("재수집할 글 번호 " + ", ".join(errors))
    print("\n".join(lines))
    if os.getenv("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf8") as out:
            print("\n".join(lines), file=out)
    return errors


if __name__ == "__main__":
    errors = sync(Board(), os.getenv("PIPC_REVIEW_ID", "").strip(), os.getenv("PIPC_NAMES", "").strip())
    if os.getenv("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf8") as out:
            print("retry=" + ("true" if errors else "false"), file=out)
    elif errors:
        sys.exit(1)
