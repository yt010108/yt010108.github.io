/* 이름, 소개, 링크와 예시 콘텐츠를 이 파일에서 수정합니다. 모든 글과 프로젝트는 틀을 보여주기 위한 예시입니다. */
window.BLOG_DATA = {
  profile: {
    name: "yt010108",
    mark: "y",
    role: "Security researcher & builder",
    headline: ["Security research,", "notes & projects."],
    intro: "보안을 공부하고, 실험하고, 발견한 내용을 기록합니다.\n작은 메모부터 분석 글과 직접 만든 도구까지.",
    about: "안녕하세요. yt010108입니다. 보안을 공부하며 정리한 생각과 실험을 이곳에 남깁니다. 한 번의 정답보다 왜 그렇게 동작하는지 이해하는 과정을 중요하게 생각합니다.",
    github: "https://github.com/yt010108",
    email: "",
    focus: [
      { name: "Security research", description: "작은 의문에서 출발해, 동작 원리와 경계를 살펴봅니다." },
      { name: "Tools & experiments", description: "반복되는 작업을 줄이고 이해를 돕는 작은 도구를 만듭니다." },
      { name: "Learning in public", description: "배운 내용을 다시 찾아볼 수 있는 기록으로 정리합니다." }
    ]
  },
  tags: {
    "web-security": "Web security",
    "research": "Research",
    "methodology": "Methodology",
    "tooling": "Tooling",
    "writing": "Writing",
    "linux": "Linux"
  },
  posts: [
    {
      id: "request-boundaries", title: "하나의 요청에서 시작하는 보안 분석",
      description: "요청이 만들어지고, 처리되고, 응답으로 돌아오기까지. 작은 관찰을 분석 기록으로 남기는 방법.",
      date: "2026-10-22", readTime: 6, tags: ["web-security", "research"], featured: true, sample: true,
      body: [
        { type: "lead", text: "작은 의문을 하나 고르고, 요청의 흐름을 따라가며 관찰한 내용을 정리합니다. 이 글은 제목, 본문, 목차, 코드 블록의 모양을 보여주는 예시입니다." },
        { type: "heading", id: "question", text: "01. 질문을 먼저 적어두기" },
        { type: "paragraph", text: "분석을 시작하기 전에 무엇을 이해하고 싶은지 한 문장으로 남깁니다. 관찰한 사실과 아직 확인하지 않은 가정을 구분하면, 다음에 살펴볼 부분이 더 분명해집니다." },
        { type: "callout", label: "RESEARCH NOTE", text: "실제 분석 글에서는 대상과 범위, 실험 환경을 먼저 설명하는 공간입니다. 아래 요청과 결과는 화면 구성을 위한 가상 예시입니다." },
        { type: "heading", id: "observation", text: "02. 관찰한 요청 정리하기" },
        { type: "paragraph", text: "원래의 요청과 바꾼 요청을 나란히 남깁니다. 캡처 이미지가 있다면 이 문단 아래에 배치할 수 있습니다. 재현에 필요한 정보는 담고, 계정 정보와 비밀 값은 제거합니다." },
        { type: "code", language: "HTTP · EXAMPLE", code: "GET /api/items/42 HTTP/1.1\nHost: example.test\nAuthorization: Bearer <redacted>\nAccept: application/json" },
        { type: "heading", id: "record", text: "03. 과정과 판단을 함께 남기기" },
        { type: "paragraph", text: "최종 결과뿐 아니라 그 결과에 도달한 과정도 기록합니다. 어떤 조건을 바꿨는지, 무엇이 달라졌는지, 추가로 확인할 부분이 무엇인지 적으면 나중에 글을 읽는 사람에게도 도움이 됩니다." },
        { type: "list", items: ["실험 환경과 확인한 범위", "원래 동작과 변경 후 관찰한 동작", "판단의 근거와 남아 있는 질문"] },
        { type: "heading", id: "takeaway", text: "04. 다음 실험으로 이어가기" },
        { type: "paragraph", text: "이곳에 실제 분석의 결론, 개선 방향, 참고 자료를 정리하면 됩니다. 짧은 후속 실험은 Notes로, 분석에 사용한 도구는 Projects로 연결해 기록을 이어갈 수 있습니다." }
      ]
    },
    {
      id: "reusable-research-notes", title: "다시 꺼내 읽을 수 있는 분석 노트 만들기",
      description: "결과만 남기는 대신 질문, 실험 과정, 판단의 근거를 함께 정리하는 기록 방식.",
      date: "2026-10-20", readTime: 4, tags: ["methodology", "writing"], featured: true, sample: true,
      body: [
        { type: "lead", text: "잘 정리한 기록은 다음 실험의 출발점이 됩니다. 이 글은 긴 분석 글과 짧은 노트를 구분하는 콘텐츠 예시입니다." },
        { type: "heading", id: "structure", text: "질문 → 관찰 → 판단" },
        { type: "paragraph", text: "무엇이 궁금했는지, 직접 무엇을 확인했는지, 그래서 어떻게 판단했는지를 순서대로 남깁니다. 확인하지 않은 부분은 다음에 살펴볼 질문으로 분리해 둡니다." },
        { type: "heading", id: "small-records", text: "작은 기록은 Notes에" },
        { type: "paragraph", text: "짧은 명령어 메모나 환경 설정은 노트로 남기고, 하나의 주제에 대한 설명이 완성되면 긴 글로 묶습니다. 서로 관련 있는 글과 프로젝트를 연결하면 기록의 맥락도 함께 보존할 수 있습니다." },
        { type: "heading", id: "template", text: "기본 기록 형식" },
        { type: "code", language: "TEXT", code: "질문\n- 무엇을 이해하고 싶은가?\n\n관찰\n- 어떤 조건에서 무엇을 확인했는가?\n\n판단\n- 근거와 남은 질문은 무엇인가?" },
        { type: "paragraph", text: "실제 글에서는 이 위치에 자신의 기록 방식과 구체적인 사례를 넣으면 됩니다." }
      ]
    },
    {
      id: "small-tools", title: "반복되는 작업을 작은 도구로 옮기기",
      description: "수동으로 하던 작업을 정리하고, 필요한 기능만 담은 도구를 설계하는 과정.",
      date: "2026-10-18", readTime: 5, tags: ["tooling", "methodology"], sample: true,
      body: [
        { type: "lead", text: "분석 과정에서 반복한 일을 모아 작은 프로젝트의 주제로 삼아봅니다. 실제 도구 개발 과정을 기록할 수 있는 글의 예시입니다." },
        { type: "heading", id: "problem", text: "어떤 일이 반복되는가" },
        { type: "paragraph", text: "시간이 오래 걸렸던 작업과 실수하기 쉬웠던 단계를 나열합니다. 도구로 만들 범위는 한두 가지의 분명한 동작으로 좁혀봅니다." },
        { type: "heading", id: "interface", text: "입력과 출력 정하기" },
        { type: "paragraph", text: "무엇을 입력하고 어떤 결과를 받을지 먼저 정리합니다. 실제 사용 예시와 한계를 함께 남기면 프로젝트 설명과 분석 글을 연결하기도 좋습니다." },
        { type: "heading", id: "reflection", text: "구현 뒤에 남길 것" },
        { type: "list", items: ["풀려고 했던 문제", "선택한 접근과 그 이유", "실제로 확인한 결과", "남아 있는 제약과 다음 작업"] }
      ]
    },
    {
      id: "reading-source", title: "소스 코드를 읽으며 남겨두는 질문들",
      description: "전체를 한 번에 이해하려 하기보다, 관심 있는 동작에서 출발하는 코드 읽기 메모.",
      date: "2026-10-15", readTime: 3, tags: ["research", "methodology"], sample: true,
      body: [
        { type: "lead", text: "소스 코드 분석 글을 위한 예시입니다. 실제 코드와 관찰 내용을 이 자리에 채울 수 있습니다." },
        { type: "heading", id: "entry", text: "관심 있는 동작에서 시작하기" },
        { type: "paragraph", text: "사용자 입력이 들어오는 위치와 결과가 만들어지는 위치를 먼저 적어둡니다. 두 지점 사이의 흐름을 따라가며 궁금한 부분을 별도로 표시합니다." },
        { type: "heading", id: "questions", text: "다음에 확인할 질문 남기기" },
        { type: "paragraph", text: "설명이 필요한 코드는 짧게 발췌하고, 어느 버전의 어떤 파일인지 함께 남깁니다. 긴 분석은 별도 글로, 작은 발견은 노트로 연결할 수 있습니다." }
      ]
    },
    {
      id: "personal-research-space", title: "글과 프로젝트가 함께 쌓이는 공간",
      description: "공부한 내용과 직접 만든 작업물을 연결하는 개인 사이트의 첫 기록.",
      date: "2026-10-12", readTime: 2, tags: ["writing"], sample: true,
      body: [
        { type: "lead", text: "이 블로그의 첫 글을 위한 자리입니다. 사이트를 시작하는 이유와 앞으로 다룰 주제를 소개할 수 있습니다." },
        { type: "heading", id: "writing", text: "기록하고 싶은 것" },
        { type: "paragraph", text: "배운 내용을 정리한 글, 짧은 실험 메모, 직접 만든 도구와 프로젝트를 이 공간에 모읍니다. 실제 관심 분야와 앞으로의 계획으로 이 문단을 교체해 주세요." }
      ]
    }
  ],
  notes: [
    {
      id: "observation-checklist", title: "실험 전에 확인하는 작은 체크리스트", description: "환경, 버전, 입력, 예상 동작을 기록해 두기.", date: "2026-10-22", readTime: 1, tags: ["methodology"], sample: true,
      body: [
        { type: "lead", text: "긴 글로 만들기 전의 짧은 메모를 위한 예시입니다." },
        { type: "heading", id: "checklist", text: "실험 시작 전" },
        { type: "list", items: ["분석 범위와 실험 환경을 적었는가?", "대상 버전과 설정을 확인했는가?", "예상 동작과 실제 관찰을 나눠 적었는가?", "계정 정보와 비밀 값을 제거했는가?"] }
      ]
    },
    {
      id: "terminal-notes", title: "터미널 작업을 기록하는 습관", description: "다음에 다시 쓸 명령과 실행 환경을 함께 남기기.", date: "2026-10-19", readTime: 1, tags: ["linux", "tooling"], sample: true,
      body: [
        { type: "lead", text: "명령어와 짧은 설명을 빠르게 남기는 노트 예시입니다." },
        { type: "heading", id: "environment", text: "환경도 함께 기록하기" },
        { type: "paragraph", text: "작업 위치와 도구 버전, 명령의 목적을 함께 남깁니다. 실제로 자주 쓰는 명령과 출력 예시를 아래에 넣을 수 있습니다." },
        { type: "code", language: "SHELL · EXAMPLE", code: "# 현재 작업 위치와 디렉터리 내용 확인\npwd\nls -la" }
      ]
    },
    {
      id: "links-with-context", title: "참고 링크에 한 문장 더하기", description: "주소만 저장하는 대신 왜 남겼는지도 적어두기.", date: "2026-10-16", readTime: 1, tags: ["writing"], sample: true,
      body: [
        { type: "lead", text: "참고 자료를 정리하는 짧은 노트의 예시입니다." },
        { type: "heading", id: "context", text: "다시 읽을 이유" },
        { type: "paragraph", text: "어떤 질문에 도움이 됐는지, 어떤 부분을 다음에 확인할지 한 문장을 함께 남깁니다. 실제 자료의 제목과 원문 링크를 이 자리에 추가할 수 있습니다." }
      ]
    }
  ],
  projects: [
    {
      id: "request-inspector", name: "Request Inspector", category: "SECURITY TOOL", description: "HTTP 요청의 구조를 읽고 비교하는 도구를 소개하는 포트폴리오 예시.", stack: ["Python", "HTTP"], year: "2026", sample: true, github: "", relatedPost: "request-boundaries", visual: "request",
      summary: "요청을 살펴보며 반복했던 작업을 한곳에 모으는 개인 도구의 예시입니다. 실제 구현물의 문제 정의, 담당 역할, 구현 과정과 결과를 이 구조에 맞춰 정리할 수 있습니다.",
      sections: [
        { title: "풀고 싶은 문제", text: "어떤 작업이 불편했는지, 기존 방식에서 무엇을 개선하려 했는지 설명하는 공간입니다." },
        { title: "내 역할과 접근", text: "직접 맡은 범위와 구현 방식을 설명합니다. 입력과 출력, 주요 흐름, 선택한 기술의 이유를 넣으면 좋습니다." },
        { title: "결과와 배운 점", text: "실제로 확인한 결과를 캡처나 근거와 함께 정리하는 공간입니다. 현재 내용은 예시이며 실제 성과를 기재한 것은 아닙니다." }
      ]
    },
    {
      id: "research-notebook", name: "Research Notebook", category: "PERSONAL EXPERIMENT", description: "흩어진 분석 메모와 참고 자료를 연결하는 기록 프로젝트 예시.", stack: ["Markdown", "JavaScript"], year: "2026", sample: true, github: "", relatedPost: "reusable-research-notes", visual: "notes",
      summary: "짧은 실험 노트와 완성된 분석을 함께 관리하는 프로젝트의 예시입니다. 배경과 핵심 기능, 구현 과정, 사용하면서 배운 점을 담을 수 있습니다.",
      sections: [
        { title: "프로젝트 배경", text: "왜 만들었는지, 누구의 어떤 문제를 해결하려 했는지 설명하는 공간입니다." },
        { title: "설계와 구현", text: "실제 콘텐츠 구조와 탐색 방식, 구현 중에 했던 선택을 정리할 수 있습니다." },
        { title: "회고와 다음 단계", text: "직접 사용해 본 결과와 한계, 다음에 개선할 부분을 담는 공간입니다." }
      ]
    }
  ]
};
