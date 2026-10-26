import { createIcons, Search, Plus, NotebookPen, GitBranch, ListTodo, X, Trash2, Pencil, Save, LogOut, ArrowUpRight } from "lucide";
import { esc } from "../shared/posts.js";
import { validateDashboard, faviconURL, dashboardText } from "../shared/dashboard.js";
import { validateActivity } from "../shared/github-activity.js";
import { DashboardRepository } from "./dashboard-repository.js";
import { REMEMBER_KEY } from "../admin/src/github.js";

const base = new URL("../", document.currentScript?.src || new URL("assets/dashboard.js", location.href));
const repository = new DashboardRepository();
const state = { value: null, saved: null, sha: null, dirty: false, editing: false, busy: false, loading: false, restored: false, status: "", error: false, activity: null, revision: "", pending: false };
let active, deploymentTimer, activityChecked = 0;
const icon = name => '<i data-lucide="' + name + '" aria-hidden="true"></i>';
const icons = () => createIcons({ icons: { Search, Plus, NotebookPen, GitBranch, ListTodo, X, Trash2, Pencil, Save, LogOut, ArrowUpRight }, attrs: { width: 16, height: 16, "stroke-width": 1.5 } });
const editable = () => state.editing && repository.connected && !state.busy;
const url = (path, revision = state.revision) => { const value = new URL(path, base); value.searchParams.set("v", revision || "current"); return value; };
const clone = value => structuredClone(value);
async function publicJSON(path, fresh = false) {
  const target = url(path); if (fresh) target.searchParams.set("check", String(Date.now()));
  const response = await fetch(target, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error("대시보드를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  return response.json();
}
function report(text, error = false) { state.status = text; state.error = error; syncControls(); }
function controls() {
  const connected = state.editing && repository.connected;
  return '<span class="dashboard-save-state" role="status" aria-live="polite"' + (state.error ? ' data-error="true"' : '') + '>' + esc(state.status || (state.dirty ? "저장하지 않은 변경이 있어요." : "")) + '</span><div class="dashboard-edit-actions">' + (connected
    ? '<button type="button" class="dashboard-button" data-dashboard-action="reload" ' + (state.busy ? "disabled" : "") + '>다시 불러오기</button><button type="button" class="dashboard-button dashboard-primary" data-dashboard-action="save" ' + (state.busy || !state.dirty ? "disabled" : "") + '>' + icon("save") + (state.busy ? "저장 중…" : "GitHub에 저장") + '</button><button type="button" class="dashboard-icon-button" data-dashboard-action="disconnect" aria-label="관리자 연결 해제" title="관리자 연결 해제" ' + (state.busy ? "disabled" : "") + '>' + icon("log-out") + '</button>'
    : '<button type="button" class="dashboard-button" data-dashboard-action="edit" ' + (state.busy || state.loading ? "disabled" : "") + '>' + icon("pencil") + (state.busy ? "연결 중…" : "편집") + '</button>' + (state.error ? '<button type="button" class="dashboard-button" data-dashboard-action="reload">다시 불러오기</button>' : "")) + '</div>';
}
function syncControls() {
  if (!active?.root.isConnected) return;
  active.root.querySelector("[data-dashboard-controls]").innerHTML = controls();
  active.root.querySelectorAll("[data-owner-only]").forEach(node => { node.hidden = !state.editing || !repository.connected; });
  const memo = active.root.querySelector("[data-dashboard-memo]");
  if (memo) memo.readOnly = !editable();
  active.root.querySelectorAll("[data-task-toggle], [data-task-remove], [data-shortcut-edit], [data-task-form] input, [data-task-form] button, [data-dashboard-action='add-shortcut']").forEach(node => { node.disabled = !editable(); });
  icons();
}
function markDirty() {
  const fields = value => JSON.stringify([value.memo, value.tasks, value.shortcuts]);
  state.dirty = !state.saved || fields(state.value) !== fields(state.saved);
  report(state.dirty ? "저장하지 않은 변경이 있어요." : "저장된 내용과 같아요.");
}
function shortcuts() {
  return (state.value?.shortcuts || []).map(item => '<div class="dashboard-shortcut-item"><a class="dashboard-shortcut" href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer"><span class="dashboard-shortcut-icon" data-favicon-fallback="' + esc(item.title.slice(0, 1)) + '"><img src="' + esc(faviconURL(item.url)) + '" width="25" height="25" alt="" referrerpolicy="no-referrer"></span><span>' + esc(item.title) + '</span></a><button type="button" class="dashboard-shortcut-edit" data-shortcut-edit="' + item.id + '" data-owner-only aria-label="' + esc(item.title) + ' 바로가기 수정" ' + (!editable() ? "disabled" : "") + '>' + icon("pencil") + '</button></div>').join("") + '<button class="dashboard-shortcut dashboard-shortcut-add" type="button" data-dashboard-action="add-shortcut" data-owner-only><span class="dashboard-shortcut-icon">' + icon("plus") + '</span><span>사이트 추가</span></button>';
}
function tasks() {
  const items = state.value?.tasks || [];
  return items.length ? items.map(task => '<div class="dashboard-task"><label><input type="checkbox" data-task-toggle="' + task.id + '" ' + (task.done ? "checked " : "") + (!editable() ? "disabled " : "") + '><span>' + esc(task.text) + '</span></label><button type="button" class="dashboard-icon-button" data-task-remove="' + task.id + '" data-owner-only aria-label="' + esc(task.text) + ' 할 일 삭제">' + icon("x") + '</button></div>').join("") : '<p class="dashboard-empty">등록한 할 일이 없어요.</p>';
}
function paintTasks() {
  if (!active?.root.isConnected) return;
  active.root.querySelector("[data-dashboard-tasks]").innerHTML = tasks();
  active.root.querySelector("[data-dashboard-task-count]").textContent = (state.value?.tasks.filter(task => task.done).length || 0) + "/" + (state.value?.tasks.length || 0);
  syncControls();
}
function recentItems() {
  return [...(active?.data.posts || []), ...(active?.data.notes || [])].filter(item => !item.sample).sort((a, b) => b.date.localeCompare(a.date) || (b.publishedAt || "").localeCompare(a.publishedAt || ""));
}
function paintRecent(filter = "all") {
  if (!active?.root.isConnected) return;
  active.filter = filter;
  const entries = recentItems().filter(item => filter === "all" || item.kind === filter).slice(0, 3);
  active.root.querySelector("[data-dashboard-recent]").innerHTML = entries.length ? entries.map(item => '<a class="dashboard-entry" href="#/' + (item.kind === "notes" ? "note" : "post") + '/' + encodeURIComponent(item.id) + '"><div class="dashboard-entry-meta"><span>' + (item.kind === "notes" ? "NOTE" : "POST") + (item.category ? " / " + esc(item.category) : "") + '</span>' + icon("arrow-up-right") + '</div><h3>' + esc(item.title) + '</h3><p>' + esc(item.description || "") + '</p><time datetime="' + esc(item.date) + '">' + esc(item.date.replaceAll("-", ".")) + '</time></a>').join("") : '<p class="dashboard-empty">아직 표시할 기록이 없어요.</p>';
  active.root.querySelectorAll("[data-dashboard-filter]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.dashboardFilter === filter)));
  icons();
}
function calendar(days, caption, className) {
  const prefix = new Date(days[0].date + "T00:00:00Z").getUTCDay();
  const cells = Array.from({ length: prefix }, () => '<span class="dashboard-day dashboard-day-blank"></span>').join("") + days.map(day => '<span class="dashboard-day" data-level="' + day.level + '" title="' + day.date + " · " + (day.count === null ? ["활동 없음", "기여 적음", "기여 보통", "기여 많음", "기여 매우 많음"][day.level] : day.count + " contributions") + '"></span>').join("");
  const month = day => Number(day.date.slice(5, 7)) + "월";
  return '<div class="' + className + '"><div class="dashboard-calendar-caption"><span>' + caption + '</span><span>' + esc(days[0].date.replaceAll("-", ".")) + " — " + esc(days.at(-1).date.replaceAll("-", ".")) + '</span></div><div class="dashboard-months" aria-hidden="true"><span>' + month(days[0]) + '</span><span>' + month(days[Math.floor(days.length / 2)]) + '</span><span>' + month(days.at(-1)) + '</span></div><div class="dashboard-calendar-grid" role="img" aria-label="' + esc(caption + " GitHub 기여도, " + days[0].date + "부터 " + days.at(-1).date + "까지") + '" style="--calendar-weeks:' + Math.ceil((prefix + days.length) / 7) + '">' + cells + '</div></div>';
}
function paintCalendar() {
  const node = active?.root.querySelector("[data-github-calendar]"); if (!node) return;
  const activity = state.activity;
  if (!activity) { node.innerHTML = '<p class="dashboard-empty">GitHub 활동을 불러오는 중…</p>'; return; }
  if (!activity.available) { node.innerHTML = '<p class="dashboard-empty">GitHub 활동을 불러오지 못했어요.<br><a href="https://github.com/yt010108" target="_blank" rel="noopener noreferrer">GitHub에서 확인 ↗</a></p>'; return; }
  node.innerHTML = calendar(activity.days, "최근 1년", "dashboard-calendar-year") + calendar(activity.days.slice(-182), "최근 6개월", "dashboard-calendar-half") + '<div class="dashboard-calendar-foot"><span>GitHub 공개 활동</span><span class="dashboard-calendar-legend">적음 ' + [0, 1, 2, 3, 4].map(level => '<span class="dashboard-day" data-level="' + level + '"></span>').join("") + ' 많음</span></div><p class="dashboard-calendar-updated">' + esc(activity.fetchedAt.slice(0, 10).replaceAll("-", ".")) + ' 업데이트</p>';
}
function refresh(force = false) {
  if (!active?.root.isConnected || (!force && Date.now() - activityChecked < 300000)) return;
  activityChecked = Date.now();
  publicJSON("assets/github-activity.json", true).then(value => { state.activity = validateActivity(value); paintCalendar(); }).catch(() => { if (!state.activity) { state.activity = { available: false }; paintCalendar(); } });
}
function paint() {
  if (!active?.root.isConnected) return;
  const root = active.root;
  root.innerHTML = '<div class="dashboard-shortcuts" aria-label="자주 가는 사이트">' + shortcuts() + '</div><form class="dashboard-search-form" role="search"><div class="dashboard-search-box">' + icon("search") + '<input type="search" aria-label="블로그 내부 검색" maxlength="150" autocomplete="off" data-dashboard-search></div><div class="dashboard-search-results" data-dashboard-results hidden></div></form><div class="dashboard-control-row" data-dashboard-controls>' + controls() + '</div><div class="dashboard-grid"><section class="dashboard-panel dashboard-github"><div class="dashboard-panel-head"><h2>' + icon("git-branch") + 'GitHub 활동</h2><a class="dashboard-text-link" href="https://github.com/yt010108" target="_blank" rel="noopener noreferrer">yt010108 ' + icon("arrow-up-right") + '</a></div><div data-github-calendar></div></section><aside class="dashboard-right" aria-label="메모와 할 일"><section class="dashboard-panel"><div class="dashboard-panel-head"><h2>' + icon("notebook-pen") + '메모</h2></div><textarea class="dashboard-memo" data-dashboard-memo aria-label="대시보드 메모" maxlength="20000" placeholder="' + (state.editing ? "떠오른 생각을 남겨보세요." : "아직 남긴 메모가 없어요.") + '" ' + (!editable() ? "readonly" : "") + '>' + esc(state.value?.memo || "") + '</textarea></section><section class="dashboard-panel"><div class="dashboard-panel-head"><h2>' + icon("list-todo") + '해야 할 일</h2><span class="dashboard-task-count" data-dashboard-task-count></span></div><div data-dashboard-tasks>' + tasks() + '</div><form class="dashboard-task-form" data-task-form data-owner-only><input type="text" aria-label="새 할 일" maxlength="200" placeholder="할 일 하나 추가하기" required><button type="submit" class="dashboard-icon-button" aria-label="할 일 추가">' + icon("plus") + '</button></form></section></aside></div><section class="dashboard-recent"><div class="dashboard-recent-head"><h2>최근의 기록</h2><div class="dashboard-filters" aria-label="최근 기록 종류"><button type="button" data-dashboard-filter="all" aria-pressed="true">전체</button><button type="button" data-dashboard-filter="posts" aria-pressed="false">글</button><button type="button" data-dashboard-filter="notes" aria-pressed="false">노트</button></div><a class="dashboard-text-link" href="#/posts">기록 더 보기 ' + icon("arrow-up-right") + '</a></div><div class="dashboard-recent-grid" data-dashboard-recent></div></section><dialog class="dashboard-dialog" data-dashboard-auth aria-labelledby="dashboard-auth-title"><form data-dashboard-auth-form><div class="dashboard-dialog-head"><h2 id="dashboard-auth-title">대시보드 편집</h2><button type="button" class="dashboard-icon-button" data-dashboard-action="close-dialog" aria-label="닫기">' + icon("x") + '</button></div><p>yt010108 관리자 연결 후 편집할 수 있어요. 저장한 내용은 공개 대시보드에 표시돼요.</p><fieldset><label class="dashboard-field">개인 액세스 토큰<input type="password" name="token" autocomplete="off" required spellcheck="false" aria-label="개인 액세스 토큰"></label><label class="dashboard-remember"><input type="checkbox" name="remember">이 브라우저에서 연결 유지</label><p class="dashboard-dialog-message" data-auth-message role="alert"></p><button type="submit" class="dashboard-button dashboard-primary">연결하기</button></fieldset></form></dialog><dialog class="dashboard-dialog" data-dashboard-shortcut-dialog aria-labelledby="dashboard-shortcut-title"><form data-shortcut-form><div class="dashboard-dialog-head"><h2 id="dashboard-shortcut-title">사이트 바로가기</h2><button type="button" class="dashboard-icon-button" data-dashboard-action="close-dialog" aria-label="닫기">' + icon("x") + '</button></div><label class="dashboard-field">이름<input name="title" maxlength="40" required></label><label class="dashboard-field">주소<input name="url" type="url" maxlength="1500" placeholder="https://" required></label><p class="dashboard-dialog-message" data-shortcut-message role="alert"></p><div class="dashboard-dialog-actions"><button class="dashboard-button" type="button" data-dashboard-action="remove-shortcut">삭제</button><button class="dashboard-button dashboard-primary" type="submit">적용</button></div></form></dialog>';
  paintCalendar(); paintTasks(); paintRecent(active.filter || "all"); syncControls();
}
async function loadPublic() {
  state.loading = !state.value; syncControls();
  try {
    const value = validateDashboard(await publicJSON("dashboard.json"));
    if (!state.dirty && !state.editing && !state.busy) { state.value = value; state.saved = clone(value); state.status = ""; state.error = false; paint(); }
  } catch (error) { if (!state.value) report(error.message, true); }
  finally { state.loading = false; syncControls(); }
}
async function enableEditing() {
  const latest = await repository.readDashboard();
  if (state.dirty && state.sha && latest.sha !== state.sha) {
    state.editing = true; paint();
    report("다른 기기의 저장본이 바뀌었어요. 현재 입력은 유지했으니 복사한 뒤 다시 불러와 주세요.", true); return;
  }
  if (!state.dirty) { state.value = latest.config; state.saved = clone(latest.config); }
  state.sha = latest.sha; state.editing = true;
  state.status = state.dirty ? "저장하지 않은 변경이 있어요." : "메모·할 일·바로가기를 편집할 수 있어요."; state.error = false;
  paint();
}
async function startEditing() {
  if (state.busy || state.loading) return;
  if (!repository.connected && !repository.hasSavedConnection) {
    const dialog = active.root.querySelector("[data-dashboard-auth]"); dialog.showModal(); dialog.querySelector("input").focus(); return;
  }
  state.busy = true; syncControls();
  try { if (!repository.connected) await repository.restore(); await enableEditing(); }
  catch (error) { report(error.message, true); }
  finally { state.busy = false; syncControls(); }
}
async function save() {
  if (!editable() || !state.dirty) return;
  state.busy = true; syncControls();
  try {
    const result = await repository.saveDashboard(state.value, state.sha);
    state.value = result.config; state.saved = clone(result.config); state.sha = result.sha; state.dirty = false; state.pending = true;
    state.status = "GitHub에 저장했어요. 사이트 배포를 기다리는 중이에요."; state.error = false;
    paint(); checkDeployment();
  } catch (error) { report(error.message, true); }
  finally { state.busy = false; syncControls(); }
}
async function checkDeployment(attempt = 0) {
  clearTimeout(deploymentTimer);
  if (!state.pending || !active?.root.isConnected) return;
  try {
    const value = validateDashboard(await publicJSON("dashboard.json", true));
    if (dashboardText(value) === dashboardText(state.saved)) { state.pending = false; if (!state.dirty) report("저장한 내용이 사이트에 반영됐어요."); return; }
  } catch {}
  if (attempt < 45) deploymentTimer = setTimeout(() => checkDeployment(attempt + 1), 4000);
  else if (!state.dirty) report("GitHub 저장은 완료됐어요. 사이트 배포가 끝나면 다른 브라우저에도 반영돼요.");
}
function openShortcut(id) {
  if (!editable()) return;
  const dialog = active.root.querySelector("[data-dashboard-shortcut-dialog]"), form = dialog.querySelector("form");
  const item = state.value.shortcuts.find(link => link.id === id);
  form.dataset.id = item?.id || ""; form.elements.title.value = item?.title || ""; form.elements.url.value = item?.url || "";
  dialog.querySelector("[data-dashboard-action='remove-shortcut']").hidden = !item;
  dialog.querySelector("[data-shortcut-message]").textContent = ""; dialog.showModal(); form.elements.title.focus();
}
function querySearch(input) {
  const root = active.root, panel = root.querySelector("[data-dashboard-results]"), query = input.value.normalize("NFKC").toLowerCase().trim();
  if (!query) { panel.hidden = true; return; }
  const tokens = query.split(/\s+/), matches = recentItems().filter(item => tokens.every(token => [item.title, item.description, item.category, item.searchText, ...(item.tags || [])].join(" ").normalize("NFKC").toLowerCase().includes(token)));
  panel.innerHTML = '<p class="dashboard-search-count">' + matches.length + '개의 기록</p>' + matches.slice(0, 8).map(item => '<a href="#/' + (item.kind === "notes" ? "note" : "post") + '/' + encodeURIComponent(item.id) + '"><span>' + (item.kind === "notes" ? "노트" : "글") + '</span><strong>' + esc(item.title) + '</strong>' + icon("arrow-up-right") + '</a>').join("") + (matches.length ? "" : '<p class="dashboard-empty">일치하는 기록이 없어요.</p>');
  panel.hidden = false; icons();
}
function unmount() { clearTimeout(deploymentTimer); active?.controller.abort(); active = null; }
function mount(root, data, revision) {
  unmount(); if (!root) return;
  const changedRevision = state.revision !== revision;
  state.revision = revision;
  const controller = new AbortController(), signal = controller.signal;
  active = { root, data, controller, filter: "all" }; paint();
  root.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null; if (!target) return;
    const action = target.closest("[data-dashboard-action]")?.dataset.dashboardAction;
    if (action === "edit") startEditing();
    if (action === "save") save();
    if (action === "reload") {
      if (state.busy || (state.dirty && !confirm("저장하지 않은 입력을 버리고 최신 저장본을 불러올까요?"))) return;
      state.dirty = false; state.value = state.saved ? clone(state.saved) : null;
      if (repository.connected) startEditing(); else loadPublic();
    }
    if (action === "disconnect") {
      if (state.busy || (state.dirty && !confirm("저장하지 않은 입력을 버리고 관리자 연결을 해제할까요?"))) return;
      state.dirty = false; state.value = clone(state.saved); repository.disconnect(); state.editing = false; state.status = "관리자 연결을 해제했어요."; state.error = false; paint();
    }
    if (action === "close-dialog") { const dialog = target.closest("dialog"); if (dialog?.matches("[data-dashboard-auth]")) dialog.querySelector("input[type=password]").value = ""; dialog?.close(); }
    if (action === "add-shortcut") { if (state.value.shortcuts.length >= 24) report("바로가기는 24개까지 저장할 수 있어요.", true); else openShortcut(); }
    if (action === "remove-shortcut" && editable()) {
      const dialog = target.closest("dialog"), id = dialog.querySelector("form").dataset.id;
      state.value.shortcuts = state.value.shortcuts.filter(item => item.id !== id); dialog.close(); markDirty(); paint();
    }
    const shortcut = target.closest("[data-shortcut-edit]"); if (shortcut) openShortcut(shortcut.dataset.shortcutEdit);
    const remove = target.closest("[data-task-remove]");
    if (remove && editable()) { state.value.tasks = state.value.tasks.filter(item => item.id !== remove.dataset.taskRemove); markDirty(); paintTasks(); }
    const filter = target.closest("[data-dashboard-filter]"); if (filter) paintRecent(filter.dataset.dashboardFilter);
    if (!target.closest(".dashboard-search-form")) root.querySelector("[data-dashboard-results]").hidden = true;
  }, { signal });
  root.addEventListener("input", event => {
    if (event.target.matches("[data-dashboard-search]")) querySearch(event.target);
    if (event.target.matches("[data-dashboard-memo]") && editable()) { state.value.memo = event.target.value; markDirty(); }
  }, { signal });
  root.addEventListener("change", event => {
    if (!event.target.matches("[data-task-toggle]") || !editable()) return;
    const item = state.value.tasks.find(task => task.id === event.target.dataset.taskToggle);
    if (item) { item.done = event.target.checked; markDirty(); paintTasks(); }
  }, { signal });
  root.addEventListener("submit", async event => {
    event.preventDefault(); const form = event.target;
    if (form.matches(".dashboard-search-form")) { querySearch(form.querySelector("input")); return; }
    if (form.matches("[data-dashboard-auth-form]")) {
      if (state.busy) return;
      const fieldset = form.querySelector("fieldset"), message = form.querySelector("[data-auth-message]");
      state.busy = true; fieldset.disabled = true; syncControls(); message.textContent = "관리자 권한을 확인하고 있어요…";
      try { await repository.connect(form.elements.token.value, { remember: form.elements.remember.checked }); form.elements.token.value = ""; await enableEditing(); }
      catch (error) { message.textContent = error.message; }
      finally { state.busy = false; fieldset.disabled = false; syncControls(); }
      return;
    }
    if (!editable()) return;
    if (form.matches("[data-task-form]")) {
      const input = form.querySelector("input"), text = input.value.trim();
      if (!text) return; if (state.value.tasks.length >= 100) { report("할 일은 100개까지 저장할 수 있어요.", true); return; }
      state.value.tasks.push({ id: crypto.randomUUID(), text, done: false }); input.value = ""; markDirty(); paintTasks(); input.focus();
    }
    if (form.matches("[data-shortcut-form]")) {
      try {
        const item = { id: form.dataset.id || crypto.randomUUID(), title: form.elements.title.value, url: form.elements.url.value };
        const next = clone(state.value), index = next.shortcuts.findIndex(link => link.id === item.id);
        if (index < 0) next.shortcuts.push(item); else next.shortcuts[index] = item;
        state.value = validateDashboard(next); form.closest("dialog").close(); markDirty(); paint();
      } catch (error) { form.querySelector("[data-shortcut-message]").textContent = error.message; }
    }
  }, { signal });
  root.addEventListener("error", event => {
    if (event.target instanceof HTMLImageElement && event.target.parentElement?.hasAttribute("data-favicon-fallback")) event.target.parentElement.textContent = event.target.parentElement.dataset.faviconFallback;
  }, { signal, capture: true });
  root.addEventListener("keydown", event => { if (event.key === "Escape") root.querySelector("[data-dashboard-results]").hidden = true; }, { signal });
  root.addEventListener("close", event => { if (event.target.matches("[data-dashboard-auth]")) event.target.querySelector("input[type=password]").value = ""; }, { signal, capture: true });
  (async () => {
    if (!state.value || (changedRevision && !state.editing && !state.dirty)) await loadPublic();
    if (!state.restored && repository.hasSavedConnection) { state.restored = true; await startEditing(); }
    else if (repository.connected && !state.busy && !state.dirty) await startEditing();
    if (state.pending) checkDeployment();
  })().catch(error => report(error.message, true));
  refresh(!state.activity || changedRevision);
}
repository.addEventListener("change", () => { if (!repository.connected) state.editing = false; syncControls(); });
window.addEventListener("beforeunload", event => { if (state.dirty || state.busy) { event.preventDefault(); event.returnValue = ""; } });
window.addEventListener("storage", event => { if ((event.key === REMEMBER_KEY || event.key === null) && !event.newValue && repository.remembered) { repository.disconnect({ forget: false }); state.editing = false; paint(); } });
window.BlogDashboard = { html: () => '<div class="container dashboard-container"><div class="dashboard" data-dashboard></div></div>', mount, unmount, refresh, focusSearch: () => { const input = active?.root.querySelector("[data-dashboard-search]"); if (!input || active.root.querySelector('dialog[open]')) return false; input.focus(); return true; } };
