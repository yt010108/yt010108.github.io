(() => {
  "use strict";

  const data = window.BLOG_DATA;
  const originalPosts = { posts: [...data.posts], notes: [...data.notes] };
  const bundleURL = new URL("published.json", document.currentScript?.src || location.href);
  let contentRevision = new URL(document.currentScript?.src || location.href).searchParams.get("v") || "";
  let contentCheck = "checking", refreshTask, hasPublishedContent = false;
  function applyPublished() {
    for (const kind of ["posts", "notes"]) {
      const published = (window.BLOG_PUBLISHED || []).filter(item => item.kind === kind);
      data[kind] = published.length || window.BLOG_MANAGED_KINDS?.includes(kind)
        ? [...published, ...originalPosts[kind].filter(item => !item.sample && !published.some(post => post.id === item.id))].sort((a, b) => b.date.localeCompare(a.date) || (b.publishedAt || "").localeCompare(a.publishedAt || ""))
        : [...originalPosts[kind]];
    }
  }
  applyPublished();
  const main = document.getElementById("main");
  const dialog = document.getElementById("search-dialog");
  const searchInput = document.getElementById("search-input");
  const results = document.getElementById("search-results");
  const searchStatus = document.getElementById("search-status");
  const menu = document.getElementById("main-nav");
  const menuButton = document.querySelector(".menu-trigger");
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const date = value => esc(value.replaceAll("-", "."));
  const tagName = value => data.tags[value] || value;
  const sample = item => item.sample ? '<span class="sample-label">예시</span>' : "";
  const arrow = '<span class="arrow" aria-hidden="true">↗</span>';
  const localPath = (kind, id) => `#/${kind}/${encodeURIComponent(id)}`;
  const isHttpLink = value => /^https?:\/\//i.test(value || "");

  function meta(item) {
    return `<div class="meta"><time datetime="${esc(item.date)}">${date(item.date)}</time>${sample(item)}</div>`;
  }

  function sectionHeading(label, title, link, linkText) {
    return `<div class="section-heading"><div><p class="eyebrow">${esc(label)}</p><h2>${esc(title)}</h2></div><a class="text-link" href="${link}">${esc(linkText)} ${arrow}</a></div>`;
  }

  function postRow(item, kind = "post") {
    return `<article class="post-row"><time class="post-date" datetime="${esc(item.date)}">${date(item.date)}</time><div><h3><a href="${localPath(kind, item.id)}">${esc(item.title)}</a></h3><p>${esc(item.description)}</p><div class="row-meta"><span>${[item.category, ...item.tags.map(tagName)].filter(Boolean).map(esc).join(" / ")}</span>${sample(item)}</div></div><a class="row-arrow" href="${localPath(kind, item.id)}" aria-label="${esc(item.title)} 읽기">${arrow}</a></article>`;
  }

  function projectVisual(project, detail = false) {
    return `<div class="project-visual ${detail ? "project-detail-visual" : ""}" aria-label="${esc(project.name)} 구성 예시"><div class="visual-topbar"><span class="visual-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${project.visual === "request" ? "REQUEST FLOW" : "RESEARCH NOTES"}</span></div>${project.visual === "request"
      ? '<div class="request-visual" aria-hidden="true"><span class="flow-node">request</span><span class="flow-arrow">→</span><span class="flow-node emphasis">inspect</span><span class="flow-arrow">→</span><span class="flow-node">insight</span></div>'
      : '<div class="notes-visual" aria-hidden="true"><i class="note-line"></i><i class="note-line"></i><i class="note-line"></i><i class="note-line"></i></div>'}<span class="visual-caption">PROJECT OUTLINE · EXAMPLE</span></div>`;
  }

  function projectCard(project) {
    return `<article class="project-card"><a href="${localPath("project", project.id)}" aria-label="${esc(project.name)} 자세히 보기">${projectVisual(project)}</a><p class="eyebrow">${esc(project.category)} &nbsp; / &nbsp; ${esc(project.year)}</p><div class="project-card-title"><h3><a href="${localPath("project", project.id)}">${esc(project.name)}</a></h3><a class="text-link" href="${localPath("project", project.id)}" aria-label="${esc(project.name)} 자세히 보기">${arrow}</a></div><p class="project-description">${esc(project.description)}</p><div class="stack">${project.stack.map(item => `<span>${esc(item)}</span>`).join("")}${sample(project)}</div></article>`;
  }

  function home() {
    const featured = data.posts.some(post => post.featured) ? data.posts.filter(post => post.featured).slice(0, 2) : data.posts.slice(0, 2);
    return `<div class="container"><section class="hero" aria-labelledby="home-title"><p class="eyebrow">${esc(data.profile.role)}</p><h1 id="home-title">${data.profile.headline.map(line => `<span>${esc(line)}</span>`).join("")}</h1><p class="hero-intro">${esc(data.profile.intro)}</p><div class="hero-actions"><a class="primary-link" href="#/posts">Explore posts <span class="arrow" aria-hidden="true">→</span></a><a class="text-link" href="#/about">About me ${arrow}</a></div><span class="hero-index" aria-hidden="true">PERSONAL SITE / 2026</span><a class="hero-scroll" href="#selected" data-scroll="selected">SCROLL TO EXPLORE <span class="arrow" aria-hidden="true">↓</span></a></section>
      <section class="home-section" id="selected">${sectionHeading("SELECTED WRITING", "먼저 읽어볼 글", "#/posts", "All posts")}<div class="featured-grid">${featured.map(post => `<article class="featured-item"><p class="eyebrow">${post.tags.map(tag => esc(tagName(tag))).join(" / ")}</p><h3 class="featured-title"><a href="${localPath("post", post.id)}">${esc(post.title)}</a></h3><p>${esc(post.description)}</p>${meta(post)}</article>`).join("")}</div></section>
      <section class="home-section">${sectionHeading("SELECTED PROJECTS", "작게 만들고, 깊게 이해하기", "#/projects", "All projects")}<div class="project-grid">${data.projects.slice(0, 2).map(project => projectCard(project)).join("")}</div></section>
      <section class="home-section">${sectionHeading("LATEST POSTS", "최근에 남긴 기록", "#/posts", "View archive")}<div class="post-list">${data.posts.slice(0, 5).map(post => postRow(post)).join("")}</div><p class="home-bottom-note">‘예시’로 표시한 글과 프로젝트는 화면 구성을 확인하기 위한 샘플입니다.</p></section></div>`;
  }

  function pageHead(eyebrow, title, intro) {
    return `<header class="page-head"><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1><p class="page-intro">${esc(intro)}</p></header>`;
  }

  function archivePath(kind, tag = "all", category = "") {
    const params = new URLSearchParams();
    if (tag !== "all") params.set("tag", tag);
    if (category) params.set("category", category);
    return `#/${kind}${params.size ? "?" + params : ""}`;
  }

  function archive(kind, selectedTag = "all", selectedCategory = "") {
    const isNotes = kind === "note";
    const items = isNotes ? data.notes : data.posts;
    const route = isNotes ? "notes" : "posts";
    const matchesCategory = (item, category) => !category || (category === "@uncategorized" ? !item.category : item.category === category || item.category?.startsWith(category + " / "));
    const categories = [...new Set(items.flatMap(item => {
      const parts = (item.category || "").split(" / ");
      return parts.map((_, index) => parts.slice(0, index + 1).join(" / ")).filter(Boolean);
    }))].sort((a, b) => a.localeCompare(b, "ko"));
    if (selectedCategory && selectedCategory !== "@uncategorized" && !categories.includes(selectedCategory)) selectedCategory = "";
    const categoryItems = items.filter(item => matchesCategory(item, selectedCategory));
    const tags = [...new Set(categoryItems.flatMap(item => item.tags))];
    const filtered = selectedTag === "all" ? categoryItems : categoryItems.filter(item => item.tags.includes(selectedTag));
    const filters = ["all", ...tags].map(tag => {
      const count = tag === "all" ? categoryItems.length : categoryItems.filter(item => item.tags.includes(tag)).length;
      return `<button class="filter-button" type="button" data-filter-tag="${esc(tag)}" data-filter-kind="${route}" aria-pressed="${tag === selectedTag}">${esc(tag === "all" ? "All" : tagName(tag))}<span>${count}</span></button>`;
    }).join("");
    const categoryOptions = [["", "전체 카테고리", items.length], ...categories.map(category => [category, category, items.filter(item => matchesCategory(item, category)).length]), ...(items.some(item => !item.category) ? [["@uncategorized", "미분류", items.filter(item => !item.category).length]] : [])];
    const categoryControl = categories.length ? `<label class="archive-category"><span>카테고리</span><select data-filter-category data-filter-kind="${route}" aria-label="카테고리 선택">${categoryOptions.map(([value, label, count]) => `<option value="${esc(value)}" ${value === selectedCategory ? "selected" : ""}>${esc(label)} (${count})</option>`).join("")}</select></label>` : "";
    return `<div class="container">${pageHead(isNotes ? "SMALL OBSERVATIONS" : "WRITING & RESEARCH", isNotes ? "Notes." : "Posts.", isNotes ? "아직 긴 글이 되지 않은 생각들. 짧은 실험, 자주 쓰는 명령, 다음에 다시 꺼내볼 메모를 남깁니다." : "궁금했던 것을 따라가며 남긴 기록입니다. 분석 과정과 배운 점, 그 사이의 작은 발견들을 정리합니다.")}${items.some(item => item.sample) ? '<p class="archive-notice"><span class="sample-label">예시</span> 표시는 콘텐츠를 채우기 전의 구성 예시입니다.</p>' : ""}<div class="filter-bar"><div class="filter-buttons" aria-label="주제 필터">${filters}</div><div class="archive-tools">${categoryControl}<button class="archive-search" type="button" data-search-open>Search ↗</button></div></div><div class="archive-list">${filtered.length ? filtered.map(item => postRow(item, kind)).join("") : '<div class="empty-state"><p>이 조건에 맞는 기록이 아직 없습니다.</p><a class="text-link" href="#/' + route + '">전체 기록 보기</a></div>'}</div></div>`;
  }

  function projects() {
    return `<div class="container">${pageHead("TOOLS & EXPERIMENTS", "Projects.", "궁금했던 것을 직접 만들어보며 이해합니다. 작은 도구와 개인 실험의 배경, 과정, 배운 점을 정리합니다.")}<p class="archive-notice">아래 프로젝트는 포트폴리오 구성을 보여주는 예시입니다.</p><div class="project-grid projects-page-grid">${data.projects.map(project => projectCard(project)).join("")}</div></div>`;
  }

  function renderBlock(block) {
    switch (block.type) {
      case "lead": return `<p class="article-lead">${esc(block.text)}</p>`;
      case "paragraph": return `<p>${esc(block.text)}</p>`;
      case "heading": return `<h2 id="${esc(block.id)}">${esc(block.text)}</h2>`;
      case "list": return `<ul>${block.items.map(item => `<li>${esc(item)}</li>`).join("")}</ul>`;
      case "code": return `<div class="article-code"><div class="code-heading"><span>${esc(block.language)}</span><button class="copy-code" type="button" aria-live="polite">복사</button></div><pre><code>${esc(block.code)}</code></pre></div>`;
      case "callout": return `<aside class="article-callout"><p class="eyebrow">${esc(block.label)}</p><p>${esc(block.text)}</p></aside>`;
      default: return "";
    }
  }

  function toc(headings, kind, id, section, inline = false) {
    if (!headings.length) return "";
    const baseLevel = Math.min(...headings.map(heading => heading.level || 2));
    return `<aside class="article-toc${inline ? " article-toc--inline" : ""}" aria-label="글 목차">${inline ? '<div class="toc-heading"><span>목차</span><span aria-hidden="true">≡</span></div>' : '<p class="eyebrow">ON THIS PAGE</p>'}<ol>${headings.map(heading => `<li class="toc-depth-${Math.max(0, (heading.level || 2) - baseLevel)}"><a href="${localPath(kind, id)}?section=${encodeURIComponent(heading.id)}" ${heading.id === section ? 'aria-current="location"' : ""}><span>${esc(heading.text)}</span>${inline ? '<span aria-hidden="true">→</span>' : ""}</a></li>`).join("")}</ol></aside>`;
  }

  function article(item, kind, section) {
    const isNotes = kind === "note";
    const archiveRoute = isNotes ? "notes" : "posts";
    const others = (isNotes ? data.notes : data.posts).filter(post => post.id !== item.id).slice(0, 2);
    const rendered = item.doc ? window.BlogPosts.renderDocument(item.doc, { assets: item.assets }) : null;
    const headings = rendered?.headings || item.body.filter(block => block.type === "heading");
    return `<article class="container post-detail"><header class="article-header"><a class="breadcrumb" href="#/${archiveRoute}">← BACK TO ${archiveRoute.toUpperCase()}</a><p class="eyebrow">${[item.category, ...item.tags.map(tagName)].filter(Boolean).map(esc).join(" / ")}</p><h1>${esc(item.title)}</h1><p>${esc(item.description)}</p>${meta(item)}</header><div class="article-layout article-layout--post">${toc(headings, kind, item.id, section, true)}<div class="article-content post-body">${rendered?.html ?? item.body.map(block => renderBlock(block)).join("")}</div></div><div class="article-end"><div class="article-tags">${item.tags.map(tag => `<a href="#/${archiveRoute}?tag=${encodeURIComponent(tag)}"># ${esc(tagName(tag))}</a>`).join("")}</div><a class="text-link" href="#/${archiveRoute}">전체 ${isNotes ? "노트" : "글"} 보기 <span class="arrow" aria-hidden="true">→</span></a></div><section class="related-section"><p class="eyebrow">MORE TO EXPLORE</p>${others.map(post => postRow(post, kind)).join("")}</section></article>`;
  }

  function projectDetail(project, section) {
    const headings = project.sections.map((item, index) => ({ id: `part-${index + 1}`, text: item.title }));
    const github = isHttpLink(project.github) ? `<a class="text-link" href="${esc(project.github)}" target="_blank" rel="noopener noreferrer">GitHub ${arrow}</a>` : '<span class="unconfigured-link">GitHub · 연결 예정</span>';
    return `<article class="container"><header class="article-header"><a class="breadcrumb" href="#/projects">← BACK TO PROJECTS</a><p class="eyebrow">${esc(project.category)} / ${esc(project.year)}</p><h1>${esc(project.name)}</h1><p>${esc(project.description)}</p>${sample(project)}<div class="project-detail-links">${github}<a class="text-link" href="${localPath("post", project.relatedPost)}">관련 글 읽기 ${arrow}</a></div></header>${projectVisual(project, true)}<dl class="project-facts"><div><dt>TYPE</dt><dd>개인 프로젝트 예시</dd></div><div><dt>STACK</dt><dd>${project.stack.map(esc).join(" / ")}</dd></div><div><dt>YEAR</dt><dd>${esc(project.year)}</dd></div></dl><div class="article-layout"><div class="article-content"><p class="article-lead">${esc(project.summary)}</p>${project.sections.map((item, index) => `<h2 id="part-${index + 1}">${esc(item.title)}</h2><p>${esc(item.text)}</p>`).join("")}</div>${toc(headings, "project", project.id, section)}</div><div class="article-end"><a class="text-link" href="#/projects">← 전체 프로젝트 보기</a><a class="text-link" href="${localPath("post", project.relatedPost)}">관련 기록으로 이어가기 ${arrow}</a></div><div class="page-bottom"></div></article>`;
  }

  function about() {
    const github = isHttpLink(data.profile.github) ? `<a href="${esc(data.profile.github)}" target="_blank" rel="noopener noreferrer">GitHub ↗</a>` : '<span class="unconfigured-link">GitHub · 연결 예정</span>';
    const email = data.profile.email ? `<a href="mailto:${esc(data.profile.email)}">${esc(data.profile.email)}</a>` : '<span class="unconfigured-link">Email · 연결 예정</span>';
    return `<div class="container">${pageHead("THE PERSON BEHIND THE NOTES", "About.", "어떤 질문을 품고, 무엇을 만들며, 어떻게 기록하는지.")}<div class="about-layout"><aside class="about-identity"><svg class="about-logo" viewBox="0 0 52 52" aria-hidden="true"><use href="assets/yt-logo.svg?v=${encodeURIComponent(contentRevision)}#mark"></use></svg><h2>${esc(data.profile.name)}</h2><p>${esc(data.profile.role)}</p></aside><div class="about-copy"><p>${esc(data.profile.about)}</p><section class="about-section"><p class="eyebrow">FOCUS</p><h2>관심을 두는 것들</h2>${data.profile.focus.map((item, index) => `<div class="focus-item"><span>0${index + 1}</span><div><h3>${esc(item.name)}</h3><p>${esc(item.description)}</p></div></div>`).join("")}</section><section class="about-section"><p class="eyebrow">EXPERIENCE & ACTIVITIES</p><h2>활동과 경험</h2><p class="placeholder-text">실제 경력, 프로젝트, 대회, 발표 등의 활동을 채울 자리입니다.<br>기간 · 역할 · 한두 문장의 설명 · 관련 링크로 구성할 수 있습니다.</p></section><section class="about-section" id="contact"><p class="eyebrow">GET IN TOUCH</p><h2>함께 이야기하고 싶다면</h2><div class="contact-row">${github}${email}</div></section></div></div></div>`;
  }

  function notFound() {
    return `<div class="container page-bottom">${pageHead("404 / NOT FOUND", "A missing page.", "이 주소에 해당하는 기록을 찾지 못했습니다.")}<a class="primary-link" href="#/">Back to home <span class="arrow" aria-hidden="true">→</span></a></div>`;
  }

  function missingPost(kind) {
    const checking = contentCheck === "checking", failed = contentCheck === "error";
    return `<div class="container page-bottom" data-publication-status role="status">${pageHead(checking ? "CHECKING PUBLICATION" : failed ? "CONNECTION UNAVAILABLE" : "404 / NOT FOUND", checking ? "글을 확인하고 있어요." : failed ? "최신 글을 확인하지 못했어요." : "A missing page.", checking ? "최신 글 목록을 불러오고 있습니다." : failed ? "연결을 확인한 뒤 다시 시도해 주세요." : "이 주소에 해당하는 기록을 찾지 못했습니다. 방금 발행한 글이라면 잠시 후 다시 확인해 주세요.")}<div class="hero-actions">${checking ? "" : '<button class="archive-search" type="button" data-refresh-posts>다시 확인 ↻</button>'}<a class="primary-link" href="#/${kind === "post" ? "posts" : "notes"}">글 목록으로 <span class="arrow" aria-hidden="true">→</span></a></div></div>`;
  }

  async function loadPublishedBundle(revision) {
    const url = new URL(bundleURL);
    url.searchParams.set("v", revision || String(Date.now()));
    url.searchParams.set("refresh", String(Date.now()));
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Content request failed");
    const value = await response.json();
    if (value.format !== "yt010108-public-content" || value.version !== 1 || !Array.isArray(value.posts) || !Array.isArray(value.managedKinds)) throw new Error("Invalid content data");
    window.BLOG_PUBLISHED = value.posts;
    window.BLOG_MANAGED_KINDS = value.managedKinds;
    hasPublishedContent = true;
  }

  function refreshPublished() {
    if (refreshTask) return refreshTask;
    refreshTask = (async () => {
      const previous = JSON.stringify([window.BLOG_PUBLISHED, window.BLOG_MANAGED_KINDS]);
      let changed = false;
      const firstLoad = !hasPublishedContent;
      try {
        let revision = "";
        try {
          const url = new URL("assets/deployment.json", bundleURL);
          url.searchParams.set("refresh", String(Date.now()));
          const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
          if (response.ok) {
            const marker = await response.json();
            if (/^[a-f0-9]{40}$/.test(marker.commit)) revision = marker.commit;
          }
        } catch { /* A fresh bundle can still be available when its marker cannot be read. */ }
        if (!hasPublishedContent || !revision || revision !== contentRevision) {
          await loadPublishedBundle(revision);
          changed = previous !== JSON.stringify([window.BLOG_PUBLISHED, window.BLOG_MANAGED_KINDS]);
          applyPublished(); contentRevision = revision;
        }
        contentCheck = "ready";
      } catch { contentCheck = "error"; }
      finally {
        refreshTask = null;
        if (changed || main.querySelector("[data-publication-status]")) render(firstLoad);
        if (dialog.open) updateSearch();
      }
    })();
    return refreshTask;
  }

  function closeMenu() {
    menu.classList.remove("is-open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "메뉴 열기");
  }

  function render(navigate = true) {
    const raw = location.hash.slice(1) || "/";
    const [path, query = ""] = raw.split("?");
    const params = new URLSearchParams(query);
    let parts;
    try { parts = path.split("/").filter(Boolean).map(decodeURIComponent); } catch { parts = ["404"]; }
    const [kind, id] = parts;
    const section = params.get("section");
    let html;
    let title = "Security research, notes & projects";
    let nav = kind || "home";
    if (!kind) html = home();
    else if (kind === "posts" || kind === "notes") {
      html = archive(kind === "posts" ? "post" : "note", params.get("tag") || "all", params.get("category") || "");
      title = kind === "posts" ? "Posts" : "Notes";
    } else if (kind === "projects") { html = projects(); title = "Projects"; }
    else if (kind === "about") { html = about(); title = "About"; }
    else if (kind === "post" || kind === "note") {
      const item = (kind === "post" ? data.posts : data.notes).find(post => post.id === id);
      html = item ? article(item, kind, section) : missingPost(kind);
      title = item ? item.title : contentCheck === "checking" ? "글 확인 중" : contentCheck === "error" ? "연결 확인" : "Not found";
      nav = kind === "post" ? "posts" : "notes";
    } else if (kind === "project") {
      const project = data.projects.find(item => item.id === id);
      html = project ? projectDetail(project, section) : notFound();
      title = project ? project.name : "Not found";
      nav = "projects";
    } else { html = notFound(); title = "Not found"; }
    if (!hasPublishedContent && (!kind || ["posts", "notes", "post", "note"].includes(kind))) {
      html = missingPost(kind === "note" || kind === "notes" ? "note" : "post");
      title = contentCheck === "error" ? "연결 확인" : "글 확인 중";
    }
    main.innerHTML = html;
    document.title = `${title} — ${data.profile.name}`;
    document.querySelectorAll("[data-nav]").forEach(link => {
      if (link.dataset.nav === nav) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    if (navigate) closeMenu();
    if (navigate) requestAnimationFrame(() => {
      if (section && document.getElementById(section)) document.getElementById(section).scrollIntoView({ behavior: "instant", block: "start" });
      else window.scrollTo({ top: 0, behavior: "instant" });
    });
  }

  const searchableItems = () => [
    ...data.posts.map(item => ({ ...item, kind: "post", type: "POST" })),
    ...data.notes.map(item => ({ ...item, kind: "note", type: "NOTE" })),
    ...data.projects.map(item => ({ ...item, title: item.name, tags: item.stack, kind: "project", type: "PROJECT" }))
  ];
  const normalize = text => String(text).normalize("NFKC").toLocaleLowerCase("ko-KR");

  function updateSearch() {
    const searchable = searchableItems();
    const query = normalize(searchInput.value).trim();
    let matches;
    if (!query) matches = [searchable[0], searchable[1], searchable.find(item => item.kind === "note"), searchable.find(item => item.kind === "project")].filter(Boolean);
    else {
      const tokens = query.split(/\s+/);
      matches = searchable.filter(item => {
        const text = normalize([item.title, item.description, item.category || "", item.searchText || "", ...item.tags, ...item.tags.map(tagName)].join(" "));
        return tokens.every(token => text.includes(token));
      });
    }
    searchStatus.textContent = query ? `${matches.length}개의 기록을 찾았습니다.` : "이런 기록부터 살펴보세요.";
    results.innerHTML = matches.length ? matches.map(item => `<a class="search-result" href="${localPath(item.kind, item.id)}"><span class="search-result-type">${item.type}</span><h3>${esc(item.title)}</h3><p>${esc(item.description)}</p></a>`).join("") : '<div class="empty-state"><p>일치하는 기록이 없습니다.</p><p class="placeholder-text">다른 단어나 짧은 검색어로 찾아보세요.</p></div>';
  }

  function openSearch() {
    if (dialog.open) return;
    searchInput.value = "";
    updateSearch();
    dialog.showModal();
    searchInput.focus();
    refreshPublished();
  }

  async function copyCode(button) {
    const code = button.closest(".article-code").querySelector("code").textContent;
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(code);
      else {
        const field = document.createElement("textarea");
        field.value = code;
        field.style.cssText = "position:fixed;left:-9999px;top:0";
        document.body.appendChild(field);
        field.select();
        const copied = document.execCommand("copy");
        field.remove();
        button.focus();
        if (!copied) throw new Error("Copy unavailable");
      }
      button.textContent = "복사됨 ✓";
    } catch { button.textContent = "코드를 선택해 복사해 주세요"; }
    window.setTimeout(() => { if (button.isConnected) button.textContent = "복사"; }, 2200);
  }

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest(".main-nav a")) closeMenu();
    if (target.closest("[data-search-open]")) openSearch();
    if (target.closest("[data-refresh-posts]")) { contentCheck = "checking"; render(false); refreshPublished(); }
    const scrollLink = target.closest("[data-scroll]");
    if (scrollLink) {
      event.preventDefault();
      document.getElementById(scrollLink.dataset.scroll)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      if (scrollLink.classList.contains("skip-link")) main.focus({ preventScroll: true });
    }
    const filter = target.closest("[data-filter-tag]");
    if (filter) location.hash = archivePath(filter.dataset.filterKind, filter.dataset.filterTag, new URLSearchParams(location.hash.split("?")[1]).get("category") || "");
    const copyButton = target.closest(".copy-code");
    if (copyButton) copyCode(copyButton);
    if (target.closest(".search-result")) dialog.close();
    if (!target.closest(".header-inner")) closeMenu();
  });

  document.addEventListener("change", event => {
    if (event.target instanceof HTMLSelectElement && event.target.matches("[data-filter-category]")) {
      const tag = new URLSearchParams(location.hash.split("?")[1]).get("tag") || "all";
      location.hash = archivePath(event.target.dataset.filterKind, tag, event.target.value);
    }
  });

  menuButton.addEventListener("click", () => {
    const open = menuButton.getAttribute("aria-expanded") !== "true";
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
    menu.classList.toggle("is-open", open);
  });
  document.querySelector(".close-search").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  searchInput.addEventListener("input", updateSearch);
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); if (dialog.open) dialog.close(); else openSearch(); }
    if (event.key === "Escape") {
      if (dialog.open) { event.preventDefault(); dialog.close(); }
      closeMenu();
    }
  });
  window.addEventListener("hashchange", () => { contentCheck = "checking"; render(); refreshPublished(); });
  window.addEventListener("focus", refreshPublished);
  window.addEventListener("online", refreshPublished);
  window.addEventListener("pageshow", event => { if (event.persisted) refreshPublished(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshPublished(); });
  setInterval(() => { if (!document.hidden) refreshPublished(); }, 30000);

  document.querySelectorAll("[data-profile-name]").forEach(node => { node.textContent = data.profile.name; });
  document.getElementById("footer-links").innerHTML = `${isHttpLink(data.profile.github) ? `<a href="${esc(data.profile.github)}" target="_blank" rel="noopener noreferrer">GitHub ↗</a>` : ""}<a href="#/about">About ↗</a><button type="button" data-search-open>Search ↗</button>`;
  document.addEventListener("error", event => {
    if (event.target instanceof HTMLImageElement && event.target.classList.contains("writer-link-image")) event.target.hidden = true;
  }, true);
  render();
  refreshPublished();
})();
