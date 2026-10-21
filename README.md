# yt010108.github.io

보안 글, 짧은 학습 노트, 프로젝트를 함께 보여주는 개인 사이트입니다.

- 사이트: https://yt010108.github.io/
- 구성: HTML · CSS · JavaScript
- 호스팅: GitHub Pages, `main` 브랜치의 루트

## 화면 구성

- 홈: 자기소개 → 대표 글 → 대표 프로젝트 → 최근 글
- Posts / Notes: 목록, 태그 필터, 상세 화면
- Projects: 프로젝트 목록과 케이스 스터디
- About: 소개, 관심 분야, 활동, 연락처
- 검색: Search 또는 Ctrl+K / Cmd+K

현재 이름과 GitHub 주소는 `yt010108`로 설정했습니다. `예시` 표시가 붙은 글과 프로젝트는 화면 구성을 보여주는 샘플이며, 실제 게시 이력이나 성과가 아닙니다. 이메일은 비워 두었습니다.

## 콘텐츠 수정

`content.js`에서 이름, 소개, 연락처, 글, 노트, 프로젝트를 수정합니다.

| 파일 | 역할 |
| --- | --- |
| `index.html` | 공통 화면과 메뉴 |
| `styles.css` | 색상, 글꼴, 간격, 반응형 스타일 |
| `app.js` | 화면 이동, 필터, 검색, 코드 복사 |
| `content.js` | 프로필과 콘텐츠 |
| `assets/favicon.svg` | 기본 아이콘 |
| `404.html` | 없는 주소 안내 |
| `.nojekyll` | 정적 파일을 그대로 배포하도록 지정 |

`profile.github`, `profile.email`, 프로젝트별 `github`에 실제 링크를 지정할 수 있습니다. 예시를 실제 내용으로 바꾼 뒤 해당 항목의 `sample`을 `false`로 바꾸면 예시 표시가 사라집니다.

글의 `body`는 `lead`, `heading`, `paragraph`, `code`, `list`, `callout` 블록으로 구성됩니다. `heading.id`는 목차 이동에 사용하므로 글 안에서 중복되지 않게 지정합니다.

## 로컬에서 확인

`index.html`을 브라우저에서 열거나, 저장소 폴더에서 다음을 실행합니다.

```powershell
python -m http.server 8781 --bind 127.0.0.1
```

브라우저에서 `http://127.0.0.1:8781/`을 엽니다.

## 배포

GitHub Pages의 소스는 `main` 브랜치, `/ (root)`입니다. `main`에 변경 사항을 반영하면 GitHub Pages가 배포합니다. 별도 빌드나 Ruby 설치는 필요하지 않습니다.

지금은 구조 확인을 위한 정적 초안으로, `#/posts`와 같은 해시 주소로 화면을 전환합니다. Markdown 자동 변환, 검색 노출용 개별 글 URL, RSS 등은 이후 연결할 작업입니다.

## 기존 콘텐츠 보존

기존 Jekyll의 `_posts/`와 이미지, 관련 원본 파일을 그대로 보존했습니다. 새 화면의 목록에는 아직 자동으로 연결되지 않습니다. 기존 Jekyll 설정 파일은 `.nojekyll`이 있는 현재 배포에서 사용하지 않습니다.

교체 직전 버전은 `backup/pre-security-blog-2026-10-22` 브랜치와 Git 이력에서 확인할 수 있습니다.
