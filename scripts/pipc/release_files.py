"""Archive originals that exceed a Git blob or the blog's 150 attachment slots."""
import hashlib
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

GIT_FILE_LIMIT = 100 * 1024 * 1024
CMS_FILE_COUNT = 150
REPOSITORY = os.getenv("GITHUB_REPOSITORY", "yt010108/yt010108.github.io")


def stage_originals(notice, folder):
    for i, file in enumerate(notice["files"]):
        if file["file"] != f"{i}.bin" or not re.fullmatch(r"[0-9]+", notice["id"]):
            raise ValueError("원본 파일의 글 번호 또는 경로가 올바르지 않습니다.")
        src = folder / file["file"]
        if not file.get("release") and i < CMS_FILE_COUNT and src.stat().st_size <= GIT_FILE_LIMIT:
            continue
        if not re.fullmatch(r"[a-f0-9]{64}", file["sha256"]):
            raise ValueError("원본 해시가 올바르지 않습니다.")
        tag = "pipc-" + notice["id"]
        if i >= 1000:  # GitHub allows 1,000 assets per release.
            tag += "-" + str(i // 1000 + 1)
        suffix = Path(file["name"]).suffix.lower()
        name = f"{i}-{file['sha256']}" + (suffix if re.fullmatch(r"\.[a-z0-9]+", suffix) else ".bin")
        url = f"https://github.com/{REPOSITORY}/releases/download/{tag}/{name}"
        if file.get("release", url) != url:
            raise ValueError("검토 원본의 Release 주소가 일치하지 않습니다.")
        dest = Path(os.environ["PIPC_RELEASE_DIR"]) / tag / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        if src.is_file():
            shutil.copyfile(src, dest)
        else:
            # An approved review already has a remote original. Verify it again before committing.
            dest.touch(exist_ok=True)
        file["release"] = url


def upload_originals(spool):
    for group in sorted(spool.glob("pipc-*")):
        tag = group.name
        if group.is_symlink() or not group.is_dir() or not re.fullmatch(r"pipc-[0-9]+(-[0-9]+)?", tag):
            raise ValueError("원본 Release 태그가 올바르지 않습니다.")
        api = f"repos/{REPOSITORY}/releases"
        lookup = ["gh", "api", f"{api}/tags/{tag}", "--jq", ".id"]
        release = subprocess.run(lookup, text=True, capture_output=True)
        if release.returncode and "HTTP 404" in release.stderr:
            subprocess.run(["gh", "release", "create", tag, "--repo", REPOSITORY, "--latest=false",
                            "--title", "개인정보위 공표 원문 " + tag[5:], "--notes", "공식 공표의 원본 첨부파일입니다."], check=True)
            release = subprocess.run(lookup, text=True, capture_output=True)
        release.check_returncode()
        assets = ["gh", "api", "--paginate", f"{api}/{int(release.stdout)}/assets?per_page=100",
                  "--jq", ".[] | [.name, .digest] | @tsv"]

        def digests():
            listing = subprocess.check_output(assets, text=True)
            return dict(line.split("\t", 1) for line in listing.splitlines())

        stored = digests()
        expected = {}
        for file in sorted(group.iterdir()):
            match = re.fullmatch(r"[0-9]+-([a-f0-9]{64})\.[a-z0-9]+", file.name)
            if file.is_symlink() or not file.is_file() or not match:
                raise ValueError("원본 Release 파일명이 올바르지 않습니다.")
            expected[file.name] = "sha256:" + match[1]
            if file.name not in stored:
                if not file.stat().st_size:
                    raise ValueError("검토 시 보관한 Release 원본이 없습니다.")
                with file.open("rb") as original:
                    if hashlib.file_digest(original, "sha256").hexdigest() != match[1]:
                        raise ValueError("업로드할 원본의 SHA-256이 일치하지 않습니다.")
                subprocess.run(["gh", "release", "upload", tag, str(file), "--repo", REPOSITORY], check=True)
        if not expected.keys() <= stored.keys():
            stored = digests()
        if any(stored.get(name) != digest for name, digest in expected.items()):
            raise ValueError("GitHub에 보관한 첨부파일의 SHA-256이 원본과 일치하지 않습니다.")


if __name__ == "__main__":
    upload_originals(Path(sys.argv[1]))
