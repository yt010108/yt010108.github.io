import { esc } from "../../shared/posts.js";
import { homeSections, isPublicProject, newestPosts } from "../../shared/home.js";

export const homePanelHTML = () => `<div class="cms-home-layout">
  <div class="cms-home-controls">
    <label class="cms-home-order">섹션 순서 <select id="home-first"><option value="post">POST → PROJECT</option><option value="project">PROJECT → POST</option></select></label>
    <section><h2>홈에 표시할 글 <small id="home-post-count"></small></h2>
      <ul id="home-post-list" class="cms-home-list" aria-label="선택한 글 순서"></ul>
      <details id="home-library" class="cms-site-section"><summary>글 추가 <span id="home-post-total"></span></summary>
        <div class="cms-home-library"><input id="home-search" type="search" aria-label="공개 글 제목 검색" placeholder="글 제목 검색" autocomplete="off"><ul id="home-matches" class="cms-home-list" aria-label="추가할 수 있는 글"></ul></div>
      </details>
    </section>
    <section><h2>홈에 표시할 프로젝트 <small id="home-project-count"></small></h2>
      <ul id="home-project-list" class="cms-home-list" aria-label="홈 프로젝트 선택과 순서"></ul>
    </section>
  </div>
  <section class="cms-home-preview" aria-labelledby="home-preview-title"><h2 id="home-preview-title">홈 미리보기</h2><div id="home-preview"></div></section>
</div>`;

const $ = id => document.getElementById(id);
const normalize = text => text.normalize("NFKC").trim().toLowerCase();
const note = message => `<li class="cms-site-empty">${esc(message)}</li>`;

function pickRow(kind, item, index, count) {
  const title = esc(item.title ?? item.name), detail = esc(item.date ?? item.category);
  const chosen = index >= 0;
  const move = (step, label, glyph, disabled) => `<button type="button" class="writer-text-button" data-move="${step}" aria-label="${title} ${label}" ${disabled ? "disabled" : ""}>${glyph}</button>`;
  return `<li data-kind="${kind}" data-id="${esc(item.id)}"><label class="cms-site-checkbox"><input type="checkbox" ${chosen ? "checked" : ""}><span>${title}<small>${detail}</small></span></label>
    ${chosen ? `<span class="cms-home-moves">${move(-1, "위로", "↑", index === 0)}${move(1, "아래로", "↓", index === count - 1)}</span>` : ""}</li>`;
}

function previewCard(kind, item) {
  const link = `../#/${kind}/${encodeURIComponent(item.id)}`;
  return `<article>${kind === "project" ? `<small>${esc(item.category)}</small>` : ""}<h4><a href="${esc(link)}" target="_blank" rel="noopener">${esc(item.title ?? item.name)}</a></h4>
    ${kind === "post" ? `<time datetime="${esc(item.date)}">${esc(item.date.replaceAll("-", "."))}</time>` : `<p>${esc(item.description)}</p>`}</article>`;
}

export function createHomeEditor({ allowed, changed }) {
  let site = null, posts = [], sections = [];
  function renderPreview() {
    if (!site) { $("home-preview").replaceChildren(); return; }
    const { profile } = site;
    const body = sections.filter(([, items]) => items.length).map(([kind, items]) =>
      `<section><header><h3>${kind.toUpperCase()}</h3><a href="../#/${kind}s" target="_blank" rel="noopener">All ${kind}s ↗</a></header><div class="cms-home-cards">${items.map(item => previewCard(kind, item)).join("")}</div></section>`).join("");
    $("home-preview").innerHTML = `<header class="cms-home-hero"><small>${esc(profile.role)}</small><p>${profile.headline.map(esc).join("<br>")}</p><a href="../#/posts" target="_blank" rel="noopener">Explore posts →</a> <a href="../#/about" target="_blank" rel="noopener">About me ↗</a></header>
      ${body}<footer><span>${esc(profile.name)}</span><span>© ${new Date().getFullYear()} ${esc(profile.name)}</span></footer>`;
  }

  function renderMatches() {
    if (!$("home-library").open || !site) return;
    const chosen = new Set(Object.fromEntries(sections).post.map(item => item.id));
    const query = normalize($("home-search").value);
    const matches = posts.filter(item => !chosen.has(item.id) && normalize(item.title).includes(query));
    $("home-matches").innerHTML = matches.map(item => `<li><button type="button" data-add-post="${esc(item.id)}" aria-label="${esc(item.title)} ${esc(item.date)} 추가"><span>${esc(item.title)}<small>${esc([item.date, item.category].filter(Boolean).join(" · "))}</small></span><span aria-hidden="true">＋</span></button></li>`).join("") || note(query ? "추가할 수 있는 검색 결과가 없어요." : "추가할 공개 글이 없어요.");
  }

  function render() {
    sections = homeSections(site?.home, posts, site?.projects ?? []);
    const { post, project } = Object.fromEntries(sections);
    $("home-first").value = site?.home.firstSection ?? "post";
    $("home-post-total").textContent = "공개 글 " + posts.length + "개";
    $("home-post-count").textContent = post.length + "개 선택";
    $("home-project-count").textContent = project.length + "개 선택";
    $("home-post-list").innerHTML = post.map((item, index) => pickRow("post", item, index, post.length)).join("") || note("홈에 표시할 글을 추가해 주세요.");
    const remaining = (site?.projects ?? []).filter(item => isPublicProject(item) && !site.home.projectIds.includes(item.id));
    $("home-project-list").innerHTML = [...project, ...remaining].map((item, index) => pickRow("project", item, index < project.length ? index : -1, project.length)).join("") || note("프로젝트 탭에서 공개한 항목이 여기에 보여요.");
    renderMatches();
    renderPreview();
  }

  function edit(kind, id, step = 0) {
    const visible = Object.fromEntries(sections)[kind].map(item => item.id);
    const key = kind === "post" ? "postIds" : "projectIds";
    const ids = [...(site.home[key] ?? visible)];
    const index = ids.indexOf(id);
    if (step) {
      const next = ids.indexOf(visible[visible.indexOf(id) + step]);
      if (index < 0 || next < 0) return;
      [ids[index], ids[next]] = [ids[next], ids[index]];
    } else if (index < 0) ids.push(id);
    else ids.splice(index, 1);
    site.home[key] = ids;
    render();
    changed();
  }

  const controls = document.querySelector(".cms-home-controls");
  controls.addEventListener("change", event => {
    if (!allowed()) return;
    if (event.target.id === "home-first") { site.home.firstSection = event.target.value; render(); changed(); return; }
    const row = event.target.closest("li[data-kind]");
    if (!row) return;
    const { kind, id } = row.dataset;
    edit(kind, id);
    const list = $("home-" + kind + "-list");
    (list.querySelector(`[data-id="${CSS.escape(id)}"] input`) || list.querySelector("input") || $("home-library").querySelector("summary")).focus({ preventScroll: true });
  });
  controls.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button || !allowed()) return;
    if (button.dataset.addPost) { edit("post", button.dataset.addPost); $("home-search").focus({ preventScroll: true }); return; }
    const row = button.closest("li[data-kind]");
    if (!row || !button.dataset.move) return;
    const { kind, id } = row.dataset;
    edit(kind, id, Number(button.dataset.move));
    const moved = $("home-" + kind + "-list").querySelector(`[data-id="${CSS.escape(id)}"]`);
    (moved.querySelector(`[data-move="${button.dataset.move}"]:enabled`) || moved.querySelector("input")).focus({ preventScroll: true });
  });
  $("home-search").addEventListener("input", renderMatches);
  $("home-library").addEventListener("toggle", renderMatches);
  return {
    setData(value, entries) { site = value; posts = newestPosts(entries); render(); },
    render, renderPreview
  };
}
