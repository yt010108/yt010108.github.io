# yt010108 · Hugo + PaperMod

[블로그](https://yt010108.github.io/) · [PaperMod 공식 문서](https://github.com/adityatelange/hugo-PaperMod/wiki/)

Hugo 0.168.0 extended와 공식 PaperMod 테마를 사용합니다. 테마는 `themes/PaperMod` Git submodule로 버전을 고정했습니다. [공식 데모](https://adityatelange.github.io/hugo-PaperMod/)의 Home-Info 모드와 페이지당 글 3개를 사용하며, 테마의 CSS와 레이아웃은 수정하지 않습니다. 상단 소개·GitHub/RSS 아이콘·메뉴는 `hugo.toml`에서 설정합니다.

원래 게시일이 없는 기존 노트도 볼 수 있도록 Archive 메뉴는 테마의 기본 노트 목록(`/notes/`)으로 연결합니다. 연도별 아카이브를 위해 임의의 게시일을 넣지 않습니다. 테마 전환·검색·목차·코드 복사·공유 버튼은 PaperMod 기본 기능을 사용합니다.

## 실행

```sh
git submodule update --init --recursive
hugo server
```

Hugo 설치: https://gohugo.io/installation/

## 글 작성

- `content/posts/`: 새 글과 분석 기록
- `content/notes/`: 기존 네트워크 노트
- `content/about.md`: 추후 작성할 About me
- `static/images/`: 글 이미지
- `hugo.toml`: 메뉴, 테마, 검색, RSS 설정

```sh
hugo new content posts/my-post.md
hugo server --buildDrafts
```

Markdown 파일 상단의 `draft = false`로 공개합니다. 목차는 `showToc = true`로 설정합니다. 기존 예시 글·프로젝트 10개는 소스를 유지한 채 초안으로 전환했습니다. 실제 네트워크 노트 11개와 원본 이미지·내부 링크는 유지합니다. 원래 게시일이 없는 노트에는 임의의 날짜를 넣지 않았습니다.

## 브라우저 편집

기존 Sveltia CMS 주소인 `/admin/`을 유지했습니다. 로그인과 저장소 권한은 그대로이며, Markdown과 TOML front matter를 저장하면 Hugo가 빌드합니다. 자세한 내용은 [CMS 안내](docs/cms.md)를 참고하세요.

## 배포

`main`에 푸시하면 GitHub Actions가 submodule을 체크아웃하고 Hugo로 빌드한 뒤 `public/`을 GitHub Pages에 배포합니다. PR에서는 빌드와 출력 검증만 실행합니다. Hugo 공식 릴리스 실행 파일의 SHA-256도 검증합니다.

```sh
hugo --minify
python scripts/check-output.py
```

검색 색인, 글 주소, 내부 링크·이미지·목차 앵커, UTF-8 출력, 샘플 초안의 비공개 여부를 검사합니다. `public/`은 생성물이므로 커밋하지 않습니다.

원본 `_posts/` 디렉터리는 그대로 보존했습니다. 전환 전 버전은 `backup/pre-papermod-2026-10-23` 브랜치에 보존합니다. PaperMod는 [Aditya Telange](https://github.com/adityatelange)가 만든 MIT 라이선스 테마이며 원본 라이선스와 테마 하단 크레딧을 유지합니다.
