import { createIcons, Search, NotebookPen, GitBranch, ListTodo, ArrowUpRight, Plus, Save } from "lucide";
import { esc } from "../shared/posts.js";
import { validateDashboard, faviconURL, shortcutURL } from "../shared/dashboard.js";
import { validateActivity, contributionsForWidth } from "../shared/github-activity.js";
import { createDashboardWorkspace } from "./dashboard-workspace.js";

const base = new URL("../", document.currentScript?.src || new URL("assets/dashboard.js", location.href));
let active, config, activity, query = "", activityChecked = 0;
const icon = name => '<i data-lucide="' + name + '" aria-hidden="true"></i>';
const icons = () => createIcons({ icons: { Search, NotebookPen, GitBranch, ListTodo, ArrowUpRight, Plus, Save }, attrs: { width: 16, height: 16, "stroke-width": 1.5 } });
async function publicJSON(path, revision) {
  const url = new URL(path, base); url.searchParams.set("v", revision || "current");
  const response = await fetch(url, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error("대시보드를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  return response.json();
}
const items = () => [...(active?.data.posts || []), ...(active?.data.notes || [])].filter(item => !item.sample).sort((a, b) => b.date.localeCompare(a.date) || (b.publishedAt || "").localeCompare(a.publishedAt || ""));
function paintConfig() {
  if (!active?.root.isConnected || !config) return;
  active.root.querySelector("[data-dashboard-shortcuts]").innerHTML = config.shortcuts.map(item => '<a class="dashboard-shortcut" href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer"><span class="dashboard-shortcut-icon" data-favicon-fallback="' + esc(item.title.slice(0, 1)) + '"><img src="' + esc(faviconURL(item.url)) + '" width="25" height="25" alt="" referrerpolicy="no-referrer"></span><span>' + esc(item.title) + '</span></a>').join("");
  active.workspace?.load(config);
}
function projectLinks(projects) {
  const links = [{ title: "블로그 개선", description: "글쓰기 · 대시보드 정리", url: "https://github.com/yt010108/yt010108.github.io" }, ...(projects || []).filter(project => !project.sample && project.status === "연구·개발" && project.github).slice(0, 2).map(project => ({ title: project.name, description: project.type, url: project.github }))];
  const rows = links.flatMap(link => {
    let url; try { url = shortcutURL(link.url); } catch { return []; }
    return ['<li><a class="dashboard-project-link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + icon("git-branch") + '<span class="dashboard-project-label"><strong>' + esc(link.title) + '</strong><span>' + esc(link.description || "프로젝트 저장소") + '</span></span>' + icon("arrow-up-right") + '</a></li>'];
  }).join("");
  return '<section class="dashboard-projects" aria-labelledby="dashboard-projects-title"><div class="dashboard-projects-head"><h3 id="dashboard-projects-title">Working on</h3><a class="dashboard-text-link" href="#/projects">Projects ' + icon("arrow-up-right") + '</a></div><ul>' + rows + '</ul></section>';
}
function paintRecent(filter = "all") {
  if (!active?.root.isConnected) return;
  active.filter = filter;
  const entries = items().filter(item => filter === "all" || item.kind === filter).slice(0, 3);
  active.root.querySelector("[data-dashboard-recent]").innerHTML = entries.length ? entries.map(item => '<a class="dashboard-entry" href="#/' + (item.kind === "notes" ? "note" : "post") + '/' + encodeURIComponent(item.id) + '"><div class="dashboard-entry-meta"><span>' + (item.kind === "notes" ? "NOTE" : "POST") + (item.category ? " / " + esc(item.category) : "") + '</span>' + icon("arrow-up-right") + '</div><h3>' + esc(item.title) + '</h3><p>' + esc(item.description || "") + '</p><time datetime="' + esc(item.date) + '">' + esc(item.date.replaceAll("-", ".")) + '</time></a>').join("") : '<p class="dashboard-empty">아직 표시할 기록이 없어요.</p>';
  active.root.querySelectorAll("[data-dashboard-filter]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.dashboardFilter === filter))); icons();
}
function calendar(period) {
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const cells = period.cells.map(day => {
    if (day.state === "padding") return '<span class="dashboard-day dashboard-day-blank"></span>';
    const recorded = day.state === "recorded", label = recorded ? day.count === null ? ["No contributions", "Few contributions", "Some contributions", "Many contributions", "Most contributions"][day.level] : day.count + (day.count === 1 ? " contribution" : " contributions") : "Activity data unavailable";
    return '<span class="dashboard-day' + (recorded ? "" : " dashboard-day-unavailable") + '" data-calendar-date="' + day.date + '"' + (recorded ? ' data-level="' + day.level + '"' : '') + ' title="' + esc(day.date + " · " + label) + '"></span>';
  }).join("");
  return '<div class="dashboard-calendar-chart" style="--calendar-weeks:' + period.weeks + '"><div class="dashboard-months" aria-hidden="true">' + period.labels.map(label => '<span style="grid-column:' + label.column + '">' + monthNames[label.month - 1] + '</span>').join("") + '</div><div class="dashboard-weekdays" aria-hidden="true"><span style="grid-row:2">Mon</span><span style="grid-row:4">Wed</span><span style="grid-row:6">Fri</span></div><div class="dashboard-calendar-grid" role="img" aria-label="' + esc("GitHub contributions from " + period.start + " to " + period.end) + '">' + cells + '</div></div>';
}
function paintCalendar() {
  const node = active?.root.querySelector("[data-github-calendar]"); if (!node || !activity) return;
  if (activity.available) {
    const period = contributionsForWidth(activity.days, node.clientWidth); node.style.setProperty("--calendar-weeks", period.weeks);
    node.innerHTML = calendar(period) + '<div class="dashboard-calendar-foot"><span class="dashboard-calendar-legend">Less ' + [0, 1, 2, 3, 4].map(level => '<span class="dashboard-day" data-level="' + level + '"></span>').join("") + ' More</span></div><p class="dashboard-calendar-updated">Updated ' + esc(activity.fetchedAt.slice(0, 10).replaceAll("-", ".")) + '</p>';
  } else node.innerHTML = '<p class="dashboard-empty">GitHub 활동을 불러오지 못했어요.<br><a href="https://github.com/yt010108" target="_blank" rel="noopener noreferrer">GitHub에서 확인 ↗</a></p>';
  icons();
}
function refresh(force = false) {
  if (!active?.root.isConnected || (!force && Date.now() - activityChecked < 300000)) return;
  activityChecked = Date.now();
  publicJSON("assets/github-activity.json", active.revision).then(value => { activity = validateActivity(value); paintCalendar(); }).catch(() => { if (!activity) { activity = { available: false }; paintCalendar(); } });
}
function querySearch(input) {
  query = input.value;
  const panel = active.root.querySelector("[data-dashboard-results]"), normalized = query.normalize("NFKC").toLowerCase().trim();
  if (!normalized) { panel.hidden = true; return; }
  const tokens = normalized.split(/\s+/), matches = items().filter(item => tokens.every(token => [item.title, item.description, item.category, item.searchText, ...(item.tags || [])].join(" ").normalize("NFKC").toLowerCase().includes(token)));
  panel.innerHTML = '<p class="dashboard-search-count">' + matches.length + '개의 기록</p>' + matches.slice(0, 8).map(item => '<a href="#/' + (item.kind === "notes" ? "note" : "post") + '/' + encodeURIComponent(item.id) + '"><span>' + (item.kind === "notes" ? "노트" : "글") + '</span><strong>' + esc(item.title) + '</strong>' + icon("arrow-up-right") + '</a>').join("") + (matches.length ? "" : '<p class="dashboard-empty">일치하는 기록이 없어요.</p>'); panel.hidden = false; icons();
}
function unmount() { active?.controller.abort(); active = null; }
function mount(root, data, revision) {
  unmount(); if (!root) return;
  const controller = new AbortController(), signal = controller.signal;
  const context = active = { root, data, revision, controller };
  root.innerHTML = '<div class="dashboard-shortcuts" data-dashboard-shortcuts aria-label="자주 가는 사이트"></div><form class="dashboard-search-form" role="search"><div class="dashboard-search-box">' + icon("search") + '<input type="search" aria-label="블로그 내부 검색" placeholder="Archive 검색" maxlength="150" autocomplete="off" data-dashboard-search value="' + esc(query) + '"></div><div class="dashboard-search-results" data-dashboard-results hidden></div></form><div class="dashboard-grid"><section class="dashboard-panel dashboard-github"><div class="dashboard-panel-head"><h2>' + icon("git-branch") + 'GitHub</h2><a class="dashboard-text-link" href="https://github.com/yt010108" target="_blank" rel="noopener noreferrer">yt010108 ' + icon("arrow-up-right") + '</a></div><div data-github-calendar><p class="dashboard-empty">GitHub 활동을 불러오는 중…</p></div></section><fieldset class="dashboard-right dashboard-workspace-fields" data-workspace-fields aria-label="메모와 할 일" disabled><section class="dashboard-panel"><div class="dashboard-panel-head"><h2>' + icon("notebook-pen") + 'Memo</h2></div><textarea class="dashboard-memo" data-dashboard-memo aria-label="메모" maxlength="20000" placeholder="떠오른 생각을 남겨보세요."></textarea></section><section class="dashboard-panel"><div class="dashboard-panel-head"><h2>' + icon("list-todo") + 'To-do</h2><span class="dashboard-task-count" data-dashboard-task-count></span></div><div data-dashboard-tasks></div><form class="dashboard-task-form" data-workspace-task-form><input type="text" data-workspace-task-new aria-label="새 할 일" maxlength="200" placeholder="할 일 하나 추가하기" autocomplete="off"><button type="submit" data-workspace-task-add aria-label="할 일 추가"><i data-lucide="plus" aria-hidden="true"></i></button></form></section></fieldset></div><div class="dashboard-savebar"><p data-workspace-status role="status" aria-live="polite">메모·할 일을 불러오는 중…</p><div class="dashboard-save-actions"><button type="button" class="dashboard-button dashboard-connection" data-workspace-connect>GitHub 연결</button><button type="button" class="dashboard-button" data-workspace-refresh>다시 불러오기</button><button type="button" class="dashboard-button dashboard-save" data-workspace-save><i data-lucide="save" aria-hidden="true"></i>GitHub에 저장</button></div></div><dialog class="dashboard-auth-dialog" data-workspace-dialog aria-labelledby="dashboard-auth-title"><form data-workspace-auth><div class="dashboard-auth-heading"><h2 id="dashboard-auth-title">GitHub 연결</h2><button type="button" data-workspace-auth-cancel aria-label="연결 창 닫기">×</button></div><p>yt010108 계정의 이 블로그 저장소 전용 토큰으로 연결해 주세요.</p><label>개인 액세스 토큰<input type="password" data-workspace-token autocomplete="off" spellcheck="false" autocapitalize="none" required maxlength="255"></label><label class="dashboard-auth-remember"><input type="checkbox" data-workspace-remember>이 브라우저에서 연결 유지</label><p class="dashboard-auth-hint">저장 권한: yt010108.github.io · Contents 읽기·쓰기<br>GitHub에 저장한 메모와 할 일은 공개돼요.</p><p data-workspace-auth-error role="status" aria-live="polite"></p><button type="submit" class="dashboard-button dashboard-save" data-workspace-submit>연결하기</button></form></dialog><section class="dashboard-recent"><div class="dashboard-recent-head"><h2>Recent</h2><div class="dashboard-filters" aria-label="최근 기록 종류"><button type="button" data-dashboard-filter="all" aria-pressed="true">All</button><button type="button" data-dashboard-filter="posts" aria-pressed="false">Posts</button><button type="button" data-dashboard-filter="notes" aria-pressed="false">Notes</button></div><a class="dashboard-text-link" href="#/posts">기록 더 보기 ' + icon("arrow-up-right") + '</a></div><div class="dashboard-recent-grid" data-dashboard-recent></div></section><p class="dashboard-empty" data-dashboard-error role="status" hidden></p>';
  root.querySelector(".dashboard-github").insertAdjacentHTML("beforeend", projectLinks(data.projects));
  context.workspace = createDashboardWorkspace({ root, signal, readPublic: async () => validateDashboard(await publicJSON("dashboard.json", String(Date.now()))), onSaved: value => { config = value; paintConfig(); } });
  const calendarObserver = new ResizeObserver(entries => {
    if (active !== context) return;
    const width = Math.floor(entries[0].contentRect.width);
    if (width > 0 && width !== context.calendarWidth) { context.calendarWidth = width; paintCalendar(); }
  });
  calendarObserver.observe(root.querySelector("[data-github-calendar]"));
  signal.addEventListener("abort", () => calendarObserver.disconnect(), { once: true });
  paintConfig(); paintCalendar(); paintRecent();
  root.addEventListener("input", event => { if (event.target.matches("[data-dashboard-search]")) querySearch(event.target); }, { signal });
  root.querySelector(".dashboard-search-form").addEventListener("submit", event => { event.preventDefault(); querySearch(root.querySelector("[data-dashboard-search]")); }, { signal });
  root.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null; if (!target) return;
    const filter = target.closest("[data-dashboard-filter]"); if (filter) paintRecent(filter.dataset.dashboardFilter);
    if (!target.closest(".dashboard-search-form")) root.querySelector("[data-dashboard-results]").hidden = true;
  }, { signal });
  root.addEventListener("keydown", event => { if (event.key === "Escape") root.querySelector("[data-dashboard-results]").hidden = true; }, { signal });
  root.addEventListener("error", event => { if (event.target instanceof HTMLImageElement && event.target.parentElement?.hasAttribute("data-favicon-fallback")) event.target.parentElement.textContent = event.target.parentElement.dataset.faviconFallback; }, { signal, capture: true });
  publicJSON("dashboard.json", revision).then(value => { if (active !== context) return; config = validateDashboard(value); paintConfig(); }).catch(error => { if (active !== context) return; const status = root.querySelector("[data-dashboard-error]"); status.textContent = error.message; status.hidden = false; });
  refresh(true);
}
window.BlogDashboard = { html: () => '<div class="container dashboard-container"><div class="dashboard" data-dashboard></div></div>', mount, unmount, refresh, focusSearch: () => { const input = active?.root.querySelector("[data-dashboard-search]"); if (!input) return false; input.focus(); return true; } };
