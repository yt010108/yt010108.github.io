# yt010108 · Hugo + PaperMod

[블로그](https://yt010108.github.io/) · [PaperMod 공식 문서](https://github.com/adityatelange/hugo-PaperMod/wiki/)

Hugo 0.168.0 extended와 공식 PaperMod 테마를 사용합니다. 테마는 `themes/PaperMod` Git submodule로 버전을 고정했습니다. 홈은 [공식 데모](https://adityatelange.github.io/hugo-PaperMod/)의 Home-Info 모드와 페이지당 글 3개를 유지합니다. 상단 소개·GitHub/RSS 아이콘·메뉴는 `hugo.toml`에서 설정합니다.

Archive 메뉴(`/archives/`, `/blog/`에서도 접근)는 공개한 글과 노트를 모아서 보여줍니다. 기존 `/notes/`와 `/posts/`의 글 목록·상세에 고정 사이드바를 적용하고, 상세에는 가운데 제목 영역과 오른쪽 목차를 표시합니다. 사이드바는 독립적으로 스크롤되며 스크롤바는 숨깁니다. 작은 화면에서는 메뉴 버튼으로 사이드바를 열고, 목차를 본문 위에서 펼칠 수 있습니다. About·Search·Tags와 홈은 기존 PaperMod 레이아웃을 사용합니다.

데스크톱에서는 사이드바와 글 영역을 40px 간격으로 묶어 가운데에 정렬합니다. 목록은 720px, 오른쪽 목차가 있는 상세 화면은 952px을 글 영역의 최대 폭으로 사용하며, 좁은 화면에서는 여유 공간에 맞춰 줄어듭니다. 화면 스크롤 중에도 사이드바는 같은 위치에 고정됩니다.

이 구성은 프로젝트의 `layouts/`와 `assets/css/blog-shell.css`, `assets/js/blog-shell.js`로 확장합니다. 원본 테마 submodule은 수정하지 않습니다. 블로그 CSS·JavaScript는 해당 화면에서만 로드합니다. 프로필은 `hugo.toml`의 `params.sidebar`에서 설정하며, `avatar`에 이미지 주소를 지정하기 전에는 `y`를 표시합니다. 기존 글과 원래 게시일이 없는 노트에 임의의 날짜를 추가하지 않습니다.

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
