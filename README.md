# yt010108 · Security journal & portfolio

[블로그](https://yt010108.github.io/) · [Tally 원본](https://examples.hwaro.hahwul.com/tally/) · [Hwaro 문서](https://hwaro.hahwul.com/)

Crystal로 작성된 정적 사이트 생성기 Hwaro 0.21.0과 HAHWUL의 Tally 예제를 기반으로 만든 보안 블로그입니다. Tally의 밝은 배경, 타이포그래피, 자물쇠 타임라인을 유지하고 글·노트·포트폴리오 구조로 바꿨습니다.

## 콘텐츠 수정

| 위치 | 용도 |
| --- | --- |
| `content/index.md` | 메인 소개, 태그라인 |
| `content/about.md` | 소개 페이지 |
| `content/posts/` | 분석 글 |
| `content/notes/` | 짧은 메모와 기존 네트워크 노트 |
| `content/projects/` | 프로젝트 상세 |
| `templates/home.html` | 메인 화면 구성, 소개 링크, 관심 분야, 추천 노트 |
| `templates/header.html`, `templates/footer.html` | 메뉴, 사이트 이름, 외부 링크 |
| `static/css/style.css` | Tally 스타일과 블로그용 확장 |
| `static/images/` | 글에 사용할 이미지 |
| `config.toml` | 사이트 제목, 설명, 주소, 검색, RSS 설정 |

글은 Markdown으로 작성합니다. 기본 예시:

```toml
+++
title = "새 분석 기록"
description = "글을 한 문장으로 소개합니다."
date = "2026-10-22"
tags = ["web-security", "research"]
toc = true
draft = false
+++
```

이 메타데이터 아래에 본문을 작성합니다. `content/posts/my-analysis.md`는 `/posts/my-analysis/`로 배포됩니다. 이미지는 `static/images/`에 넣고 본문에서 `![설명](/images/파일명.png)`로 연결합니다. 날짜가 없는 기존 노트에는 임의의 게시일을 추가하지 않았습니다.

예시 콘텐츠는 `[extra]` 아래 `sample = true`로 표시되어 있습니다. 실제 글이나 프로젝트로 교체할 때 해당 값을 지우거나 `false`로 바꾸면 예시 표시가 사라집니다. 프로젝트를 추가하면 메인과 Projects 목록에 자동으로 표시됩니다.

## 로컬 실행

[공식 설치 안내](https://hwaro.hahwul.com/start/installation/)에 따라 Hwaro 0.21.0을 준비한 뒤 저장소 루트에서 실행합니다.

```sh
hwaro serve --base-url http://localhost:3000 --port 3000
```

초안 생성과 미리보기:

```sh
hwaro new posts/my-analysis.md
hwaro serve --drafts --base-url http://localhost:3000
```

`archetypes/default.md`에서 새 글 기본 형식을 수정할 수 있습니다. 초안은 `draft = true`이며, 공개할 때 `false`로 바꿉니다.

## 자동 배포와 확인

GitHub Pages의 소스는 GitHub Actions입니다. `main`에 푸시하면 `.github/workflows/deploy.yml`이 Hwaro를 실행하고 생성된 `public/`만 GitHub Pages에 배포합니다. 별도의 Ruby·Jekyll·Crystal 컴파일 환경을 설치할 필요 없이, 버전과 SHA-256을 고정한 공식 Hwaro 실행 파일을 사용합니다. PR에서는 빌드와 검증만 실행합니다.

```sh
hwaro doctor
hwaro build --minify
hwaro tool check-links --internal-only
python scripts/check-output.py
```

렌더된 글 목록, 내부 링크·이미지·목차 앵커, 제목 구조, UTF-8 출력, 검색 결과 주소도 검사합니다. `public/`은 생성물이므로 수정하거나 커밋하지 않습니다.

## 이전 콘텐츠 보존

- `_posts/`와 그 아래의 원본 이미지들은 이전 저장소 상태 그대로 보존했습니다.
- 원래 네트워크 노트 11개를 `content/notes/`로 옮겨 사이트에서 읽을 수 있게 했습니다. Obsidian 링크 7개와 이미지 2개를 웹 링크로 변환했습니다.
- 원본의 제목 단계와 잘못 지정된 코드 언어는 웹에서 읽을 수 있도록 정리했습니다. 본문의 설명은 수정하지 않았습니다.
- 가상화 노트의 `attachment:` 이미지 1개는 저장소에 실제 파일이 없어 해당 위치에 안내를 남겼습니다.
- 기본 Jekyll 환영 글과 첨부 파일 경로만 있는 `무제.md`는 원본만 보존하고 새 글 목록에는 넣지 않았습니다.
- 기존 `#/post/...` 등의 링크는 새 고유 주소로 연결됩니다.
- 전환 전 화면은 `backup/pre-hwaro-tally-2026-10-22` 브랜치에 보존했습니다. 더 이전 Jekyll 원본은 `backup/pre-security-blog-2026-10-22`에 있습니다.

## 테마 출처

Tally는 [hahwul/hwaro-examples](https://github.com/hahwul/hwaro-examples)의 공개 스캐폴드입니다. `hwaro init --scaffold https://github.com/hahwul/hwaro-examples/tree/main/examples/tally`로 가져왔으며, 원본 기준 커밋은 `67e0b00d2db3b7c102679100ed7b1eecbd011774`입니다. 원본 제품의 가상 릴리스 내용 대신 개인 블로그 콘텐츠를 연결했습니다. 출처 표시는 사이트 하단에도 유지합니다.
