import { createIcons, Search, NotebookPen, GitBranch, ListTodo, ArrowUpRight, ChevronLeft, ChevronRight } from "lucide";
import { esc } from "../shared/posts.js";
import { validateDashboard, faviconURL } from "../shared/dashboard.js";
import { validateActivity, contributionPeriod } from "../shared/github-activity.js";

const base = new URL("../", document.currentScript?.src || new URL("assets/dashboard.js", location.href));
let active, config, activity, query = "", activityChecked = 0;
let calendarMonths = 6, calendarAnchor = null;
const icon = name => '<i data-lucide="' + name + '" aria-hidden="true"></i>';
const icons = () => createIcons({ icons: { Search, NotebookPen, GitBranch, ListTodo, ArrowUpRight, ChevronLeft, ChevronRight }, attrs: { width: 16, height: 16, "stroke-width": 1.5 } });
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
  const memo = active.root.querySelector("[data-dashboard-memo]"); memo.textContent = config.memo || "아직 남긴 메모가 없어요."; memo.classList.toggle("is-empty", !config.memo);
  active.root.querySelector("[data-dashboard-tasks]").innerHTML = config.tasks.length ? config.tasks.map(task => '<div class="dashboard-task"><label><input type="checkbox" disabled ' + (task.done ? "checked" : "") + '><span>' + esc(task.text) + '</span></label></div>').join("") : '<p class="dashboard-empty">등록한 할 일이 없어요.</p>';
  active.root.querySelector("[data-dashboard-task-count]").textContent = config.tasks.filter(task => task.done).length + "/" + config.tasks.length;
}
function paintRecent(filter = "all") {
  if (!active?.root.isConnected) return;
  active.filter = filter;
  const entries = items().filter(item => filter === "all" || item.kind === filter).slice(0, 3);
  active.root.querySelector("[data-dashboard-recent]").innerHTML = entries.length ? entries.map(item => '<a class="dashboard-entry" href="#/' + (item.kind === "notes" ? "note" : "post") + '/' + encodeURIComponent(item.id) + '"><div class="dashboard-entry-meta"><span>' + (item.kind === "notes" ? "NOTE" : "POST") + (item.category ? " / " + esc(item.category) : "") + '</span>' + icon("arrow-up-right") + '</div><h3>' + esc(item.title) + '</h3><p>' + esc(item.description || "") + '</p><time datetime="' + esc(item.date) + '">' + esc(item.date.replaceAll("-", ".")) + '</time></a>').join("") : '<p class="dashboard-empty">아직 표시할 기록이 없어요.</p>';
  active.root.querySelectorAll("[data-dashboard-filter]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.dashboardFilter === filter))); icons();
}
function calendar() {
  const period = contributionPeriod(activity.days, calendarMonths, calendarAnchor || activity.days.at(-1).date);
  const cells = period.cells.map(day => {
    if (day.state === "padding") return '<span class="dashboard-day dashboard-day-blank"></span>';
    const recorded = day.state === "recorded", label = recorded ? day.count === null ? ["활동 없음", "기여 적음", "기여 보통", "기여 많음", "기여 매우 많음"][day.level] : day.count + " contributions" : day.state === "pending" ? "아직 집계되지 않은 날짜" : "수집된 활동 데이터가 없는 날짜";
    return '<span class="dashboard-day' + (recorded ? "" : " dashboard-day-unavailable") + '" data-calendar-date="' + day.date + '"' + (recorded ? ' data-level="' + day.level + '"' : '') + ' title="' + esc(day.date + " · " + label) + '"></span>';
  }).join("");
  return '<div class="dashboard-calendar-toolbar"><div class="dashboard-calendar-modes" role="group" aria-label="GitHub 활동 표시 단위"><button type="button" data-calendar-months="6" aria-pressed="' + (calendarMonths === 6) + '">반년</button><button type="button" data-calendar-months="3" aria-pressed="' + (calendarMonths === 3) + '">분기</button></div><div class="dashboard-calendar-navigation"><button type="button" data-calendar-period="previous" aria-label="이전 기간" ' + (!period.previous ? "disabled" : "") + '>' + icon("chevron-left") + '</button><span class="dashboard-calendar-period" aria-live="polite">' + esc(period.label) + '</span><button type="button" data-calendar-period="next" aria-label="다음 기간" ' + (!period.next ? "disabled" : "") + '>' + icon("chevron-right") + '</button></div></div><div class="dashboard-calendar-chart" style="--calendar-weeks:' + period.weeks + '"><div class="dashboard-months" aria-hidden="true">' + period.labels.map(label => '<span style="grid-column:' + label.column + '">' + label.month + '월</span>').join("") + '</div><div class="dashboard-weekdays" aria-hidden="true"><span style="grid-row:2">월</span><span style="grid-row:4">수</span><span style="grid-row:6">금</span></div><div class="dashboard-calendar-grid" role="img" aria-label="' + esc(period.label + " GitHub 기여도. 옅은 칸은 아직 집계되지 않았거나 활동 데이터가 없는 날짜입니다.") + '">' + cells + '</div></div>';
}
function paintCalendar() {
  const node = active?.root.querySelector("[data-github-calendar]"); if (!node || !activity) return;
  node.innerHTML = activity.available ? calendar() + '<div class="dashboard-calendar-foot"><span>GitHub 공개 활동</span><span class="dashboard-calendar-legend">적음 ' + [0, 1, 2, 3, 4].map(level => '<span class="dashboard-day" data-level="' + level + '"></span>').join("") + ' 많음</span></div><p class="dashboard-calendar-updated">' + esc(activity.fetchedAt.slice(0, 10).replaceAll("-", ".")) + ' 업데이트</p>' : '<p class="dashboard-empty">GitHub 활동을 불러오지 못했어요.<br><a href="https://github.com/yt010108" target="_blank" rel="noopener noreferrer">GitHub에서 확인 ↗</a></p>';
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
  root.innerHTML = '<div class="dashboard-shortcuts" data-dashboard-shortcuts aria-label="자주 가는 사이트"></div><form class="dashboard-search-form" role="search"><div class="dashboard-search-box">' + icon("search") + '<input type="search" aria-label="블로그 내부 검색" maxlength="150" autocomplete="off" data-dashboard-search value="' + esc(query) + '"></div><div class="dashboard-search-results" data-dashboard-results hidden></div></form><div class="dashboard-grid"><section class="dashboard-panel dashboard-github"><div class="dashboard-panel-head"><h2>' + icon("git-branch") + 'GitHub 활동</h2><a class="dashboard-text-link" href="https://github.com/yt010108" target="_blank" rel="noopener noreferrer">yt010108 ' + icon("arrow-up-right") + '</a></div><div data-github-calendar><p class="dashboard-empty">GitHub 활동을 불러오는 중…</p></div></section><aside class="dashboard-right" aria-label="메모와 할 일"><section class="dashboard-panel"><div class="dashboard-panel-head"><h2>' + icon("notebook-pen") + '메모</h2></div><div class="dashboard-memo" data-dashboard-memo></div></section><section class="dashboard-panel"><div class="dashboard-panel-head"><h2>' + icon("list-todo") + '해야 할 일</h2><span class="dashboard-task-count" data-dashboard-task-count></span></div><div data-dashboard-tasks></div></section></aside></div><section class="dashboard-recent"><div class="dashboard-recent-head"><h2>최근의 기록</h2><div class="dashboard-filters" aria-label="최근 기록 종류"><button type="button" data-dashboard-filter="all" aria-pressed="true">전체</button><button type="button" data-dashboard-filter="posts" aria-pressed="false">글</button><button type="button" data-dashboard-filter="notes" aria-pressed="false">노트</button></div><a class="dashboard-text-link" href="#/posts">기록 더 보기 ' + icon("arrow-up-right") + '</a></div><div class="dashboard-recent-grid" data-dashboard-recent></div></section><p class="dashboard-empty" data-dashboard-error role="status" hidden></p>';
  paintConfig(); paintCalendar(); paintRecent();
  root.addEventListener("input", event => { if (event.target.matches("[data-dashboard-search]")) querySearch(event.target); }, { signal });
  root.addEventListener("submit", event => { event.preventDefault(); querySearch(root.querySelector("[data-dashboard-search]")); }, { signal });
  root.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null; if (!target) return;
    const filter = target.closest("[data-dashboard-filter]"); if (filter) paintRecent(filter.dataset.dashboardFilter);
    const mode = target.closest("[data-calendar-months]"), direction = target.closest("[data-calendar-period]");
    if (activity?.available && (mode || direction)) {
      const period = contributionPeriod(activity.days, calendarMonths, calendarAnchor || activity.days.at(-1).date);
      if (mode) { calendarAnchor = period.end < activity.days.at(-1).date ? period.end : activity.days.at(-1).date; calendarMonths = Number(mode.dataset.calendarMonths); }
      else calendarAnchor = direction.dataset.calendarPeriod === "previous" ? period.previous : period.next;
      paintCalendar();
      root.querySelector(mode ? '[data-calendar-months="' + calendarMonths + '"]' : '[data-calendar-period="' + direction.dataset.calendarPeriod + '"]')?.focus({ preventScroll: true });
    }
    if (!target.closest(".dashboard-search-form")) root.querySelector("[data-dashboard-results]").hidden = true;
  }, { signal });
  root.addEventListener("keydown", event => { if (event.key === "Escape") root.querySelector("[data-dashboard-results]").hidden = true; }, { signal });
  root.addEventListener("error", event => { if (event.target instanceof HTMLImageElement && event.target.parentElement?.hasAttribute("data-favicon-fallback")) event.target.parentElement.textContent = event.target.parentElement.dataset.faviconFallback; }, { signal, capture: true });
  publicJSON("dashboard.json", revision).then(value => { if (active !== context) return; config = validateDashboard(value); paintConfig(); }).catch(error => { if (active !== context) return; const status = root.querySelector("[data-dashboard-error]"); status.textContent = error.message; status.hidden = false; });
  refresh(true);
}
window.BlogDashboard = { html: () => '<div class="container dashboard-container"><div class="dashboard" data-dashboard></div></div>', mount, unmount, refresh, focusSearch: () => { const input = active?.root.querySelector("[data-dashboard-search]"); if (!input) return false; input.focus(); return true; } };
