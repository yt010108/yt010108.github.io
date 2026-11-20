import { esc } from "../../shared/posts.js";
import { PROFILE_SECTIONS, PROJECT_TEXT_FIELDS, validateSite, publicSite } from "../../shared/site.js";
import { homePanelHTML, createHomeEditor } from "./home.js";

const basics = [["name", "계정 이름"], ["displayName", "표시 이름"], ["role", "홈 상단 소개"], ["headline", "홈 제목 · 한 줄에 하나"], ["intro", "홈 소개"], ["about", "About 소개"], ["github", "GitHub 주소"], ["tistory", "티스토리 주소"], ["email", "이메일"]];
const multiline = new Set(["headline", "intro", "about", "description", "items", "summary", "stack", "flow", "text"]);
const lines = value => value.split("\n").map(line => line.trim()).filter(Boolean);
const field = (label, value, attributes, key) => `<label>${esc(label)}${multiline.has(key) ? `<textarea ${attributes} rows="${["about", "summary", "text"].includes(key) ? 5 : 3}">${esc(value)}</textarea>` : `<input ${attributes} value="${esc(value)}">`}</label>`;

export const siteViewHTML = () => `<section id="site-view" class="cms-manager" aria-labelledby="site-title" hidden>
  <div class="cms-title-row"><h1 id="site-title" tabindex="-1">홈 화면 설정</h1><button id="site-refresh" type="button" class="writer-button" disabled>최신 저장본 불러오기</button></div>
  <p id="site-status" class="cms-list-note" role="status" aria-live="polite"></p>
  <fieldset id="site-fields" aria-labelledby="site-title" disabled>
    <div id="site-home-panel">${homePanelHTML()}
      <details class="cms-site-section"><summary>홈 소개 · About 편집</summary><div class="cms-site-section-body"><div class="cms-site-panel-heading"><h2>프로필</h2><a class="writer-text-button" href="../#/about" target="_blank" rel="noopener noreferrer">공개 About 보기 ↗</a></div><div id="site-basics" class="cms-site-form"></div><div id="site-profile-sections"></div></div></details>
    </div>
    <div id="site-projects-panel" hidden><div class="cms-site-panel-heading"><label class="cms-search"><span class="writer-sr-only">프로젝트 검색</span><input id="site-project-search" type="search" placeholder="프로젝트 이름·분류 검색"></label><button id="site-project-add" type="button" class="writer-button">프로젝트 추가</button></div><div class="cms-site-project-layout"><div id="site-project-list" class="cms-site-project-list" role="group" aria-label="프로젝트 목록"></div><div id="site-project-editor" class="cms-site-project-editor"></div></div></div>
  </fieldset>
  <div class="cms-site-save-row"><p class="writer-small-note">입력은 저장 버튼을 눌렀을 때 GitHub에 반영돼요. 저장소는 공개이며, ‘사이트에 표시’를 끈 항목도 저장소에서는 볼 수 있어요.</p><button id="site-save" type="button" class="writer-button writer-primary" disabled>GitHub에 저장</button></div>
</section>`;

export function createSiteManager({ repository, onBusy }) {
  const $ = id => document.getElementById(id);
  let value = null, saved = null, selected = null, posts = [], busy = false, externalBusy = true, deploymentTimer;
  const fields = input => input ? JSON.stringify([input.profile, input.projects, input.home, input.pages]) : "";
  const dirty = () => fields(value) !== fields(saved);
  const allowed = () => value && repository.connected && !busy && !externalBusy;
  const project = () => value?.projects.find(item => item.id === selected);
  const status = (text, error = false) => { $("site-status").textContent = text; $("site-status").dataset.error = String(error); $("site-status").setAttribute("role", error ? "alert" : "status"); };
  function setBusy(next) {
    externalBusy = next;
    $("site-fields").disabled = !allowed(); $("site-save").disabled = !allowed() || !dirty();
    $("site-refresh").disabled = busy || externalBusy || !repository.connected;
  }
  function changed() { status(dirty() ? "저장하지 않은 변경이 있어요. 다른 관리 메뉴로 이동해도 입력은 유지돼요." : "저장된 내용과 같아요."); setBusy(externalBusy); }
  const homeEditor = createHomeEditor({ allowed, changed });
  function setSection(section) {
    const home = section === "home";
    $("site-title").textContent = home ? "홈 화면 설정" : "프로젝트";
    $("site-home-panel").hidden = !home;
    $("site-projects-panel").hidden = home;
    if (home) homeEditor.render();
    else renderProjectList();
  }
  function actions(scope, index, total) {
    return `<div class="cms-site-row-actions"><button type="button" class="writer-text-button" data-site-action="up" data-scope="${esc(scope)}" data-index="${index}" aria-label="${index + 1}번 항목 위로" ${index === 0 ? "disabled" : ""}>위로</button><button type="button" class="writer-text-button" data-site-action="down" data-scope="${esc(scope)}" data-index="${index}" aria-label="${index + 1}번 항목 아래로" ${index === total - 1 ? "disabled" : ""}>아래로</button><button type="button" class="writer-text-button" data-site-action="remove" data-scope="${esc(scope)}" data-index="${index}" aria-label="${index + 1}번 항목 삭제">삭제</button></div>`;
  }
  function renderProfile() {
    $("site-basics").innerHTML = basics.map(([key, label]) => field(label, Array.isArray(value?.profile[key]) ? value.profile[key].join("\n") : value?.profile[key] || "", `data-profile-field="${key}" maxlength="${["intro", "about"].includes(key) ? 12000 : key === "headline" ? 803 : key === "email" ? 254 : ["github", "tistory"].includes(key) ? 1500 : 200}"`, key)).join("");
    $("site-profile-sections").innerHTML = PROFILE_SECTIONS.map(section => {
      const items = value?.profile[section.key] || [];
      return `<details class="cms-site-section"><summary>${esc(section.label)} <span>${items.length}</span></summary><div class="cms-site-section-body">${items.map((item, index) => `<div class="cms-site-repeat-item"><div class="cms-site-form">${section.fields.map(([key, label]) => field(label, key === "items" ? item[key].join("\n") : item[key], `data-profile-section="${section.key}" data-index="${index}" data-field="${key}" maxlength="${key === "description" ? 3000 : key === "href" ? 1500 : key === "items" ? 3630 : 250}"`, key)).join("")}</div>${actions(section.key, index, items.length)}</div>`).join("") || '<p class="cms-site-empty">등록된 항목이 없어요.</p>'}<button type="button" class="writer-button" data-site-add="${section.key}">${esc(section.label)} 추가</button></div></details>`;
    }).join("");
  }
  function renderProjectList() {
    const query = $("site-project-search").value.toLowerCase().trim();
    $("site-project-list").innerHTML = (value?.projects || []).filter(item => !query || (item.name + " " + item.category).toLowerCase().includes(query)).map(item => `<button type="button" class="cms-site-project-item" data-project-select="${esc(item.id)}" aria-pressed="${item.id === selected}"><span>${esc(item.name || "새 프로젝트")}</span><small>${esc(item.category || "미분류")} · ${item.published ? "공개" : "사이트에서 숨김"}${item.published && !item.sample && value.home.projectIds.includes(item.id) ? " · 홈에 표시" : ""}</small></button>`).join("") || '<p class="cms-site-empty">프로젝트가 없어요.</p>';
  }
  function renderProject() {
    renderProjectList(); const item = project();
    if (!item) { $("site-project-editor").innerHTML = '<p class="cms-site-empty">프로젝트를 선택하거나 추가해 주세요.</p>'; return; }
    const existing = saved?.projects.some(original => original.id === item.id), index = value.projects.indexOf(item);
    $("site-project-editor").innerHTML = `<div class="cms-site-project-top">
      <label class="cms-site-checkbox"><input type="checkbox" data-project-field="published" ${item.published ? "checked" : ""}>사이트에 표시</label>
      <a href="../#/project/${esc(item.id)}" class="writer-text-button" target="_blank" rel="noopener noreferrer">공개 페이지 ↗</a></div>
      <div class="cms-site-form">${field("주소 ID", item.id, `data-project-field="id" maxlength="90" ${existing ? "readonly" : ""}`, "id")}${PROJECT_TEXT_FIELDS.map(([key, label]) => field(label, item[key], `data-project-field="${key}" maxlength="${["summary", "description"].includes(key) ? 12000 : key === "github" ? 1500 : 250}"`, key)).join("")}${field("기술 스택 · 한 줄에 하나", item.stack.join("\n"), 'data-project-field="stack" maxlength="3025"', "stack")}${field("구성도 단계 · 한 줄에 하나 (최대 8개)", item.flow.join("\n"), 'data-project-field="flow" maxlength="968"', "flow")}</div>
      <p class="writer-small-note">${existing ? "기존 링크를 유지하기 위해 저장한 프로젝트의 주소 ID는 변경하지 않아요." : "주소 ID는 영문 소문자·숫자·하이픈으로 입력하세요. 저장 후 주소가 고정돼요."}</p>
      <div class="cms-site-section cms-site-section-body"><h3>상세 설명</h3>${item.sections.map((section, sectionIndex) => `<div class="cms-site-repeat-item">${field("설명 제목", section.title, `data-project-section="${sectionIndex}" data-field="title" maxlength="200"`, "title")}${field("설명 내용", section.text, `data-project-section="${sectionIndex}" data-field="text" maxlength="15000"`, "text")}${actions("project-sections", sectionIndex, item.sections.length)}</div>`).join("")}<button type="button" class="writer-button" data-site-add="project-sections">설명 추가</button></div>
      <details class="cms-site-section"><summary>관련 글 <span>${item.relatedPosts.length}</span></summary><div class="cms-site-section-body"><input id="site-related-search" type="search" placeholder="관련 글 검색" aria-label="관련 글 검색"><div class="cms-site-related">${posts.filter(post => post.status === "published").map(post => `<label data-related-label="${esc(post.id)}" class="cms-site-checkbox"><input type="checkbox" data-related-post="${esc(post.id)}" ${item.relatedPosts.includes(post.id) ? "checked" : ""}><span>${esc(post.title)}<small>${post.kind === "notes" ? "Notes" : "Posts"} · ${esc(post.category || "미분류")}</small></span></label>`).join("") || '<p>공개된 글이 없어요.</p>'}</div></div></details>
      ${actions("projects", index, value.projects.length)}<p class="writer-small-note">위로·아래로 버튼으로 전체 프로젝트 목록의 순서를 바꿔요. 홈에 표시할 항목과 순서는 홈 화면 설정에서 정해요.</p>`;
    setBusy(externalBusy);
  }
  function render() { homeEditor.setData(value, posts); renderProfile(); if (!project()) selected = value?.projects[0]?.id || null; renderProject(); setBusy(externalBusy); }
  async function refresh({ discard = false } = {}) {
    if (busy || !repository.connected) return;
    if (dirty() && !discard) { status("저장하지 않은 입력을 유지했어요."); return; }
    if (discard && dirty() && !confirm("저장하지 않은 홈·프로젝트 설정을 버리고 최신 저장본을 불러올까요?")) return;
    const generation = repository.generation; busy = true; onBusy(true); status("GitHub의 설정을 불러오는 중…");
    try {
      const snapshot = await repository.snapshot(), latest = await repository.readSite(snapshot.head);
      if (!repository.connected || generation !== repository.generation) return;
      value = latest.value; saved = structuredClone(value); posts = snapshot.index.entries; render(); status("");
    } catch (error) { status(error.message, true); }
    finally { busy = false; onBusy(false); setBusy(false); }
  }
  async function watchDeployment(attempt = 0) {
    clearTimeout(deploymentTimer); if (!saved || !repository.connected) return;
    try {
      const response = await fetch(new URL("../assets/site-data.js?check=" + Date.now(), location.href), { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(12000) });
      const source = response.ok ? await response.text() : "", prefix = "window.BLOG_SITE_DATA = ";
      if (source.startsWith(prefix) && JSON.stringify(JSON.parse(source.slice(prefix.length).replace(/;\s*$/, ""))) === JSON.stringify(publicSite(saved, posts))) { if (!dirty()) status("저장한 내용이 공개 사이트에 반영됐어요."); return; }
    } catch {}
    if (attempt < 45) deploymentTimer = setTimeout(() => watchDeployment(attempt + 1), 4000);
  }
  async function save() {
    if (!allowed() || !dirty()) return;
    try { validateSite(value); } catch (error) { status(error.message, true); return; }
    const generation = repository.generation; busy = true; onBusy(true); status("GitHub에 저장하는 중…");
    try {
      const result = await repository.saveSite(saved, value);
      if (!repository.connected || generation !== repository.generation) return;
      value = result.value; saved = structuredClone(value); posts = result.entries; render(); status("GitHub에 저장했어요. 배포가 끝나면 공개 사이트에 반영돼요."); watchDeployment();
    } catch (error) { status(error.message, true); }
    finally { busy = false; onBusy(false); setBusy(false); }
  }
  $("site-fields").addEventListener("input", event => {
    if (!allowed()) return; const element = event.target, data = element.dataset;
    if (data.profileField) {
      value.profile[data.profileField] = data.profileField === "headline" ? lines(element.value) : element.value;
      if (["headline", "role", "name"].includes(data.profileField)) homeEditor.renderPreview();
    }
    else if (data.profileSection) value.profile[data.profileSection][Number(data.index)][data.field] = data.field === "items" ? lines(element.value) : element.value;
    else if (data.projectField && project()) {
      const item = project(), key = data.projectField;
      if (key === "id" && saved.projects.some(original => original.id === item.id)) return;
      if (key === "id" && value.projects.some(other => other !== item && other.id === element.value)) { status("같은 주소 ID의 프로젝트가 있어요. 다른 주소를 입력해 주세요.", true); return; }
      if (key === "id") {
        value.home.projectIds = value.home.projectIds.map(id => id === item.id ? element.value : id);
        selected = element.value;
      }
      item[key] = element.type === "checkbox" ? element.checked : ["stack", "flow"].includes(key) ? lines(element.value) : element.value;
      if (["id", "name", "category", "published"].includes(key)) renderProjectList();
    } else if (data.projectSection !== undefined && project()) project().sections[Number(data.projectSection)][data.field] = element.value;
    else if (data.relatedPost && project()) { const ids = new Set(project().relatedPosts); element.checked ? ids.add(data.relatedPost) : ids.delete(data.relatedPost); project().relatedPosts = [...ids]; }
    else if (element.id === "site-project-search") { renderProjectList(); return; }
    else if (element.id === "site-related-search") { const query = element.value.toLowerCase(); $("site-project-editor").querySelectorAll("[data-related-label]").forEach(label => { label.hidden = !label.textContent.toLowerCase().includes(query); }); return; }
    else return;
    changed();
  });
  $("site-fields").addEventListener("click", event => {
    if (!allowed()) return; const button = event.target.closest("button"); if (!button) return; const data = button.dataset;
    if (data.projectSelect !== undefined) { selected = data.projectSelect; renderProject(); return; }
    if (button.id === "site-project-add") {
      if (value.projects.length >= 60) { status("프로젝트는 60개까지 추가할 수 있어요.", true); return; }
      selected = "project-" + crypto.randomUUID().slice(0, 8);
      value.projects.push({ id: selected, ...Object.fromEntries(PROJECT_TEXT_FIELDS.map(([key]) => [key, key === "name" ? "새 프로젝트" : ""])), stack: [], flow: [], sections: [], relatedPosts: [], published: false, sample: false }); renderProject(); changed(); return;
    }
    if (data.siteAdd) {
      if (data.siteAdd === "project-sections") { if (!project() || project().sections.length >= 25) return; project().sections.push({ title: "새 설명", text: "" }); renderProject(); }
      else { const section = PROFILE_SECTIONS.find(item => item.key === data.siteAdd); if (!section || value.profile[section.key].length >= 30) return; value.profile[section.key].push(Object.fromEntries(section.fields.map(([key]) => [key, key === "items" ? [] : ["name", "title"].includes(key) ? "새 항목" : ""]))); renderProfile(); const detail = document.querySelector(`[data-site-add="${section.key}"]`).closest("details"); detail.open = true; }
      changed(); return;
    }
    if (!data.siteAction) return;
    const scope = data.scope, list = scope === "projects" ? value.projects : scope === "project-sections" ? project()?.sections : value.profile[scope], index = Number(data.index);
    if (!list || !list[index]) return;
    if (data.siteAction === "remove") {
      const label = list[index].name || list[index].title || "이 항목";
      if (!confirm(label + "을 목록에서 삭제할까요? GitHub에 저장하면 공개 사이트에서도 제거돼요.")) return;
      if (scope === "projects") value.home.projectIds = value.home.projectIds.filter(id => id !== list[index].id);
      list.splice(index, 1);
    }
    else { const next = index + (data.siteAction === "up" ? -1 : 1); if (next < 0 || next >= list.length) return; [list[index], list[next]] = [list[next], list[index]]; }
    if (scope === "projects" || scope === "project-sections") { if (!project()) selected = value.projects[0]?.id || null; renderProject(); }
    else { renderProfile(); const detail = document.querySelector(`[data-site-add="${scope}"]`).closest("details"); detail.open = true; }
    changed();
  });
  $("site-refresh").addEventListener("click", () => refresh({ discard: true })); $("site-save").addEventListener("click", save);
  return { refresh, save, setSection, setBusy, isLoaded: () => Boolean(value), isDirty: dirty, isBusy: () => busy,
    discard() { value = saved ? structuredClone(saved) : null; render(); },
    clear() { clearTimeout(deploymentTimer); if (!dirty()) { value = null; saved = null; posts = []; selected = null; render(); } setBusy(true); }
  };
}
